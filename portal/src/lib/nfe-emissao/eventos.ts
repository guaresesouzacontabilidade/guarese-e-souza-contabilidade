import { CODIGO_UF } from "@/lib/notas-automaticas/nfe";
import { assinatura, textoLeiaute, textoXml, type ChavesAssinatura } from "@/lib/fiscal/xml-assinatura";
import { dataHoraUf, type AmbienteNfe } from "./calculo";
import { NS_NFE } from "./nfe";

/**
 * Eventos da NF-e emitida pela empresa (esquemas dos pacotes Evento Canc e
 * Evento CCe v1.01), enviados ao autorizador do estado do emitente:
 *  - 110111 Cancelamento: com o protocolo de autorização e a justificativa
 *    (15 a 255 caracteres); em regra até 24 horas depois da autorização;
 *  - 110110 Carta de Correção: texto de 15 a 1000 caracteres; a última
 *    carta substitui as anteriores (até 20 por nota). Não corrige valores,
 *    quantidades, alíquotas, emitente, destinatário nem datas (Convênio
 *    S/N/1970, art. 7º, § 1º-A).
 */

export const CONDICAO_USO_CCE =
  "A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para " +
  "regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam " +
  "o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao " +
  "de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.";

interface Comum {
  ambiente: AmbienteNfe;
  uf: string;
  chave: string;
  /** CNPJ ou CPF do emitente */
  documento: string;
  quando: Date;
}

function evento(p: Comum & { tipo: "110111" | "110110"; sequencia: number; detalhe: string }, chaves: ChavesAssinatura) {
  if (!/^\d{6}[0-9A-Z]{12}\d{26}$/.test(p.chave)) throw new Error("Chave de acesso inválida.");
  const cuf = CODIGO_UF[p.uf.toUpperCase()];
  if (!cuf) throw new Error(`UF inválida (${p.uf}).`);
  const doc = p.documento.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const autor = doc.length === 11 ? `<CPF>${doc}</CPF>` : `<CNPJ>${doc}</CNPJ>`;
  if (!Number.isInteger(p.sequencia) || p.sequencia < 1 || p.sequencia > 20) throw new Error("Sequência do evento inválida (1 a 20).");
  const id = `ID${p.tipo}${p.chave}${String(p.sequencia).padStart(2, "0")}`;
  const filhos =
    `<cOrgao>${cuf}</cOrgao><tpAmb>${p.ambiente === "producao" ? 1 : 2}</tpAmb>${autor}<chNFe>${p.chave}</chNFe>` +
    `<dhEvento>${dataHoraUf(p.quando, p.uf)}</dhEvento><tpEvento>${p.tipo}</tpEvento><nSeqEvento>${p.sequencia}</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">${p.detalhe}</detEvento>`;
  const canonico = `<infEvento xmlns="${NS_NFE}" Id="${id}">${filhos}</infEvento>`;
  return { id, xml: `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${id}">${filhos}</infEvento>${assinatura(canonico, id, chaves)}</evento>` };
}

export function eventoCancelamento(p: Comum & { protocolo: string; justificativa: string }, chaves: ChavesAssinatura) {
  if (!/^\d{15}$/.test(p.protocolo)) throw new Error("Protocolo de autorização inválido.");
  const just = textoLeiaute(p.justificativa, 255);
  if (just.length < 15) throw new Error("Explique o motivo do cancelamento (de 15 a 255 caracteres).");
  return evento({ ...p, tipo: "110111", sequencia: 1, detalhe: `<descEvento>Cancelamento</descEvento><nProt>${p.protocolo}</nProt><xJust>${textoXml(just)}</xJust>` }, chaves);
}

export function eventoCartaCorrecao(p: Comum & { sequencia: number; correcao: string }, chaves: ChavesAssinatura) {
  const texto = textoLeiaute(p.correcao, 1000);
  if (texto.length < 15) throw new Error("Descreva a correção (de 15 a 1000 caracteres).");
  return evento(
    { ...p, tipo: "110110", detalhe: `<descEvento>Carta de Correcao</descEvento><xCorrecao>${textoXml(texto)}</xCorrecao><xCondUso>${CONDICAO_USO_CCE}</xCondUso>` },
    chaves,
  );
}
