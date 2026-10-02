/**
 * Sugestões de categoria e competência no momento do envio (no navegador).
 * São apenas sugestões: o cliente vê, pode alterar e só então envia. A leitura
 * completa do arquivo acontece depois, no servidor.
 */

export interface Sugestao {
  categoria?: string;
  competencia?: string; // AAAA-MM
  motivo: string;
}

const MESES: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5, jun: 6, junho: 6,
  jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11, dez: 12, dezembro: 12,
};

function normalizar(t: string) {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function comp(ano: number, mes: number): string | undefined {
  if (mes < 1 || mes > 12 || ano < 2000 || ano > new Date().getFullYear() + 1) return undefined;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/** Competência no nome do arquivo: "09-2026", "2026_09", "set2026", "setembro de 2026"... */
export function competenciaNoNome(nome: string): string | undefined {
  const n = normalizar(nome);
  let m = /(?:^|[^0-9])(20\d{2})[-_. ]?(0[1-9]|1[0-2])(?:[^0-9]|$)/.exec(n);
  if (m) return comp(Number(m[1]), Number(m[2]));
  m = /(?:^|[^0-9])(0[1-9]|1[0-2])[-_. /](20\d{2})(?:[^0-9]|$)/.exec(n);
  if (m) return comp(Number(m[2]), Number(m[1]));
  m = /(?:^|[^a-z])(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[-_. ]*(?:de[-_. ]*)?(20\d{2}|\d{2})(?:[^0-9]|$)/.exec(n);
  if (m) {
    const ano = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return comp(ano, MESES[m[1]]);
  }
  return undefined;
}

const REGRAS_NOME: { re: RegExp; categoria: string; rotulo: string }[] = [
  { re: /\b(stone|cielo|rede|pagseguro|pagbank|getnet|mercado ?pago|sumup|infinitepay|maquininhas?|adquirentes?|vendas? (no )?cartao)\b/, categoria: "relatorio_maquininha", rotulo: "relatório de maquininha" },
  { re: /\b(faturas?|cartao de credito|cartoes?|cartao)\b/, categoria: "extrato_cartao", rotulo: "fatura de cartão" },
  { re: /\b(extratos?|ofx)\b/, categoria: "extrato_bancario", rotulo: "extrato bancário" },
  { re: /\b(comprovantes?|pix|transferencias?|ted|recibos? de pagamento)\b/, categoria: "comprovante", rotulo: "comprovante" },
  { re: /\b(boletos?)\b/, categoria: "boleto", rotulo: "boleto" },
  { re: /\b(das|darf|gps|fgts|gare|dae|guias?|iss|icms|inss|irrf|simples nacional)\b/, categoria: "guia_imposto", rotulo: "guia de imposto" },
  { re: /\b(folhas?|holerites?|contracheques?|ponto|pro ?labore|ferias|rescisao|rescisoes|admissao|admissoes|esocial)\b/, categoria: "folha_pagamento", rotulo: "documento trabalhista" },
  { re: /\b(contratos?|emprestimos?|financiamentos?|cedulas?|ccb|consorcios?)\b/, categoria: "contrato_emprestimo", rotulo: "contrato/empréstimo" },
  { re: /\b(nfs ?e|notas? de servicos?|nfse)\b/, categoria: "nfse", rotulo: "nota de serviço" },
  { re: /\b(danfe|notas? fisca(l|is)|nf ?e|nfc ?e|cupom fiscal|cupons?)\b/, categoria: "notas_pdf", rotulo: "nota fiscal" },
];

export function extensao(nome: string) {
  return /\.([a-z0-9]{1,8})$/i.exec(nome)?.[1]?.toLowerCase() ?? "";
}

/** Sugestão a partir do nome e da extensão. */
export function sugerirPorNome(nome: string): Sugestao | null {
  const ext = extensao(nome);
  const n = normalizar(nome).replace(/[_\-.]+/g, " ");
  const competencia = competenciaNoNome(nome);
  if (ext === "ofx") return { categoria: /fatura|cartao/.test(n) ? "extrato_cartao" : "extrato_bancario", competencia, motivo: "arquivo OFX" };
  for (const r of REGRAS_NOME) {
    if (r.re.test(n)) return { categoria: r.categoria, competencia, motivo: `nome do arquivo indica ${r.rotulo}` };
  }
  if (competencia) return { competencia, motivo: "mês no nome do arquivo" };
  return null;
}

function tag(texto: string, nomes: string[]): string | undefined {
  for (const nome of nomes) {
    const m = new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}>\\s*([^<]+?)\\s*</`, "i").exec(texto);
    if (m) return m[1];
  }
  return undefined;
}

function bloco(texto: string, nome: string): string {
  const m = new RegExp(`<(?:[A-Za-z0-9_]+:)?${nome}[\\s>][\\s\\S]*?</(?:[A-Za-z0-9_]+:)?${nome}>`, "i").exec(texto);
  return m?.[0] ?? "";
}

function compDeData(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^(\d{4})-?(\d{2})/.exec(v.trim());
  return m ? comp(Number(m[1]), Number(m[2])) : undefined;
}

/**
 * Sugestão a partir do início do conteúdo (XML/OFX). `documentoEmpresa` é o
 * CNPJ/CPF da empresa, usado para distinguir notas de saída e de entrada.
 */
export function sugerirPorConteudo(nome: string, inicio: string, documentoEmpresa: string): Sugestao | null {
  const ext = extensao(nome);
  const doc = documentoEmpresa.replace(/\D/g, "");
  if (ext === "ofx" || /<OFX>|OFXHEADER/i.test(inicio)) {
    const cartao = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(inicio);
    const ini = /<DTSTART>\s*(\d{8})/i.exec(inicio)?.[1];
    const fim = /<DTEND>\s*(\d{8})/i.exec(inicio)?.[1];
    return {
      categoria: cartao ? "extrato_cartao" : "extrato_bancario",
      competencia: compDeData(fim ?? ini),
      motivo: cartao ? "conteúdo de fatura de cartão (OFX)" : "conteúdo de extrato (OFX)",
    };
  }
  if (ext !== "xml") return null;

  if (/<(?:[a-z0-9_]+:)?(procEventoNFe|procEventoCTe|eventoCTe|evento)[\s>]/i.test(inicio) && !/<infNFe|<infCte/i.test(inicio)) {
    return { categoria: "eventos_fiscais", competencia: compDeData(tag(inicio, ["dhEvento", "dhRegEvento"])), motivo: "XML de evento fiscal" };
  }
  if (/<(?:[a-z0-9_]+:)?infCte[\s>]/i.test(inicio)) {
    return { categoria: "cte_xml", competencia: compDeData(tag(inicio, ["dhEmi"])), motivo: "XML de CT-e" };
  }
  if (/<(?:[a-z0-9_]+:)?infNFe[\s>]/i.test(inicio)) {
    const emit = tag(bloco(inicio, "emit"), ["CNPJ", "CPF"])?.replace(/\D/g, "");
    const dest = tag(bloco(inicio, "dest"), ["CNPJ", "CPF"])?.replace(/\D/g, "");
    const competencia = compDeData(tag(inicio, ["dhEmi", "dEmi"]));
    if (doc && emit === doc) return { categoria: "nfe_saida_xml", competencia, motivo: "nota emitida pela empresa (saída)" };
    if (doc && dest === doc) return { categoria: "nfe_entrada_xml", competencia, motivo: "nota recebida pela empresa (entrada)" };
    return { competencia, motivo: "XML de nota fiscal — confirme se é de entrada ou saída" };
  }
  if (/<(?:[a-z0-9_]+:)?(CompNfse|Nfse|NFSe|infNFSe|InfNfse)[\s>]/i.test(inicio)) {
    return { categoria: "nfse", competencia: compDeData(tag(inicio, ["dCompet", "Competencia", "DataEmissao", "dhEmi", "dhProc"])), motivo: "XML de NFS-e" };
  }
  return null;
}

/** Junta as sugestões (conteúdo tem prioridade sobre o nome). */
export function combinarSugestoes(...lista: (Sugestao | null | undefined)[]): Sugestao | null {
  const validas = lista.filter((s): s is Sugestao => Boolean(s));
  if (!validas.length) return null;
  const categoria = validas.find((s) => s.categoria)?.categoria;
  const competencia = validas.find((s) => s.competencia)?.competencia;
  if (!categoria && !competencia) return null;
  const motivo = validas.find((s) => s.categoria || s.competencia)?.motivo ?? "";
  return { categoria, competencia, motivo };
}
