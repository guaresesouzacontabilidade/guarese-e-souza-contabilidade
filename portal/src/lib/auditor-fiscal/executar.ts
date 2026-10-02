import "server-only";
import Decimal from "decimal.js";
import type { ClienteAdmin } from "@/lib/supabase/admin";
import type { Job } from "@/lib/jobs/executor";
import { hojeISO, somarMeses } from "@/lib/competencia";
import { lerXmlFiscal } from "@/lib/fiscal/xml";
import { decodificarTexto } from "@/lib/extratos/comum";
import { receitaBruta12Meses, type DadosPrevisao, type MesDados, type ParametrosCalculo } from "@/lib/calculos/previsao";
import type { LinhaCatalogo } from "./catalogo";
import { auditar, inicioPrazo, type GrupoItens, type MesSimples } from "./regras";

/**
 * Tarefa "auditor_fiscal" da fila: analisa as NF-e/NFC-e de uma empresa nos
 * últimos 5 anos (prazo de restituição) e grava os achados.
 *  1. Relê, do arquivo guardado, as notas lidas antes da versão 2 da leitura
 *     (em lotes; o restante continua numa nova tarefa).
 *  2. Busca os itens agrupados por mês e códigos fiscais, o regime de cada mês,
 *     a receita de 12 meses do Simples e o catálogo de produtos monofásicos.
 *  3. Aplica as regras (src/lib/auditor-fiscal/regras.ts) e registra.
 */

const LOTE_RELEITURA = 120;
const TEMPO_RELEITURA_MS = 25_000;

interface Payload {
  empresa_id: string;
  execucao_id?: string;
  origem?: "automatica" | "manual" | "mensal";
}

interface DadosAuditor {
  empresa: { id: string; nome: string; documento: string; uf: string | null; regime: string | null };
  parametros: (ParametrosCalculo & { anexo_mercadorias: "I" | "II" }) | null;
  meses: (MesDados & { regime: string | null })[];
  catalogo: LinhaCatalogo[];
  leitura_antiga: number;
  notas: number;
  sem_ibscbs: { competencia: string; total: number; apos_normal: number }[];
}

async function iniciarExecucao(admin: ClienteAdmin, p: Payload): Promise<string> {
  if (p.execucao_id) {
    const { data } = await admin.from("auditor_execucoes").select("id, iniciada_em").eq("id", p.execucao_id).maybeSingle();
    if (data) {
      await admin
        .from("auditor_execucoes")
        .update({ situacao: "processando", iniciada_em: data.iniciada_em ?? new Date().toISOString(), erro: null })
        .eq("id", data.id);
      return data.id;
    }
  }
  const { data, error } = await admin
    .from("auditor_execucoes")
    .insert({ empresa_id: p.empresa_id, origem: p.origem ?? "automatica", situacao: "processando", iniciada_em: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Não foi possível registrar a análise: ${error?.message ?? "sem retorno"}`);
  return data.id;
}

/** Relê do armazenamento as notas gravadas antes da leitura completa dos códigos fiscais. */
async function relerNotasAntigas(admin: ClienteAdmin, empresa: { id: string; documento: string }, inicio: string) {
  const t0 = Date.now();
  let relidas = 0;
  const { data: notas, error } = await admin
    .from("documentos_fiscais")
    .select("id, documento_id")
    .eq("empresa_id", empresa.id)
    .lt("leitura_versao", 2)
    .in("modelo", ["55", "65"])
    .gte("competencia", inicio)
    .order("competencia", { ascending: false })
    .limit(LOTE_RELEITURA);
  if (error) throw new Error(`Falha ao listar notas para releitura: ${error.message}`);
  for (const n of notas ?? []) {
    if (Date.now() - t0 > TEMPO_RELEITURA_MS) break;
    const { data: doc } = await admin.from("documentos").select("versao_atual").eq("id", n.documento_id).maybeSingle();
    const { data: versao } = doc
      ? await admin.from("documento_versoes").select("storage_path").eq("documento_id", n.documento_id).eq("versao", doc.versao_atual).maybeSingle()
      : { data: null };
    let atualizada = false;
    if (versao?.storage_path) {
      const { data: arquivo } = await admin.storage.from("documentos").download(versao.storage_path);
      if (arquivo) {
        const bytes = new Uint8Array(await arquivo.arrayBuffer());
        const cabecalho = new TextDecoder("latin1").decode(bytes.slice(0, 200));
        const texto = decodificarTexto(bytes, /encoding="(iso-8859-1|windows-1252)"/i.exec(cabecalho)?.[1]);
        const lido = lerXmlFiscal(texto, { documento: empresa.documento });
        if (lido.sucesso && lido.dados.tipo === "nota") {
          const { error: e } = await admin.rpc("atualizar_leitura_xml_fiscal", { p_documento_fiscal_id: n.id, p_dados: lido.dados as never });
          atualizada = !e;
        }
      }
    }
    // Arquivo ausente ou ilegível: marca como relida para não tentar para sempre (fica com os dados antigos).
    if (!atualizada) await admin.from("documentos_fiscais").update({ leitura_versao: 2 }).eq("id", n.id);
    relidas++;
  }
  const { count } = await admin
    .from("documentos_fiscais")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresa.id)
    .lt("leitura_versao", 2)
    .in("modelo", ["55", "65"])
    .gte("competencia", inicio);
  return { relidas, pendentes: count ?? 0 };
}

export async function executarAuditorFiscal(admin: ClienteAdmin, job: Job) {
  const p = job.payload as unknown as Payload;
  if (!p?.empresa_id) return { ignorado: "tarefa sem empresa" };
  const execucaoId = await iniciarExecucao(admin, p);
  try {
    const hoje = hojeISO();
    const fim = `${hoje.slice(0, 7)}-01`;
    const inicio = inicioPrazo(hoje);
    const { data: empresa } = await admin.from("empresas").select("id, documento").eq("id", p.empresa_id).maybeSingle();
    if (!empresa?.documento) {
      await admin.from("auditor_execucoes").update({ situacao: "erro", erro: "Empresa sem CNPJ/CPF cadastrado.", concluida_em: new Date().toISOString() }).eq("id", execucaoId);
      return { erro: "empresa sem documento" };
    }

    // 1. Notas antigas: relê antes de analisar
    const releitura = await relerNotasAntigas(admin, empresa, inicio);
    if (releitura.pendentes > 0) {
      const { data: atual } = await admin.from("auditor_execucoes").select("notas_relidas").eq("id", execucaoId).single();
      await admin
        .from("auditor_execucoes")
        .update({ situacao: "pendente", notas_relidas: (atual?.notas_relidas ?? 0) + releitura.relidas })
        .eq("id", execucaoId);
      await admin.from("jobs").insert({
        tipo: "auditor_fiscal",
        payload: { empresa_id: p.empresa_id, execucao_id: execucaoId, origem: p.origem ?? "automatica" },
        empresa_id: p.empresa_id,
        chave_idempotencia: `auditor:releitura:${execucaoId}:${releitura.pendentes}`,
        prioridade: 110,
      });
      return { relidas: releitura.relidas, pendentes: releitura.pendentes };
    }

    // 2. Dados
    const { data: bruto, error: erroDados } = await admin.rpc("auditor_dados", { p_empresa_id: p.empresa_id, p_inicio: inicio, p_fim: fim });
    if (erroDados || !bruto) throw new Error(`Falha ao carregar os dados da empresa: ${erroDados?.message ?? "sem retorno"}`);
    const dados = bruto as unknown as DadosAuditor;
    const grupos: GrupoItens[] = [];
    for (let c = inicio; c <= fim; c = somarMeses(c, 12)) {
      const ate = somarMeses(c, 11) < fim ? somarMeses(c, 11) : fim;
      const { data, error } = await admin.rpc("auditor_itens_agrupados", { p_empresa_id: p.empresa_id, p_inicio: c, p_fim: ate });
      if (error) throw new Error(`Falha ao carregar as notas: ${error.message}`);
      grupos.push(...((data ?? []) as unknown as GrupoItens[]));
    }

    // 3. Regime e Simples de cada mês
    const regimes = new Map(dados.meses.map((m) => [String(m.competencia).slice(0, 7), m.regime]));
    const previsao: DadosPrevisao = {
      competencia: fim,
      empresa: {
        nome: dados.empresa.nome,
        regime: dados.empresa.regime,
        lucro_real_apuracao: null,
        contribuinte_icms: true,
        contribuinte_iss: false,
        tem_empregados: false,
        tem_pro_labore: false,
        uf: dados.empresa.uf,
      },
      parametros: dados.parametros,
      meses: dados.meses,
      checklist: null,
      colaboradores: [],
      ajustes: [],
      vencimentos: [],
      guias_publicadas: 0,
    };
    const cacheSimples = new Map<string, MesSimples>();
    const simples = (c: string): MesSimples => {
      const chave = c.slice(0, 7);
      const salvo = cacheSimples.get(chave);
      if (salvo) return salvo;
      const r = receitaBruta12Meses(previsao, c);
      const s: MesSimples = {
        rbt12: new Decimal(r.rbt12.toString()),
        anexo: dados.parametros?.anexo_mercadorias === "II" ? "II" : "I",
        anexoInformado: Boolean(dados.parametros),
        mesesSemDados: r.mesesSemDados,
        observacao: r.observacao,
      };
      cacheSimples.set(chave, s);
      return s;
    };

    // 4. Regras
    const semIbsCbs = new Map(dados.sem_ibscbs.map((x) => [String(x.competencia).slice(0, 7), x]));
    const achados = auditar({
      hoje,
      inicio,
      fim,
      regimeDoMes: (c) => regimes.get(c.slice(0, 7)) ?? dados.empresa.regime,
      simples,
      grupos,
      catalogo: dados.catalogo,
      semIbsCbs: (c) => semIbsCbs.get(c.slice(0, 7)) ?? null,
    });

    // 5. Registro
    const notas = dados.notas;
    const itens = grupos.reduce((t, g) => t + g.itens, 0);
    const oportunidades = achados.filter((a) => a.tipo === "oportunidade");
    const resumo = {
      periodo_inicio: inicio,
      periodo_fim: fim,
      notas,
      itens,
      grupos: grupos.length,
      achados: achados.length,
      oportunidades: oportunidades.length,
      riscos: achados.filter((a) => a.tipo === "risco").length,
      valor_oportunidades: oportunidades.reduce((t, a) => t.plus(a.valor_estimado ?? 0), new Decimal(0)).toFixed(2),
      anexo_informado: Boolean(dados.parametros),
    };
    const { data: registro, error: erroRegistro } = await admin.rpc("auditor_registrar_resultado", {
      p_execucao_id: execucaoId,
      p_achados: achados as never,
      p_resumo: resumo as never,
    });
    if (erroRegistro) throw new Error(`Falha ao registrar os achados: ${erroRegistro.message}`);
    return { ...resumo, registro };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    await admin
      .from("auditor_execucoes")
      .update({ situacao: "erro", erro: mensagem.slice(0, 2000), concluida_em: new Date().toISOString() })
      .eq("id", execucaoId);
    throw e;
  }
}
