/**
 * Apuração do ICMS na DEMONSTRAÇÃO (dados fictícios): compras de outros
 * estados no mês anterior, enviadas pelo mesmo caminho dos clientes (Enviar
 * documentos):
 *   - Padaria (Simples Nacional, TO): fermento e detergente de Goiás (12%) e
 *     embalagens de um fornecedor do Simples de São Paulo (7%, CSOSN 101) —
 *     complementação de alíquota; o detergente é uso e consumo (o escritório
 *     marca na tela e ele passa para o diferencial de alíquotas);
 *   - Oficina (Lucro Presumido, TO): uniformes de Goiás, com o fornecedor já
 *     marcado como "uso e consumo" — diferencial de alíquotas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dvChave } from "../src/lib/fiscal/chave";
import { dataNoMes } from "./demo-auditor";
import { enviar, sessao } from "./demo-documentos";

const MARCA = "DEMO-ICMS";

function dvCnpj(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const r = b.split("").reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}

export const ATACADO_GOIAS = dvCnpj("441112220001");
export const EMBALAGENS_SP = dvCnpj("442223330001");
export const UNIFORMES_GOIAS = dvCnpj("443334440001");

const CODIGO_UF: Record<string, string> = { GO: "52", SP: "35", TO: "17" };
const dec = (v: number) => v.toFixed(2);

interface ItemIcms {
  codigo: string;
  descricao: string;
  ncm: string;
  qtd: number;
  unit: number;
  frete?: number;
  /** Alíquota do ICMS destacado (regime normal) ou crédito do Simples (CSOSN 101). */
  icms: { tipo: "normal"; aliquota: number } | { tipo: "sn101"; credito: number };
}

function notaInterestadual(o: {
  emitente: { cnpj: string; nome: string; uf: "GO" | "SP"; crt: "1" | "3" };
  dest: { cnpj: string; nome: string };
  numero: number;
  data: string;
  itens: ItemIcms[];
}) {
  const aamm = o.data.slice(2, 4) + o.data.slice(5, 7);
  const cNF = String(30000000 + o.numero * 7919).slice(-8);
  const base = `${CODIGO_UF[o.emitente.uf]}${aamm}${o.emitente.cnpj}55001${String(o.numero).padStart(9, "0")}1${cNF}`;
  const chave = `${base}${dvChave(base)}`;
  let vProd = 0;
  let vFrete = 0;
  let vBC = 0;
  let vIcms = 0;
  const dets = o.itens
    .map((it, i) => {
      const valor = Math.round(it.qtd * it.unit * 100) / 100;
      vProd += valor;
      vFrete += it.frete ?? 0;
      let icms: string;
      if (it.icms.tipo === "normal") {
        const bc = valor + (it.frete ?? 0);
        const v = Math.round(bc * it.icms.aliquota) / 100;
        vBC += bc;
        vIcms += v;
        icms = `<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>${dec(bc)}</vBC><pICMS>${dec(it.icms.aliquota)}</pICMS><vICMS>${dec(v)}</vICMS></ICMS00>`;
      } else {
        const cred = Math.round(valor * it.icms.credito) / 100;
        icms = `<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>${dec(it.icms.credito)}</pCredSN><vCredICMSSN>${dec(cred)}</vCredICMSSN></ICMSSN101>`;
      }
      return (
        `<det nItem="${i + 1}"><prod><cProd>${it.codigo}</cProd><cEAN>SEM GTIN</cEAN><xProd>${it.descricao}</xProd><NCM>${it.ncm}</NCM><CFOP>6102</CFOP>` +
        `<uCom>UN</uCom><qCom>${it.qtd.toFixed(4)}</qCom><vUnCom>${it.unit.toFixed(10)}</vUnCom><vProd>${dec(valor)}</vProd><cEANTrib>SEM GTIN</cEANTrib>` +
        `<uTrib>UN</uTrib><qTrib>${it.qtd.toFixed(4)}</qTrib><vUnTrib>${it.unit.toFixed(10)}</vUnTrib>${it.frete ? `<vFrete>${dec(it.frete)}</vFrete>` : ""}<indTot>1</indTot></prod>` +
        `<imposto><ICMS>${icms}</ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>`
      );
    })
    .join("");
  const vNF = vProd + vFrete;
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>${CODIGO_UF[o.emitente.uf]}</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>${o.numero}</nNF><dhEmi>${o.data}T09:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>2</idDest><cMunFG>5208707</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres></ide>
      <emit><CNPJ>${o.emitente.cnpj}</CNPJ><xNome>${o.emitente.nome}</xNome><enderEmit><xLgr>Avenida Ficticia</xLgr><nro>200</nro><xBairro>Centro</xBairro><cMun>5208707</cMun><xMun>Cidade Ficticia</xMun><UF>${o.emitente.uf}</UF></enderEmit><IE>100000001</IE><CRT>${o.emitente.crt}</CRT></emit>
      <dest><CNPJ>${o.dest.cnpj}</CNPJ><xNome>${o.dest.nome}</xNome><enderDest><xLgr>Rua Ficticia</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>1718204</cMun><xMun>Porto Nacional</xMun><UF>TO</UF></enderDest><indIEDest>1</indIEDest><IE>290000099</IE></dest>
      ${dets}
      <total><ICMSTot><vBC>${dec(vBC)}</vBC><vICMS>${dec(vIcms)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${dec(vProd)}</vProd><vFrete>${dec(vFrete)}</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${dec(vNF)}</vNF></ICMSTot></total>
      <transp><modFrete>0</modFrete></transp>
      <pag><detPag><tPag>15</tPag><vPag>${dec(vNF)}</vPag></detPag></pag>
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>DEMONSTRACAO</verAplic><chNFe>${chave}</chNFe><dhRecbto>${o.data}T09:00:05-03:00</dhRecbto><nProt>3522600${String(o.numero).padStart(8, "0")}</nProt><digVal>ZGVtbw==</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (ambiente de homologacao)</xMotivo></infProt></protNFe>
</nfeProc>
`;
}

export async function semearIcms(
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
  const comp = `${dataNoMes(-1, 1).slice(0, 7)}-01`;
  const subir = async (quem: SupabaseClient, empresaId: string, nome: string, xml: string) =>
    enviar(quem, admin, empresaId, { comp, categoria: "nfe_entrada_xml", nome: `${MARCA} ${nome}.xml`, mime: "application/xml", bytes: Buffer.from(xml, "utf8"), itemId: null });

  const clientePadaria = await sessao(admin, conexao.url, conexao.publica, emails.cliente);
  const destPadaria = { cnpj: padaria.documento, nome: "PADARIA PAO DOURADO LTDA (FICTICIA)" };
  await subir(
    clientePadaria,
    empresas.padaria,
    `Compra Goias ${comp.slice(0, 7)}`,
    notaInterestadual({
      emitente: { cnpj: ATACADO_GOIAS, nome: "ATACADO DE ALIMENTOS DE GOIAS (FICTICIO)", uf: "GO", crt: "3" },
      dest: destPadaria,
      numero: 4401,
      data: dataNoMes(-1, 8),
      itens: [
        { codigo: "FERM-500", descricao: "FERMENTO BIOLOGICO 500G (FICTICIO)", ncm: "21021090", qtd: 100, unit: 20, frete: 100, icms: { tipo: "normal", aliquota: 12 } },
        { codigo: "DET-5L", descricao: "DETERGENTE 5L PARA LIMPEZA (FICTICIO)", ncm: "34022000", qtd: 10, unit: 30, icms: { tipo: "normal", aliquota: 12 } },
      ],
    }),
  );
  await subir(
    clientePadaria,
    empresas.padaria,
    `Compra Sao Paulo ${comp.slice(0, 7)}`,
    notaInterestadual({
      emitente: { cnpj: EMBALAGENS_SP, nome: "EMBALAGENS PAULISTA ME (FICTICIA)", uf: "SP", crt: "1" },
      dest: destPadaria,
      numero: 5502,
      data: dataNoMes(-1, 15),
      itens: [{ codigo: "SACO-PAO", descricao: "SACO DE PAPEL PARA PAO (FICTICIO)", ncm: "48193000", qtd: 1000, unit: 1, icms: { tipo: "sn101", credito: 1.25 } }],
    }),
  );

  const clienteOficina = await sessao(admin, conexao.url, conexao.publica, emails.cliente2);
  await subir(
    clienteOficina,
    empresas.oficina,
    `Compra uniformes ${comp.slice(0, 7)}`,
    notaInterestadual({
      emitente: { cnpj: UNIFORMES_GOIAS, nome: "UNIFORMES PROFISSIONAIS GOIAS (FICTICIA)", uf: "GO", crt: "3" },
      dest: { cnpj: oficina.documento, nome: "OFICINA MECANICA EXEMPLO LTDA (FICTICIA)" },
      numero: 6603,
      data: dataNoMes(-1, 10),
      itens: [{ codigo: "UNIF-01", descricao: "UNIFORME DE MECANICO (FICTICIO)", ncm: "62034200", qtd: 10, unit: 80, icms: { tipo: "normal", aliquota: 12 } }],
    }),
  );
  // O escritório já marcou o fornecedor de uniformes da Oficina como uso e consumo
  const { count: regra } = await admin
    .from("icms_destinacoes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresas.oficina)
    .eq("fornecedor_documento", UNIFORMES_GOIAS);
  if (!regra) {
    const { error } = await admin.from("icms_destinacoes").insert({ empresa_id: empresas.oficina, fornecedor_documento: UNIFORMES_GOIAS, destinacao: "uso_consumo" });
    if (error) throw new Error(`Falha ao marcar o fornecedor de uniformes: ${error.message}`);
  }
  return true;
}
