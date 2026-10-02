"use server";

import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { falha, mensagemErro, sucesso, type ResultadoAcao } from "@/lib/acoes";
import { lerValorBR } from "@/lib/dinheiro";
import { processarFilaDepois } from "@/lib/jobs/disparo";
import { normalizarBandeira } from "./leitura";
import { CAMPOS_RELATORIO, MODALIDADES, TIPOS_ADQUIRENTE, type Modalidade, type TipoAdquirente } from "./rotulos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// As telas das maquininhas são dinâmicas e os formulários atualizam a página
// depois de mostrar a mensagem: as ações não revalidam.

function texto(fd: FormData, nome: string) {
  return String(fd.get(nome) ?? "").trim();
}

async function contexto(empresaId: string) {
  if (!UUID.test(empresaId)) return null;
  const ctx = await obterContextoEmpresa(empresaId);
  return ctx.pode("maquininhas.gerenciar") ? ctx : null;
}

/** Taxa digitada ("2,39", "2.39%") entre 0 e 100, com até 4 casas. */
function lerTaxa(valor: string): number | null {
  const v = lerValorBR(valor.replace(/%/g, ""));
  if (!v || v.lt(0) || v.gt(100)) return null;
  return Number(v.toDecimalPlaces(4).toFixed(4));
}

async function reconferir(ctx: NonNullable<Awaited<ReturnType<typeof contexto>>>, empresaId: string) {
  const { data } = await ctx.supabase.rpc("maquininha_reconferir", { p_empresa_id: empresaId });
  return (data as number | null) ?? 0;
}

// -----------------------------------------------------------------------------
// Contratos
// -----------------------------------------------------------------------------
const TAXAS_RAPIDAS: { campo: string; modalidade: Modalidade; de: number; ate: number }[] = [
  { campo: "rapida_debito", modalidade: "debito", de: 1, ate: 1 },
  { campo: "rapida_credito", modalidade: "credito_vista", de: 1, ate: 1 },
  { campo: "rapida_parcelado_6", modalidade: "credito_parcelado", de: 2, ate: 6 },
  { campo: "rapida_parcelado_12", modalidade: "credito_parcelado", de: 7, ate: 12 },
  { campo: "rapida_pix", modalidade: "pix", de: 1, ate: 1 },
  { campo: "rapida_voucher", modalidade: "voucher", de: 1, ate: 1 },
  { campo: "rapida_frota", modalidade: "frota", de: 1, ate: 1 },
  { campo: "rapida_outros", modalidade: "outros", de: 1, ate: 1 },
];

export async function salvarContrato(empresaId: string, contratoId: string | null, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (contratoId && !UUID.test(contratoId)) return falha("Contrato inválido.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite cadastrar contratos das maquininhas.");
  const erros: Record<string, string[]> = {};

  const escolha = texto(fd, "adquirente");
  let codigo: string | null = null;
  let nome = "";
  let tipo: TipoAdquirente = "cartao";
  if (!escolha) erros.adquirente = ["Escolha a adquirente."];
  else if (escolha === "outra") {
    nome = texto(fd, "adquirente_nome");
    if (nome.length < 2 || nome.length > 80) erros.adquirente_nome = ["Informe o nome da adquirente."];
    const t = texto(fd, "tipo");
    if (!(TIPOS_ADQUIRENTE as readonly string[]).includes(t)) erros.tipo = ["Escolha o tipo."];
    else tipo = t as TipoAdquirente;
  } else {
    const { data: cat } = await ctx.supabase.from("maquininha_adquirentes").select("codigo, nome, tipo").eq("codigo", escolha).eq("ativo", true).maybeSingle();
    if (!cat) erros.adquirente = ["Adquirente inválida."];
    else {
      codigo = cat.codigo;
      nome = cat.nome;
      tipo = cat.tipo as TipoAdquirente;
    }
  }
  const inicio = texto(fd, "vigencia_inicio");
  if (!DATA.test(inicio)) erros.vigencia_inicio = ["Informe desde quando valem as taxas."];
  const fim = texto(fd, "vigencia_fim") || null;
  if (fim && (!DATA.test(fim) || fim < inicio)) erros.vigencia_fim = ["O fim precisa ser depois do início."];
  const aluguelTexto = texto(fd, "aluguel_mensal");
  const aluguel = aluguelTexto ? lerValorBR(aluguelTexto) : null;
  if (aluguelTexto && (!aluguel || aluguel.lt(0))) erros.aluguel_mensal = ["Valor inválido."];

  const rapidas: { modalidade: Modalidade; de: number; ate: number; taxa: number }[] = [];
  if (!contratoId) {
    for (const r of TAXAS_RAPIDAS) {
      const v = texto(fd, r.campo);
      if (!v) continue;
      const taxa = lerTaxa(v);
      if (taxa === null) erros[r.campo] = ["Taxa entre 0 e 100%."];
      else rapidas.push({ modalidade: r.modalidade, de: r.de, ate: r.ate, taxa });
    }
  }
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const registro = {
    empresa_id: empresaId,
    adquirente_codigo: codigo,
    adquirente_nome: nome,
    tipo,
    apelido: texto(fd, "apelido").slice(0, 80) || null,
    codigo_estabelecimento: texto(fd, "codigo_estabelecimento").slice(0, 40) || null,
    vigencia_inicio: inicio,
    vigencia_fim: fim,
    aluguel_mensal: aluguel ? Number(aluguel.toFixed(2)) : null,
    observacao: texto(fd, "observacao").slice(0, 1000) || null,
    ativo: contratoId ? fd.get("ativo") === "on" : true,
  };
  if (contratoId) {
    const { error, count } = await ctx.supabase
      .from("maquininha_contratos")
      .update(registro, { count: "exact" })
      .eq("id", contratoId)
      .eq("empresa_id", empresaId);
    if (error) return falha(mensagemErro(error));
    if (!count) return falha("Contrato não encontrado.");
  } else {
    const { data: novo, error } = await ctx.supabase.from("maquininha_contratos").insert(registro).select("id").single();
    if (error || !novo) return falha(mensagemErro(error));
    if (rapidas.length) {
      const { error: e2 } = await ctx.supabase.from("maquininha_taxas").insert(
        rapidas.map((r) => ({
          contrato_id: novo.id,
          empresa_id: empresaId,
          modalidade: r.modalidade,
          parcelas_de: r.de,
          parcelas_ate: r.ate,
          taxa_percentual: r.taxa,
        })),
      );
      if (e2) return falha(`Contrato salvo, mas as taxas não: ${mensagemErro(e2)}`);
    }
  }
  const n = await reconferir(ctx, empresaId);
  return sucesso(contratoId ? `Contrato atualizado.${n ? " As vendas foram conferidas de novo." : ""}` : "Contrato cadastrado. Confira as taxas por bandeira, se houver diferença.");
}

export async function excluirContrato(empresaId: string, contratoId: string): Promise<ResultadoAcao> {
  if (!UUID.test(contratoId)) return falha("Contrato inválido.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite excluir contratos.");
  const { error, count } = await ctx.supabase.from("maquininha_contratos").delete({ count: "exact" }).eq("id", contratoId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Contrato não encontrado.");
  await reconferir(ctx, empresaId);
  return sucesso("Contrato excluído.");
}

// -----------------------------------------------------------------------------
// Taxas do contrato
// -----------------------------------------------------------------------------
export async function salvarTaxa(
  empresaId: string,
  contratoId: string,
  taxaId: string | null,
  _anterior: ResultadoAcao,
  fd: FormData,
): Promise<ResultadoAcao> {
  if (!UUID.test(contratoId) || (taxaId && !UUID.test(taxaId))) return falha("Taxa inválida.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar as taxas.");
  const erros: Record<string, string[]> = {};
  const modalidade = texto(fd, "modalidade");
  if (!(MODALIDADES as readonly string[]).includes(modalidade)) erros.modalidade = ["Escolha a modalidade."];
  const bandeiraTexto = texto(fd, "bandeira");
  const bandeira = bandeiraTexto ? normalizarBandeira(bandeiraTexto) : null;
  if (bandeiraTexto && !bandeira) erros.bandeira = ["Bandeira inválida."];
  let de = 1;
  let ate = 1;
  if (modalidade === "credito_parcelado") {
    de = Number(texto(fd, "parcelas_de") || "2");
    ate = Number(texto(fd, "parcelas_ate") || String(de));
    if (!Number.isInteger(de) || de < 2 || de > 99) erros.parcelas_de = ["De 2 a 99."];
    if (!Number.isInteger(ate) || ate < de || ate > 99) erros.parcelas_ate = ["Igual ou maior que o início."];
  }
  const taxa = lerTaxa(texto(fd, "taxa_percentual"));
  if (taxa === null) erros.taxa_percentual = ["Informe a taxa (0 a 100%)."];
  const tarifaTexto = texto(fd, "tarifa_fixa");
  const tarifa = tarifaTexto ? lerValorBR(tarifaTexto) : null;
  if (tarifaTexto && (!tarifa || tarifa.lt(0))) erros.tarifa_fixa = ["Valor inválido."];
  const prazoTexto = texto(fd, "prazo_dias");
  const prazo = prazoTexto ? Number(prazoTexto) : null;
  if (prazoTexto && (!Number.isInteger(prazo) || prazo! < 0 || prazo! > 400)) erros.prazo_dias = ["De 0 a 400 dias."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const registro = {
    contrato_id: contratoId,
    empresa_id: empresaId,
    bandeira,
    modalidade,
    parcelas_de: de,
    parcelas_ate: ate,
    taxa_percentual: taxa!,
    tarifa_fixa: tarifa ? Number(tarifa.toFixed(2)) : 0,
    prazo_dias: prazo,
    observacao: texto(fd, "observacao").slice(0, 300) || null,
  };
  const { error, count } = taxaId
    ? await ctx.supabase.from("maquininha_taxas").update(registro, { count: "exact" }).eq("id", taxaId).eq("contrato_id", contratoId)
    : await ctx.supabase.from("maquininha_taxas").insert(registro, { count: "exact" });
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Contrato não encontrado.");
  await reconferir(ctx, empresaId);
  return sucesso(taxaId ? "Taxa atualizada. As vendas foram conferidas de novo." : "Taxa incluída. As vendas foram conferidas de novo.");
}

export async function excluirTaxa(empresaId: string, taxaId: string): Promise<ResultadoAcao> {
  if (!UUID.test(taxaId)) return falha("Taxa inválida.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite alterar as taxas.");
  const { error, count } = await ctx.supabase.from("maquininha_taxas").delete({ count: "exact" }).eq("id", taxaId).eq("empresa_id", empresaId);
  if (error) return falha(mensagemErro(error));
  if (!count) return falha("Taxa não encontrada.");
  await reconferir(ctx, empresaId);
  return sucesso("Taxa excluída.");
}

// -----------------------------------------------------------------------------
// Relatórios
// -----------------------------------------------------------------------------
export async function confirmarColunas(empresaId: string, importacaoId: string, _anterior: ResultadoAcao, fd: FormData): Promise<ResultadoAcao> {
  if (!UUID.test(importacaoId)) return falha("Relatório inválido.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite importar relatórios das maquininhas.");
  const { data: imp } = await ctx.supabase
    .from("maquininha_importacoes")
    .select("id, empresa_id, cabecalho, amostra")
    .eq("id", importacaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!imp) return falha("Relatório não encontrado.");
  // A tela mostra a linha mais larga (cabeçalho ou exemplos)
  const larguras = [imp.cabecalho, ...(Array.isArray(imp.amostra) ? imp.amostra : [])].map((l) => (Array.isArray(l) ? l.length : 0));
  const colunas = Math.max(0, ...larguras);
  const erros: Record<string, string[]> = {};
  const mapeamento: Record<string, number | null> = {};
  for (const c of CAMPOS_RELATORIO) {
    const v = texto(fd, `campo_${c.chave}`);
    if (!v) {
      mapeamento[c.chave] = null;
      continue;
    }
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || (colunas && i >= colunas)) erros[`campo_${c.chave}`] = ["Coluna inválida."];
    else mapeamento[c.chave] = i;
  }
  const linhaCabecalho = Number(texto(fd, "linha_cabecalho") || "0");
  if (mapeamento.data === null || mapeamento.data === undefined) erros.campo_data = ["Escolha a coluna da data da venda."];
  if (mapeamento.bruto === null || mapeamento.bruto === undefined) erros.campo_bruto = ["Escolha a coluna do valor da venda."];
  if (mapeamento.liquido === null && mapeamento.taxa === null && mapeamento.taxa_percentual === null) {
    erros.campo_liquido = ["Escolha a coluna do valor líquido (ou a da taxa)."];
  }
  const escolha = texto(fd, "adquirente");
  const nomeOutra = texto(fd, "adquirente_nome");
  if (!escolha) erros.adquirente = ["Escolha a adquirente."];
  else if (escolha === "outra" && (nomeOutra.length < 2 || nomeOutra.length > 80)) erros.adquirente_nome = ["Informe o nome da adquirente."];
  if (Object.keys(erros).length) return falha("Revise os campos destacados.", erros);

  const { error } = await ctx.supabase.rpc("maquininha_confirmar_mapeamento", {
    p_importacao_id: importacaoId,
    p_adquirente_codigo: escolha === "outra" ? undefined : escolha,
    p_adquirente_nome: escolha === "outra" ? nomeOutra : undefined,
    p_mapeamento: { linhaCabecalho: Number.isInteger(linhaCabecalho) ? linhaCabecalho : 0, ...mapeamento } as never,
    p_lembrar: fd.get("lembrar") === "on",
  });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["importar_maquininha"], limite: 3 });
  return sucesso("Colunas confirmadas. As vendas estão sendo importadas e conferidas com o contrato.");
}

export async function reimportarRelatorio(empresaId: string, importacaoId: string): Promise<ResultadoAcao> {
  if (!UUID.test(importacaoId)) return falha("Relatório inválido.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite importar relatórios das maquininhas.");
  const { data: imp } = await ctx.supabase
    .from("maquininha_importacoes")
    .select("id, adquirente_codigo, adquirente_nome, mapeamento")
    .eq("id", importacaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!imp) return falha("Relatório não encontrado.");
  if (!imp.mapeamento || !imp.adquirente_nome) return falha("Confira as colunas do relatório primeiro.");
  const { error } = await ctx.supabase.rpc("maquininha_confirmar_mapeamento", {
    p_importacao_id: importacaoId,
    p_adquirente_codigo: imp.adquirente_codigo ?? undefined,
    p_adquirente_nome: imp.adquirente_codigo ? undefined : imp.adquirente_nome,
    p_mapeamento: imp.mapeamento,
    p_lembrar: false,
  });
  if (error) return falha(mensagemErro(error));
  processarFilaDepois({ tipos: ["importar_maquininha"], limite: 3 });
  return sucesso("Importação reiniciada.");
}

export async function excluirRelatorio(empresaId: string, importacaoId: string): Promise<ResultadoAcao> {
  if (!UUID.test(importacaoId)) return falha("Relatório inválido.");
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite excluir relatórios das maquininhas.");
  const { error } = await ctx.supabase.rpc("maquininha_excluir_importacao", { p_importacao_id: importacaoId });
  if (error) return falha(mensagemErro(error));
  return sucesso("Relatório e vendas excluídos da conferência. O arquivo continua em Documentos.");
}

export async function conferirDeNovo(empresaId: string): Promise<ResultadoAcao> {
  const ctx = await contexto(empresaId);
  if (!ctx) return falha("Seu acesso não permite esta ação.");
  const n = await reconferir(ctx, empresaId);
  return sucesso(n ? `${n.toLocaleString("pt-BR")} vendas conferidas de novo.` : "Nenhuma venda para conferir.");
}
