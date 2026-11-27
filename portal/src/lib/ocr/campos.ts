import { lerValorBR } from "@/lib/dinheiro";
import { validarCnpj, validarCpf } from "@/lib/formatos";
import { chaveValida } from "@/lib/fiscal/chave";

/**
 * Extração de campos de comprovantes, boletos e notas a partir do texto.
 * Cada campo traz a confiança (alta/média/baixa). Campos de baixa confiança
 * exigem conferência humana — nada é lançado automaticamente.
 */
export type Confianca = "alta" | "media" | "baixa";

export interface CampoExtraido {
  campo: "valor" | "data" | "vencimento" | "cnpj" | "cpf" | "linha_digitavel" | "id_transacao_pix" | "chave_acesso";
  rotulo: string;
  valor: string;
  confianca: Confianca;
  origem: string;
}

function confiancaOcr(trecho: string, palavras?: { texto: string; confianca: number }[]): number | null {
  if (!palavras?.length) return null;
  const alvo = trecho.replace(/\s/g, "");
  const relacionadas = palavras.filter((p) => p.texto.length > 1 && alvo.includes(p.texto.replace(/\s/g, "")));
  if (!relacionadas.length) return null;
  return relacionadas.reduce((s, p) => s + p.confianca, 0) / relacionadas.length;
}

function nivel(base: Confianca, ocr: number | null): Confianca {
  if (ocr === null) return base;
  if (ocr < 60) return "baixa";
  if (ocr < 85) return base === "alta" ? "media" : base;
  return base;
}

/** Decodifica a linha digitável de boleto bancário (47 dígitos). */
export function decodificarLinhaDigitavel(linha: string): { valor: string | null; vencimento: string | null } | null {
  const d = linha.replace(/\D/g, "");
  if (d.length !== 47) return null;
  const fator = Number(d.slice(33, 37));
  const valor = Number(d.slice(37, 47)) / 100;
  let vencimento: string | null = null;
  if (fator >= 1000) {
    // Fator de vencimento: base 07/10/1997; reiniciado em 1000 a partir de 22/02/2025.
    const c1 = Date.UTC(1997, 9, 7) + fator * 86400000;
    const c2 = Date.UTC(2025, 1, 22) + (fator - 1000) * 86400000;
    const agora = Date.now();
    const escolhido = Math.abs(c1 - agora) <= Math.abs(c2 - agora) ? c1 : c2;
    vencimento = new Date(escolhido).toISOString().slice(0, 10);
  }
  return { valor: valor > 0 ? valor.toFixed(2) : null, vencimento };
}

export function extrairCampos(texto: string, palavras?: { texto: string; confianca: number }[]) {
  const campos: CampoExtraido[] = [];
  const t = texto.replace(/\r/g, "");

  // Chave de acesso (DANFE)
  for (const m of t.matchAll(/(\d{4}\s?){11}/g)) {
    const chave = m[0].replace(/\D/g, "");
    if (chave.length === 44 && chaveValida(chave)) {
      campos.push({ campo: "chave_acesso", rotulo: "Chave de acesso", valor: chave, confianca: "alta", origem: m[0] });
      break;
    }
  }

  // Linha digitável de boleto
  const ld = /(\d{5}[.\s]?\d{5}\s+\d{5}[.\s]?\d{6}\s+\d{5}[.\s]?\d{6}\s+\d\s+\d{14})/.exec(t);
  if (ld) {
    const dec = decodificarLinhaDigitavel(ld[1]);
    campos.push({ campo: "linha_digitavel", rotulo: "Linha digitável", valor: ld[1].replace(/\s+/g, " "), confianca: nivel("alta", confiancaOcr(ld[1], palavras)), origem: ld[1] });
    if (dec?.valor) campos.push({ campo: "valor", rotulo: "Valor do boleto", valor: dec.valor, confianca: "alta", origem: "linha digitável" });
    if (dec?.vencimento) campos.push({ campo: "vencimento", rotulo: "Vencimento (boleto)", valor: dec.vencimento, confianca: "media", origem: "linha digitável" });
  }

  // Identificador da transação PIX (E2E)
  const e2e = /\b(E\d{8}\d{12}[A-Za-z0-9]{11})\b/.exec(t);
  if (e2e) campos.push({ campo: "id_transacao_pix", rotulo: "ID da transação PIX", valor: e2e[1], confianca: nivel("alta", confiancaOcr(e2e[1], palavras)), origem: e2e[1] });

  // CNPJ e CPF válidos
  const vistos = new Set<string>();
  for (const m of t.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length === 14 && validarCnpj(d) && !vistos.has(d)) {
      vistos.add(d);
      campos.push({ campo: "cnpj", rotulo: "CNPJ", valor: d, confianca: nivel("alta", confiancaOcr(m[0], palavras)), origem: m[0] });
    }
  }
  for (const m of t.matchAll(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length === 11 && validarCpf(d) && !vistos.has(d)) {
      vistos.add(d);
      campos.push({ campo: "cpf", rotulo: "CPF", valor: d, confianca: nivel("media", confiancaOcr(m[0], palavras)), origem: m[0] });
    }
  }

  // Valores monetários: prioriza os rotulados (total, valor pago, valor do documento)
  if (!campos.some((c) => c.campo === "valor")) {
    const rotulados = [...t.matchAll(/(valor\s*(total|pago|do\s*documento|da\s*transfer[eê]ncia|do\s*pix)?|total\s*(a\s*pagar|pago)?)\s*:?\s*R?\$?\s*([\d.]+,\d{2})/gi)];
    const todos = [...t.matchAll(/R\$\s*([\d.]{1,15},\d{2})/g)];
    const escolhido = rotulados[0]?.[4] ?? null;
    if (escolhido) {
      const v = lerValorBR(escolhido);
      if (v) campos.push({ campo: "valor", rotulo: "Valor", valor: v.toFixed(2), confianca: nivel("alta", confiancaOcr(escolhido, palavras)), origem: rotulados[0][0] });
    } else if (todos.length) {
      const valores = [...new Set(todos.map((m) => lerValorBR(m[1])?.toFixed(2)).filter(Boolean) as string[])];
      const maior = valores.sort((a, b) => Number(b) - Number(a))[0];
      if (maior) campos.push({ campo: "valor", rotulo: "Valor (maior encontrado)", valor: maior, confianca: valores.length > 1 ? "baixa" : "media", origem: "R$" });
    }
  }

  // Datas
  const datas = [...t.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)]
    .map((m) => ({ iso: `${m[3]}-${m[2]}-${m[1]}`, origem: m[0], indice: m.index ?? 0 }))
    .filter((d) => {
      const [a, mm, dd] = d.iso.split("-").map(Number);
      return a >= 2000 && a <= 2100 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
    });
  const rotuloData = /(data\s*(do\s*pagamento|da\s*transa[cç][aã]o|de\s*emiss[aã]o|da\s*opera[cç][aã]o)?|pago\s*em|realizad[oa]\s*em)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  if (rotuloData) {
    const [dd, mm, aaaa] = rotuloData[3].split("/");
    campos.push({ campo: "data", rotulo: "Data", valor: `${aaaa}-${mm}-${dd}`, confianca: nivel("alta", confiancaOcr(rotuloData[3], palavras)), origem: rotuloData[0] });
  } else if (datas.length) {
    campos.push({ campo: "data", rotulo: "Data (primeira encontrada)", valor: datas[0].iso, confianca: datas.length > 1 ? "baixa" : "media", origem: datas[0].origem });
  }
  const venc = /vencimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(t);
  if (venc && !campos.some((c) => c.campo === "vencimento")) {
    const [dd, mm, aaaa] = venc[1].split("/");
    campos.push({ campo: "vencimento", rotulo: "Vencimento", valor: `${aaaa}-${mm}-${dd}`, confianca: nivel("alta", confiancaOcr(venc[1], palavras)), origem: venc[0] });
  }

  const dataPrincipal = campos.find((c) => c.campo === "data")?.valor ?? null;
  return { campos, competenciaSugerida: dataPrincipal ? `${dataPrincipal.slice(0, 7)}-01` : null };
}
