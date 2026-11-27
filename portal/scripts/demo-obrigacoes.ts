/**
 * Camada operacional FICTÍCIA para a DEMONSTRAÇÃO.
 *
 *  - cadastro operacional das empresas (município, ICMS/ISS, folha);
 *  - histórico de regimes da Oficina (Simples Nacional até 12/2025 e Lucro
 *    Presumido desde 01/2026);
 *  - o administrador fictício confere e aplica as regras propostas do
 *    catálogo (algumas ficam pendentes para mostrar a validação);
 *  - tarefas em várias situações, com recibos e comprovantes fictícios.
 *
 * Só executa se as empresas ainda não tiverem tarefas (pode rodar de novo).
 * Em produção, as regras do catálogo ficam aguardando a validação do escritório.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviar, pdfFicticio, sessao } from "./demo-documentos";

/** Regras que ficam pendentes na demonstração (para mostrar o fluxo de validação). */
const PENDENTES = new Set(["EFD_REINF", "CBS", "IBS"]);

function competencia(deslocamentoMeses: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + deslocamentoMeses);
  return d.toISOString().slice(0, 8) + "01";
}
function mmaaaa(comp: string) {
  return `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;
}

interface Contexto {
  admin: SupabaseClient;
  conexao: { url: string; publica: string };
  padaria: string;
  oficina: string;
  emails: { admin: string; equipe: string; cliente: string; cliente2: string };
}

export async function semearObrigacoes(c: Contexto): Promise<boolean> {
  const { admin } = c;
  const { count } = await admin.from("tarefas").select("id", { count: "exact", head: true }).in("empresa_id", [c.padaria, c.oficina]);
  if (count) return false;

  // Cadastro operacional (o município vem do IBGE pela cidade/UF)
  await admin.from("empresas").update({ contribuinte_icms: true, contribuinte_iss: false, tem_empregados: true, tem_pro_labore: true }).eq("id", c.padaria);
  await admin.from("empresas").update({ contribuinte_icms: true, contribuinte_iss: true, tem_empregados: true, tem_pro_labore: true }).eq("id", c.oficina);

  // Oficina: Simples Nacional até 12/2025, Lucro Presumido a partir de 01/2026
  const { data: periodos } = await admin.from("empresa_regimes").select("id, inicio").eq("empresa_id", c.oficina).order("inicio");
  if (periodos?.length === 1 && periodos[0].inicio < "2026-01-01") {
    const inicioAtendimento = periodos[0].inicio as string;
    await admin
      .from("empresa_regimes")
      .update({ inicio: "2026-01-01", observacao: "Opção pelo Lucro Presumido a partir de janeiro de 2026 (demonstração)." })
      .eq("id", periodos[0].id);
    await admin.from("empresa_regimes").insert({
      empresa_id: c.oficina,
      regime: "simples_nacional",
      inicio: inicioAtendimento,
      fim: "2025-12-01",
      observacao: "Regime anterior (demonstração).",
    });
  }

  const comoAdmin = await sessao(admin, c.conexao.url, c.conexao.publica, c.emails.admin);
  const comoEquipe = await sessao(admin, c.conexao.url, c.conexao.publica, c.emails.equipe);
  const comoCliente = await sessao(admin, c.conexao.url, c.conexao.publica, c.emails.cliente);
  const comoCliente2 = await sessao(admin, c.conexao.url, c.conexao.publica, c.emails.cliente2);
  const { data: perfilAdmin } = await admin.from("perfis").select("id").eq("email", c.emails.admin).single();

  // Calendário próprio: revisão do IRPJ/CSLL da Oficina e ECD incluída (distribui lucros acima da presunção)
  const { data: obrigacoes } = await admin.from("obrigacoes").select("id, codigo");
  const obr = new Map((obrigacoes ?? []).map((o) => [o.codigo as string, o.id as string]));
  await comoEquipe.from("empresa_obrigacoes").insert([
    {
      empresa_id: c.oficina,
      obrigacao_id: obr.get("IRPJ_CSLL_TRIM"),
      modo: "automatico",
      vigencia_inicio: "2026-01-01",
      revisor_id: perfilAdmin?.id,
      motivo: "Revisão pelo administrador antes do pagamento (demonstração).",
    },
    {
      empresa_id: c.oficina,
      obrigacao_id: obr.get("ECD"),
      modo: "incluida",
      vigencia_inicio: "2026-01-01",
      motivo: "Distribui lucros acima da base presumida; mantém escrituração completa (demonstração).",
    },
  ]);

  // O administrador fictício confere as fontes e aplica as regras do catálogo
  const { data: propostas } = await admin
    .from("atualizacoes_normativas")
    .select("id, status, obrigacao:obrigacoes(codigo)")
    .eq("status", "proposta")
    .order("proposta_em");
  for (const p of propostas ?? []) {
    const codigo = (p.obrigacao as unknown as { codigo: string } | null)?.codigo ?? "";
    if (PENDENTES.has(codigo)) continue;
    const { error: eVal } = await comoAdmin.rpc("validar_atualizacao_normativa", {
      p_id: p.id,
      p_observacao: "Demonstração: fonte conferida pelo administrador fictício.",
    });
    if (eVal) throw new Error(`Falha ao validar regra (${codigo}): ${eVal.message}`);
    const { error: eApl } = await comoAdmin.rpc("aplicar_atualizacao_normativa", { p_id: p.id });
    if (eApl) throw new Error(`Falha ao aplicar regra (${codigo}): ${eApl.message}`);
  }

  // Tarefas em várias situações
  const m2 = competencia(-2);
  const m1 = competencia(-1);
  const { data: tarefas } = await admin
    .from("tarefas")
    .select("id, empresa_id, competencia, etapa, obrigacao:obrigacoes(codigo)")
    .in("empresa_id", [c.padaria, c.oficina]);
  const achar = (empresa: string, codigo: string, comp: string, etapa: string) =>
    (tarefas ?? []).find(
      (t) => t.empresa_id === empresa && t.competencia === comp && t.etapa === etapa && (t.obrigacao as unknown as { codigo: string } | null)?.codigo === codigo,
    )?.id as string | undefined;

  const documento = async (quem: SupabaseClient, empresa: string, comp: string, categoria: string, nome: string, titulo: string, linhas: [string, string][]) =>
    enviar(quem, admin, empresa, {
      comp,
      categoria,
      nome,
      mime: "application/pdf",
      bytes: await pdfFicticio(titulo, empresa === c.padaria ? "Padaria Pão Dourado (DEMONSTRAÇÃO)" : "Oficina Exemplo (DEMONSTRAÇÃO)", linhas),
      itemId: null,
      titulo,
    });

  const atualizar = async (quem: SupabaseClient, id: string | undefined, dados: Record<string, unknown>) => {
    if (!id) return;
    const { error } = await quem.rpc("atualizar_tarefa", { p_tarefa_id: id, ...dados });
    if (error) throw new Error(`Falha ao atualizar tarefa de demonstração: ${error.message}`);
  };
  // Entrega e pagamento só são concluídos com o recibo/comprovante (sem ele, ficam em andamento)
  const concluir = async (id: string | undefined, comprovante?: string, extra: Record<string, unknown> = {}) => {
    if (!id) return;
    await atualizar(comoEquipe, id, { p_status: "em_andamento" });
    const { data: t } = await admin.from("tarefas").select("etapa").eq("id", id).single();
    if (t?.etapa !== "apuracao" && !comprovante) return;
    await atualizar(comoEquipe, id, { p_status: "concluida", p_comprovante_documento_id: comprovante, ...extra });
  };
  const docPorTitulo = async (empresa: string, trecho: string) => {
    const { data } = await admin.from("documentos").select("id").eq("empresa_id", empresa).ilike("nome_original", `%${trecho}%`).limit(1).maybeSingle();
    return (data?.id as string | undefined) ?? undefined;
  };

  // ---- Padaria (Simples Nacional, com folha)
  const reciboPgdas = await documento(comoEquipe, c.padaria, m2, "esc_protocolo", `Recibo PGDAS-D - ${mmaaaa(m2)}.pdf`, `Recibo de transmissão do PGDAS-D — ${mmaaaa(m2)}`, [
    ["Declaração", `PGDAS-D ${mmaaaa(m2)}`],
    ["Número do recibo", "00.00.00000.0000000-0 (fictício)"],
  ]);
  const comprovanteDas = await docPorTitulo(c.padaria, `Comprovante pagamento DAS - ${mmaaaa(m2)}`);
  await concluir(achar(c.padaria, "SN_DAS", m2, "apuracao"));
  await concluir(achar(c.padaria, "SN_DAS", m2, "entrega"), reciboPgdas, { p_protocolo: "00000000000000000 (fictício)" });
  await concluir(achar(c.padaria, "SN_DAS", m2, "pagamento"), comprovanteDas);
  const reciboEsocial = await documento(comoEquipe, c.padaria, m2, "esc_protocolo", `Recibo eSocial fechamento - ${mmaaaa(m2)}.pdf`, `Recibo do fechamento dos eventos periódicos — ${mmaaaa(m2)}`, [
    ["Evento", "S-1299 — fechamento"],
    ["Recibo", "1.1.0000000000000000000 (fictício)"],
  ]);
  await concluir(achar(c.padaria, "ESOCIAL", m2, "apuracao"));
  await concluir(achar(c.padaria, "ESOCIAL", m2, "entrega"), reciboEsocial);
  const reciboDctf = await documento(comoEquipe, c.padaria, m2, "esc_protocolo", `Recibo DCTFWeb - ${mmaaaa(m2)}.pdf`, `Recibo de entrega da DCTFWeb — ${mmaaaa(m2)}`, [
    ["Declaração", `DCTFWeb ${mmaaaa(m2)} — original`],
    ["Recibo", "0000.0000.0000.0000 (fictício)"],
  ]);
  await concluir(achar(c.padaria, "DCTFWEB", m2, "apuracao"));
  await concluir(achar(c.padaria, "DCTFWEB", m2, "entrega"), reciboDctf);
  const comprovanteInss = await documento(comoCliente, c.padaria, m1, "comprovante", `Comprovante DARF previdenciario - ${mmaaaa(m2)}.pdf`, `Comprovante de pagamento do DARF previdenciário — ${mmaaaa(m2)}`, [
    ["Documento", `DARF numerado da DCTFWeb ${mmaaaa(m2)}`],
    ["Valor pago", "R$ 2.184,90"],
  ]);
  await concluir(achar(c.padaria, "INSS_DARF", m2, "apuracao"));
  await concluir(achar(c.padaria, "INSS_DARF", m2, "pagamento"), comprovanteInss);
  // FGTS de dois meses atrás: guia enviada, comprovante ainda não chegou (fica em atraso)
  await concluir(achar(c.padaria, "FGTS", m2, "apuracao"));
  await atualizar(comoEquipe, achar(c.padaria, "FGTS", m2, "pagamento"), {
    p_status: "aguardando_cliente",
    p_comentario: "Guia enviada ao cliente; aguardando o comprovante de pagamento.",
  });
  // Mês passado: DAS apurado, PGDAS-D em revisão e guia publicada no portal
  await concluir(achar(c.padaria, "SN_DAS", m1, "apuracao"));
  const guiaDas = await docPorTitulo(c.padaria, `DAS Simples Nacional - ${mmaaaa(m1)}`);
  await atualizar(comoEquipe, achar(c.padaria, "SN_DAS", m1, "entrega"), {
    p_status: "em_revisao",
    p_revisor_id: perfilAdmin?.id,
    p_comentario: "Declaração preenchida; conferir as receitas com ST antes de transmitir.",
  });
  await atualizar(comoEquipe, achar(c.padaria, "SN_DAS", m1, "pagamento"), { p_guia_documento_id: guiaDas, p_valor: 1967.15 });
  await atualizar(comoEquipe, achar(c.padaria, "ESOCIAL", m1, "apuracao"), { p_status: "em_andamento" });
  const guiaFgts = await docPorTitulo(c.padaria, `FGTS Digital - ${mmaaaa(m1)}`);
  await atualizar(comoEquipe, achar(c.padaria, "FGTS", m1, "pagamento"), { p_guia_documento_id: guiaFgts, p_valor: 913.6 });

  // ---- Oficina (Lucro Presumido)
  const reciboEfd = await documento(comoEquipe, c.oficina, competencia(-3), "esc_protocolo", `Recibo EFD-Contribuicoes - ${mmaaaa(competencia(-3))}.pdf`, `Recibo de entrega da EFD-Contribuições — ${mmaaaa(competencia(-3))}`, [
    ["Escrituração", `EFD-Contribuições ${mmaaaa(competencia(-3))}`],
    ["Recibo", "00.00.00.00.00.00 (fictício)"],
  ]);
  await concluir(achar(c.oficina, "EFD_CONTRIB", competencia(-3), "apuracao"));
  await concluir(achar(c.oficina, "EFD_CONTRIB", competencia(-3), "entrega"), reciboEfd);
  const comprovantePis = await documento(comoCliente2, c.oficina, m1, "comprovante", `Comprovante DARF PIS e Cofins - ${mmaaaa(m2)}.pdf`, `Comprovante de pagamento do DARF de PIS/Cofins — ${mmaaaa(m2)}`, [
    ["Códigos de receita", "8109 e 2172"],
    ["Valor pago", "R$ 1.098,44"],
  ]);
  await concluir(achar(c.oficina, "PIS_COFINS", m2, "apuracao"));
  await concluir(achar(c.oficina, "PIS_COFINS", m2, "pagamento"), comprovantePis);
  const reciboDctfOficina = await documento(comoEquipe, c.oficina, m2, "esc_protocolo", `Recibo DCTFWeb - ${mmaaaa(m2)}.pdf`, `Recibo de entrega da DCTFWeb — ${mmaaaa(m2)}`, [
    ["Declaração", `DCTFWeb ${mmaaaa(m2)} — original`],
    ["Recibo", "0000.0000.0000.0001 (fictício)"],
  ]);
  await concluir(achar(c.oficina, "DCTFWEB", m2, "apuracao"));
  await concluir(achar(c.oficina, "DCTFWEB", m2, "entrega"), reciboDctfOficina);
  await atualizar(comoEquipe, achar(c.oficina, "EFD_CONTRIB", m2, "apuracao"), { p_status: "em_andamento" });
  await atualizar(comoEquipe, achar(c.oficina, "PIS_COFINS", m1, "apuracao"), {
    p_status: "aguardando_cliente",
    p_comentario: "Aguardando as notas de serviço emitidas no mês.",
  });
  await atualizar(comoEquipe, achar(c.oficina, "IRPJ_CSLL_TRIM", m1, "apuracao"), {
    p_status: "em_revisao",
    p_comentario: "Apuração do trimestre pronta para revisão.",
  });
  const guiaPis = await docPorTitulo(c.oficina, `DARF PIS e Cofins - ${mmaaaa(m1)}`);
  await atualizar(comoEquipe, achar(c.oficina, "PIS_COFINS", m1, "pagamento"), { p_guia_documento_id: guiaPis, p_valor: 1098.44 });

  // Ano de teste da CBS/IBS: destaque conferido nos meses anteriores
  for (const comp of [competencia(-3), m2, m1]) {
    await atualizar(comoEquipe, achar(c.oficina, "CBS_IBS_TESTE", comp, "apuracao"), {
      p_status: "concluida",
      p_comentario: "Destaque de CBS e IBS conferido nas notas emitidas.",
    });
  }

  // Alertas do dia para a equipe (sino do portal)
  await admin.rpc("rotina_operacional");
  return true;
}
