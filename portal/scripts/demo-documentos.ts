/**
 * Documentos, conversas e fechamento FICTÍCIOS para a DEMONSTRAÇÃO.
 *
 * Usa as mesmas funções do portal (com a sessão de cada usuário fictício):
 *   - envios dos clientes nos últimos meses, com a conferência do escritório
 *     (aprovado, em análise, correção pedida e aguardando conferência);
 *   - guias e folhas publicadas pelo escritório;
 *   - um XML de NF-e fictícia (homologação), que vira lançamento sugerido;
 *   - uma conversa entre cliente e escritório;
 *   - na Padaria, o fechamento do mês retrasado com o pacote de relatórios
 *     publicado (versão revisada).
 * Todos os arquivos trazem a marca "DOCUMENTO FICTÍCIO — DEMONSTRAÇÃO".
 * Só executa em empresas que ainda não têm documentos (pode rodar de novo).
 */
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { dvChave } from "../src/lib/fiscal/chave";

type PerfilDemo = "padaria" | "oficina";
type Status = "aprovado" | "em_analise" | "correcao" | "recebido";

interface EnvioDemo {
  mes: number; // deslocamento em meses em relação ao mês atual (0, -1, -2)
  categoria: string;
  nome: string;
  titulo: string;
  linhas: [string, string][];
  status?: Status;
  motivo?: string;
}

interface PublicacaoDemo {
  mes: number;
  categoria: "esc_guia" | "esc_folha" | "esc_recibo";
  nome: string;
  titulo: string;
  linhas: [string, string][];
  vencimento?: string; // AAAA-MM-DD
  valor?: string; // "1.234,56"
}

function competencia(deslocamentoMeses: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamentoMeses);
  return d.toISOString().slice(0, 8) + "01";
}
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function rotuloMes(deslocamento: number) {
  const c = competencia(deslocamento);
  return `${NOMES_MES[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}`;
}
function mmaaaa(deslocamento: number) {
  const c = competencia(deslocamento);
  return `${c.slice(5, 7)}/${c.slice(0, 4)}`;
}
function dia(deslocamentoMeses: number, d: number) {
  return `${competencia(deslocamentoMeses).slice(0, 8)}${String(d).padStart(2, "0")}`;
}
function brData(iso: string) {
  return iso.split("-").reverse().join("/");
}
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
/** Próximo (ou anterior) dia útil, considerando fins de semana e feriados nacionais de data fixa. */
function diaUtil(iso: string, sentido: 1 | -1) {
  const d = new Date(`${iso}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || FERIADOS_FIXOS.includes(d.toISOString().slice(5, 10))) d.setUTCDate(d.getUTCDate() + sentido);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ arquivos

interface PdfMake {
  setFonts(f: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(fn: (url: string) => boolean): void;
  setLocalAccessPolicy(fn: (caminho: string) => boolean): void;
  createPdf(doc: TDocumentDefinitions): { getBuffer(): Promise<Buffer> };
}
let pdfmakeCache: PdfMake | null = null;
async function pdfmake() {
  if (pdfmakeCache) return pdfmakeCache;
  const mod = (await import("pdfmake")) as unknown as { default?: PdfMake } & PdfMake;
  const pm = mod.default ?? mod;
  const pasta = join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto");
  pm.setFonts({
    Roboto: {
      normal: join(pasta, "Roboto-Regular.ttf"),
      bold: join(pasta, "Roboto-Medium.ttf"),
      italics: join(pasta, "Roboto-Italic.ttf"),
      bolditalics: join(pasta, "Roboto-MediumItalic.ttf"),
    },
  });
  pm.setUrlAccessPolicy(() => false);
  // Arquivos locais: somente as fontes do próprio pdfmake
  pm.setLocalAccessPolicy((caminho) => resolve(caminho).startsWith(pasta));
  pdfmakeCache = pm;
  return pm;
}

export async function pdfFicticio(titulo: string, empresa: string, linhas: [string, string][]): Promise<Buffer> {
  const pm = await pdfmake();
  const corpo: Content[] = [
    { text: "DOCUMENTO FICTÍCIO — AMBIENTE DE DEMONSTRAÇÃO", color: "#b42318", bold: true, fontSize: 9, margin: [0, 0, 0, 10] },
    { text: titulo, fontSize: 16, bold: true, color: "#4a2c1d" },
    { text: empresa, fontSize: 10, color: "#555555", margin: [0, 2, 0, 14] },
    {
      table: {
        widths: ["*", "auto"],
        body: [
          [
            { text: "Descrição", bold: true },
            { text: "Valor / informação", bold: true, alignment: "right" },
          ],
          ...linhas.map(([a, b]) => [a, { text: b, alignment: "right" as const }]),
        ],
      },
      layout: "lightHorizontalLines",
    },
    { text: "Arquivo gerado automaticamente para demonstrar o Portal Guarese's ON. Não tem validade fiscal nem contábil.", fontSize: 8, color: "#777777", margin: [0, 18, 0, 0] },
  ];
  return pm
    .createPdf({
      pageSize: "A4",
      pageMargins: [48, 48, 48, 48],
      info: { title: `${titulo} (FICTÍCIO)`, creator: "Portal Guarese's ON — demonstração" },
      watermark: { text: "FICTÍCIO", opacity: 0.06, bold: true, fontSize: 90 },
      content: corpo,
      defaultStyle: { fontSize: 10 },
    })
    .getBuffer();
}

/** NF-e fictícia em ambiente de homologação (tpAmb 2), emitida pela empresa de demonstração. */
function xmlNfeFicticia(cnpjEmitente: string, nNF: number, dataEmissao: string, valor: string, vencimentos: [string, string][]) {
  const aamm = dataEmissao.slice(2, 4) + dataEmissao.slice(5, 7);
  const cNF = String(10000000 + nNF * 7919).slice(-8);
  const base = `17${aamm}${cnpjEmitente}55001${String(nNF).padStart(9, "0")}1${cNF}`;
  const chave = `${base}${dvChave(base)}`;
  const dups = vencimentos.map(([venc, v], i) => `<dup><nDup>${String(i + 1).padStart(3, "0")}</nDup><dVenc>${venc}</dVenc><vDup>${v}</vDup></dup>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>17</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>${nNF}</nNF><dhEmi>${dataEmissao}T09:15:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>1718204</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe></ide>
      <emit><CNPJ>${cnpjEmitente}</CNPJ><xNome>PADARIA PAO DOURADO LTDA (DEMONSTRACAO - FICTICIA)</xNome><enderEmit><xLgr>Rua Ficticia</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>1718204</cMun><xMun>Porto Nacional</xMun><UF>TO</UF></enderEmit><IE>000000000</IE><CRT>1</CRT></emit>
      <dest><CNPJ>98765432000198</CNPJ><xNome>BUFFET FESTA BOA LTDA (FICTICIO)</xNome><enderDest><xLgr>Av. Ficticia</xLgr><nro>2</nro><xBairro>Centro</xBairro><cMun>1721000</cMun><xMun>Palmas</xMun><UF>TO</UF></enderDest><indIEDest>9</indIEDest></dest>
      <det nItem="1"><prod><cProd>P001</cProd><xProd>BOLO DECORADO 3KG (FICTICIO)</xProd><NCM>19059090</NCM><CFOP>5101</CFOP><uCom>UN</uCom><qCom>4.0000</qCom><vUnCom>${(Number(valor) / 4).toFixed(10)}</vUnCom><vProd>${valor}</vProd><indTot>1</indTot></prod>
        <imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>
      <total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${valor}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${valor}</vNF></ICMSTot></total>
      <transp><modFrete>9</modFrete></transp>
      <cobr><fat><nFat>${nNF}</nFat><vOrig>${valor}</vOrig><vDesc>0.00</vDesc><vLiq>${valor}</vLiq></fat>${dups}</cobr>
      <pag><detPag><tPag>15</tPag><vPag>${valor}</vPag></detPag></pag>
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>DEMONSTRACAO</verAplic><chNFe>${chave}</chNFe><dhRecbto>${dataEmissao}T09:16:00-03:00</dhRecbto><nProt>3172600000${String(nNF).padStart(5, "0")}</nProt><digVal>ZGVtbw==</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (ambiente de homologacao)</xMotivo></infProt></protNFe>
</nfeProc>
`;
}

// ------------------------------------------------------------------ sessões e envio

export async function sessao(admin: SupabaseClient, url: string, publica: string, email: string): Promise<SupabaseClient> {
  const cliente = createClient(url, publica, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`Falha ao preparar o acesso de ${email}: ${error?.message ?? "sem token"}`);
  const { error: e2 } = await cliente.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (e2) throw new Error(`Falha ao entrar como ${email}: ${e2.message}`);
  return cliente;
}

async function itemChecklist(admin: SupabaseClient, empresaId: string, comp: string, categoria: string) {
  const { data } = await admin.from("checklist_itens").select("id").eq("empresa_id", empresaId).eq("competencia", comp).eq("categoria_codigo", categoria).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function enviar(
  quem: SupabaseClient,
  admin: SupabaseClient,
  empresaId: string,
  a: { comp: string; categoria: string; nome: string; mime: string; bytes: Buffer; itemId: string | null; titulo?: string; vencimento?: string; valor?: string },
): Promise<string> {
  const sha256 = createHash("sha256").update(a.bytes).digest("hex");
  const { data, error } = await quem.rpc("criar_documento", {
    p_empresa_id: empresaId,
    p_competencia: a.comp,
    p_categoria: a.categoria,
    p_nome_arquivo: a.nome,
    p_mime: a.mime,
    p_tamanho: a.bytes.length,
    p_sha256: sha256,
    p_checklist_item_id: a.itemId ?? undefined,
    p_origem: "upload",
    p_forcar_duplicado: false,
    p_titulo: a.titulo ?? undefined,
    p_vencimento: a.vencimento ?? undefined,
    p_valor: a.valor ? (a.valor.replace(/\./g, "").replace(",", ".") as unknown as number) : undefined,
  });
  if (error) throw new Error(`Falha ao registrar ${a.nome}: ${error.message}`);
  const r = data as { situacao: string; documento_id?: string; versao_id?: string; storage_path?: string; duplicado?: { id: string } };
  if (r.situacao === "duplicado") return r.duplicado!.id;
  const { error: eUp } = await admin.storage.from("documentos").upload(r.storage_path!, a.bytes, { contentType: a.mime, upsert: false });
  if (eUp) throw new Error(`Falha ao enviar o arquivo ${a.nome}: ${eUp.message}`);
  const { error: eConf } = await quem.rpc("confirmar_upload", { p_versao_id: r.versao_id! });
  if (eConf) throw new Error(`Falha ao confirmar ${a.nome}: ${eConf.message}`);
  return r.documento_id!;
}

// ------------------------------------------------------------------ roteiro

function enviosPadaria(): EnvioDemo[] {
  const lista: EnvioDemo[] = [];
  for (const m of [-2, -1]) {
    const rot = rotuloMes(m);
    const ultimo = m === -1;
    lista.push(
      {
        mes: m,
        categoria: "extrato_bancario",
        nome: `Extrato Banco do Brasil - ${rot}.pdf`,
        titulo: `Extrato da conta corrente — ${rot}`,
        linhas: [
          ["Saldo anterior", "R$ 15.420,18"],
          ["Vendas no débito e crédito (repasses)", "R$ 38.917,40"],
          ["PIX recebidos", "R$ 6.230,00"],
          ["Pagamento de fornecedores", "- R$ 21.884,35"],
          ["Folha de pagamento", "- R$ 9.870,00"],
          ["Tarifas bancárias", "- R$ 89,90"],
          ["Saldo final", "R$ 28.723,33"],
        ],
        status: "aprovado",
      },
      {
        mes: m,
        categoria: "extrato_cartao",
        nome: `Fatura cartao Visa empresarial - ${rot}.pdf`,
        titulo: `Fatura do cartão de crédito empresarial — ${rot}`,
        linhas: [
          ["Atacadão (insumos)", "R$ 2.315,70"],
          ["Posto de combustível", "R$ 420,00"],
          ["Assinatura do sistema de caixa", "R$ 149,90"],
          ["Total da fatura", "R$ 2.885,60"],
        ],
        status: "aprovado",
      },
      {
        mes: m,
        categoria: "relatorio_maquininha",
        nome: `Relatorio de vendas Stone - ${rot}.pdf`,
        titulo: `Relatório de vendas da maquininha — ${rot}`,
        linhas: [
          ["Vendas no débito", "R$ 17.640,00"],
          ["Vendas no crédito", "R$ 22.105,30"],
          ["Taxas descontadas", "- R$ 827,90"],
          ["Valor líquido repassado", "R$ 38.917,40"],
        ],
        status: ultimo ? "em_analise" : "aprovado",
      },
      {
        mes: m,
        categoria: "comprovante",
        nome: `Comprovantes de pagamentos - ${rot}.pdf`,
        titulo: `Comprovantes de pagamentos — ${rot}`,
        linhas: [
          ["Aluguel do ponto comercial (PIX)", "R$ 4.200,00"],
          ["Energia elétrica", "R$ 1.380,54"],
          ["Moinho Bom Trigo — farinha (boleto)", "R$ 6.940,00"],
        ],
        status: ultimo ? "correcao" : "aprovado",
        motivo: ultimo ? "O comprovante do aluguel está cortado na parte de baixo. Por favor, envie a imagem completa." : undefined,
      },
      {
        mes: m,
        categoria: "folha_pagamento",
        nome: `Ponto e informacoes da folha - ${rot}.pdf`,
        titulo: `Controle de ponto e informações para a folha — ${rot}`,
        linhas: [
          ["Funcionários ativos", "6"],
          ["Horas extras no mês", "14 h"],
          ["Faltas justificadas", "1"],
          ["Admissões / demissões", "0 / 0"],
        ],
        status: "aprovado",
      },
      {
        mes: m,
        categoria: "guia_imposto",
        nome: `Comprovante pagamento DAS - ${mmaaaa(m - 1)}.pdf`,
        titulo: `Comprovante de pagamento do DAS — competência ${mmaaaa(m - 1)}`,
        linhas: [
          ["Documento de arrecadação do Simples Nacional", `Competência ${mmaaaa(m - 1)}`],
          ["Data do pagamento", brData(dia(m, 20))],
          ["Valor pago", "R$ 1.842,37"],
        ],
        status: "aprovado",
      },
      {
        mes: m,
        categoria: "outros",
        nome: `Inventario de estoque - ${rot}.pdf`,
        titulo: `Inventário de estoque no fim do mês — ${rot}`,
        linhas: [
          ["Farinha de trigo (sacos de 25 kg)", "38"],
          ["Açúcar (fardos)", "12"],
          ["Embalagens", "4.000 un."],
          ["Valor total estimado", "R$ 9.875,00"],
        ],
        status: ultimo ? "recebido" : "aprovado",
      },
    );
  }
  lista.push({
    mes: 0,
    categoria: "comprovante",
    nome: "Comprovante PIX fornecedor de embalagens.pdf",
    titulo: "Comprovante de PIX — fornecedor de embalagens",
    linhas: [
      ["Favorecido", "Embalagens Centro-Norte (fictício)"],
      ["Data", brData(dia(0, 1))],
      ["Valor", "R$ 1.260,00"],
    ],
    status: "recebido",
  });
  return lista;
}

function enviosOficina(): EnvioDemo[] {
  const r = (m: number) => rotuloMes(m);
  return [
    { mes: -2, categoria: "extrato_bancario", nome: `Extrato Banco do Brasil - ${r(-2)}.pdf`, titulo: `Extrato da conta corrente — ${r(-2)}`, linhas: [["Saldo anterior", "R$ 3.210,44"], ["Serviços recebidos", "R$ 24.380,00"], ["Peças e fornecedores", "- R$ 17.905,12"], ["Empréstimo (parcela)", "- R$ 2.450,00"], ["Saldo final", "R$ 7.235,32"]], status: "aprovado" },
    { mes: -2, categoria: "extrato_cartao", nome: `Fatura cartao - ${r(-2)}.pdf`, titulo: `Fatura do cartão de crédito — ${r(-2)}`, linhas: [["Distribuidora de peças", "R$ 3.870,00"], ["Ferramentas", "R$ 689,90"], ["Total", "R$ 4.559,90"]], status: "aprovado" },
    { mes: -2, categoria: "relatorio_maquininha", nome: `Relatorio maquininha - ${r(-2)}.pdf`, titulo: `Relatório da maquininha — ${r(-2)}`, linhas: [["Vendas no crédito", "R$ 11.240,00"], ["Taxas", "- R$ 398,15"], ["Líquido", "R$ 10.841,85"]], status: "aprovado" },
    { mes: -2, categoria: "comprovante", nome: `Comprovantes - ${r(-2)}.pdf`, titulo: `Comprovantes de pagamentos — ${r(-2)}`, linhas: [["Aluguel do galpão", "R$ 3.500,00"], ["Peças (boleto)", "R$ 5.120,00"]], status: "aprovado" },
    { mes: -2, categoria: "guia_imposto", nome: `Comprovante DARF PIS e Cofins - ${mmaaaa(-3)}.pdf`, titulo: `Comprovante de pagamento do DARF de PIS/Cofins — ${mmaaaa(-3)}`, linhas: [["Valor pago", "R$ 1.215,80"]], status: "aprovado" },
    { mes: -1, categoria: "extrato_bancario", nome: `Extrato Banco do Brasil - ${r(-1)}.pdf`, titulo: `Extrato da conta corrente — ${r(-1)}`, linhas: [["Saldo anterior", "R$ 7.235,32"], ["Serviços recebidos", "R$ 19.870,00"], ["Peças e fornecedores", "- R$ 21.430,60"], ["Saldo final", "R$ 5.674,72"]], status: "aprovado" },
    { mes: -1, categoria: "relatorio_maquininha", nome: `Relatorio maquininha - ${r(-1)}.pdf`, titulo: `Relatório da maquininha — ${r(-1)}`, linhas: [["Vendas no crédito", "R$ 9.430,00"], ["Taxas", "- R$ 334,02"]], status: "recebido" },
  ];
}

function publicacoes(perfil: PerfilDemo): PublicacaoDemo[] {
  // Padaria (Simples Nacional): DAS até o dia 20, adiado para o dia útil seguinte.
  // Oficina (Lucro Presumido): DARF de PIS/Cofins até o dia 25, antecipado para o dia útil anterior.
  const valores = perfil === "padaria" ? ["1.842,37", "1.967,15"] : ["1.215,80", "1.098,44"];
  const lista: PublicacaoDemo[] = [-2, -1].map((m, i) => {
    const vencimento = perfil === "padaria" ? diaUtil(dia(m + 1, 20), 1) : diaUtil(dia(m + 1, 25), -1);
    const nome = perfil === "padaria" ? "DAS Simples Nacional" : "DARF PIS e Cofins";
    return {
      mes: m,
      categoria: "esc_guia" as const,
      nome: `${nome} - ${mmaaaa(m)}.pdf`,
      titulo: `${perfil === "padaria" ? "DAS — Simples Nacional" : "DARF — PIS/Pasep e Cofins"} — ${mmaaaa(m)}`,
      linhas: [
        [perfil === "padaria" ? "Documento de arrecadação do Simples Nacional" : "Documento de arrecadação de receitas federais", `Competência ${mmaaaa(m)}`],
        ["Vencimento", brData(vencimento)],
        ["Valor", `R$ ${valores[i]}`],
      ],
      vencimento,
      valor: valores[i],
    };
  });
  if (perfil === "padaria") {
    for (const m of [-2, -1]) {
      lista.push({
        mes: m,
        categoria: "esc_folha",
        nome: `Folha de pagamento e holerites - ${mmaaaa(m)}.pdf`,
        titulo: `Folha de pagamento e holerites — ${mmaaaa(m)}`,
        linhas: [
          ["Funcionários", "6"],
          ["Total de proventos", "R$ 11.420,00"],
          ["Descontos (INSS, vale-transporte)", "- R$ 1.550,00"],
          ["Líquido a pagar", "R$ 9.870,00"],
        ],
      });
    }
    lista.push({
      mes: -1,
      categoria: "esc_guia",
      nome: `FGTS Digital - ${mmaaaa(-1)}.pdf`,
      titulo: `FGTS — ${mmaaaa(-1)}`,
      linhas: [["Guia do FGTS Digital", `Competência ${mmaaaa(-1)}`], ["Vencimento", brData(diaUtil(dia(0, 20), -1))], ["Valor", "R$ 913,60"]],
      vencimento: diaUtil(dia(0, 20), -1),
      valor: "913,60",
    });
  }
  return lista;
}

// ------------------------------------------------------------------ execução

export async function semearDocumentos(
  admin: SupabaseClient,
  chaves: { url: string; publica: string },
  empresaId: string,
  perfil: PerfilDemo,
  emails: { cliente: string; equipe: string },
): Promise<boolean> {
  const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  const { data: emp } = await admin.from("empresas").select("documento, razao_social, nome_fantasia").eq("id", empresaId).single();
  if (!emp) throw new Error("Empresa de demonstração não encontrada.");
  const nomeEmpresa = `${emp.nome_fantasia ?? emp.razao_social} — CNPJ ${emp.documento}`;

  const cliente = await sessao(admin, chaves.url, chaves.publica, emails.cliente);
  const equipe = await sessao(admin, chaves.url, chaves.publica, emails.equipe);
  try {
    // 1) Envios do cliente e conferência do escritório
    for (const e of perfil === "padaria" ? enviosPadaria() : enviosOficina()) {
      const comp = competencia(e.mes);
      const itemId = await itemChecklist(admin, empresaId, comp, e.categoria);
      const bytes = await pdfFicticio(e.titulo, nomeEmpresa, e.linhas);
      const id = await enviar(cliente, admin, empresaId, { comp, categoria: e.categoria, nome: e.nome, mime: "application/pdf", bytes, itemId });
      if (e.status && e.status !== "recebido") {
        const { error } = await equipe.rpc("alterar_status_documento", { p_documento_id: id, p_status: e.status, p_motivo: e.motivo ?? undefined });
        if (error) throw new Error(`Falha na conferência de ${e.nome}: ${error.message}`);
      }
    }

    // 2) XMLs dos meses anteriores: obtidos pelo escritório no emissor da empresa (conclusão manual)
    for (const m of [-2]) {
      for (const categoria of ["nfe_saida_xml", "nfe_entrada_xml"]) {
        const itemId = await itemChecklist(admin, empresaId, competencia(m), categoria);
        if (!itemId) continue;
        const { error } = await equipe.rpc("concluir_item_checklist", {
          p_item_id: itemId,
          p_observacao: "XMLs obtidos pelo escritório diretamente no sistema emissor da empresa.",
        });
        if (error) throw new Error(`Falha ao concluir o item ${categoria}: ${error.message}`);
      }
    }

    // 3) NF-e fictícia do mês atual (Padaria): vira lançamento sugerido para conferência
    if (perfil === "padaria") {
      const emissao = dia(0, 1);
      const xml = xmlNfeFicticia(emp.documento, 4127, emissao, "1840.00", [
        [dia(1, 5), "920.00"],
        [dia(2, 5), "920.00"],
      ]);
      const comp = competencia(0);
      await enviar(cliente, admin, empresaId, {
        comp,
        categoria: "nfe_saida_xml",
        nome: "NFe 4127 - Buffet Festa Boa.xml",
        mime: "application/xml",
        bytes: Buffer.from(xml, "utf8"),
        itemId: await itemChecklist(admin, empresaId, comp, "nfe_saida_xml"),
      });
    }

    // 4) Documentos publicados pelo escritório (guias e folha)
    for (const p of publicacoes(perfil)) {
      const bytes = await pdfFicticio(p.titulo, nomeEmpresa, p.linhas);
      await enviar(equipe, admin, empresaId, {
        comp: competencia(p.mes),
        categoria: p.categoria,
        nome: p.nome,
        mime: "application/pdf",
        bytes,
        itemId: null,
        titulo: p.titulo,
        vencimento: p.vencimento,
        valor: p.valor,
      });
    }

    // 5) Conversa entre cliente e escritório
    if (perfil === "padaria") {
      const { data: conversa, error } = await cliente.rpc("criar_conversa", {
        p_empresa_id: empresaId,
        p_assunto: `Guia do DAS de ${mmaaaa(-1)}`,
        p_corpo: `Bom dia! Recebi a guia do DAS de ${mmaaaa(-1)} aqui no portal. Posso pagar pelo PIX do banco?`,
        p_tipo: "mensagem",
      });
      if (error) throw new Error(`Falha ao criar a conversa: ${error.message}`);
      await equipe.rpc("enviar_mensagem", {
        p_conversa_id: conversa as string,
        p_corpo: "Bom dia! Pode sim: a guia tem QR Code para PIX. Depois do pagamento, envie o comprovante em Enviar documentos → Guias de impostos, para fecharmos o mês.",
        p_interna: false,
      });
    } else {
      await equipe.rpc("criar_conversa", {
        p_empresa_id: empresaId,
        p_assunto: `Documentos de ${mmaaaa(-1)}`,
        p_corpo: `Olá! Ainda faltam a fatura do cartão e os comprovantes de pagamento de ${mmaaaa(-1)}. Consegue enviar até o dia 10? Assim fechamos o mês sem atraso.`,
        p_tipo: "solicitacao",
        p_competencia: competencia(-1),
      });
    }

    // 6) Padaria: fecha o mês retrasado e publica o pacote de relatórios (versão revisada)
    if (perfil === "padaria") await fecharEPublicar(admin, equipe, empresaId, competencia(-2));
  } finally {
    await cliente.auth.signOut({ scope: "local" });
    await equipe.auth.signOut({ scope: "local" });
  }
  return true;
}

async function fecharEPublicar(admin: SupabaseClient, equipe: SupabaseClient, empresaId: string, comp: string) {
  const { error: eIni } = await equipe.rpc("iniciar_fechamento", { p_empresa_id: empresaId, p_competencia: comp });
  if (eIni) throw new Error(`Falha ao iniciar o fechamento: ${eIni.message}`);
  const { data: competenciaRow } = await admin.from("competencias").select("id").eq("empresa_id", empresaId).eq("competencia", comp).single();
  const { data: etapas } = await admin.from("fechamento_etapas").select("id, etapa").eq("competencia_id", competenciaRow!.id).order("ordem");
  const obs: Record<string, string> = {
    coleta: "Documentos do mês recebidos.",
    conferencia: "Documentos conferidos e lançamentos revisados.",
    conciliacao: "Extrato conciliado e saldo conferido com o banco.",
    revisao: "Resultado revisado pelo contador.",
    publicacao: "Pacote de relatórios publicado para o cliente.",
  };
  for (const e of etapas ?? []) {
    const { error } = await equipe.rpc("atualizar_etapa_fechamento", { p_etapa_id: e.id, p_status: "concluida", p_observacao: obs[e.etapa] ?? undefined });
    if (error) throw new Error(`Falha na etapa ${e.etapa}: ${error.message}`);
  }
  const { error: eFechar } = await equipe.rpc("fechar_competencia", { p_empresa_id: empresaId, p_competencia: comp, p_observacao: "Mês fechado após conferência e conciliação." });
  if (eFechar) throw new Error(`Falha ao fechar o mês: ${eFechar.message}`);

  // Pacote mensal publicado depois do fechamento → versão "revisada"
  const { gerarSnapshot } = await import("../src/lib/relatorios/snapshot");
  const { lerPeriodo } = await import("../src/lib/relatorios/periodo");
  const { hojeISO } = await import("../src/lib/competencia");
  const hoje = hojeISO();
  const periodo = lerPeriodo(comp.slice(0, 7), hoje);
  const { snapshot, limitacoes } = await gerarSnapshot(equipe as never, empresaId, periodo, hoje);
  const { data: id, error: eRasc } = await equipe.rpc("salvar_rascunho_relatorio", {
    p_id: null as unknown as string,
    p_empresa_id: empresaId,
    p_tipo: "pacote_mensal",
    p_titulo: `Pacote completo — ${periodo.rotulo}`,
    p_competencia: periodo.inicio,
    p_inicio: periodo.inicio,
    p_fim: periodo.fim,
    p_dados: snapshot as never,
    p_resumo: snapshot.resumoAutomatico.join("\n\n"),
    p_comentarios:
      "Mês fechado e conciliado. As vendas cresceram e as despesas ficaram dentro do esperado. Atenção ao aumento do custo da farinha: vale renegociar com o fornecedor. (Comentário fictício de demonstração.)",
    p_limitacoes: limitacoes as never,
  });
  if (eRasc) throw new Error(`Falha ao preparar o relatório: ${eRasc.message}`);
  const { error: ePub } = await equipe.rpc("publicar_relatorio", { p_id: id as string });
  if (ePub) throw new Error(`Falha ao publicar o relatório: ${ePub.message}`);
}
