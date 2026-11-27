import type { AmbienteNfe } from "./calculo";

/**
 * Cupom fiscal (NFC-e, modelo 65): link do QR Code e endereço de consulta pela
 * chave, que vão no XML (infNFeSupl) e no cupom impresso.
 *
 * QR Code versão 3 (NT 2025.001 — "Simplificação Operacional"): na emissão
 * normal (tpEmis = 1) o parâmetro p leva só chave|3|tpAmb, sem o CSC (Código
 * de Segurança do Contribuinte) e sem hash. A assinatura no QR Code só existe
 * no cupom emitido em contingência off-line, que o portal não usa: sem
 * resposta da SEFAZ, a venda fica gravada e o cupom pendente, para emitir de novo.
 *
 * Endereços de consulta: os da documentação da NFC-e da SEFAZ do estado
 * (TO: Portal da NFC-e da SEFAZ-TO). A SEFAZ confere se o endereço do QR Code
 * é o dela; um estado só entra na lista depois de conferido.
 */
interface EnderecosUf {
  qrCode: Record<AmbienteNfe, string>;
  consulta: Record<AmbienteNfe, string>;
}

const ENDERECOS: Record<string, EnderecosUf> = {
  TO: {
    qrCode: { producao: "http://www.sefaz.to.gov.br/nfce/qrcode", homologacao: "http://homologacao.sefaz.to.gov.br/nfce/qrcode" },
    consulta: { producao: "http://www.sefaz.to.gov.br/nfce/consulta", homologacao: "http://homologacao.sefaz.to.gov.br/nfce/consulta" },
  },
};

export const VERSAO_QRCODE = 3;

export function nfceNaUf(uf: string): boolean {
  return Boolean(ENDERECOS[uf.toUpperCase()]);
}

function enderecos(uf: string): EnderecosUf {
  const e = ENDERECOS[uf.toUpperCase()];
  if (!e) throw new Error(`O cupom fiscal (NFC-e) ainda não está disponível no portal para ${uf.toUpperCase()}. Fale com o escritório.`);
  return e;
}

/** Link do QR Code do cupom emitido normalmente (versão 3): chave|3|tpAmb. */
export function qrCodeNfce(chave: string, ambiente: AmbienteNfe, uf: string): string {
  if (!/^\d{6}[0-9A-Z]{12}\d{26}$/.test(chave) || chave.slice(20, 22) !== "65") throw new Error("Chave de acesso do cupom inválida.");
  return `${enderecos(uf).qrCode[ambiente]}?p=${chave}|${VERSAO_QRCODE}|${ambiente === "producao" ? 1 : 2}`;
}

/** Endereço de consulta pela chave de acesso (vai no XML e no cupom impresso). */
export function urlConsultaNfce(uf: string, ambiente: AmbienteNfe): string {
  return enderecos(uf).consulta[ambiente];
}

/** Chave em grupos de 4 dígitos, como no cupom impresso. */
export function chaveEmGrupos(chave: string): string {
  return chave.replace(/(.{4})/g, "$1 ").trim();
}
