import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    // `asPlatformAdmin` é o bypass explícito de RLS. Ele existe para poucos
    // caminhos legítimos (roteamento, identidade, auditoria); em qualquer outro
    // lugar, usá-lo direto é acesso a dado de tenant sem rastro. O acesso de
    // suporte passa por `withPlatformAudit()`, que revalida o portão e grava o
    // AuditLog antes de ler. Esta regra existe porque convenção escrita em
    // documento não sobrevive a trinta tarefas.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/tenant/db',
              importNames: ['asPlatformAdmin'],
              message:
                'Use withPlatformAudit() de @/lib/audit para acesso de plataforma a dado de tenant. Se o seu caso é roteamento ou identidade (sem auditoria), adicione o arquivo à exceção em eslint.config.mjs e justifique no PR.',
            },
          ],
        },
      ],
    },
  },
  {
    // Exceções deliberadas, cada uma com motivo registrado:
    //  - lib/tenant/**      define e usa o próprio bypass;
    //  - lib/audit/**       é quem embrulha o bypass com auditoria;
    //  - lib/auth/membership.ts  "meus salões" atravessa tenants por identidade
    //                       da própria sessão, não é acesso de suporte;
    //  - lib/auth/rbac.ts   lê o próprio `user` da sessão por id — tabela global
    //                       sem tenantId, leitura pontual, nunca listagem;
    //  - lib/privacy/**     a exclusão do titular precisa saber se a identidade
    //                       global (User, sem tenantId) ainda é cliente de
    //                       outro salão antes de apagá-la; a checagem atravessa
    //                       tenants por definição e grava AuditLog (F6.2);
    //  - tests/**           montam cenário entre tenants de propósito.
    files: [
      'lib/tenant/**/*.ts',
      'lib/audit/**/*.ts',
      'lib/auth/membership.ts',
      'lib/auth/rbac.ts',
      'lib/privacy/**/*.ts',
      'tests/**/*.ts',
      'prisma/**/*.mts',
      'scripts/**/*.mts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default config;
