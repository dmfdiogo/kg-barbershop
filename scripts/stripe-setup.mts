/**
 * Cria no Stripe os produtos e preços dos três planos B2B (tarefa F8.1).
 *
 * POR QUE SCRIPT E NÃO O PAINEL. O catálogo é código: `lib/billing/plans.ts` é
 * a fonte de verdade de nome, preço e limites, e o enforcement lê de lá. Criar
 * preço à mão no painel produz divergência silenciosa entre o que o produto
 * acredita cobrar e o que o provedor cobra — e o sintoma aparece na fatura do
 * cliente, não em teste.
 *
 * IDEMPOTENTE. Reexecutar não duplica nada: produto e preço são procurados por
 * `lookup_key`/metadata antes de criar. Preço no Stripe é IMUTÁVEL, então
 * mudar o valor de um plano não edita o preço existente — cria um novo, move a
 * `lookup_key` para ele e ARQUIVA o antigo. Assinaturas vigentes continuam no
 * preço que contrataram, que é exatamente a regra que o produto já aplica em
 * `Membership.contractedPriceCents` para o clube B2C.
 *
 * Uso:
 *   node --experimental-strip-types scripts/stripe-setup.mts          (aplica)
 *   node --experimental-strip-types scripts/stripe-setup.mts --dry-run (só mostra)
 */
import Stripe from 'stripe';
import { BILLING_PLANS, BILLING_PLAN_CODES, type BillingPlanCode } from '../lib/billing/plans.ts';

const DRY_RUN = process.argv.includes('--dry-run');

/** Marca as linhas criadas por este script, para não mexer no que não é nosso. */
const MANAGED_BY = 'bom-horario/stripe-setup';

function requireTestKey(): string {
  if (!process.env.STRIPE_SECRET_KEY && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile('.env');
    } catch {
      // Sem .env: a chave pode vir do ambiente.
    }
  }
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY não definida. Preencha o .env com a chave de TESTE.');
  }
  // Trava deliberada: este script CRIA catálogo. Rodá-lo contra produção por
  // engano publicaria preços numa conta que cobra dinheiro de verdade.
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY não é chave de teste. Este script recusa rodar em produção.',
    );
  }
  return key;
}

function lookupKeyFor(code: BillingPlanCode): string {
  return `bom_horario_${code.toLowerCase()}_mensal`;
}

/**
 * Id FIXO por plano. É o que torna a checagem de existência confiável:
 * `products.retrieve` por id é consulta forte, enquanto `products.search` por
 * metadata é EVENTUALMENTE CONSISTENTE — logo após criar, ela ainda não
 * devolve o registro. A primeira versão deste script usava search e, ao rodar
 * duas vezes seguidas, criou uma segunda leva de produtos órfãos por não
 * enxergar a própria escrita anterior.
 */
function productIdFor(code: BillingPlanCode): string {
  return `bom_horario_${code.toLowerCase()}`;
}

async function ensureProduct(stripe: Stripe, code: BillingPlanCode): Promise<Stripe.Product> {
  const plan = BILLING_PLANS[code];
  const id = productIdFor(code);

  try {
    const existing = await stripe.products.retrieve(id);
    const patch: Stripe.ProductUpdateParams = {};
    // Produto arquivado por uma limpeza anterior volta à ativa em vez de virar
    // duplicata com outro id.
    if (!existing.active) patch.active = true;
    if (existing.name !== plan.name) patch.name = plan.name;
    if (Object.keys(patch).length === 0) return existing;
    if (DRY_RUN) {
      console.log(`  produto ${code}: atualizaria ${JSON.stringify(patch)}`);
      return existing;
    }
    return await stripe.products.update(id, patch);
  } catch (error) {
    const missing = (error as { code?: string })?.code === 'resource_missing';
    if (!missing) throw error;
  }

  if (DRY_RUN) {
    console.log(`  produto ${code}: criaria "${plan.name}" com id ${id}`);
    return { id, name: plan.name } as Stripe.Product;
  }

  return stripe.products.create({
    id,
    name: plan.name,
    metadata: {
      plan_code: code,
      managed_by: MANAGED_BY,
      agenda_limit: plan.agendaLimit === null ? 'ilimitado' : String(plan.agendaLimit),
    },
  });
}

async function ensurePrice(
  stripe: Stripe,
  code: BillingPlanCode,
  product: Stripe.Product,
): Promise<string> {
  const plan = BILLING_PLANS[code];
  const lookupKey = lookupKeyFor(code);

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
  const current = existing.data[0];

  if (current) {
    const igual =
      current.unit_amount === plan.priceCents &&
      current.currency === 'brl' &&
      current.recurring?.interval === 'month';
    if (igual) {
      console.log(`  preço ${code}: já correto (${current.id})`);
      return current.id;
    }
    console.log(
      `  preço ${code}: mudou (${current.unit_amount} → ${plan.priceCents}); criando novo e arquivando o antigo`,
    );
    if (DRY_RUN) return current.id;
    // Libera a lookup_key ANTES de criar a nova: ela é única entre preços ativos.
    await stripe.prices.update(current.id, { lookup_key: '', active: false });
  } else if (DRY_RUN) {
    console.log(`  preço ${code}: criaria ${plan.priceCents} centavos/mês`);
    return `price_dry_${code}`;
  }

  const created = await stripe.prices.create({
    product: product.id,
    currency: 'brl',
    unit_amount: plan.priceCents,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { plan_code: code, managed_by: MANAGED_BY },
  });
  console.log(`  preço ${code}: criado ${created.id}`);
  return created.id;
}

async function main(): Promise<void> {
  const stripe = new Stripe(requireTestKey());

  const account = await stripe.accounts.retrieve();
  console.log(
    `Conta: ${account.id} (${account.country}/${account.default_currency})${DRY_RUN ? ' — DRY RUN' : ''}\n`,
  );

  for (const code of BILLING_PLAN_CODES) {
    const plan = BILLING_PLANS[code];
    console.log(`${plan.name} — R$ ${(plan.priceCents / 100).toFixed(2).replace('.', ',')}/mês`);
    const product = await ensureProduct(stripe, code);
    await ensurePrice(stripe, code, product);
  }

  console.log('\nCatálogo sincronizado.');
}

await main();
