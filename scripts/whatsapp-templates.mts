/**
 * Submete ao Meta os templates de WhatsApp do produto (tarefa F8.3).
 *
 * POR QUE SCRIPT E NÃO O PAINEL. `lib/messaging/templates.ts` é a fonte de
 * verdade de nome, categoria e variáveis; o código só envia template que
 * existe lá. Criar no painel à mão produz divergência silenciosa — o produto
 * manda `booking_reminder_d1` com cinco variáveis e o Meta recusa porque o
 * template aprovado tem quatro, e isso só aparece quando o lembrete não chega.
 *
 * A ORDEM DAS VARIÁVEIS É CONTRATO. O WhatsApp numera posicionalmente
 * (`{{1}}`, `{{2}}`), sem nome. A ordem aqui tem de ser a mesma de `variables`
 * no catálogo; trocar duas de lugar faz o cliente receber o nome do
 * profissional onde deveria estar o serviço, e nada quebra em teste.
 *
 * Idempotente: o Meta recusa nome duplicado no mesmo idioma, e o script trata
 * isso como "já existe" em vez de erro.
 *
 * Uso:
 *   node --experimental-strip-types scripts/whatsapp-templates.mts --dry-run
 *   node --experimental-strip-types scripts/whatsapp-templates.mts
 */
const DRY_RUN = process.argv.includes('--dry-run');
const GRAPH = 'https://graph.facebook.com/v23.0';
const LANGUAGE = 'pt_BR';

interface BodyTemplate {
  name: string;
  category: 'UTILITY';
  /** Texto com `{{n}}` na MESMA ordem de `variables` do catálogo. */
  text: string;
  /** Exemplo por posição; o Meta exige para aprovar. */
  example: string[];
}

const BODY_TEMPLATES: BodyTemplate[] = [
  {
    name: 'booking_confirmation',
    category: 'UTILITY',
    text:
      'Olá, {{1}}! Seu agendamento está confirmado e o horário já está reservado para você.\n\n' +
      'Serviço: {{2}}\nProfissional: {{3}}\nQuando: {{4}}\nEndereço: {{5}}\n\n' +
      'Veja como chegar até nós: {{6}}\n' +
      'Se acontecer algum imprevisto, avise com antecedência para liberarmos o horário.',
    example: ['Ana', 'Corte masculino', 'Carlos', 'sexta, 12/06 às 14:00', 'Rua das Flores, 123', 'https://maps.app.goo.gl/exemplo'],
  },
  {
    name: 'booking_reminder_d1',
    category: 'UTILITY',
    text:
      'Oi, {{1}}! Passando para lembrar do seu atendimento marcado para amanhã.\n\n' +
      'Serviço: {{2}}\nProfissional: {{3}}\nQuando: {{4}}\n\n' +
      'Se não puder comparecer, use este link para remarcar: {{5}} — assim o horário ' +
      'fica livre para outra pessoa. Até amanhã!',
    example: ['Ana', 'Corte masculino', 'Carlos', 'sexta, 12/06 às 14:00', 'https://bomhorario.com.br/carlosbarber/minha-conta'],
  },
  {
    name: 'booking_reminder_h2',
    category: 'UTILITY',
    text: 'Oi, {{1}}! Seu atendimento é daqui a pouco, às {{2}}. Estamos te esperando, até já!',
    example: ['Ana', '14:00'],
  },
  {
    name: 'booking_cancelled_customer',
    category: 'UTILITY',
    text:
      'Olá, {{1}}. Confirmamos o cancelamento do seu atendimento de {{2}}, que estava ' +
      'marcado para {{3}}. Quando quiser, é só agendar de novo pelo nosso portal.',
    example: ['Ana', 'Corte masculino', 'sexta, 12/06 às 14:00'],
  },
  {
    name: 'booking_cancelled_staff',
    category: 'UTILITY',
    text:
      'Olá, {{1}}. Avisamos que o cliente {{2}} acabou de cancelar o atendimento que estava ' +
      'marcado para {{3}}. O horário já voltou a ficar livre na sua agenda.',
    example: ['Carlos', 'Ana Souza', 'sexta, 12/06 às 14:00'],
  },
  {
    name: 'booking_rescheduled_customer',
    category: 'UTILITY',
    text:
      'Olá, {{1}}! Seu agendamento de {{2}} foi remarcado conforme combinado. Antes estava ' +
      'marcado para {{3}} e agora ficou para {{4}}. Até lá!',
    example: ['Ana', 'Corte masculino', 'sexta, 12/06 às 14:00', 'sábado, 13/06 às 10:00'],
  },
  {
    name: 'booking_rescheduled_staff',
    category: 'UTILITY',
    text:
      'Olá, {{1}}. O cliente {{2}} remarcou o atendimento dele. Antes estava marcado para ' +
      '{{3}} e passou para {{4}}. A sua agenda já foi atualizada.',
    example: ['Carlos', 'Ana Souza', 'sexta, 12/06 às 14:00', 'sábado, 13/06 às 10:00'],
  },
  {
    name: 'booking_created_staff',
    category: 'UTILITY',
    text:
      'Olá, {{1}}! Você recebeu um novo agendamento feito pelo portal. Cliente: {{2}}. ' +
      'Serviço: {{3}}. Data e horário: {{4}}. A sua agenda já está atualizada.',
    example: ['Carlos', 'Ana Souza', 'Corte masculino', 'sexta, 12/06 às 14:00'],
  },
];

function env(name: string): string {
  if (!process.env[name] && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile('.env');
    } catch {
      // A variável pode vir do ambiente.
    }
  }
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não definida no .env.`);
  return value;
}

/**
 * Nomes já existentes na conta. Idempotência por LISTAGEM, e não por
 * interpretação de mensagem de erro: o Meta devolve `Invalid parameter` tanto
 * para nome duplicado quanto para texto reprovado, e tratar os dois como
 * "já existe" esconderia template recusado.
 */
async function existingNames(waba: string, token: string): Promise<Set<string>> {
  const r = await fetch(`${GRAPH}/${waba}/message_templates?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = (await r.json()) as { data?: { name: string; status: string }[] };
  for (const t of d.data ?? []) console.log(`  (existe) ${t.name}: ${t.status}`);
  return new Set((d.data ?? []).map((t) => t.name));
}

async function createTemplate(waba: string, token: string, body: unknown): Promise<void> {
  const name = (body as { name: string }).name;
  if (DRY_RUN) {
    console.log(`  ${name}: submeteria`);
    return;
  }
  const response = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as {
    id?: string;
    status?: string;
    error?: { message?: string; error_subcode?: number };
  };

  if (response.ok) {
    console.log(`  ${name}: submetido (${data.status ?? 'PENDING'})`);
    return;
  }
  const e = data.error as { message?: string; error_user_title?: string; error_user_msg?: string };
  console.log(`  ${name}: RECUSADO — ${e?.error_user_title ?? e?.message}`);
  if (e?.error_user_msg) console.log(`      ${e.error_user_msg}`);
}

async function main(): Promise<void> {
  const token = env('WHATSAPP_ACCESS_TOKEN');
  const waba = env('WHATSAPP_BUSINESS_ACCOUNT_ID');

  console.log(`Conta ${waba}${DRY_RUN ? ' — DRY RUN' : ''}\n`);

  const already = await existingNames(waba, token);

  console.log('\nTemplates de utilidade');
  for (const t of BODY_TEMPLATES) {
    if (already.has(t.name)) {
      console.log(`  ${t.name}: já existe, pulando`);
      continue;
    }
    await createTemplate(waba, token, {
      name: t.name,
      language: LANGUAGE,
      category: t.category,
      components: [
        { type: 'BODY', text: t.text, example: { body_text: [t.example] } },
      ],
    });
  }

  // O template de OTP tem forma PRÓPRIA: o Meta monta o texto, e nós só
  // declaramos a validade e o botão de copiar código. Texto livre em categoria
  // AUTHENTICATION é recusado.
  console.log('\nTemplate de autenticação');
  if (already.has('otp_login')) console.log('  otp_login: já existe, pulando');
  else await createTemplate(waba, token, {
    name: 'otp_login',
    language: LANGUAGE,
    category: 'AUTHENTICATION',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ],
  });

  console.log('\nSubmetido. A aprovação do Meta leva de minutos a dois dias.');
}

await main();
