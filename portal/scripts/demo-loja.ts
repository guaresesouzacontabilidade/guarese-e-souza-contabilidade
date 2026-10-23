/**
 * Gestão da loja na DEMONSTRAÇÃO (dados fictícios): uma madeireira do
 * Simples Nacional (eucalipto e pinus de reflorestamento) com a gestão da
 * loja ligada — produtos com as medidas da peça (cubagem), estoque inicial,
 * clientes, um caixa do balconista já fechado (vendas em dinheiro, PIX,
 * cartão e a prazo, sangria e suprimento), o caixa da tarde aberto pelo dono
 * e um orçamento em aberto. Tudo é feito pelas mesmas funções do portal,
 * com cada pessoa fictícia entrando com a própria sessão.
 *
 * Estoque pelas notas de compra: a entrada automática ligada, os itens de um
 * fornecedor fictício já ligados aos produtos (nota que entra sozinha) e a
 * nota de outro fornecedor com caixa de prego (1 caixa = 12 kg) e um item novo,
 * esperando a conferência do dono.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dvChave } from "../src/lib/fiscal/chave";
import { enviar } from "./demo-documentos";

function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

function cpfValido(base9: string) {
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9);
  return `${base9}${d1}${calc(base9 + d1)}`;
}

function hojeMais(dias: number) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
  const [a, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

async function entrarComo(admin: SupabaseClient, conexao: { url: string; publica: string }, email: string) {
  const cliente = createClient(conexao.url, conexao.publica, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`Falha ao preparar o acesso de ${email}: ${error?.message ?? "sem token"}`);
  const { error: e2 } = await cliente.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2) throw new Error(`Falha ao entrar como ${email}: ${e2.message}`);
  return cliente;
}

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Loja de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

interface Produto {
  chave: string;
  descricao: string;
  grupo: string;
  ncm: string;
  unidade: string;
  preco: string;
  custo: string;
  estoque: string;
  minimo: string;
  esp?: string;
  larg?: string;
  comp?: string;
}

// Preços e medidas fictícios. NCM de referência (confirmar com o escritório em cada caso real):
// pinus serrado 4407.11.00; eucalipto serrado 4407.99.90; madeira roliça tratada 4403.12.00; lenha 4401.12.00.
const PRODUTOS: Produto[] = [
  { chave: "caibro", descricao: "Caibro de eucalipto 5 x 6 cm", grupo: "Eucalipto serrado", ncm: "44079990", unidade: "M3", preco: "2200", custo: "1400", estoque: "4", minimo: "1", esp: "5", larg: "6", comp: "3" },
  { chave: "viga", descricao: "Viga de eucalipto 6 x 12 cm", grupo: "Eucalipto serrado", ncm: "44079990", unidade: "M3", preco: "2300", custo: "1450", estoque: "6", minimo: "2", esp: "6", larg: "12", comp: "4" },
  { chave: "tabua_euc", descricao: "Tábua de eucalipto 2,5 x 20 cm", grupo: "Eucalipto serrado", ncm: "44079990", unidade: "M3", preco: "2100", custo: "1300", estoque: "3.5", minimo: "1", esp: "2.5", larg: "20", comp: "3" },
  { chave: "ripa", descricao: "Ripa de eucalipto 1,5 x 5 cm", grupo: "Eucalipto serrado", ncm: "44079990", unidade: "M", preco: "2.2", custo: "1.2", estoque: "1500", minimo: "300", comp: "3" },
  { chave: "tabua_pinus", descricao: "Tábua de pinus 2,5 x 30 cm", grupo: "Pinus serrado", ncm: "44071100", unidade: "M3", preco: "1900", custo: "1150", estoque: "2.2", minimo: "1", esp: "2.5", larg: "30", comp: "3" },
  { chave: "sarrafo", descricao: "Sarrafo de pinus 2,5 x 10 cm", grupo: "Pinus serrado", ncm: "44071100", unidade: "M3", preco: "1850", custo: "1100", estoque: "0.8", minimo: "1", esp: "2.5", larg: "10", comp: "3" },
  { chave: "mourao", descricao: "Mourão de eucalipto tratado 2,20 m (10 a 12 cm)", grupo: "Eucalipto tratado", ncm: "44031200", unidade: "PC", preco: "28", custo: "16", estoque: "220", minimo: "50" },
  { chave: "poste", descricao: "Poste de eucalipto tratado 7 m", grupo: "Eucalipto tratado", ncm: "44031200", unidade: "PC", preco: "380", custo: "230", estoque: "12", minimo: "5" },
  { chave: "lenha", descricao: "Lenha de eucalipto (metro cúbico)", grupo: "Lenha", ncm: "44011200", unidade: "M3", preco: "120", custo: "60", estoque: "40", minimo: "10" },
  { chave: "prego", descricao: "Prego 17 x 27 com cabeça (kg)", grupo: "Ferragens", ncm: "73170090", unidade: "KG", preco: "18.9", custo: "11.5", estoque: "0", minimo: "10" },
];

/** Logo fictícia da madeireira (para mostrar as duas logos nos relatórios). Só envia se ainda não houver. */
async function semearLogoLoja(admin: SupabaseClient, empresaId: string) {
  const { data: e } = await admin.from("empresas").select("logo_path").eq("id", empresaId).single();
  if (e?.logo_path) return;
  const bytes = readFileSync(join(__dirname, "arquivos-demo", "logo-madeireira.png"));
  const caminho = `${empresaId}/logo-${Date.now()}.png`;
  ok("logo: envio", await admin.storage.from("empresas-logos").upload(caminho, bytes, { contentType: "image/png", upsert: false }));
  ok("logo: cadastro", await admin.from("empresas").update({ logo_path: caminho, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId));
}

/** NF-e da madeireira (desligada: sem certificado, nenhuma nota vai à SEFAZ). Só cria o que falta. */
async function semearNfeLoja(admin: SupabaseClient, empresaId: string) {
  const { count } = await admin.from("nfe_config").select("empresa_id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return;
  // NF-e configurada para as vendas em que o cliente pede nota, mas DESLIGADA:
  // a demonstração não tem certificado digital e nenhuma nota vai à SEFAZ.
  ok("NF-e: configuração", await admin.from("nfe_config").insert({ empresa_id: empresaId, ativa: false, ambiente: "homologacao", crt: 1, presenca: 1, enviar_email_destinatario: false }));
  ok(
    "NF-e: emitente",
    await admin.from("nfe_emitentes").insert({
      empresa_id: empresaId,
      nome: "Madeireira Reflorestar (DEMO)",
      inscricao_estadual: "290000000",
      logradouro: "Avenida Fictícia das Madeiras",
      numero: "1500",
      bairro: "Setor Industrial",
      municipio_ibge: "1718204",
      cep: "77500000",
      serie: 1,
    }),
  );
  ok(
    "NF-e: operação",
    await admin.from("nfe_operacoes").insert({
      empresa_id: empresaId,
      nome: "Venda de madeira no Tocantins (Simples Nacional) (DEMO)",
      natureza: "VENDA DE MERCADORIA",
      destino: "interna",
      cfop: "5102",
      icms_cst: "102",
      pis_cst: "49",
      cofins_cst: "49",
      informacoes: "Documento emitido por ME ou EPP optante pelo Simples Nacional. Operação de DEMONSTRAÇÃO, sem valor fiscal.",
    }),
  );
  ok(
    "NF-e: destinatário",
    await admin.from("nfe_destinatarios").insert({
      empresa_id: empresaId,
      tipo: "cnpj",
      documento: cnpjValido("556667770001"),
      nome: "CONSTRUTORA HORIZONTE EXEMPLO LTDA (DEMO)",
      indicador_ie: 9,
      logradouro: "Rua Fictícia",
      numero: "200",
      bairro: "Centro",
      municipio_ibge: "1718204",
      cep: "77500000",
    }),
  );

}

// ------------------------------------------------------------- notas de compra
const MARCA_COMPRAS = "DEMO-ESTOQUE";
const REFLORESTADORA = { cnpj: cnpjValido("889990000001"), nome: "REFLORESTADORA ARAGUAIA LTDA (FICTICIA)" };
const FERRAGENS = { cnpj: cnpjValido("889990000002"), nome: "FERRAGENS DO CERRADO LTDA (FICTICIA)" };

interface ItemCompra {
  codigo: string;
  descricao: string;
  ncm: string;
  unidade: string;
  qtd: number;
  unit: number;
}

/** XML fictício (homologação) de uma nota de compra do Simples para a madeireira. */
function notaCompra(o: { emitente: { cnpj: string; nome: string }; dest: string; numero: number; data: string; itens: ItemCompra[] }) {
  const dec = (v: number) => v.toFixed(2);
  const aamm = o.data.slice(2, 4) + o.data.slice(5, 7);
  const cNF = String(30000000 + o.numero * 7907).slice(-8);
  const base = `17${aamm}${o.emitente.cnpj}55001${String(o.numero).padStart(9, "0")}1${cNF}`;
  const chave = `${base}${dvChave(base)}`;
  let vProd = 0;
  const dets = o.itens
    .map((it, i) => {
      const valor = Math.round(it.qtd * it.unit * 100) / 100;
      vProd += valor;
      return (
        `<det nItem="${i + 1}"><prod><cProd>${it.codigo}</cProd><cEAN>SEM GTIN</cEAN><xProd>${it.descricao}</xProd><NCM>${it.ncm}</NCM><CFOP>5102</CFOP>` +
        `<uCom>${it.unidade}</uCom><qCom>${it.qtd.toFixed(4)}</qCom><vUnCom>${it.unit.toFixed(10)}</vUnCom><vProd>${dec(valor)}</vProd><cEANTrib>SEM GTIN</cEANTrib>` +
        `<uTrib>${it.unidade}</uTrib><qTrib>${it.qtd.toFixed(4)}</qTrib><vUnTrib>${it.unit.toFixed(10)}</vUnTrib><indTot>1</indTot></prod>` +
        `<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>` +
        `<PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.0000</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>` +
        `<COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.0000</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto></det>`
      );
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>17</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>${o.numero}</nNF><dhEmi>${o.data}T09:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>1718204</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>1</indPres></ide>
      <emit><CNPJ>${o.emitente.cnpj}</CNPJ><xNome>${o.emitente.nome}</xNome><enderEmit><xLgr>Rua Ficticia</xLgr><nro>200</nro><xBairro>Centro</xBairro><cMun>1718204</cMun><xMun>Porto Nacional</xMun><UF>TO</UF></enderEmit><IE>290000002</IE><CRT>1</CRT></emit>
      <dest><CNPJ>${o.dest}</CNPJ><xNome>MADEIREIRA REFLORESTAR EXEMPLO LTDA (FICTICIA)</xNome><enderDest><xLgr>Avenida Ficticia das Madeiras</xLgr><nro>1500</nro><xBairro>Setor Industrial</xBairro><cMun>1718204</cMun><xMun>Porto Nacional</xMun><UF>TO</UF></enderDest><indIEDest>1</indIEDest><IE>290000098</IE></dest>
      ${dets}
      <total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${dec(vProd)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${dec(vProd)}</vNF></ICMSTot></total>
      <transp><modFrete>9</modFrete></transp>
      <pag><detPag><tPag>15</tPag><vPag>${dec(vProd)}</vPag></detPag></pag>
    </infNFe>
  </NFe>
  <protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>DEMONSTRACAO</verAplic><chNFe>${chave}</chNFe><dhRecbto>${o.data}T09:00:05-03:00</dhRecbto><nProt>3172600${String(o.numero).padStart(8, "0")}</nProt><digVal>ZGVtbw==</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (ambiente de homologacao)</xMotivo></infProt></protNFe>
</nfeProc>
`;
}

/**
 * Estoque pelas notas de compra (uma vez só): liga a entrada automática, guarda os
 * itens da reflorestadora ligados ao mourão e ao poste e envia duas notas pelo
 * caminho normal (Enviar documentos). Na fila, a da reflorestadora entra sozinha
 * no estoque; a das ferragens (caixa de prego e um item novo) espera a conferência.
 */
async function semearComprasLoja(admin: SupabaseClient, conexao: { url: string; publica: string }, empresaId: string, emailDono: string) {
  const { count } = await admin.from("documentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).like("nome_original", `${MARCA_COMPRAS}%`);
  if (count) return false;
  const { data: empresa } = await admin.from("empresas").select("documento").eq("id", empresaId).single();
  const { data: produtos } = await admin.from("nfe_produtos").select("id, descricao").eq("empresa_id", empresaId);
  const produto = (inicio: string) => produtos?.find((p) => p.descricao.startsWith(inicio))?.id;
  const mourao = produto("Mourão de eucalipto");
  const poste = produto("Poste de eucalipto");
  if (!empresa?.documento || !mourao || !poste) return false;

  ok("ligar a entrada automática", await admin.from("gestao_config").update({ entrada_automatica: true }).eq("empresa_id", empresaId));
  ok(
    "itens da reflorestadora ligados",
    await admin.from("estoque_vinculos").upsert(
      [
        { empresa_id: empresaId, fornecedor_documento: REFLORESTADORA.cnpj, codigo_fornecedor: "MT-220", produto_id: mourao, fator: 1, descricao_fornecedor: "MOURAO EUCALIPTO TRATADO 2,20M", unidade_fornecedor: "UN" },
        { empresa_id: empresaId, fornecedor_documento: REFLORESTADORA.cnpj, codigo_fornecedor: "PT-7M", produto_id: poste, fator: 1, descricao_fornecedor: "POSTE EUCALIPTO TRATADO 7M", unidade_fornecedor: "UN" },
      ],
      { onConflict: "empresa_id,fornecedor_documento,codigo_fornecedor" },
    ),
  );

  const dono = await entrarComo(admin, conexao, emailDono);
  const subir = async (nome: string, data: string, xml: string) =>
    enviar(dono, admin, empresaId, { comp: `${data.slice(0, 7)}-01`, categoria: "nfe_entrada_xml", nome: `${MARCA_COMPRAS} ${nome}.xml`, mime: "application/xml", bytes: Buffer.from(xml, "utf8"), itemId: null });
  const d1 = hojeMais(-3);
  await subir(
    "Compra reflorestadora",
    d1,
    notaCompra({
      emitente: REFLORESTADORA,
      dest: empresa.documento,
      numero: 4101,
      data: d1,
      itens: [
        { codigo: "MT-220", descricao: "MOURAO EUCALIPTO TRATADO 2,20M", ncm: "44031200", unidade: "UN", qtd: 100, unit: 15.5 },
        { codigo: "PT-7M", descricao: "POSTE EUCALIPTO TRATADO 7M", ncm: "44031200", unidade: "UN", qtd: 6, unit: 225 },
      ],
    }),
  );
  const d2 = hojeMais(-1);
  await subir(
    "Compra ferragens",
    d2,
    notaCompra({
      emitente: FERRAGENS,
      dest: empresa.documento,
      numero: 7302,
      data: d2,
      itens: [
        { codigo: "PRG1727-CX", descricao: "PREGO 17X27 C/ CABECA CX 12KG", ncm: "73170090", unidade: "CX", qtd: 5, unit: 132 },
        { codigo: "DOB3-ZN", descricao: "DOBRADICA 3 POL ZINCADA", ncm: "83021000", unidade: "UN", qtd: 24, unit: 4.8 },
      ],
    }),
  );
  await dono.auth.signOut();
  return true;
}

export async function semearLoja(
  admin: SupabaseClient,
  comoAdmin: SupabaseClient,
  conexao: { url: string; publica: string },
  opcoes: {
    dominio: string;
    contadorId: string;
    inicioAtendimento: string;
    garantirUsuario: (email: string, nome: string) => Promise<string>;
    permissoesTitular: string[];
  },
): Promise<boolean> {
  const documento = cnpjValido("334445550001");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) {
    await semearNfeLoja(admin, existente.id);
    await semearLogoLoja(admin, existente.id);
    if (await semearComprasLoja(admin, conexao, existente.id, `madeireira@${opcoes.dominio}`)) {
      console.log("  Madeireira: entrada automática ligada e notas de compra fictícias enviadas (a leitura e a entrada no estoque rodam na fila)");
    }
    return false;
  }

  const empresaId = ok(
    "empresa",
    await comoAdmin.rpc("criar_empresa", {
      p_dados: {
        razao_social: "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)",
        nome_fantasia: "Madeireira Reflorestar (DEMO)",
        tipo_pessoa: "PJ",
        documento,
        regime_tributario: "simples_nacional",
        atividade_principal: "Comércio varejista de madeira de reflorestamento (eucalipto e pinus)",
        cnae: "4744-0/02",
        servicos: ["contabil", "fiscal", "financeiro"],
        controla_estoque: true,
        logradouro: "Avenida Fictícia das Madeiras",
        numero: "1500",
        bairro: "Setor Industrial",
        cidade: "Porto Nacional",
        uf: "TO",
        cep: "77500000",
        telefone: "63999990000",
        email: `madeireira@${opcoes.dominio}`,
        contador_responsavel_id: opcoes.contadorId,
        data_inicio_atendimento: opcoes.inicioAtendimento,
        demonstracao: true,
      },
    }),
  ) as string;

  // Dono (titular, gerencia a loja) e balconista (só vende no caixa)
  const idDono = await opcoes.garantirUsuario(`madeireira@${opcoes.dominio}`, "Dono da Madeireira (Demonstração)");
  const idBalcao = await opcoes.garantirUsuario(`balcao@${opcoes.dominio}`, "Balconista da Madeireira (Demonstração)");
  ok("acesso do dono", await admin.from("empresa_membros").upsert({ empresa_id: empresaId, user_id: idDono, papel: "cliente_titular", permissoes: opcoes.permissoesTitular, ativo: true }, { onConflict: "empresa_id,user_id" }));
  ok(
    "acesso do balconista",
    await admin
      .from("empresa_membros")
      .upsert({ empresa_id: empresaId, user_id: idBalcao, papel: "cliente_colaborador", permissoes: ["empresa.ver", "gestao.vender", "mensagens.usar"], ativo: true }, { onConflict: "empresa_id,user_id" }),
  );

  // O escritório liga a gestão da loja (cria as contas do Financeiro)
  ok(
    "ligar a loja",
    await comoAdmin.rpc("gestao_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        ativa: true,
        perfil_fiscal: "comercio",
        permitir_venda_prazo: true,
        desconto_maximo_operador: "5",
        validade_orcamento_dias: 15,
        mensagem_comprovante: "Madeira de reflorestamento — eucalipto e pinus.\nSeg a sex 7h às 18h · sáb 7h às 12h\nTroca só com este comprovante. (DEMONSTRAÇÃO)",
      },
    }),
  );

  const dono = await entrarComo(admin, conexao, `madeireira@${opcoes.dominio}`);
  const balcao = await entrarComo(admin, conexao, `balcao@${opcoes.dominio}`);

  // Produtos e estoque inicial (pelo dono)
  const ids: Record<string, string> = {};
  for (const p of PRODUTOS) {
    ids[p.chave] = ok(
      `produto ${p.descricao}`,
      await dono.rpc("gestao_produto_salvar", {
        p_empresa_id: empresaId,
        p_id: null,
        p_dados: {
          descricao: p.descricao,
          grupo: p.grupo,
          ncm: p.ncm,
          unidade: p.unidade,
          valor_unitario: p.preco,
          preco_custo: p.custo,
          controla_estoque: true,
          estoque_minimo: p.minimo,
          espessura_cm: p.esp ?? null,
          largura_cm: p.larg ?? null,
          comprimento_m: p.comp ?? null,
          ativo: true,
        },
      }),
    ) as string;
    if (Number(p.estoque) > 0) {
      ok(
        `estoque inicial ${p.descricao}`,
        await dono.rpc("gestao_estoque_lancar", {
          p_empresa_id: empresaId,
          p_dados: { tipo: "entrada_manual", produto_id: ids[p.chave], quantidade: p.estoque, custo_unitario: p.custo, observacao: "Estoque inicial (DEMONSTRAÇÃO)" },
        }),
      );
    }
  }

  // Clientes do cadastro
  const cliente = async (nome: string, doc: string, telefone: string) =>
    ok(`cliente ${nome}`, await dono.rpc("gestao_cliente_salvar", { p_empresa_id: empresaId, p_dados: { nome, documento: doc, telefone } })) as string;
  const construtora = await cliente("CONSTRUTORA HORIZONTE EXEMPLO LTDA (DEMO)", cnpjValido("556667770001"), "63988887777");
  const fazenda = await cliente("Fazenda Santa Luzia — José Exemplo (DEMO)", cpfValido("321654987"), "63977776666");
  const joao = await cliente("João Carpinteiro Exemplo (DEMO)", cpfValido("147258369"), "63966665555");

  // Turno da manhã: balconista abre, vende, faz sangria e fecha (conferiu certinho)
  const manha = ok("abrir caixa da manhã", await balcao.rpc("gestao_caixa_abrir", { p_empresa_id: empresaId, p_caixa_nome: "Caixa 1", p_valor_abertura: 150 })) as string;
  const vender = async (quem: SupabaseClient, sessao: string, dados: Record<string, unknown>) =>
    ok("venda", await quem.rpc("gestao_venda_finalizar", { p_empresa_id: empresaId, p_dados: { sessao_id: sessao, ...dados } })) as { total: number };
  // 1) 10 caibros de 3 m (0,09 m³ × 2.200 = 198,00) — dinheiro, recebeu 200
  await vender(balcao, manha, {
    cliente_id: joao,
    itens: [{ produto_id: ids.caibro, pecas: "10", comprimento_m: "3", preco_unitario: "2200" }],
    pagamentos: [{ forma: "dinheiro", valor: "198", valor_recebido: "200" }],
  });
  // 2) 30 mourões — PIX
  await vender(balcao, manha, {
    cliente_id: fazenda,
    itens: [{ produto_id: ids.mourao, quantidade: "30", preco_unitario: "28" }],
    pagamentos: [{ forma: "pix", valor: "840" }],
  });
  // 3) 100 m de ripa + 2 m³ de lenha — débito
  await vender(balcao, manha, {
    cliente_nome: "Consumidor balcão",
    itens: [
      { produto_id: ids.ripa, pecas: "33", comprimento_m: "3", preco_unitario: "2.2" },
      { produto_id: ids.lenha, quantidade: "2", preco_unitario: "120" },
    ],
    pagamentos: [{ forma: "cartao_debito", valor: "457.8" }],
  });
  // 4) 20 tábuas de pinus 2,5 × 30 × 3 m (0,45 m³ × 1.900 = 855,00) — dinheiro + PIX
  await vender(balcao, manha, {
    cliente_nome: "Marcenaria do Bairro (DEMO)",
    itens: [{ produto_id: ids.tabua_pinus, pecas: "20", comprimento_m: "3", preco_unitario: "1900" }],
    pagamentos: [
      { forma: "dinheiro", valor: "300", valor_recebido: "300" },
      { forma: "pix", valor: "555" },
    ],
  });
  ok("suprimento", await balcao.rpc("gestao_caixa_movimento", { p_sessao_id: manha, p_tipo: "suprimento", p_valor: 50, p_motivo: "Troco em moedas trazido do cofre", p_conta_id: null }));
  const { data: contas } = await admin.from("contas_financeiras").select("id, nome").eq("empresa_id", empresaId).eq("tipo", "conta_corrente");
  ok(
    "sangria",
    await balcao.rpc("gestao_caixa_movimento", { p_sessao_id: manha, p_tipo: "sangria", p_valor: 400, p_motivo: "Depósito no banco", p_conta_id: contas?.[0]?.id ?? null }),
  );
  const resumo = ok("resumo da manhã", await balcao.rpc("gestao_caixa_resumo", { p_sessao_id: manha })) as { dinheiro_esperado: number };
  ok("fechar caixa da manhã", await balcao.rpc("gestao_caixa_fechar", { p_sessao_id: manha, p_valor_contado: Number(resumo.dinheiro_esperado), p_observacao: "Turno da manhã (DEMONSTRAÇÃO)" }));

  // Turno da tarde: o dono abre o caixa e vende a prazo e no crédito (caixa fica aberto)
  const tarde = ok("abrir caixa da tarde", await dono.rpc("gestao_caixa_abrir", { p_empresa_id: empresaId, p_caixa_nome: "Caixa 1", p_valor_abertura: 200 })) as string;
  // 5) Construtora: 40 vigas 6 × 12 × 4 m (1,152 m³ × 2.300 = 2.649,60) + frete — a prazo em 2x
  await vender(dono, tarde, {
    cliente_id: construtora,
    itens: [{ produto_id: ids.viga, pecas: "40", comprimento_m: "4", preco_unitario: "2300" }],
    frete: "150",
    pagamentos: [{ forma: "a_prazo", valor: "2799.6", parcelas: 2, primeiro_vencimento: hojeMais(30), intervalo_dias: 30 }],
    entrega: "Obra Residencial Horizonte — Rua Fictícia, 200 (DEMO)",
  });
  // 6) 2 postes — crédito em 3x
  await vender(dono, tarde, {
    cliente_id: fazenda,
    itens: [{ produto_id: ids.poste, quantidade: "2", preco_unitario: "380" }],
    pagamentos: [{ forma: "cartao_credito", valor: "760", parcelas: 3 }],
  });

  // Orçamento em aberto para a construtora
  ok(
    "orçamento",
    await dono.rpc("gestao_orcamento_salvar", {
      p_empresa_id: empresaId,
      p_id: null,
      p_dados: {
        cliente_id: construtora,
        itens: [
          { produto_id: ids.caibro, pecas: "120", comprimento_m: "3", preco_unitario: "2200" },
          { produto_id: ids.tabua_euc, pecas: "60", comprimento_m: "3", preco_unitario: "2100" },
        ],
        desconto: "100",
        frete: "200",
        entrega: "Entrega na obra (DEMO)",
        observacao: "Segunda etapa do telhado. Valores de DEMONSTRAÇÃO.",
      },
    }),
  );

  await semearNfeLoja(admin, empresaId);
  await semearLogoLoja(admin, empresaId);
  await semearComprasLoja(admin, conexao, empresaId, `madeireira@${opcoes.dominio}`);

  await dono.auth.signOut();
  await balcao.auth.signOut();
  return true;
}
