/**
 * Auditor fiscal na DEMONSTRAÇÃO (dados fictícios): notas de compra e de
 * venda de três meses para as duas empresas de demonstração, enviadas pelo
 * mesmo caminho dos clientes (Enviar documentos). O processamento normal lê
 * os XML e agenda a análise do auditor, que encontra:
 *   - Padaria (Simples): bebidas compradas com PIS/Cofins monofásico (CST 04)
 *     e ICMS-ST, vendidas no caixa como tributadas (CSOSN 102);
 *   - Oficina (Lucro Presumido): autopeças revendidas com PIS/Cofins destacado
 *     (o certo é CST 04) e notas sem o grupo de IBS/CBS depois de 03/08/2026.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dvChave } from "../src/lib/fiscal/chave";
import { enviar, sessao } from "./demo-documentos";

const MARCA = "DEMO-AUDITOR";

function dvCnpj(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const r = b.split("").reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

function gtin(base12: string) {
  const soma = base12.split("").reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base12}${(10 - (soma % 10)) % 10}`;
}

const DISTRIBUIDORA_BEBIDAS = dvCnpj("334445550001");
const DISTRIBUIDORA_PECAS = dvCnpj("556667770001");
const OFICINA_CLIENTE = dvCnpj("667778880001");

const PRODUTOS = {
  refrigerante: { codigo: "REF2L", gtin: gtin("789100000001"), descricao: "REFRIGERANTE COLA 2L (FICTICIO)", ncm: "22021000", cest: "0300700" },
  cerveja: { codigo: "CERV350", gtin: gtin("789100000002"), descricao: "CERVEJA LATA 350ML (FICTICIA)", ncm: "22030000", cest: "0302100" },
  agua: { codigo: "AGUA500", gtin: gtin("789100000003"), descricao: "AGUA MINERAL 500ML (FICTICIA)", ncm: "22011000", cest: "0300200" },
  farinha: { codigo: "FAR50", gtin: gtin("789100000004"), descricao: "FARINHA DE TRIGO 50KG (FICTICIA)", ncm: "11010010", cest: null },
  pao: { codigo: "PAOKG", gtin: null, descricao: "PAO FRANCES KG (FICTICIO)", ncm: "19059090", cest: null },
  pastilha: { codigo: "PF-01", gtin: gtin("789200000001"), descricao: "PASTILHA DE FREIO DIANTEIRA (FICTICIA)", ncm: "87083090", cest: "0101400" },
  filtro: { codigo: "FO-02", gtin: gtin("789200000002"), descricao: "FILTRO DE OLEO (FICTICIO)", ncm: "84212300", cest: "0100300" },
  oleo: { codigo: "OL-03", gtin: gtin("789200000003"), descricao: "OLEO LUBRIFICANTE 1L (FICTICIO)", ncm: "27101932", cest: "0600700" },
} as const;

type Produto = (typeof PRODUTOS)[keyof typeof PRODUTOS];
type Tributacao =
  | { tipo: "sn"; csosn: "102" | "500"; pis: "49" }
  | { tipo: "st_retido"; pis: "04" | "01" | "06" }
  | { tipo: "normal"; aliquotaIcms: string; pis: "01" | "04" | "06"; aliquotaPis?: string; aliquotaCofins?: string };

interface ItemDemo {
  p: Produto;
  cfop: string;
  qtd: number;
  unit: number;
  t: Tributacao;
}

const dec = (v: number) => v.toFixed(2);

function impostosItem(item: ItemDemo, valor: number, ibsCbs: boolean) {
  const t = item.t;
  let icms = "";
  let pis = "";
  let cofins = "";
  let vIcms = 0;
  let vPis = 0;
  let vCofins = 0;
  if (t.tipo === "sn") {
    icms = `<ICMS><ICMSSN${t.csosn}><orig>0</orig><CSOSN>${t.csosn}</CSOSN></ICMSSN${t.csosn}></ICMS>`;
    pis = `<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>`;
    cofins = `<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`;
  } else if (t.tipo === "st_retido") {
    const bcRet = valor * 1.4;
    icms = `<ICMS><ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>${dec(bcRet)}</vBCSTRet><pST>20.0000</pST><vICMSSTRet>${dec(bcRet * 0.2 - valor * 0.2)}</vICMSSTRet></ICMS60></ICMS>`;
    pis = `<PIS><PISNT><CST>${t.pis}</CST></PISNT></PIS>`;
    cofins = `<COFINS><COFINSNT><CST>${t.pis}</CST></COFINSNT></COFINS>`;
  } else {
    vIcms = (valor * Number(t.aliquotaIcms)) / 100;
    icms = `<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${dec(valor)}</vBC><pICMS>${t.aliquotaIcms}</pICMS><vICMS>${dec(vIcms)}</vICMS></ICMS00></ICMS>`;
    if (t.pis === "01") {
      vPis = (valor * Number(t.aliquotaPis ?? "0.65")) / 100;
      vCofins = (valor * Number(t.aliquotaCofins ?? "3.00")) / 100;
      pis = `<PIS><PISAliq><CST>01</CST><vBC>${dec(valor)}</vBC><pPIS>${t.aliquotaPis ?? "0.65"}</pPIS><vPIS>${dec(vPis)}</vPIS></PISAliq></PIS>`;
      cofins = `<COFINS><COFINSAliq><CST>01</CST><vBC>${dec(valor)}</vBC><pCOFINS>${t.aliquotaCofins ?? "3.00"}</pCOFINS><vCOFINS>${dec(vCofins)}</vCOFINS></COFINSAliq></COFINS>`;
    } else {
      pis = `<PIS><PISNT><CST>${t.pis}</CST></PISNT></PIS>`;
      cofins = `<COFINS><COFINSNT><CST>${t.pis}</CST></COFINSNT></COFINS>`;
    }
  }
  const ibs = ibsCbs
    ? `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${dec(valor)}</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>${dec(valor * 0.001)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${dec(valor * 0.001)}</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>${dec(valor * 0.009)}</vCBS></gCBS></gIBSCBS></IBSCBS>`
    : "";
  return { xml: `${icms}${pis}${cofins}${ibs}`, vIcms, vPis, vCofins };
}

function nota(o: {
  modelo: "55" | "65";
  emitente: { cnpj: string; nome: string; crt: "1" | "3" };
  dest?: { cnpj: string; nome: string; contribuinte: boolean };
  numero: number;
  data: string;
  natOp: string;
  itens: ItemDemo[];
  ibsCbs: boolean;
}) {
  const aamm = o.data.slice(2, 4) + o.data.slice(5, 7);
  const cNF = String(20000000 + o.numero * 7907).slice(-8);
  const base = `17${aamm}${o.emitente.cnpj}${o.modelo}001${String(o.numero).padStart(9, "0")}1${cNF}`;
  const chave = `${base}${dvChave(base)}`;
  let vProd = 0;
  let vIcms = 0;
  let vPis = 0;
  let vCofins = 0;
  const dets = o.itens
    .map((it, i) => {
      const valor = Math.round(it.qtd * it.unit * 100) / 100;
      vProd += valor;
      const imp = impostosItem(it, valor, o.ibsCbs);
      vIcms += imp.vIcms;
      vPis += imp.vPis;
      vCofins += imp.vCofins;
      const ean = it.p.gtin ?? "SEM GTIN";
      return (
        `<det nItem="${i + 1}"><prod><cProd>${it.p.codigo}</cProd><cEAN>${ean}</cEAN><xProd>${it.p.descricao}</xProd><NCM>${it.p.ncm}</NCM>` +
        `${it.p.cest ? `<CEST>${it.p.cest}</CEST>` : ""}<CFOP>${it.cfop}</CFOP><uCom>UN</uCom><qCom>${it.qtd.toFixed(4)}</qCom>` +
        `<vUnCom>${it.unit.toFixed(10)}</vUnCom><vProd>${dec(valor)}</vProd><cEANTrib>${ean}</cEANTrib><uTrib>UN</uTrib><qTrib>${it.qtd.toFixed(4)}</qTrib>` +
        `<vUnTrib>${it.unit.toFixed(10)}</vUnTrib><indTot>1</indTot></prod><imposto>${imp.xml}</imposto></det>`
      );
    })
    .join("");
  const dest = o.dest
    ? `<dest><CNPJ>${o.dest.cnpj}</CNPJ><xNome>${o.dest.nome}</xNome><enderDest><xLgr>Rua Ficticia</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>1718204</cMun><xMun>Porto Nacional</xMun><UF>TO</UF></enderDest><indIEDest>${o.dest.contribuinte ? "1" : "9"}</indIEDest>${o.dest.contribuinte ? "<IE>290000099</IE>" : ""}</dest>`
    : "";
  const totIbs = o.ibsCbs
    ? `<IBSCBSTot><vBCIBSCBS>${dec(vProd)}</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${dec(vProd * 0.001)}</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${dec(vProd * 0.001)}</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>${dec(vProd * 0.009)}</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot>`
    : "";
  return {
    chave,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>17</cUF><cNF>${cNF}</cNF><natOp>${o.natOp}</natOp><mod>${o.modelo}</mod><serie>1</serie><nNF>${o.numero}</nNF><dhEmi>${o.data}T10:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>1718204</cMunFG><tpImp>${o.modelo === "65" ? "4" : "1"}</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>${o.modelo === "65" || !o.dest?.contribuinte ? "1" : "0"}</indFinal><indPres>1</indPres></ide>
      <emit><CNPJ>${o.emitente.cnpj}</CNPJ><xNome>${o.emitente.nome}</xNome><enderEmit><xLgr>Rua Ficticia</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>1718204</cMun><xMun>Porto Nacional</xMun><UF>TO</UF></enderEmit><IE>290000001</IE><CRT>${o.emitente.crt}</CRT></emit>
      ${dest}${dets}
      <total><ICMSTot><vBC>${dec(vIcms > 0 ? vProd : 0)}</vBC><vICMS>${dec(vIcms)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${dec(vProd)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>${dec(vPis)}</vPIS><vCOFINS>${dec(vCofins)}</vCOFINS><vOutro>0.00</vOutro><vNF>${dec(vProd)}</vNF></ICMSTot>${totIbs}</total>
      <transp><modFrete>9</modFrete></transp>
      <pag><detPag><tPag>${o.modelo === "65" ? "17" : "15"}</tPag><vPag>${dec(vProd)}</vPag></detPag></pag>
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>DEMONSTRACAO</verAplic><chNFe>${chave}</chNFe><dhRecbto>${o.data}T10:00:05-03:00</dhRecbto><nProt>3172600${String(o.numero).padStart(8, "0")}</nProt><digVal>ZGVtbw==</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (ambiente de homologacao)</xMotivo></infProt></protNFe>
</nfeProc>
`,
  };
}

function dataNoMes(deslocamento: number, dia: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamento);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export async function semearAuditor(
  admin: SupabaseClient,
  conexao: { url: string; publica: string },
  empresas: { padaria: string; oficina: string },
  emails: { cliente: string; cliente2: string },
): Promise<boolean> {
  const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresas.padaria).like("nome_original", `${MARCA}%`);
  if (count) return false;
  const [{ data: padaria }, { data: oficina }] = await Promise.all([
    admin.from("empresas").select("documento").eq("id", empresas.padaria).single(),
    admin.from("empresas").select("documento").eq("id", empresas.oficina).single(),
  ]);
  if (!padaria?.documento || !oficina?.documento) throw new Error("Empresas de demonstração sem CNPJ.");
  const clientePadaria = await sessao(admin, conexao.url, conexao.publica, emails.cliente);
  const clienteOficina = await sessao(admin, conexao.url, conexao.publica, emails.cliente2);

  const EMIT_BEBIDAS = { cnpj: DISTRIBUIDORA_BEBIDAS, nome: "DISTRIBUIDORA DE BEBIDAS TOCANTINS (FICTICIA)", crt: "3" as const };
  const EMIT_PECAS = { cnpj: DISTRIBUIDORA_PECAS, nome: "AUTOPECAS DISTRIBUIDORA DO NORTE (FICTICIA)", crt: "3" as const };
  const EMIT_PADARIA = { cnpj: padaria.documento, nome: "PADARIA PAO DOURADO LTDA (DEMONSTRACAO - FICTICIA)", crt: "1" as const };
  const EMIT_OFICINA = { cnpj: oficina.documento, nome: "OFICINA MECANICA EXEMPLO LTDA (DEMONSTRACAO - FICTICIA)", crt: "3" as const };

  let n = 0;
  const subir = async (quem: SupabaseClient, empresaId: string, categoria: string, nome: string, xml: string, comp: string) => {
    await enviar(quem, admin, empresaId, { comp, categoria, nome: `${MARCA} ${nome}.xml`, mime: "application/xml", bytes: Buffer.from(xml, "utf8"), itemId: null });
    n++;
  };

  for (const m of [-3, -2, -1]) {
    const comp = `${dataNoMes(m, 1).slice(0, 7)}-01`;
    const apos = (dia: number) => dataNoMes(m, dia) >= "2026-08-03";

    // Padaria: compra das bebidas (monofásico CST 04 e ICMS-ST retido) e da farinha
    const compra = nota({
      modelo: "55", emitente: EMIT_BEBIDAS, dest: { cnpj: padaria.documento, nome: "PADARIA PAO DOURADO LTDA (FICTICIA)", contribuinte: true },
      numero: 9100 + (m + 4), data: dataNoMes(m, 3), natOp: "Venda de mercadoria", ibsCbs: apos(3),
      itens: [
        { p: PRODUTOS.refrigerante, cfop: "5405", qtd: 120, unit: 6.5, t: { tipo: "st_retido", pis: "04" } },
        { p: PRODUTOS.cerveja, cfop: "5405", qtd: 240, unit: 3.2, t: { tipo: "st_retido", pis: "04" } },
        { p: PRODUTOS.agua, cfop: "5405", qtd: 200, unit: 1.1, t: { tipo: "st_retido", pis: "04" } },
        { p: PRODUTOS.farinha, cfop: "5102", qtd: 10, unit: 150, t: { tipo: "normal", aliquotaIcms: "12.00", pis: "06" } },
      ],
    });
    await subir(clientePadaria, empresas.padaria, "nfe_entrada_xml", `Compra bebidas ${comp.slice(0, 7)}`, compra.xml, comp);

    // Padaria: vendas no caixa (NFC-e). Refrigerante e água saem como tributados (CSOSN 102), a cerveja como ST (certo).
    for (const [k, dia] of [12, 26].entries()) {
      const venda = nota({
        modelo: "65", emitente: EMIT_PADARIA, numero: 50000 + (m + 4) * 10 + k, data: dataNoMes(m, dia), natOp: "Venda ao consumidor", ibsCbs: false,
        itens: [
          { p: PRODUTOS.pao, cfop: "5101", qtd: 90, unit: 15, t: { tipo: "sn", csosn: "102", pis: "49" } },
          { p: PRODUTOS.refrigerante, cfop: "5102", qtd: 50, unit: 9.5, t: { tipo: "sn", csosn: "102", pis: "49" } },
          { p: PRODUTOS.cerveja, cfop: "5405", qtd: 100, unit: 5, t: { tipo: "sn", csosn: "500", pis: "49" } },
          { p: PRODUTOS.agua, cfop: "5102", qtd: 75, unit: 2.5, t: { tipo: "sn", csosn: "102", pis: "49" } },
        ],
      });
      await subir(clientePadaria, empresas.padaria, "nfe_saida_xml", `NFC-e caixa ${dataNoMes(m, dia)}`, venda.xml, comp);
    }

    // Oficina: compra de autopeças (CST 04) e óleo, venda com PIS/Cofins destacado nas peças
    const compraPecas = nota({
      modelo: "55", emitente: EMIT_PECAS, dest: { cnpj: oficina.documento, nome: "OFICINA MECANICA EXEMPLO LTDA (FICTICIA)", contribuinte: true },
      numero: 7200 + (m + 4), data: dataNoMes(m, 5), natOp: "Venda de mercadoria", ibsCbs: apos(5),
      itens: [
        { p: PRODUTOS.pastilha, cfop: "5102", qtd: 30, unit: 70, t: { tipo: "normal", aliquotaIcms: "20.00", pis: "04" } },
        { p: PRODUTOS.filtro, cfop: "5102", qtd: 40, unit: 18, t: { tipo: "normal", aliquotaIcms: "20.00", pis: "04" } },
        { p: PRODUTOS.oleo, cfop: "5102", qtd: 60, unit: 22, t: { tipo: "normal", aliquotaIcms: "20.00", pis: "01", aliquotaPis: "1.65", aliquotaCofins: "7.60" } },
      ],
    });
    await subir(clienteOficina, empresas.oficina, "nfe_entrada_xml", `Compra pecas ${comp.slice(0, 7)}`, compraPecas.xml, comp);
    const vendaPecas = nota({
      modelo: "55", emitente: EMIT_OFICINA, dest: { cnpj: OFICINA_CLIENTE, nome: "TRANSPORTES RIO TOCANTINS (FICTICIA)", contribuinte: false },
      numero: 300 + (m + 4), data: dataNoMes(m, 20), natOp: "Venda de mercadoria", ibsCbs: false,
      itens: [
        { p: PRODUTOS.pastilha, cfop: "5102", qtd: 12, unit: 140, t: { tipo: "normal", aliquotaIcms: "20.00", pis: "01" } },
        { p: PRODUTOS.filtro, cfop: "5102", qtd: 20, unit: 38, t: { tipo: "normal", aliquotaIcms: "20.00", pis: "01" } },
        { p: PRODUTOS.oleo, cfop: "5102", qtd: 25, unit: 45, t: { tipo: "normal", aliquotaIcms: "20.00", pis: "01" } },
      ],
    });
    await subir(clienteOficina, empresas.oficina, "nfe_saida_xml", `NF-e venda pecas ${dataNoMes(m, 20)}`, vendaPecas.xml, comp);
  }
  return n > 0;
}
