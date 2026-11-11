import { defineConfig } from '@playwright/test';

const PORT = 4181;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    serviceWorkers: 'block',
    trace: 'off',
  },
  projects: [
    { name: 'celular-pequeno', use: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'computador', use: { viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    env: { PORT: String(PORT), LELE_FAKE_CLOUD: '1' },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
  },
});
