import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    projects: [
      { extends: true, test: { name: "unidade", include: ["tests/unit/**/*.test.ts"], exclude: ["tests/unit/**/*-integracao.test.ts"] } },
      // Os testes de integração usam a mesma empresa de demonstração no Supabase local: um arquivo por vez, depois dos demais
      {
        extends: true,
        test: { name: "integracao", include: ["tests/unit/**/*-integracao.test.ts"], fileParallelism: false, sequence: { groupOrder: 1 } },
      },
    ],
  },
});
