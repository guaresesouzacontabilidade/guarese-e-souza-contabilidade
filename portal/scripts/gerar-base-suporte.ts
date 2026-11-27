/**
 * Gera a base de conhecimento do suporte 24h a partir do Guia de uso.
 * Rode depois de mudar docs/GUIA-DE-USO.md: npm run suporte:base
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extrairBase } from "../src/lib/suporte/guia";

const raiz = join(__dirname, "..");
const base = extrairBase(readFileSync(join(raiz, "docs/GUIA-DE-USO.md"), "utf8"));
writeFileSync(join(raiz, "src/lib/suporte/base-guia.json"), `${JSON.stringify(base, null, 1)}\n`);
console.log(`Base do suporte: ${base.length} trechos do guia.`);
