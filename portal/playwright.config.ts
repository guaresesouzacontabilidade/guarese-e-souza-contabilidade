import { defineConfig } from "@playwright/test";

/**
 * Testes de ponta a ponta. Por padrão rodam contra o ambiente local; para
 * verificar o site publicado (demonstração):
 *   PORTAL_URL=https://seu-portal.vercel.app DEMO_SENHA=... npx playwright test
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: process.env.PORTAL_URL ?? "http://localhost:3000",
    locale: "pt-BR",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
});
