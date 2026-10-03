/**
 * SPED Fiscal na DEMONSTRAÇÃO (dados fictícios): a EFD ICMS/IPI do mês passado
 * da Oficina (Lucro Presumido), montada a partir das mesmas notas fictícias da
 * demonstração e enviada pela equipe. A conferência com os XML encontra:
 *   - a compra de autopeças para revenda escriturada sem o crédito de ICMS;
 *   - a venda de peças escriturada com ICMS menor que o destacado;
 *   - outra venda do mês que ficou fora do arquivo;
 *   - uma compra de embalagens escriturada sem XML no portal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { dvChave } from "../src/lib/fiscal/chave";
import { enviar, sessao } from "./demo-documentos";
import { DISTRIBUIDORA_PECAS, OFICINA_CLIENTE, compraPecasOficina, dataNoMes, vendaFiltrosOficina, vendaPecasOficina } from "./demo-auditor";

const MARCA = "DEMO-SPED";
const FORNECEDOR_EMBALAGENS = "45678912000135";

const brl = (v: number) => v.toFixed(2).replace(".", ",");
const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

function c100(o: {
  operacao: "0" | "1";
  emissao: "0" | "1";
  participante: string;
  numero: number;
  chave: string;
  data: string;
  valor: number;
  icms: number;
  cfop: string;
  aliquota: string;
}) {
  const base = o.icms > 0 ? o.valor : 0;
  return [
    `|C100|${o.operacao}|${o.emissao}|${o.participante}|55|00|001|${o.numero}|${o.chave}|${ddmmaaaa(o.data)}|${ddmmaaaa(o.data)}|${brl(o.valor)}|1|0,00|0,00|${brl(o.valor)}|9|0,00|0,00|0,00|${brl(base)}|${brl(o.icms)}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`,
    `|C190|000|${o.cfop}|${o.icms > 0 ? o.aliquota : "0,00"}|${brl(o.valor)}|${brl(base)}|${brl(o.icms)}|0,00|0,00|0,00|0,00||`,
  ];
}

function arquivoSped(oficina: { cnpj: string; ie: string | null }, m: number) {
  const inicio = dataNoMes(m, 1);
  const ultimo = new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)), 0)).getUTCDate();
  const fim = dataNoMes(m, ultimo);
  const compra = compraPecasOficina(m, oficina.cnpj);
  const venda = vendaPecasOficina(m, oficina.cnpj);
  // Compra de embalagens de um fornecedor fictício: o XML não foi enviado ao portal
  const baseEmb = `17${inicio.slice(2, 4)}${inicio.slice(5, 7)}${FORNECEDOR_EMBALAGENS}55001${String(880).padStart(9, "0")}1${"00880088"}`;
  const chaveEmb = `${baseEmb}${dvChave(baseEmb)}`;
  // ICMS da venda escriturado R$ 20,00 menor que o destacado
  const icmsVenda = Math.round((venda.icms - 20) * 100) / 100;

  const linhas = [
    `|0000|020|0|${ddmmaaaa(inicio)}|${ddmmaaaa(fim)}|OFICINA MECANICA EXEMPLO LTDA (DEMONSTRACAO - FICTICIA)|${oficina.cnpj}||TO|${oficina.ie ?? "290000002"}|1718204|||A|1|`,
    "|0001|0|",
    `|0150|CLI01|TRANSPORTES RIO TOCANTINS (FICTICIA)|1058|${OFICINA_CLIENTE}||||1718204||RUA FICTICIA|10||CENTRO|`,
    `|0150|FOR01|AUTOPECAS DISTRIBUIDORA DO NORTE (FICTICIA)|1058|${DISTRIBUIDORA_PECAS}||||1718204||RUA FICTICIA|100||CENTRO|`,
    `|0150|FOR02|EMBALAGENS DO CERRADO (FICTICIA)|1058|${FORNECEDOR_EMBALAGENS}||||1718204||RUA FICTICIA|200||CENTRO|`,
    "|0990|6|",
    "|C001|0|",
    // Compra para revenda: ICMS destacado no XML, mas escriturada sem crédito
    ...c100({ operacao: "0", emissao: "1", participante: "FOR01", numero: compra.numero, chave: compra.chave, data: compra.data, valor: compra.valor, icms: 0, cfop: "1102", aliquota: "20,00" }),
    // Venda: ICMS escriturado diferente do XML
    ...c100({ operacao: "1", emissao: "0", participante: "CLI01", numero: venda.numero, chave: venda.chave, data: venda.data, valor: venda.valor, icms: icmsVenda, cfop: "5102", aliquota: "20,00" }),
    // Compra de embalagens (uso e consumo) sem XML no portal
    ...c100({ operacao: "0", emissao: "1", participante: "FOR02", numero: 880, chave: chaveEmb, data: dataNoMes(m, 8), valor: 450, icms: 0, cfop: "1556", aliquota: "0,00" }),
    "|C990|9|",
    "|E001|0|",
    `|E100|${ddmmaaaa(inicio)}|${ddmmaaaa(fim)}|`,
    `|E110|${brl(icmsVenda)}|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|${brl(icmsVenda)}|0,00|${brl(icmsVenda)}|0,00|0,00|`,
    "|E990|4|",
    "|9001|0|",
    "|9900|0000|1|",
    "|9990|3|",
    "|9999|25|",
  ];
  return { texto: linhas.join("\r\n") + "\r\n", competencia: `${inicio.slice(0, 7)}-01` };
}

export async function semearSped(
  admin: SupabaseClient,
  conexao: { url: string; publica: string },
  oficinaId: string,
  emails: { equipe: string; cliente2: string },
): Promise<boolean> {
  const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", oficinaId).like("nome_original", `${MARCA}%`);
  if (count) return false;
  const { data: oficina } = await admin.from("empresas").select("documento, inscricao_estadual").eq("id", oficinaId).single();
  if (!oficina?.documento) throw new Error("Empresa de demonstração sem CNPJ.");
  const m = -1;

  // Outra venda do mês, enviada pelo cliente (vai ficar fora do SPED)
  const cliente = await sessao(admin, conexao.url, conexao.publica, emails.cliente2);
  const venda2 = vendaFiltrosOficina(m, oficina.documento);
  await enviar(cliente, admin, oficinaId, {
    comp: `${venda2.data.slice(0, 7)}-01`,
    categoria: "nfe_saida_xml",
    nome: `${MARCA} NF-e venda filtros ${venda2.data}.xml`,
    mime: "application/xml",
    bytes: Buffer.from(venda2.xml, "utf8"),
    itemId: null,
  });

  // A EFD do mês, gerada no sistema fiscal e enviada pela equipe
  const equipe = await sessao(admin, conexao.url, conexao.publica, emails.equipe);
  const sped = arquivoSped({ cnpj: oficina.documento, ie: oficina.inscricao_estadual }, m);
  await enviar(equipe, admin, oficinaId, {
    comp: sped.competencia,
    categoria: "sped_fiscal",
    nome: `${MARCA} EFD ICMS IPI ${sped.competencia.slice(0, 7)}.txt`,
    mime: "text/plain",
    bytes: Buffer.from(sped.texto, "latin1"),
    itemId: null,
  });
  return true;
}
