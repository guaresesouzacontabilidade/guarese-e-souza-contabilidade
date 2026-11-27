/**
 * Relatório de correções para o cliente: o que fazer em cada tipo de achado do
 * auditor fiscal e o código fiscal sugerido para cada produto. Textos fixos,
 * conferidos com as regras de cada achado (regras.ts e servicos.ts) — nada
 * aqui vem de inteligência artificial. O escritório revisa antes de entregar.
 */

export interface ProdutoCorrecao {
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  csosn: string | null;
  cst_icms: string | null;
  cst_pis: string | null;
  cst_cofins: string | null;
  operacao: "entrada" | "saida";
  motivo: string | null;
  itens: number;
  notas: number;
  valor: number | string;
  lista: { numero: string | null; modelo: string; data: string | null; documento_id: string | null; valor: number | string }[];
}

interface Guia {
  /** Passos para corrigir, em linguagem simples. */
  passos: string[];
  /** Como o produto deve sair nas próximas notas (ou o que pedir ao fornecedor). */
  sugestao?: (p: ProdutoCorrecao) => string;
}

const interestadual = (cfop: string | null) => (cfop ?? "").startsWith("6");
const cfopStRetido = (cfop: string | null) => (interestadual(cfop) ? "6.404" : "5.405");
const cfopTributado = (cfop: string | null) => (interestadual(cfop) ? "6.102" : "5.102");
/** Simples Nacional usa CSOSN; o regime normal, CST do ICMS. */
const doSimples = (p: ProdutoCorrecao) => Boolean(p.csosn) || !p.cst_icms;

export const GUIAS_CORRECAO: Record<string, Guia> = {
  monofasico_simples: {
    passos: [
      "Na apuração do Simples (PGDAS-D), informe a receita destes produtos como receita com PIS e Cofins monofásicos. Assim o DAS não cobra PIS e Cofins de novo.",
      "No sistema de vendas, marque estes produtos como monofásicos (PIS/Cofins CST 04 na revenda), para as próximas apurações já saírem separadas.",
      "Para os meses que já foram pagos sem a separação, o escritório retifica o PGDAS-D e pede a restituição do que foi pago a mais (prazo de 5 anos).",
    ],
    sugestao: () => "Monofásico: PIS/Cofins CST 04; no PGDAS-D, receita monofásica",
  },
  st_simples: {
    passos: [
      "No PGDAS-D, informe a receita destes produtos como receita com ICMS já pago por substituição tributária. Assim o DAS não cobra o ICMS de novo.",
      "No sistema de vendas, cadastre estes produtos como mercadoria com ICMS já retido: CSOSN 500 e CFOP 5.405 (6.404 para outro estado).",
      "Para os meses já pagos sem a separação, o escritório retifica o PGDAS-D e pede a restituição do ICMS pago a mais (prazo de 5 anos).",
    ],
    sugestao: (p) => `CSOSN 500 · CFOP ${cfopStRetido(p.cfop)}`,
  },
  monofasico_regime_normal: {
    passos: [
      "No sistema de vendas, cadastre estes produtos com PIS/Cofins CST 04 (revenda de monofásico, alíquota zero): as próximas notas saem sem PIS e Cofins.",
      "O PIS e a Cofins destacados e recolhidos nas vendas abaixo podem ser pedidos de volta ou compensados (PER/DCOMP), com a retificação da EFD-Contribuições e da DCTFWeb, em até 5 anos.",
    ],
    sugestao: () => "PIS/Cofins CST 04 (alíquota zero)",
  },
  icms_st_regime_normal: {
    passos: [
      "No sistema de vendas, cadastre estes produtos como mercadoria com ICMS já retido: CST 60, sem destaque de ICMS, e CFOP 5.405 (6.404 para outro estado).",
      "O escritório confere a apuração do ICMS dos meses abaixo: se o ICMS destacado entrou como débito, avalia o estorno ou a restituição conforme a regra do Estado.",
    ],
    sugestao: (p) => `CST 60 (sem ICMS próprio) · CFOP ${cfopStRetido(p.cfop)}`,
  },
  st_retida_fora_da_st: {
    passos: [
      "Estes produtos saíram da substituição tributária quando vendidos por indústria do Estado. Mostre esta lista ao fornecedor: ele deve emitir as próximas notas sem ICMS-ST.",
      "O ICMS-ST retido nas compras abaixo pode ser recuperado com pedido de restituição à SEFAZ, com a prova de quem pagou o imposto. O escritório prepara o pedido.",
    ],
    sugestao: () => "Pedir ao fornecedor nota sem ICMS-ST",
  },
  st_sem_compra_st: {
    passos: [
      "Estes produtos foram vendidos como se o ICMS já tivesse sido pago por substituição tributária, mas as compras chegaram sem ICMS-ST.",
      "Confira com o fornecedor. Se o ICMS não foi retido na compra, a venda precisa sair tributada normalmente (veja a coluna \"Corrigir para\"), e o escritório avalia o ICMS dos meses abaixo para evitar autuação.",
    ],
    sugestao: (p) => (doSimples(p) ? `CSOSN 102 · CFOP ${cfopTributado(p.cfop)}` : `CST 00 · CFOP ${cfopTributado(p.cfop)}`),
  },
  venda_st_fora_da_st: {
    passos: [
      "Estes produtos saíram da substituição tributária quando comprados de indústria do Estado. Só o estoque comprado com ICMS-ST pode ser vendido como ST.",
      "No sistema de vendas, o restante precisa sair tributado normalmente (veja a coluna \"Corrigir para\"). O escritório confere o estoque e o ICMS dos meses abaixo.",
    ],
    sugestao: (p) => (doSimples(p) ? `CSOSN 102 · CFOP ${cfopTributado(p.cfop)}` : `CST 00 · CFOP ${cfopTributado(p.cfop)}`),
  },
  estoque_saida_st: {
    passos: [
      "Faça o inventário destes produtos na data em que saíram da substituição tributária e envie ao escritório (quantidade e valor de cada um).",
      "O escritório lança o estoque na EFD (Bloco H, motivo 02) e faz o procedimento do Estado. Daí em diante as vendas desse estoque entram na apuração normal do ICMS.",
    ],
    sugestao: () => "Inventariar o estoque na data da mudança",
  },
  ncm_invalido: {
    passos: [
      "No cadastro do sistema de vendas, informe o NCM correto, com 8 dígitos, para cada produto abaixo. O NCM define a tributação (monofásico, ST e reforma tributária).",
      "Se não souber o NCM, consulte a nota de compra do fornecedor ou peça ajuda ao escritório.",
    ],
    sugestao: () => "Informar o NCM de 8 dígitos",
  },
  ibscbs_ausente: {
    passos: [
      "Peça ao suporte do sistema emissor de notas para ligar o destaque do IBS e da CBS (grupo IBSCBS) nas notas de venda, com as alíquotas de teste de 2026.",
      "Cumprir essa obrigação em 2026 dispensa o pagamento do IBS e da CBS de teste. As notas abaixo são exemplos do mês.",
    ],
  },
  ibscbs_aliquota: {
    passos: [
      "Peça ao suporte do sistema emissor para usar as alíquotas de teste de 2026 (CBS 0,9%, IBS estadual 0,1%, IBS municipal 0%) nas vendas com tributação integral.",
      "As notas abaixo são exemplos do mês.",
    ],
  },
  iss_retido_simples: {
    passos: [
      "No PGDAS-D, informe a receita destes serviços como receita com ISS retido. Assim o DAS não cobra o ISS de novo.",
      "Para os meses já pagos sem a separação, o escritório retifica o PGDAS-D e pede a restituição do ISS pago a mais.",
    ],
  },
  iss_aliquota_acima: {
    passos: [
      "Informe aos tomadores, em cada nota, a alíquota de ISS do Simples do mês (a parte do ISS na alíquota efetiva). Retenção acima dela é cobrança a mais.",
      "A diferença retida a mais pode ser pedida de volta ao município. O escritório prepara o pedido.",
    ],
  },
  iss_aliquota_abaixo: {
    passos: [
      "Nas próximas notas, informe a alíquota de ISS correta do mês (a parte do ISS na alíquota efetiva do Simples).",
      "A diferença não retida continua devida ao município: o escritório emite a guia complementar.",
    ],
  },
  retencao_federal_simples: {
    passos: [
      "Envie aos tomadores a declaração de optante pelo Simples Nacional para que parem de reter IR, PIS, Cofins e CSLL.",
      "Os valores retidos indevidamente nas notas abaixo podem ser recuperados. O escritório avalia o pedido.",
    ],
  },
  inss_retido_simples: {
    passos: [
      "Se a empresa não presta serviço do Anexo IV, peça aos tomadores que não retenham o INSS, informando o enquadramento no Simples.",
      "O INSS retido indevidamente nas notas abaixo pode ser compensado ou restituído pela DCTFWeb. O escritório confere.",
    ],
  },
  nfse_regime_divergente: {
    passos: ["No emissor de NFS-e, corrija o regime tributário da empresa (Simples Nacional, MEI ou regime normal) para as próximas notas saírem certas."],
  },
};

/** Como o produto saiu na nota: CFOP e códigos do ICMS e do PIS/Cofins. */
export function comoSaiu(p: ProdutoCorrecao): string {
  const partes = [
    p.cfop ? `CFOP ${p.cfop.length === 4 ? `${p.cfop[0]}.${p.cfop.slice(1)}` : p.cfop}` : null,
    p.csosn ? `CSOSN ${p.csosn}` : p.cst_icms ? `CST ${p.cst_icms}` : null,
    p.cst_pis ? `PIS/Cofins ${p.cst_pis}${p.cst_cofins && p.cst_cofins !== p.cst_pis ? `/${p.cst_cofins}` : ""}` : null,
  ].filter(Boolean);
  return partes.join(" · ") || "—";
}

export function formatarNcm(ncm: string | null): string {
  return ncm && /^\d{8}$/.test(ncm) ? `${ncm.slice(0, 4)}.${ncm.slice(4, 6)}.${ncm.slice(6)}` : ncm || "sem NCM";
}

export function sugestaoProduto(regra: string, p: ProdutoCorrecao): string {
  return GUIAS_CORRECAO[regra]?.sugestao?.(p) ?? "Conferir com o escritório";
}
