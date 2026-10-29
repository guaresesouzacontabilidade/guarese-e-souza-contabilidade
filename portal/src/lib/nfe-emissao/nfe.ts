import { randomInt } from "node:crypto";
import { dvChave } from "@/lib/fiscal/chave";
import { CODIGO_UF } from "@/lib/notas-automaticas/nfe";
import { assinatura, textoLeiaute, textoXml, type ChavesAssinatura } from "@/lib/fiscal/xml-assinatura";
import { calcularNota, dataHoraUf, type EntradaNfe, type GrupoIbsCalculado, type ItemCalculado, type NotaCalculada } from "./calculo";
import { dec, fmt, fmtVariavel, somar, type Dec } from "./decimal";

/**
 * NF-e modelo 55, leiaute 4.00 (pacote de esquemas PL_010f v1.04, de
 * 31/08/2026, com o IBS/CBS da NT 2025.002-RTC). O XML sai na forma canônica
 * (sem espaços entre os elementos), assinado no infNFe (RSA-SHA1, C14N),
 * como no padrão nacional.
 *
 * Regras do Manual de Orientação seguidas aqui (as que costumam recusar a nota):
 *  - em homologação, o nome do destinatário é o texto fixo exigido (598);
 *  - emitente pessoa física (produtor rural) usa as séries 920 a 969;
 *  - veículo (veicTransp) só em operação interna; nas demais, a placa vai
 *    nas informações complementares;
 *  - indicador de intermediador quando a venda não é presencial;
 *  - pagamento: soma igual ao total da nota (ou "90 - sem pagamento" com zero).
 */

export const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
export const VERSAO_NFE = "4.00";
export const VERSAO_APLICATIVO = "PortalGuaresesON-1.0";
export const NOME_HOMOLOGACAO = "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

/** Texto livre já limpo para o leiaute (Latin-1, sem espaços duplos) e escapado. */
const tx = (nome: string, valor: string | null | undefined, max: number) => {
  if (valor == null) return "";
  const t = textoLeiaute(valor, max);
  return t ? `<${nome}>${textoXml(t)}</${nome}>` : "";
};
const v2 = (v: Dec) => fmt(v, 2);
const p4 = (v: Dec) => fmt(v, 4);
const p2 = (v: Dec) => fmt(v, 2);
const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** cNF: 8 dígitos sorteados, diferente do número da nota e sem sequências óbvias. */
export function sortearCodigoNumerico(numero: number): string {
  for (;;) {
    const c = String(randomInt(10_000_000, 100_000_000));
    if (c !== String(numero).padStart(8, "0") && !/^(\d)\1{7}$/.test(c) && c !== "12345678" && c !== "87654321") return c;
  }
}

/** Chave de acesso (44 dígitos) e o dígito verificador. */
export function chaveDeAcesso(p: { uf: string; emitidaEm: Date; documento: string; serie: number; numero: number; tipoEmissao?: number; codigoNumerico: string }): string {
  const cuf = CODIGO_UF[p.uf.toUpperCase()];
  if (!cuf) throw new Error(`UF do emitente inválida (${p.uf}).`);
  const local = dataHoraUf(p.emitidaEm, p.uf);
  const aamm = local.slice(2, 4) + local.slice(5, 7);
  const doc = p.documento.toUpperCase().padStart(14, "0");
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(doc)) throw new Error("CNPJ/CPF do emitente inválido.");
  if (!/^\d{8}$/.test(p.codigoNumerico)) throw new Error("Código numérico da nota inválido.");
  const base = `${cuf}${aamm}${doc}55${String(p.serie).padStart(3, "0")}${String(p.numero).padStart(9, "0")}${p.tipoEmissao ?? 1}${p.codigoNumerico}`;
  return base + dvChave(base);
}

function validarSerie(e: EntradaNfe) {
  if (!Number.isInteger(e.numero) || e.numero < 1 || e.numero > 999_999_999) throw new Error("Número da nota inválido.");
  if (e.emitente.tipo === "cpf") {
    if (e.serie < 920 || e.serie > 969) throw new Error("Produtor rural pessoa física emite NF-e nas séries 920 a 969.");
  } else if (e.serie < 0 || e.serie > 889) {
    throw new Error("Série da NF-e inválida (0 a 889).");
  }
}

function endereco(tag: string, e: EntradaNfe["emitente"]["endereco"], emitente: boolean): string {
  const exterior = !emitente && (e.uf.toUpperCase() === "EX" || (e.codigoPais && e.codigoPais !== "1058"));
  const cep = digitos(e.cep);
  if (emitente && !/^\d{8}$/.test(cep)) throw new Error("CEP do emitente inválido.");
  if (!/^\d{7}$/.test(e.codigoMunicipio)) throw new Error(`Código do município inválido (${e.municipio}).`);
  return (
    `<${tag}>` +
    tx("xLgr", e.logradouro || "SEM ENDERECO", 60) +
    tx("nro", e.numero || "SN", 60) +
    tx("xCpl", e.complemento, 60) +
    tx("xBairro", e.bairro || "NAO INFORMADO", 60) +
    `<cMun>${e.codigoMunicipio}</cMun>` +
    tx("xMun", e.municipio, 60) +
    `<UF>${e.uf.toUpperCase()}</UF>` +
    (/^\d{8}$/.test(cep) ? `<CEP>${cep}</CEP>` : "") +
    (exterior ? `<cPais>${e.codigoPais}</cPais>${tx("xPais", e.pais, 60)}` : "<cPais>1058</cPais><xPais>BRASIL</xPais>") +
    (/^\d{6,14}$/.test(digitos(e.telefone)) ? `<fone>${digitos(e.telefone)}</fone>` : "") +
    `</${tag}>`
  );
}

function icmsXml(i: ItemCalculado): string {
  const c = i.icms;
  const orig = `<orig>${i.entrada.origem}</orig>`;
  if (c.simples) {
    if (c.cst === "101") return `<ICMSSN101>${orig}<CSOSN>101</CSOSN><pCredSN>${p2(c.pCredSN!)}</pCredSN><vCredICMSSN>${v2(c.vCredICMSSN)}</vCredICMSSN></ICMSSN101>`;
    if (c.cst === "900") {
      const base = c.comBase ? `<modBC>3</modBC><vBC>${v2(c.vBC)}</vBC>${c.pRedBC ? `<pRedBC>${p2(c.pRedBC)}</pRedBC>` : ""}<pICMS>${p2(c.pICMS!)}</pICMS><vICMS>${v2(c.vICMS)}</vICMS>` : "";
      return `<ICMSSN900>${orig}<CSOSN>900</CSOSN>${base}</ICMSSN900>`;
    }
    // ICMS já retido pelo fornecedor (substituído): sem destaque; o ICMS retido antes é opcional no leiaute
    if (c.cst === "500") return `<ICMSSN500>${orig}<CSOSN>500</CSOSN></ICMSSN500>`;
    return `<ICMSSN102>${orig}<CSOSN>${c.cst}</CSOSN></ICMSSN102>`;
  }
  const cst = `<CST>${c.cst}</CST>`;
  switch (c.cst) {
    case "00":
      return `<ICMS00>${orig}${cst}<modBC>3</modBC><vBC>${v2(c.vBC)}</vBC><pICMS>${p2(c.pICMS!)}</pICMS><vICMS>${v2(c.vICMS)}</vICMS></ICMS00>`;
    case "20":
      return `<ICMS20>${orig}${cst}<modBC>3</modBC><pRedBC>${p2(c.pRedBC!)}</pRedBC><vBC>${v2(c.vBC)}</vBC><pICMS>${p2(c.pICMS!)}</pICMS><vICMS>${v2(c.vICMS)}</vICMS></ICMS20>`;
    case "40":
    case "41":
    case "50":
      return `<ICMS40>${orig}${cst}</ICMS40>`;
    case "60":
      return `<ICMS60>${orig}${cst}</ICMS60>`;
    case "51":
      return (
        `<ICMS51>${orig}${cst}<modBC>3</modBC>${c.pRedBC ? `<pRedBC>${p2(c.pRedBC)}</pRedBC>` : ""}` +
        `<vBC>${v2(c.vBC)}</vBC><pICMS>${p2(c.pICMS!)}</pICMS><vICMSOp>${v2(c.vICMSOp)}</vICMSOp>` +
        `<pDif>${p2(c.pDif!)}</pDif><vICMSDif>${v2(c.vICMSDif)}</vICMSDif><vICMS>${v2(c.vICMS)}</vICMS></ICMS51>`
      );
    case "90": {
      const base = c.comBase
        ? `<modBC>3</modBC><vBC>${v2(c.vBC)}</vBC>${c.pRedBC ? `<pRedBC>${p2(c.pRedBC)}</pRedBC>` : ""}<pICMS>${p2(c.pICMS!)}</pICMS><vICMS>${v2(c.vICMS)}</vICMS>`
        : "";
      return `<ICMS90>${orig}${cst}${base}</ICMS90>`;
    }
  }
  throw new Error(`CST ${c.cst} do ICMS não aceito.`);
}

function pisCofinsXml(tag: "PIS" | "COFINS", c: ItemCalculado["pis"]): string {
  const p = tag === "PIS" ? "pPIS" : "pCOFINS";
  const v = tag === "PIS" ? "vPIS" : "vCOFINS";
  if (c.grupo === "NT") return `<${tag}><${tag}NT><CST>${c.cst}</CST></${tag}NT></${tag}>`;
  return `<${tag}><${tag}${c.grupo}><CST>${c.cst}</CST><vBC>${v2(c.vBC)}</vBC><${p}>${p2(c.aliquota)}</${p}><${v}>${v2(c.valor)}</${v}></${tag}${c.grupo}></${tag}>`;
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

function ibsCbsXml(i: ItemCalculado): string {
  const b = i.ibscbs;
  if (!b) return "";
  const cab = `<CST>${b.cst}</CST><cClassTrib>${b.classificacao}</cClassTrib>`;
  if (!b.comValores) return `<IBSCBS>${cab}</IBSCBS>`;
  return (
    `<IBSCBS>${cab}<gIBSCBS><vBC>${v2(b.vBC)}</vBC>` +
    grupoIbsXml("gIBSUF", "UF", b.uf) +
    grupoIbsXml("gIBSMun", "Mun", b.mun) +
    `<vIBS>${v2(b.vIBS)}</vIBS>` +
    grupoIbsXml("gCBS", "", b.cbs) +
    "</gIBSCBS></IBSCBS>"
  );
}

function itemXml(nota: NotaCalculada, i: ItemCalculado): string {
  const e = i.entrada;
  const gtin = e.gtin && /^(\d{8}|\d{12,14})$/.test(e.gtin) ? e.gtin : "SEM GTIN";
  const opc = (nome: string, v: Dec) => (v > 0n ? `<${nome}>${v2(v)}</${nome}>` : "");
  const qtd = fmtVariavel(i.quantidade, 4);
  const unit = fmtVariavel(i.valorUnitario, 10, 2);
  const prod =
    "<prod>" +
    tx("cProd", e.codigo, 60) +
    `<cEAN>${gtin}</cEAN>` +
    tx("xProd", e.descricao, 120) +
    `<NCM>${e.ncm}</NCM>` +
    (e.cest && /^\d{7}$/.test(e.cest) ? `<CEST>${e.cest}</CEST>` : "") +
    (e.icms.beneficio ? tx("cBenef", e.icms.beneficio, 10) : "") +
    `<CFOP>${e.cfop}</CFOP>` +
    tx("uCom", e.unidade, 6) +
    `<qCom>${qtd}</qCom><vUnCom>${unit}</vUnCom><vProd>${v2(i.vProd)}</vProd>` +
    `<cEANTrib>${gtin}</cEANTrib>` +
    tx("uTrib", e.unidade, 6) +
    `<qTrib>${qtd}</qTrib><vUnTrib>${unit}</vUnTrib>` +
    opc("vFrete", i.vFrete) +
    opc("vSeg", i.vSeg) +
    opc("vDesc", i.vDesc) +
    opc("vOutro", i.vOutro) +
    "<indTot>1</indTot>" +
    (nota.entrada.pedidoCompra ? tx("xPed", nota.entrada.pedidoCompra, 15) : "") +
    "</prod>";
  const d = i.difal;
  const difal = d
    ? `<ICMSUFDest><vBCUFDest>${v2(d.vBCUFDest)}</vBCUFDest>` +
      (d.pFCPUFDest > 0n ? `<vBCFCPUFDest>${v2(d.vBCUFDest)}</vBCFCPUFDest><pFCPUFDest>${p2(d.pFCPUFDest)}</pFCPUFDest>` : "") +
      `<pICMSUFDest>${p2(d.pICMSUFDest)}</pICMSUFDest><pICMSInter>${p2(d.pICMSInter)}</pICMSInter><pICMSInterPart>100.00</pICMSInterPart>` +
      (d.pFCPUFDest > 0n ? `<vFCPUFDest>${v2(d.vFCPUFDest)}</vFCPUFDest>` : "") +
      `<vICMSUFDest>${v2(d.vICMSUFDest)}</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>`
    : "";
  const imposto = `<imposto><ICMS>${icmsXml(i)}</ICMS>${pisCofinsXml("PIS", i.pis)}${pisCofinsXml("COFINS", i.cofins)}${difal}${ibsCbsXml(i)}</imposto>`;
  const vItem = i.ibscbs ? `<vItem>${v2(i.vItem)}</vItem>` : "";
  return `<det nItem="${i.numero}">${prod}${imposto}${tx("infAdProd", e.informacoes, 500)}${vItem}</det>`;
}

function totalXml(n: NotaCalculada): string {
  const t = n.totais;
  const difal = t.vICMSUFDest > 0n || t.vFCPUFDest > 0n || n.itens.some((i) => i.difal);
  const icmsTot =
    "<ICMSTot>" +
    `<vBC>${v2(t.vBC)}</vBC><vICMS>${v2(t.vICMS)}</vICMS><vICMSDeson>${v2(t.vICMSDeson)}</vICMSDeson>` +
    (difal ? `<vFCPUFDest>${v2(t.vFCPUFDest)}</vFCPUFDest><vICMSUFDest>${v2(t.vICMSUFDest)}</vICMSUFDest><vICMSUFRemet>${v2(t.vICMSUFRemet)}</vICMSUFRemet>` : "") +
    `<vFCP>${v2(t.vFCP)}</vFCP><vBCST>${v2(t.vBCST)}</vBCST><vST>${v2(t.vST)}</vST><vFCPST>${v2(t.vFCPST)}</vFCPST><vFCPSTRet>${v2(t.vFCPSTRet)}</vFCPSTRet>` +
    `<vProd>${v2(t.vProd)}</vProd><vFrete>${v2(t.vFrete)}</vFrete><vSeg>${v2(t.vSeg)}</vSeg><vDesc>${v2(t.vDesc)}</vDesc>` +
    `<vII>${v2(t.vII)}</vII><vIPI>${v2(t.vIPI)}</vIPI><vIPIDevol>${v2(t.vIPIDevol)}</vIPIDevol><vPIS>${v2(t.vPIS)}</vPIS><vCOFINS>${v2(t.vCOFINS)}</vCOFINS>` +
    `<vOutro>${v2(t.vOutro)}</vOutro><vNF>${v2(t.vNF)}</vNF>` +
    "</ICMSTot>";
  const b = t.ibscbs;
  const ibs = b
    ? `<IBSCBSTot><vBCIBSCBS>${v2(b.vBC)}</vBCIBSCBS>` +
      (n.itens.some((i) => i.ibscbs?.comValores)
        ? `<gIBS><gIBSUF><vDif>${v2(b.vDifUF)}</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${v2(b.vIBSUF)}</vIBSUF></gIBSUF>` +
          `<gIBSMun><vDif>${v2(b.vDifMun)}</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>${v2(b.vIBSMun)}</vIBSMun></gIBSMun>` +
          `<vIBS>${v2(b.vIBS)}</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS>` +
          `<gCBS><vDif>${v2(b.vDifCBS)}</vDif><vDevTrib>0.00</vDevTrib><vCBS>${v2(b.vCBS)}</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS>`
        : "") +
      "</IBSCBSTot>"
    : "";
  return `<total>${icmsTot}${ibs}${t.vNFTot != null ? `<vNFTot>${v2(t.vNFTot)}</vNFTot>` : ""}</total>`;
}

function transporteXml(n: NotaCalculada): string {
  const tr = n.entrada.transporte;
  let x = `<transp><modFrete>${tr.modalidade}</modFrete>`;
  const t = tr.transportador;
  if (t) {
    const doc = digitos(t.documento);
    x +=
      "<transporta>" +
      (t.tipo === "cnpj" ? `<CNPJ>${t.documento.toUpperCase()}</CNPJ>` : `<CPF>${doc}</CPF>`) +
      tx("xNome", t.nome, 60) +
      (t.inscricaoEstadual ? `<IE>${/^isento$/i.test(t.inscricaoEstadual) ? "ISENTO" : digitos(t.inscricaoEstadual)}</IE>` : "") +
      tx("xEnder", t.endereco, 60) +
      tx("xMun", t.municipio, 60) +
      (t.uf ? `<UF>${t.uf.toUpperCase()}</UF>` : "") +
      "</transporta>";
  }
  const f = n.icmsFrete;
  if (f) {
    x += `<retTransp><vServ>${v2(f.vServ)}</vServ><vBCRet>${v2(f.vBCRet)}</vBCRet><pICMSRet>${p2(f.pICMSRet)}</pICMSRet><vICMSRet>${v2(f.vICMSRet)}</vICMSRet><CFOP>${f.cfop}</CFOP><cMunFG>${f.codigoMunicipio}</cMunFG></retTransp>`;
  }
  const v = tr.veiculo;
  if (v && n.idDest === 1) {
    const placa = v.placa.toUpperCase().replace(/[^A-Z0-9]/g, "");
    x += `<veicTransp><placa>${placa}</placa>${v.uf ? `<UF>${v.uf.toUpperCase()}</UF>` : ""}${tx("RNTC", v.rntc, 20)}</veicTransp>`;
  }
  const vol = tr.volumes;
  if (vol?.quantidade || vol?.especie?.trim() || vol?.marca?.trim() || n.pesoLiquidoKg != null) {
    const peso = n.pesoLiquidoKg != null ? fmt(n.pesoLiquidoKg, 3) : null;
    x +=
      "<vol>" +
      (vol?.quantidade ? `<qVol>${Math.trunc(vol.quantidade)}</qVol>` : "") +
      tx("esp", vol?.especie, 60) +
      tx("marca", vol?.marca, 60) +
      (peso ? `<pesoL>${peso}</pesoL><pesoB>${peso}</pesoB>` : "") +
      "</vol>";
  }
  return x + "</transp>";
}

function cobrancaXml(n: NotaCalculada, numero: number): string {
  const p = n.entrada.pagamento;
  if (!p.aPrazo || !p.parcelas?.length) return "";
  const vNF = v2(n.totais.vNF);
  const valores = p.parcelas.map((d) => dec(d.valor));
  if (valores.some((v) => v <= 0n)) throw new Error("Valor de parcela inválido.");
  if (v2(somar(...valores)) !== vNF) throw new Error("A soma das parcelas precisa ser igual ao total da nota.");
  const dups = p.parcelas
    .map((d, i) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.vencimento)) throw new Error("Vencimento de parcela inválido.");
      return `<dup><nDup>${String(i + 1).padStart(3, "0")}</nDup><dVenc>${d.vencimento}</dVenc><vDup>${v2(valores[i])}</vDup></dup>`;
    })
    .join("");
  return `<cobr><fat><nFat>${numero}</nFat><vOrig>${vNF}</vOrig><vDesc>0.00</vDesc><vLiq>${vNF}</vLiq></fat>${dups}</cobr>`;
}

function pagamentoXml(n: NotaCalculada): string {
  const p = n.entrada.pagamento;
  if (!/^\d{2}$/.test(p.forma)) throw new Error("Forma de pagamento inválida.");
  const semPagamento = p.forma === "90";
  const valor = semPagamento ? "0.00" : v2(n.totais.vNF);
  const ind = semPagamento ? "" : `<indPag>${p.aPrazo ? 1 : 0}</indPag>`;
  const desc = p.forma === "99" ? tx("xPag", p.descricao || "Outros", 60) : "";
  return `<pag><detPag>${ind}<tPag>${p.forma}</tPag>${desc}<vPag>${valor}</vPag></detPag></pag>`;
}

function informacoesXml(n: NotaCalculada): string {
  const partes = [n.entrada.informacoesComplementares, ...n.textosAutomaticos].filter((x): x is string => Boolean(x && x.trim()));
  const cpl = partes.length ? textoLeiaute(partes.join(" "), 5000) : "";
  const fisco = n.entrada.informacoesFisco ? textoLeiaute(n.entrada.informacoesFisco, 2000) : "";
  if (!cpl && !fisco) return "";
  return `<infAdic>${fisco ? `<infAdFisco>${textoXml(fisco)}</infAdFisco>` : ""}${cpl ? `<infCpl>${textoXml(cpl)}</infCpl>` : ""}</infAdic>`;
}

export interface NfeMontada {
  chave: string;
  id: string;
  nota: NotaCalculada;
  /** filhos do infNFe (sem o próprio elemento) */
  filhos: string;
  canonico: string;
}

/** Calcula a nota e monta o infNFe (sem assinatura). */
export function montarNfe(e: EntradaNfe): NfeMontada {
  validarSerie(e);
  const nota = calcularNota(e);
  const em = e.emitente;
  const uf = em.endereco.uf.toUpperCase();
  const docEmit = em.tipo === "cnpj" ? em.documento.toUpperCase() : digitos(em.documento);
  if (em.tipo === "cnpj" && !/^[0-9A-Z]{12}\d{2}$/.test(docEmit)) throw new Error("CNPJ do emitente inválido.");
  if (em.tipo === "cpf" && !/^\d{11}$/.test(docEmit)) throw new Error("CPF do emitente inválido.");
  const ieEmit = digitos(em.inscricaoEstadual);
  if (!/^\d{2,14}$/.test(ieEmit)) throw new Error("Inscrição estadual do emitente inválida: a NF-e exige a IE de quem emite.");
  const chave = chaveDeAcesso({ uf, emitidaEm: e.emitidaEm, documento: docEmit, serie: e.serie, numero: e.numero, codigoNumerico: e.codigoNumerico });
  const id = `NFe${chave}`;
  const homologacao = e.ambiente === "homologacao";

  const refs = (e.referencias ?? []).map((r) => {
    if (!/^\d{44}$/.test(r)) throw new Error(`Chave de acesso referenciada inválida: ${r}`);
    return `<NFref><refNFe>${r}</refNFe></NFref>`;
  });
  if (e.finalidade === 4 && !refs.length) throw new Error("A nota de devolução precisa da chave da nota devolvida.");
  const naoPresencial = [2, 3, 4, 9].includes(e.presenca);
  const ide =
    "<ide>" +
    `<cUF>${CODIGO_UF[uf]}</cUF><cNF>${e.codigoNumerico}</cNF>` +
    tx("natOp", e.natureza, 60) +
    `<mod>55</mod><serie>${e.serie}</serie><nNF>${e.numero}</nNF>` +
    `<dhEmi>${dataHoraUf(e.emitidaEm, uf)}</dhEmi>` +
    (e.saidaEm ? `<dhSaiEnt>${dataHoraUf(e.saidaEm, uf)}</dhSaiEnt>` : "") +
    `<tpNF>1</tpNF><idDest>${nota.idDest}</idDest><cMunFG>${em.endereco.codigoMunicipio}</cMunFG>` +
    `<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave[43]}</cDV><tpAmb>${homologacao ? 2 : 1}</tpAmb>` +
    `<finNFe>${e.finalidade}</finNFe><indFinal>${nota.consumidorFinal ? 1 : 0}</indFinal><indPres>${e.presenca}</indPres>` +
    (naoPresencial ? "<indIntermed>0</indIntermed>" : "") +
    `<procEmi>0</procEmi><verProc>${VERSAO_APLICATIVO}</verProc>` +
    refs.join("") +
    "</ide>";

  const emit =
    "<emit>" +
    (em.tipo === "cnpj" ? `<CNPJ>${docEmit}</CNPJ>` : `<CPF>${docEmit}</CPF>`) +
    tx("xNome", em.nome, 60) +
    tx("xFant", em.fantasia, 60) +
    endereco("enderEmit", em.endereco, true) +
    `<IE>${ieEmit}</IE><CRT>${em.crt}</CRT>` +
    "</emit>";

  const d = e.destinatario;
  const docDest = d.tipo === "cnpj" ? (d.documento ?? "").toUpperCase() : digitos(d.documento);
  if (d.tipo === "cnpj" && !/^[0-9A-Z]{12}\d{2}$/.test(docDest)) throw new Error("CNPJ do destinatário inválido.");
  if (d.tipo === "cpf" && !/^\d{11}$/.test(docDest)) throw new Error("CPF do destinatário inválido.");
  const ieDest = digitos(d.inscricaoEstadual);
  if (d.indicadorIe === 1 && !/^\d{2,14}$/.test(ieDest)) throw new Error("Informe a inscrição estadual do destinatário (contribuinte do ICMS).");
  if (d.tipo === "estrangeiro" && d.indicadorIe !== 9) throw new Error("Destinatário no exterior é não contribuinte (indicador 9).");
  const idDoc = d.tipo === "cnpj" ? `<CNPJ>${docDest}</CNPJ>` : d.tipo === "cpf" ? `<CPF>${docDest}</CPF>` : `<idEstrangeiro>${textoXml(textoLeiaute(d.documento ?? "", 20))}</idEstrangeiro>`;
  const dest =
    "<dest>" +
    idDoc +
    tx("xNome", homologacao ? NOME_HOMOLOGACAO : d.nome, 60) +
    endereco("enderDest", d.endereco, false) +
    `<indIEDest>${d.indicadorIe}</indIEDest>` +
    (d.indicadorIe === 1 ? `<IE>${ieDest}</IE>` : "") +
    (d.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim()) ? tx("email", d.email.trim(), 60) : "") +
    "</dest>";

  const autXml = (e.autorizadosXml ?? [])
    .map((x) => x.toUpperCase().replace(/[^0-9A-Z]/g, ""))
    .filter((x, i, a) => x && a.indexOf(x) === i && x !== docEmit)
    .slice(0, 10)
    .map((x) => (x.length === 11 ? `<autXML><CPF>${x}</CPF></autXML>` : `<autXML><CNPJ>${x}</CNPJ></autXML>`))
    .join("");

  const rt = e.responsavelTecnico;
  const respTec = rt
    ? `<infRespTec><CNPJ>${rt.cnpj.toUpperCase()}</CNPJ>${tx("xContato", rt.contato, 60)}${tx("email", rt.email, 60)}<fone>${digitos(rt.telefone)}</fone></infRespTec>`
    : "";

  const filhos =
    ide +
    emit +
    dest +
    autXml +
    nota.itens.map((i) => itemXml(nota, i)).join("") +
    totalXml(nota) +
    transporteXml(nota) +
    cobrancaXml(nota, e.numero) +
    pagamentoXml(nota) +
    informacoesXml(nota) +
    respTec;
  return { chave, id, nota, filhos, canonico: `<infNFe xmlns="${NS_NFE}" Id="${id}" versao="${VERSAO_NFE}">${filhos}</infNFe>` };
}

/** NF-e assinada, pronta para o lote de autorização. */
export function nfeAssinada(e: EntradaNfe, chaves: ChavesAssinatura): NfeMontada & { xml: string } {
  const m = montarNfe(e);
  return {
    ...m,
    xml: `<NFe xmlns="${NS_NFE}"><infNFe Id="${m.id}" versao="${VERSAO_NFE}">${m.filhos}</infNFe>${assinatura(m.canonico, m.id, chaves)}</NFe>`,
  };
}
