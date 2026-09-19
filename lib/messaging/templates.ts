/**
 * Registro central de templates aprovados (spec-executiva.md §4).
 *
 * A partir da F6.0 este arquivo pertence à tarefa F6.0 (`lib/messaging/templates.ts`),
 * que adiciona os templates de job/lembrete. A F0.3 cria a versão inicial porque o
 * mock precisa recusar template não registrado — é essa recusa que evita que a
 * aprovação da Meta na F8 vire retrabalho.
 *
 * Regras:
 * - `name` é CONTRATO EXTERNO: é o nome que a Meta aprova e o que vai no
 *   provider real (Cloud API exige `[a-z0-9_]`). Nenhum arquivo fora deste
 *   registro pode conter esse texto como literal — use a chave do registro
 *   (`TemplateName`) ou `TEMPLATES[x].name`. Quando a aprovação da F8.3 vier
 *   com nome diferente, renomeia-se aqui e em nenhum outro lugar.
 * - `variables` são as variáveis aceitas; enviar variável fora da lista ou
 *   deixar de enviar uma obrigatória é recusado pelo provider (mock e real).
 */
export type TemplateCategory = 'AUTHENTICATION' | 'UTILITY';

/**
 * Para quem o template é enviado. O runner da F6.0 usa isto para resolver o
 * destinatário a partir do agendamento: `CUSTOMER` → `Booking.customerId`,
 * `STAFF` → `Booking.staffId`. Sem esta marcação o nome do template seria a
 * única pista do destinatário, e um template novo poderia sair para a pessoa
 * errada em silêncio.
 */
export type TemplateAudience = 'CUSTOMER' | 'STAFF';

export interface TemplateDefinition {
  readonly name: string;
  readonly category: TemplateCategory;
  readonly audience: TemplateAudience;
  readonly variables: readonly string[];
}

export const TEMPLATES = {
  otp_login: {
    name: 'otp_login',
    category: 'AUTHENTICATION',
    audience: 'CUSTOMER',
    variables: ['code'],
  },
  booking_confirmation: {
    name: 'booking_confirmation',
    category: 'UTILITY',
    audience: 'CUSTOMER',
    variables: [
      'customer_name',
      'service_name',
      'staff_name',
      'starts_at',
      'address',
      'maps_url',
    ],
  },
  booking_reminder_d1: {
    name: 'booking_reminder_d1',
    category: 'UTILITY',
    audience: 'CUSTOMER',
    variables: [
      'customer_name',
      'service_name',
      'staff_name',
      'starts_at',
      'confirmation_url',
    ],
  },
  booking_reminder_h2: {
    name: 'booking_reminder_h2',
    category: 'UTILITY',
    audience: 'CUSTOMER',
    variables: ['customer_name', 'starts_at'],
  },
  booking_cancelled_customer: {
    name: 'booking_cancelled_customer',
    category: 'UTILITY',
    audience: 'CUSTOMER',
    variables: ['customer_name', 'service_name', 'starts_at'],
  },
  booking_cancelled_staff: {
    name: 'booking_cancelled_staff',
    category: 'UTILITY',
    audience: 'STAFF',
    variables: ['staff_name', 'customer_name', 'starts_at'],
  },
  booking_rescheduled_customer: {
    name: 'booking_rescheduled_customer',
    category: 'UTILITY',
    audience: 'CUSTOMER',
    variables: ['customer_name', 'service_name', 'old_starts_at', 'new_starts_at'],
  },
  booking_rescheduled_staff: {
    name: 'booking_rescheduled_staff',
    category: 'UTILITY',
    audience: 'STAFF',
    variables: ['staff_name', 'customer_name', 'old_starts_at', 'new_starts_at'],
  },
  booking_created_staff: {
    name: 'booking_created_staff',
    category: 'UTILITY',
    audience: 'STAFF',
    variables: ['staff_name', 'customer_name', 'service_name', 'starts_at'],
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateName = keyof typeof TEMPLATES;

/**
 * Identificador interno do template de OTP. O texto do nome externo vive no
 * registro acima; este alias evita literal espalhado pelo código.
 */
export const OTP_TEMPLATE = 'otp_login' satisfies TemplateName;

export function isTemplateName(value: string): value is TemplateName {
  return Object.hasOwn(TEMPLATES, value);
}

/**
 * Templates que podem virar `NotificationJob`. O OTP fica de fora: ele é
 * enviado na hora pelo login (F1), não é agendado nem persistido como job.
 */
export type JobTemplateName = Exclude<TemplateName, typeof OTP_TEMPLATE>;

export function isJobTemplateName(value: string): value is JobTemplateName {
  return isTemplateName(value) && value !== OTP_TEMPLATE;
}

export function templateAudience(name: TemplateName): TemplateAudience {
  return TEMPLATES[name].audience;
}

export interface TemplateVariablesCheck {
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
}

export function checkTemplateVariables(
  name: TemplateName,
  vars: Readonly<Record<string, string>>,
): TemplateVariablesCheck {
  const definition = TEMPLATES[name];
  const provided = Object.keys(vars);
  const missing = definition.variables.filter((variable) => !provided.includes(variable));
  const unknown = provided.filter(
    (variable) => !(definition.variables as readonly string[]).includes(variable),
  );
  return { missing, unknown };
}
