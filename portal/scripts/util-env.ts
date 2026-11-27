import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Carrega .env.local / .env para scripts executados fora do Next.js. */
export function carregarEnv() {
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = resolve(process.cwd(), arquivo);
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
      if (!m || process.env[m[1]] !== undefined) continue;
      let valor = m[2];
      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) valor = valor.slice(1, -1);
      process.env[m[1]] = valor;
    }
  }
}
