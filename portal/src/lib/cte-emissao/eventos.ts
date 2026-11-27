import { CODIGO_UF } from "@/lib/notas-automaticas/nfe";
import { assinatura, textoLeiaute, textoXml, type ChavesAssinatura } from "@/lib/fiscal/xml-assinatura";
import { dataHoraUf } from "@/lib/nfe-emissao/calculo";
import type { AmbienteCte } from "./calculo";
import { NS_CTE, VERSAO_CTE } from "./sefaz";

/**
 * Eventos do CT-e emitido pela empresa (esquemas evCancCTe e evCCeCTe 4.00),
 * enviados um a um ao autorizador do estado do emitente:
 *  - 110111 Cancelamento: com o protocolo de autorização e a justificativa
 *    (15 a 255 caracteres); em regra até 7 dias depois da autorização e
 *    antes do início da prestação;
 *  - 110110 Carta de Correção: campo a campo (grupo, campo e valor certo do
 *    leiaute); a última carta substitui as anteriores. Não corrige valores,
 *    alíquotas, tomador, remetente, destinatário nem datas (Convênio SINIEF
 *    06/89, art. 58-B).
 */

export const CONDICAO_USO_CCE_CTE =
  "A Carta de Correcao e disciplinada pelo Art. 58-B do CONVENIO/SINIEF 06/89: Fica permitida a utilizacao de carta de correcao, para regularizacao " +
  "de erro ocorrido na emissao de documentos fiscais relativos a prestacao de servico de transporte, desde que o erro nao esteja relacionado com: " +
  "I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da prestacao;" +
  "II - a correcao de dados cadastrais que implique mudanca do emitente, tomador, remetente ou do destinatario;III - a data de emissao ou de saida.";

export interface CorrecaoCte {
  grupo: string;
  campo: string;
  valor: string;
  /** Número do item, quando o grupo se repete (1 a 99) */
  item?: number | null;
}

interface Comum {
  ambiente: AmbienteCte;
  uf: string;
  chave: string;
  /** CNPJ do emitente */
  documento: string;
  quando: Date;
}

function evento(p: Comum & { tipo: "110111" | "110110"; sequencia: number; detalhe: string }, chaves: ChavesAssinatura) {
  if (!/^\d{6}[0-9A-Z]{12}\d{26}$/.test(p.chave) || p.chave.slice(20, 22) !== "57") throw new Error("Chave de acesso do CT-e inválida.");
  const cuf = CODIGO_UF[p.uf.toUpperCase()];
  if (!cuf) throw new Error(`UF inválida (${p.uf}).`);
  const doc = p.documento.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const autor = doc.length === 11 ? `<CPF>${doc}</CPF>` : `<CNPJ>${doc.padStart(14, "0")}</CNPJ>`;
  if (!Number.isInteger(p.sequencia) || p.sequencia < 1 || p.sequencia > 20) throw new Error("Sequência do evento inválida (1 a 20).");
  const id = `ID${p.tipo}${p.chave}${String(p.sequencia).padStart(3, "0")}`;
  const filhos =
    `<cOrgao>${cuf}</cOrgao><tpAmb>${p.ambiente === "producao" ? 1 : 2}</tpAmb>${autor}<chCTe>${p.chave}</chCTe>` +
    `<dhEvento>${dataHoraUf(p.quando, p.uf)}</dhEvento><tpEvento>${p.tipo}</tpEvento><nSeqEvento>${p.sequencia}</nSeqEvento>` +
    `<detEvento versaoEvento="${VERSAO_CTE}">${p.detalhe}</detEvento>`;
  const canonico = `<infEvento xmlns="${NS_CTE}" Id="${id}">${filhos}</infEvento>`;
  return {
    id,
    xml: `<eventoCTe xmlns="${NS_CTE}" versao="${VERSAO_CTE}"><infEvento Id="${id}">${filhos}</infEvento>${assinatura(canonico, id, chaves)}</eventoCTe>`,
  };
}

export function eventoCancelamentoCte(p: Comum & { protocolo: string; justificativa: string }, chaves: ChavesAssinatura) {
  if (!/^\d{15}$/.test(p.protocolo)) throw new Error("Protocolo de autorização inválido.");
  const just = textoLeiaute(p.justificativa, 255);
  if (just.length < 15) throw new Error("Explique o motivo do cancelamento (de 15 a 255 caracteres).");
  return evento(
    { ...p, tipo: "110111", sequencia: 1, detalhe: `<evCancCTe><descEvento>Cancelamento</descEvento><nProt>${p.protocolo}</nProt><xJust>${textoXml(just)}</xJust></evCancCTe>` },
    chaves,
  );
}

export function eventoCartaCorrecaoCte(p: Comum & { sequencia: number; correcoes: CorrecaoCte[] }, chaves: ChavesAssinatura) {
  if (!p.correcoes.length || p.correcoes.length > 20) throw new Error("Informe de 1 a 20 correções.");
  const itens = p.correcoes.map((c) => {
    if (!/^[A-Za-z]{1,20}$/.test(c.grupo) || !/^[A-Za-z]{1,20}$/.test(c.campo)) throw new Error("Correção inválida: grupo e campo do leiaute.");
    const valor = textoLeiaute(c.valor, 500);
    if (!valor) throw new Error(`Informe o valor certo de ${c.grupo}/${c.campo}.`);
    if (c.item != null && (!Number.isInteger(c.item) || c.item < 1 || c.item > 99)) throw new Error("Número do item da correção inválido (1 a 99).");
    return (
      `<infCorrecao><grupoAlterado>${c.grupo}</grupoAlterado><campoAlterado>${c.campo}</campoAlterado>` +
      `<valorAlterado>${textoXml(valor)}</valorAlterado>${c.item != null ? `<nroItemAlterado>${String(c.item).padStart(2, "0")}</nroItemAlterado>` : ""}</infCorrecao>`
    );
  });
  return evento(
    { ...p, tipo: "110110", detalhe: `<evCCeCTe><descEvento>Carta de Correcao</descEvento>${itens.join("")}<xCondUso>${CONDICAO_USO_CCE_CTE}</xCondUso></evCCeCTe>` },
    chaves,
  );
}
