// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { AsaasPaymentProvider } from '@/lib/payments/asaas';
import { PaymentProviderError } from '@/lib/payments/types';

/**
 * O adaptador do Asaas contra o SANDBOX DE VERDADE (tarefa F8.2).
 *
 * Roda só quando `ASAAS_API_KEY` e `ASAAS_TEST_SALON_API_KEY` estão no
 * AMBIENTE — não basta estarem no `.env`, que este arquivo não carrega. Assim
 * `npm test` e o CI seguem sem rede e sem segredo, e a verificação contra o
 * provedor é um comando explícito:
 *
 *   set -a; . ./.env; set +a
 *   ASAAS_API_KEY="$ASAAS_API_KEY" \
 *   ASAAS_TEST_SALON_API_KEY="$ASAAS_TEST_SALON_API_KEY" \
 *   PLATFORM_WALLET_ID="$PLATFORM_WALLET_ID" \
 *   npx vitest run tests/integration/payments/asaas-sandbox.test.ts
 *
 * DUAS CONTAS, DE PROPÓSITO. A cobrança nasce na conta do SALÃO e o split vai
 * para a carteira da PLATAFORMA. É o desenho que protege o modelo fiscal: o
 * dinheiro do serviço nunca passa pela plataforma, só a taxa. O Asaas recusa
 * split para a própria carteira justamente porque a cobrança e o destino
 * precisam ser contas diferentes — e é isso que o último teste prova.
 *
 * `createMerchantAccount` NÃO é exercitado aqui: criar subconta exige
 * conta-pai com CNPJ, e a conta de teste é de pessoa física (403). O método
 * existe e está implementado; o teste chega quando o CNPJ existir.
 */

/** A chave vem escapada do `.env` porque começa com `$`; fora do Next, desescapar. */
function key(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw.replace(/\\\$/g, '$') : undefined;
}

const platformKey = key('ASAAS_API_KEY');
const salonKey = key('ASAAS_TEST_SALON_API_KEY');
const platformWallet = process.env.PLATFORM_WALLET_ID;
const enabled = Boolean(platformKey && salonKey && platformWallet);

describe.skipIf(!enabled)('AsaasPaymentProvider contra o sandbox', () => {
  // Construção PREGUIÇOSA: o corpo do `describe` roda mesmo quando o
  // `skipIf` pula os testes, e instanciar aqui estouraria sem a chave —
  // quebrando `npm test` justamente no ambiente que deveria pular.
  let provider!: AsaasPaymentProvider;

  beforeAll(() => {
    provider = new AsaasPaymentProvider({
      apiKey: platformKey,
      // No produto isto lê `AsaasAccount.apiKeyEnc`; aqui a subconta é
      // representada pela segunda conta do sandbox.
      resolveAccountKey: async () => salonKey!,
      // O Asaas exige CPF/CNPJ do pagador para emitir cobrança, e o nosso
      // `User` ainda não guarda esse dado — ver `resolvePayer`. Aqui entra um
      // CPF de teste válido para exercitar o caminho.
      resolvePayer: async (customerId) => ({
        name: 'Ana Souza (teste)',
        document: '24971563792',
        phone: '48999990000',
        email: `${customerId}@exemplo.test`,
      }),
    });
  });

  const charge = (extra: Record<string, unknown> = {}) => ({
    accountId: 'acc_salao_sandbox',
    customerId: 'tenantmember_teste_contrato',
    method: 'PIX' as const,
    amountCents: 5000,
    dueDate: '2026-12-01',
    description: 'Corte masculino — teste de contrato',
    ...extra,
  });

  it('cria a cobrança na conta do salão com split para a plataforma', async () => {
    const created = await provider.createCharge(
      charge({ split: [{ walletId: platformWallet!, percentageValue: 10 }] }),
    );

    expect(created.id).toMatch(/^pay_/);
    expect(created.method).toBe('PIX');
    expect(created.status).toBe('PENDING');
    expect(created.amountCents).toBe(5000);

    // Pix copia-e-cola: sem ele o cliente não paga.
    expect(created.pixCopyPaste).toBeTruthy();
    expect(created.pixCopyPaste).toContain('br.gov.bcb.pix');
  }, 60_000);

  it('o valor do split vem do PROVEDOR, calculado sobre o líquido', async () => {
    const created = await provider.createCharge(
      charge({ split: [{ walletId: platformWallet!, percentageValue: 10 }] }),
    );

    const split = created.split[0];
    expect(split?.walletId).toBe(platformWallet);

    // O ponto deste teste. 10% de R$ 50,00 seria R$ 5,00; o Asaas desconta a
    // taxa dele antes de dividir, então o repasse real é menor. Gravar o
    // nosso cálculo em vez do valor do provedor faria o extrato divergir em
    // TODA cobrança — e a diferença muda conforme a taxa do meio de pagamento.
    expect(split?.fixedValueCents).toBeDefined();
    expect(split!.fixedValueCents!).toBeLessThan(500);
    expect(split!.fixedValueCents!).toBeGreaterThan(400);
  }, 60_000);

  it('recusa split para a própria carteira, como o mock já recusava', async () => {
    // A carteira do próprio salão: dividir para si mesmo não faz sentido, e o
    // Asaas barra. O `MockPaymentProvider` foi escrito recusando isso antes de
    // existir integração real — este teste confirma que ele acertou.
    const wallets = await fetch(
      `${process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3'}/wallets`,
      { headers: { access_token: salonKey! } },
    ).then((r) => r.json() as Promise<{ data: { id: string }[] }>);
    const own = wallets.data[0]!.id;

    await expect(
      provider.createCharge(charge({ split: [{ walletId: own, percentageValue: 10 }] })),
    ).rejects.toMatchObject({ code: 'SPLIT_TO_SELF' });
  }, 60_000);

  it('recusa carteira inexistente como split inválido', async () => {
    await expect(
      provider.createCharge(
        charge({
          split: [{ walletId: '00000000-0000-0000-0000-000000000000', percentageValue: 10 }],
        }),
      ),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  }, 60_000);

  it('recusa cartão sem IP do pagador antes de tocar na rede', async () => {
    await expect(
      provider.createCharge(charge({ method: 'CARD', cardToken: 'tok_qualquer' })),
    ).rejects.toMatchObject({ code: 'REMOTE_IP_REQUIRED' });
  });
});
