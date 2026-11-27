/**
 * Base de conhecimento do suporte, extraída do Guia de uso (docs/GUIA-DE-USO.md).
 * Cada seção vira uma entrada e cada item em negrito ("- **Título**: ...") ou
 * pergunta frequente ("**Pergunta?** resposta") vira uma entrada própria, para
 * a busca achar o trecho certo. A parte "Para a equipe do escritório" fica só
 * para a equipe. O resultado é guardado em base-guia.json
 * (npm run suporte:base); um teste confere se está em dia com o guia.
 */

export type Publico = "todos" | "cliente" | "equipe";

export interface EntradaGuia {
  id: string;
  publico: Publico;
  secao: string;
  titulo: string;
  texto: string;
}

/** Tira a marcação do Markdown (negrito, links, crases) e junta as linhas. */
export function textoLimpo(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function extrairBase(markdown: string): EntradaGuia[] {
  const entradas: EntradaGuia[] = [];
  const usados = new Map<string, number>();
  let publico: Publico = "todos";
  let secao = "";
  let intro: string[] = [];
  let item: { titulo: string; linhas: string[] } | null = null;

  const adicionar = (titulo: string, texto: string) => {
    const t = textoLimpo(texto);
    if (t.length < 20) return;
    let id = chave(titulo) || "secao";
    const n = (usados.get(id) ?? 0) + 1;
    usados.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    entradas.push({ id, publico, secao, titulo: textoLimpo(titulo), texto: t.slice(0, 2500) });
  };
  const fecharItem = () => {
    if (item) adicionar(secao ? `${secao} › ${item.titulo}` : item.titulo, item.linhas.join(" "));
    item = null;
  };
  const fecharSecao = () => {
    fecharItem();
    if (secao && intro.length) adicionar(secao, intro.join(" "));
    intro = [];
  };

  for (const linha of markdown.split("\n")) {
    const h = /^(#{2,4})\s+(.*)$/.exec(linha);
    if (h) {
      fecharSecao();
      const titulo = textoLimpo(h[2]);
      if (h[1] === "##") {
        publico = /^3\./.test(titulo) ? "equipe" : /^2\./.test(titulo) ? "cliente" : "todos";
        secao = titulo.replace(/^\d+\.\s*/, "");
      } else {
        secao = titulo;
      }
      continue;
    }
    if (/^#\s/.test(linha) || /^---\s*$/.test(linha)) continue;
    // Item em negrito: "- **Título**: texto" ou pergunta frequente "**Pergunta?** resposta"
    const b = /^(?:- |\d+\. )?\*\*([^*]{3,140})\*\*[:.]?\s*(.*)$/.exec(linha);
    if (b && (linha.startsWith("- ") || linha.startsWith("**"))) {
      fecharItem();
      item = { titulo: b[1].replace(/[:.]$/, ""), linhas: [b[2]] };
      continue;
    }
    if (item && (linha.startsWith("  ") || (linha.trim() && !linha.startsWith("- ") && !/^\d+\. /.test(linha)))) {
      item.linhas.push(linha.trim());
      continue;
    }
    if (!linha.trim()) {
      // Linha em branco encerra a pergunta frequente (sem item de lista)
      continue;
    }
    fecharItem();
    intro.push(linha.replace(/^- |^\d+\. /, ""));
  }
  fecharSecao();
  return entradas;
}
