/**
 * Validação PURA do passo de estabelecimento (tarefa F2.5).
 *
 * Sem banco e sem `next/*`: o formulário entrega strings e o servidor decide o
 * que vai ao banco. A validação roda de novo na server action — o cliente nunca
 * dita o que é gravado.
 *
 * O CPF/CNPJ é normalizado para dígitos (o dono pode digitar com pontuação) e a
 * chave Pix apenas tem tamanho conferido: o TIPO da chave (CPF, e-mail, telefone
 * ou aleatória) é do provedor e só importa na F4.1, que cria a subconta. Aqui a
 * coleta precisa ser tolerante, não adivinha.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 120;
export const PIX_KEY_MIN = 3;
export const PIX_KEY_MAX = 200;

export interface EstablishmentFormInput {
  name?: unknown;
  document?: unknown;
  pixKey?: unknown;
}

export interface ValidatedEstablishment {
  name: string;
  /** CPF (11) ou CNPJ (14), apenas dígitos. */
  document: string;
  pixKey: string;
}

export type EstablishmentField = 'name' | 'document' | 'pixKey';
export type EstablishmentFieldErrors = Partial<Record<EstablishmentField, string>>;

export type EstablishmentValidation =
  | { ok: true; value: ValidatedEstablishment }
  | { ok: false; fieldErrors: EstablishmentFieldErrors };

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function validateEstablishment(input: EstablishmentFormInput): EstablishmentValidation {
  const fieldErrors: EstablishmentFieldErrors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    fieldErrors.name = `Informe o nome do estabelecimento (${NAME_MIN} a ${NAME_MAX} caracteres).`;
  }

  const document =
    typeof input.document === 'string' ? digitsOnly(input.document) : '';
  if (document.length !== 11 && document.length !== 14) {
    fieldErrors.document = 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).';
  }

  const pixKey = typeof input.pixKey === 'string' ? input.pixKey.trim() : '';
  if (pixKey.length < PIX_KEY_MIN || pixKey.length > PIX_KEY_MAX) {
    fieldErrors.pixKey = `Informe a chave Pix que vai receber os valores (${PIX_KEY_MIN} a ${PIX_KEY_MAX} caracteres).`;
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { name, document, pixKey } };
}
