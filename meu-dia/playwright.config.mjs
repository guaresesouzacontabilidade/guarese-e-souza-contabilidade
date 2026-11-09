import { defineConfig } from '@playwright/test';

const PORT = 4174;

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
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'celular-pequeno', use: { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'android', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
    { name: 'computador', use: { viewport: { width: 1366, height: 860 } } },
  ],
  webServer: {
    command: `node scripts/serve.mjs`,
    env: { PORT: String(PORT), MEUDIA_NO_CLOUD: '1' },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
  },
});
