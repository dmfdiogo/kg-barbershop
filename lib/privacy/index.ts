/**
 * Direitos do titular (LGPD) — tarefa F6.2.
 *
 * - `exportCustomerData()`: direito de acesso, em JSON portátil, escopado ao
 *   salão que atende o pedido.
 * - `eraseCustomer()`: direito de eliminação. A política registrada em
 *   `./policy.ts` diz o que é apagado, o que é anonimizado por obrigação fiscal
 *   e por quanto tempo.
 */
export { exportCustomerData } from './export';
export { eraseCustomer, eraseCustomerData, purgeOrphanIdentity } from './deletion';
export {
  ANONYMIZED_CUSTOMER_NAME,
  ANONYMIZED_PHONE_PREFIX,
  FISCAL_RETENTION_YEARS,
  anonymizedPhone,
  isAnonymizedPhone,
} from './policy';
export type {
  CustomerDataExport,
  ErasureResult,
  ErasureRetained,
} from './types';
