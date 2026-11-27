import { dvChave } from "@/lib/fiscal/chave";
import { CODIGO_UF } from "@/lib/notas-automaticas/nfe";
import { assinatura, textoLeiaute, textoXml, type ChavesAssinatura } from "@/lib/fiscal/xml-assinatura";
import { dataHoraUf, type GrupoIbsCalculado } from "@/lib/nfe-emissao/calculo";
import { dec, fmt, type Dec } from "@/lib/nfe-emissao/decimal";
import { VERSAO_APLICATIVO } from "@/lib/nfe-emissao/nfe";
import { calcularCte, type CteCalculado, type EntradaCte, type ParticipanteCte } from "./calculo";
import { NS_CTE, VERSAO_CTE, urlQrCode } from "./sefaz";

export { NS_CTE, VERSAO_CTE };

/**
 * CT-e modelo 57, versão 4.00, modal rodoviário (pacote de esquemas
 * PL_CTe_400 da NT 2026.002 v1.01, em produção desde 31/08/2026). O XML sai na
 * forma canônica (sem espaços entre os elementos), assinado no infCte
 * (RSA-SHA1, C14N), com o QR Code no infCTeSupl.
 *
 * Regras do Manual de Orientação (MOC 4.00 e Anexo I) seguidas aqui:
 *  - em homologação, a razão social do remetente e do destinatário é o texto
 *    fixo exigido (rejeições 646 e 649);
 *  - CFOP com 5 quando a prestação começa e termina no mesmo estado e 6
 *    quando termina em outro (519); a prestação começa no estado do emitente
 *    (o caso 5932/6932 é barrado antes, no banco);
 *  - o grupo IBS/CBS sempre vai (exigido em homologação desde 01/07/2026),
 *    com o total do documento (vTotDFe), que em 2026 é o valor da prestação;
 *  - o modal rodoviário leva só o RNTRC (veículo e motorista ficam no MDF-e).
 */

export const NOME_HOMOLOGACAO_CTE = "CTE EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

const tx = (nome: string, valor: string | null | undefined, max: number) => {
  if (valor == null) return "";
  const t = textoLeiaute(valor, max);
  return t ? `<${nome}>${textoXml(t)}</${nome}>` : "";
};
const v2 = (v: Dec) => fmt(v, 2);
const p2 = (v: Dec) => fmt(v, 2);
const p4 = (v: Dec) => fmt(v, 4);
const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Chave de acesso do CT-e (44 dígitos), com o dígito verificador. */
export function chaveCte(p: { uf: string; emitidoEm: Date; documento: string; serie: number; numero: number; tipoEmissao?: number; codigoNumerico: string }): string {
  const cuf = CODIGO_UF[p.uf.toUpperCase()];
  if (!cuf) throw new Error(`UF do emitente inválida (${p.uf}).`);
  const local = dataHoraUf(p.emitidoEm, p.uf);
  const aamm = local.slice(2, 4) + local.slice(5, 7);
  const doc = p.documento.toUpperCase().padStart(14, "0");
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(doc)) throw new Error("CNPJ do emitente inválido.");
  if (!/^\d{8}$/.test(p.codigoNumerico)) throw new Error("Código numérico do CT-e inválido.");
  if (!Number.isInteger(p.serie) || p.serie < 0 || p.serie > 999) throw new Error("Série do CT-e inválida.");
  const base = `${cuf}${aamm}${doc}57${String(p.serie).padStart(3, "0")}${String(p.numero).padStart(9, "0")}${p.tipoEmissao ?? 1}${p.codigoNumerico}`;
  return base + dvChave(base);
}

function documento(p: { tipo: string; documento: string }, campoCnpj = "CNPJ"): string {
  const d = p.documento.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return p.tipo === "cpf" ? `<CPF>${d.padStart(11, "0")}</CPF>` : `<${campoCnpj}>${d.padStart(14, "0")}</${campoCnpj}>`;
}

/** IE do participante: o número (contribuinte), ISENTO ou nada (não contribuinte). */
function ie(p: ParticipanteCte): string {
  if (p.indicadorIe === 1 && digitos(p.inscricaoEstadual)) return `<IE>${digitos(p.inscricaoEstadual)}</IE>`;
  if (p.indicadorIe === 2) return "<IE>ISENTO</IE>";
  return "";
}

function endereco(tag: string, e: ParticipanteCte["endereco"], comPais: boolean): string {
  const cep = digitos(e.cep);
  return (
    `<${tag}>` +
    tx("xLgr", e.logradouro, 255) +
    tx("nro", e.numero || "SN", 60) +
    tx("xCpl", e.complemento, 60) +
    tx("xBairro", e.bairro, 60) +
    `<cMun>${e.codigoMunicipio}</cMun>` +
    tx("xMun", e.municipio, 60) +
    (cep.length === 8 ? `<CEP>${cep}</CEP>` : "") +
    `<UF>${e.uf}</UF>` +
    (comPais ? "<cPais>1058</cPais><xPais>BRASIL</xPais>" : "") +
    `</${tag}>`
  );
}

function fone(v: string | null | undefined): string {
  const f = digitos(v);
  return f.length >= 6 && f.length <= 14 ? `<fone>${f}</fone>` : "";
}

function email(v: string | null | undefined): string {
  const e = (v ?? "").trim();
  return e && e.length <= 60 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? `<email>${textoXml(e)}</email>` : "";
}

/** Remetente ou destinatário (no ambiente de teste, com a razão social exigida pela SEFAZ). */
function participante(tag: "rem" | "dest", tagEndereco: string, p: ParticipanteCte, homologacao: boolean): string {
  const nome = homologacao ? NOME_HOMOLOGACAO_CTE : p.nome;
  return `<${tag}>${documento(p)}${ie(p)}${tx("xNome", nome, 60)}${fone(p.telefone)}${endereco(tagEndereco, p.endereco, true)}${email(p.email)}</${tag}>`;
}

function tomadorXml(c: CteCalculado): string {
  const t = c.entrada.tomador;
  if (t.papel === 0 || t.papel === 3) return `<toma3><toma>${t.papel}</toma></toma3>`;
  const p = t.participante;
  if (!p) throw new Error("Falta o tomador do serviço.");
  return `<toma4><toma>4</toma>${documento(p)}${ie(p)}${tx("xNome", p.nome, 60)}${fone(p.telefone)}${endereco("enderToma", p.endereco, true)}${email(p.email)}</toma4>`;
}

function icmsXml(c: CteCalculado): string {
  const i = c.icms;
  switch (i.grupo) {
    case "ICMS00":
      return `<ICMS00><CST>00</CST><vBC>${v2(i.vBC)}</vBC><pICMS>${p2(i.pICMS!)}</pICMS><vICMS>${v2(i.vICMS)}</vICMS></ICMS00>`;
    case "ICMS20":
      return `<ICMS20><CST>20</CST><pRedBC>${p2(i.pRedBC!)}</pRedBC><vBC>${v2(i.vBC)}</vBC><pICMS>${p2(i.pICMS!)}</pICMS><vICMS>${v2(i.vICMS)}</vICMS></ICMS20>`;
    case "ICMS45":
      return `<ICMS45><CST>${i.cst}</CST></ICMS45>`;
    case "ICMS60":
      return (
        `<ICMS60><CST>60</CST><vBCSTRet>${v2(i.vBC)}</vBCSTRet><vICMSSTRet>${v2(i.vICMS)}</vICMSSTRet><pICMSSTRet>${p2(i.pICMS!)}</pICMSSTRet>` +
        (i.vCred != null ? `<vCred>${v2(i.vCred)}</vCred>` : "") +
        "</ICMS60>"
      );
    case "ICMS90":
      return (
        `<ICMS90><CST>90</CST>${i.pRedBC != null ? `<pRedBC>${p2(i.pRedBC)}</pRedBC>` : ""}<vBC>${v2(i.vBC)}</vBC><pICMS>${p2(i.pICMS!)}</pICMS>` +
        `<vICMS>${v2(i.vICMS)}</vICMS>${i.vCred != null ? `<vCred>${v2(i.vCred)}</vCred>` : ""}</ICMS90>`
      );
    case "ICMSSN":
      return "<ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN>";
  }
}

function grupoIbsXml(tag: string, sufixo: "UF" | "Mun" | "", g: GrupoIbsCalculado): string {
  const nomeP = sufixo === "" ? "pCBS" : `pIBS${sufixo}`;
  const nomeV = sufixo === "" ? "vCBS" : `vIBS${sufixo}`;
  return (
    `<${tag}><${nomeP}>${p4(g.pAliq)}</${nomeP}>` +
    (g.pDif != null ? `<gDif><pDif>${p4(g.pDif)}</pDif><vDif>${v2(g.vDif)}</vDif></gDif>` : "") +
    (g.pRed != null ? `<gRed><pRedAliq>${p4(g.pRed)}</pRedAliq><pAliqEfet>${p4(g.pAliqEfet!)}</pAliqEfet></gRed>` : "") +
    `<${nomeV}>${v2(g.valor)}</${nomeV}></${tag}>`
  );
}

function ibsCbsXml(c: CteCalculado): string {
  const b = c.ibscbs;
  if (!b) return "";
  const cab = `<CST>${b.cst}</CST><cClassTrib>${b.classificacao}</cClassTrib>`;
  // Simples Nacional e MEI: o grupo de valores não é exigido (NT 2025.001, regra 006)
  const simples = [1, 2, 4].includes(c.entrada.emitente.crt);
  if (!b.comValores || simples) return `<IBSCBS>${cab}</IBSCBS>`;
  return (
    `<IBSCBS>${cab}<gIBSCBS><vBC>${v2(b.vBC)}</vBC>` +
    grupoIbsXml("gIBSUF", "UF", b.uf) +
    grupoIbsXml("gIBSMun", "Mun", b.mun) +
    `<vIBS>${v2(b.vIBS)}</vIBS>` +
    grupoIbsXml("gCBS", "", b.cbs) +
    "</gIBSCBS></IBSCBS>"
  );
}

function impXml(c: CteCalculado): string {
  return (
    `<imp><ICMS>${icmsXml(c)}</ICMS>` +
    (c.vTotTrib > 0n ? `<vTotTrib>${v2(c.vTotTrib)}</vTotTrib>` : "") +
    ibsCbsXml(c) +
    (c.ibscbs ? `<vTotDFe>${v2(c.vTotDFe)}</vTotDFe>` : "") +
    "</imp>"
  );
}

function cargaXml(c: CteCalculado): string {
  const g = c.entrada.carga;
  const peso = dec(g.pesoKg);
  if (peso <= 0n) throw new Error("Informe o peso da carga.");
  return (
    "<infCarga>" +
    (g.valor ? `<vCarga>${v2(dec(g.valor))}</vCarga>` : "") +
    tx("proPred", g.produto, 60) +
    tx("xOutCat", g.outras, 30) +
    `<infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>${fmt(peso, 4)}</qCarga></infQ>` +
    "</infCarga>"
  );
}

export interface CteMontado {
  chave: string;
  id: string;
  calculado: CteCalculado;
  filhos: string;
  canonico: string;
  qrCode: string;
}

export function montarCte(e: EntradaCte): CteMontado {
  const c = calcularCte(e);
  const em = e.emitente;
  const uf = em.endereco.uf.toUpperCase();
  const homologacao = e.ambiente !== "producao";
  if (!e.nfes.length) throw new Error("Informe ao menos uma NF-e da carga.");
  if (e.nfes.some((k) => !/^\d{44}$/.test(k))) throw new Error("Chave de NF-e inválida.");
  const mesmaUf = e.inicio.uf === e.fim.uf;
  if (!/^[56]/.test(e.cfop) || (mesmaUf && !e.cfop.startsWith("5")) || (!mesmaUf && !e.cfop.startsWith("6"))) {
    throw new Error(`O CFOP ${e.cfop} não combina com o trajeto (${e.inicio.uf} → ${e.fim.uf}).`);
  }
  if (e.inicio.uf !== uf) throw new Error("A prestação precisa começar no estado do emitente.");

  const chave = chaveCte({ uf, emitidoEm: e.emitidoEm, documento: em.documento, serie: e.serie, numero: e.numero, codigoNumerico: e.codigoNumerico });
  const id = `CTe${chave}`;
  const ide =
    "<ide>" +
    `<cUF>${CODIGO_UF[uf]}</cUF><cCT>${e.codigoNumerico}</cCT><CFOP>${e.cfop}</CFOP>` +
    tx("natOp", e.natureza, 60) +
    `<mod>57</mod><serie>${e.serie}</serie><nCT>${e.numero}</nCT><dhEmi>${dataHoraUf(e.emitidoEm, uf)}</dhEmi>` +
    `<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${homologacao ? 2 : 1}</tpAmb>` +
    `<tpCTe>0</tpCTe><procEmi>0</procEmi><verProc>${VERSAO_APLICATIVO}</verProc>` +
    `<cMunEnv>${em.endereco.codigoMunicipio}</cMunEnv>${tx("xMunEnv", em.endereco.municipio, 60)}<UFEnv>${uf}</UFEnv>` +
    "<modal>01</modal><tpServ>0</tpServ>" +
    `<cMunIni>${e.inicio.codigoMunicipio}</cMunIni>${tx("xMunIni", e.inicio.municipio, 60)}<UFIni>${e.inicio.uf}</UFIni>` +
    `<cMunFim>${e.fim.codigoMunicipio}</cMunFim>${tx("xMunFim", e.fim.municipio, 60)}<UFFim>${e.fim.uf}</UFFim>` +
    `<retira>1</retira><indIEToma>${e.tomador.indicadorIe}</indIEToma>` +
    tomadorXml(c) +
    "</ide>";
  const obs = e.observacoes ? textoLeiaute(e.observacoes, 2000) : "";
  const compl = obs ? `<compl><xObs>${textoXml(obs)}</xObs></compl>` : "";
  const emit =
    "<emit>" +
    `<CNPJ>${em.documento.toUpperCase().replace(/[^0-9A-Z]/g, "").padStart(14, "0")}</CNPJ>` +
    `<IE>${digitos(em.inscricaoEstadual)}</IE>` +
    tx("xNome", em.nome, 60) +
    tx("xFant", em.fantasia, 60) +
    "<enderEmit>" +
    tx("xLgr", em.endereco.logradouro, 255) +
    tx("nro", em.endereco.numero || "SN", 60) +
    tx("xCpl", em.endereco.complemento, 60) +
    tx("xBairro", em.endereco.bairro, 60) +
    `<cMun>${em.endereco.codigoMunicipio}</cMun>` +
    tx("xMun", em.endereco.municipio, 60) +
    (digitos(em.endereco.cep).length === 8 ? `<CEP>${digitos(em.endereco.cep)}</CEP>` : "") +
    `<UF>${uf}</UF>` +
    fone(em.endereco.telefone) +
    "</enderEmit>" +
    `<CRT>${em.crt}</CRT>` +
    "</emit>";
  const rem = participante("rem", "enderReme", e.remetente, homologacao);
  const dest = participante("dest", "enderDest", e.destinatario, homologacao);
  const vPrest =
    `<vPrest><vTPrest>${v2(c.vTPrest)}</vTPrest><vRec>${v2(c.vRec)}</vRec>` +
    e.componentes.map((x) => `<Comp>${tx("xNome", x.nome, 15)}<vComp>${v2(dec(x.valor))}</vComp></Comp>`).join("") +
    "</vPrest>";
  const norm =
    "<infCTeNorm>" +
    cargaXml(c) +
    `<infDoc>${e.nfes.map((k) => `<infNFe><chave>${k}</chave></infNFe>`).join("")}</infDoc>` +
    `<infModal versaoModal="${VERSAO_CTE}"><rodo><RNTRC>${e.rntrc}</RNTRC></rodo></infModal>` +
    "</infCTeNorm>";
  const aut = (e.autorizadosXml ?? []).map((d) => `<autXML><CNPJ>${d}</CNPJ></autXML>`).join("");
  const rt = e.responsavelTecnico
    ? `<infRespTec><CNPJ>${e.responsavelTecnico.cnpj}</CNPJ>${tx("xContato", e.responsavelTecnico.contato, 60)}<email>${textoXml(e.responsavelTecnico.email.slice(0, 60))}</email><fone>${e.responsavelTecnico.telefone}</fone></infRespTec>`
    : "";
  const filhos = ide + compl + emit + rem + dest + vPrest + impXml(c) + norm + aut + rt;
  const qrCode = `${urlQrCode(uf, e.ambiente)}?chCTe=${chave}&tpAmb=${homologacao ? 2 : 1}`;
  return { chave, id, calculado: c, filhos, canonico: `<infCte xmlns="${NS_CTE}" Id="${id}" versao="${VERSAO_CTE}">${filhos}</infCte>`, qrCode };
}

/** CT-e assinado, pronto para a recepção síncrona. */
export function cteAssinado(e: EntradaCte, chaves: ChavesAssinatura): CteMontado & { xml: string } {
  const m = montarCte(e);
  return {
    ...m,
    xml:
      `<CTe xmlns="${NS_CTE}"><infCte Id="${m.id}" versao="${VERSAO_CTE}">${m.filhos}</infCte>` +
      `<infCTeSupl><qrCodCTe>${textoXml(m.qrCode)}</qrCodCTe></infCTeSupl>` +
      `${assinatura(m.canonico, m.id, chaves)}</CTe>`,
  };
}
