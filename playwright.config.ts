import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // Mobile-first: é assim que o cliente final usa o produto.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // `next start` roda em produção, onde estas variáveis são obrigatórias e
    // falham cedo de propósito. Fixadas aqui para que o e2e funcione mesmo com
    // um .env desatualizado — foi assim que a suíte quebrou depois da F1.0: o
    // agente tinha as variáveis na worktree dele, e .env não é versionado.
    env: {
      APP_DOMAIN: process.env.APP_DOMAIN ?? `127.0.0.1:${PORT}`,
      AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET ?? 'e2e-session-secret',
    },
  },
});
