import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      // Código legado do MVP anterior. A remoção é da tarefa F0.4; até lá ele
      // fica fora do typecheck e do lint para não travar o CI.
      'backend/**',
      'frontend/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
