'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { deletionRefusalMessage } from './messages';
import {
  createService,
  deleteService,
  setServiceActive,
  updateService,
} from './services';
import type { ServiceActionResult, ServiceFormInput } from './types';
import { validateServiceForm } from './validation';

/**
 * Server actions do catálogo de serviços (tarefa F2.1).
 *
 * Toda ação revalida o papel com `requireRole('OWNER')`: o portão da tela
 * (`servicos/layout.tsx`) barra a navegação, mas esconder link não é controle
 * de acesso — a autorização precisa valer na action, que é o caminho que
 * realmente escreve. A validação também é refeita aqui; o cliente nunca dita o
 * que vai ao banco.
 *
 * As actions são cascas finas: o núcleo de dados fica em `./services`, que
 * recebe a transação escopada do tenant. Assim o isolamento e o retry da F0
 * continuam sendo o único caminho até o banco.
 */

const SERVICES_PATH = '/painel/servicos';

async function ownerOrForbidden(): Promise<
  { ok: true; context: Awaited<ReturnType<typeof requireRole>> } | { ok: false }
> {
  try {
    return { ok: true, context: await requireRole('OWNER') };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}

function forbidden(): ServiceActionResult {
  return { ok: false, code: 'FORBIDDEN', message: 'Você não tem acesso a esta área.' };
}

export async function createServiceAction(input: ServiceFormInput): Promise<ServiceActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const validation = validateServiceForm(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const service = await auth.context.forTenant((tx) =>
    createService(tx, auth.context.tenant.id, validation.value),
  );
  revalidatePath(SERVICES_PATH);
  return { ok: true, service };
}

export async function updateServiceAction(
  serviceId: string,
  input: ServiceFormInput,
): Promise<ServiceActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const validation = validateServiceForm(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const service = await auth.context.forTenant((tx) =>
    updateService(tx, auth.context.tenant.id, serviceId, validation.value),
  );
  if (!service) {
    return { ok: false, code: 'NOT_FOUND', message: 'Serviço não encontrado.' };
  }

  revalidatePath(SERVICES_PATH);
  return { ok: true, service };
}

export async function setServiceActiveAction(
  serviceId: string,
  active: boolean,
): Promise<ServiceActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const changed = await auth.context.forTenant((tx) =>
    setServiceActive(tx, auth.context.tenant.id, serviceId, active),
  );
  if (!changed) {
    return { ok: false, code: 'NOT_FOUND', message: 'Serviço não encontrado.' };
  }

  revalidatePath(SERVICES_PATH);
  return { ok: true, deactivated: !active };
}

export async function deleteServiceAction(serviceId: string): Promise<ServiceActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const result = await auth.context.forTenant((tx) =>
    deleteService(tx, auth.context.tenant.id, serviceId),
  );
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: deletionRefusalMessage(result),
      futureBookings: result.futureBookings,
    };
  }

  revalidatePath(SERVICES_PATH);
  return { ok: true };
}
