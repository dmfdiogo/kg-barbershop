import {
  getMockBillingStore,
  type BillingCheckoutSessionRecord,
} from '@/lib/billing/mock-store';
import { BILLING_PLANS, isBillingPlanCode } from '@/lib/billing/plans';
import type { BillingSubscriptionStatus } from '@/lib/billing/types';
import { listAllTenantIds } from '@/lib/tenant/context';
import { forTenant } from '@/lib/tenant/db';

/**
 * Leitura do console `/dev/billing` (F8.0-A).
 *
 * Duas verdades têm de aparecer lado a lado, como no `/dev/payments`:
 *
 *   - a do PROVEDOR, que vive no store em memória do mock (`contexto-comum.md`
 *     §5.3 — dado falso de provider não mora no schema de domínio);
 *   - a da APLICAÇÃO, que é o `PlatformSub` persistido e só muda quando o
 *     webhook chega. É esta coluna que prova o caminho assíncrono.
 *
 * A leitura do `PlatformSub` passa por `forTenant`, com a RLS em vigor — o
 * console não é porta de bypass. A travessia de tenants usa
 * `listAllTenantIds()`, o mesmo caminho dos crons, porque o webhook e o console
 * são atores de sistema sem tenant no caminho.
 */

export interface BillingConsoleTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Assinatura vista pela aplicação (persistida), não pelo mock. */
  appPlan: string | null;
  appStatus: BillingSubscriptionStatus | null;
  appCurrentPeriodEnd: string | null;
  /** Só faz sentido abrir checkout se não há assinatura vigente. */
  canStartCheckout: boolean;
}

export interface BillingConsoleCustomer {
  id: string;
  tenantId: string;
  name: string;
  email?: string;
}

export interface BillingConsoleSession {
  id: string;
  customerId: string;
  customerName: string | null;
  tenantId: string | null;
  plan: string;
  planName: string;
  priceCents: number | null;
  status: BillingCheckoutSessionRecord['status'];
  createdAt: string;
  expiresAt: string;
  trialEndsAt?: string;
}

export interface BillingConsoleSubscription {
  id: string;
  customerId: string;
  customerName: string | null;
  tenantId: string | null;
  plan: string;
  planName: string;
  amountCents: number;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: string;
  /** Estado da assinatura na aplicação; só muda por webhook. */
  appStatus: BillingSubscriptionStatus | null;
  appPlan: string | null;
}

export interface BillingConsoleDelivery {
  id: string;
  eventId: string;
  type: string;
  url: string;
  delivered: boolean;
  httpStatus?: number;
  error?: string;
  at: string;
}

export interface BillingConsoleData {
  tenants: BillingConsoleTenant[];
  customers: BillingConsoleCustomer[];
  sessions: BillingConsoleSession[];
  subscriptions: BillingConsoleSubscription[];
  deliveries: BillingConsoleDelivery[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function planName(code: string): string {
  return isBillingPlanCode(code) ? BILLING_PLANS[code].name : code;
}

function planPrice(code: string): number | null {
  return isBillingPlanCode(code) ? BILLING_PLANS[code].priceCents : null;
}

interface PlatformSubSnapshot {
  plan: string;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: Date | null;
}

async function loadTenants(): Promise<{
  tenants: BillingConsoleTenant[];
  appSubs: Map<string, PlatformSubSnapshot>;
}> {
  const tenants: BillingConsoleTenant[] = [];
  const appSubs = new Map<string, PlatformSubSnapshot>();

  for (const tenantId of await listAllTenantIds()) {
    const row = await forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, status: true },
      });
      const subscription = await tx.platformSub.findUnique({
        where: { tenantId },
        select: { plan: true, status: true, currentPeriodEnd: true },
      });
      return { tenant, subscription };
    });
    if (!row.tenant) {
      continue;
    }

    if (row.subscription) {
      appSubs.set(tenantId, {
        plan: row.subscription.plan,
        status: row.subscription.status,
        currentPeriodEnd: row.subscription.currentPeriodEnd,
      });
    }

    tenants.push({
      id: row.tenant.id,
      name: row.tenant.name,
      slug: row.tenant.slug,
      status: row.tenant.status,
      appPlan: row.subscription?.plan ?? null,
      appStatus: row.subscription?.status ?? null,
      appCurrentPeriodEnd: row.subscription?.currentPeriodEnd?.toISOString() ?? null,
      canStartCheckout: !row.subscription || row.subscription.status === 'CANCELED',
    });
  }

  tenants.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { tenants, appSubs };
}

export async function loadBillingConsoleData(): Promise<BillingConsoleData> {
  const store = getMockBillingStore();
  const { tenants, appSubs } = await loadTenants();

  const customers = [...store.customers.values()].map(clone);

  const sessions = [...store.checkoutSessions.values()]
    .map((session) => {
      const customer = store.customers.get(session.customerId);
      return {
        id: session.id,
        customerId: session.customerId,
        customerName: customer?.name ?? null,
        tenantId: customer?.tenantId ?? null,
        plan: session.plan,
        planName: planName(session.plan),
        priceCents: planPrice(session.plan),
        status: session.status,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ...(session.trialEndsAt ? { trialEndsAt: session.trialEndsAt } : {}),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const subscriptions = [...store.subscriptions.values()]
    .map((subscription) => {
      const customer = store.customers.get(subscription.customerId);
      const app = customer ? appSubs.get(customer.tenantId) : undefined;
      return {
        id: subscription.id,
        customerId: subscription.customerId,
        customerName: customer?.name ?? null,
        tenantId: customer?.tenantId ?? null,
        plan: subscription.plan,
        planName: planName(subscription.plan),
        amountCents: subscription.amountCents,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        ...(subscription.trialEndsAt ? { trialEndsAt: subscription.trialEndsAt } : {}),
        appStatus: app?.status ?? null,
        appPlan: app?.plan ?? null,
      };
    })
    .sort((a, b) => b.currentPeriodEnd.localeCompare(a.currentPeriodEnd));

  const deliveries = store.webhookDeliveries.slice(0, 20).map(clone);

  return { tenants, customers, sessions, subscriptions, deliveries };
}
