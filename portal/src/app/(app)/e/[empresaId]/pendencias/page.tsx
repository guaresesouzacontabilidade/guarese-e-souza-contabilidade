import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, ListChecks } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Alerta, EstadoVazio, Progresso } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ItensCompetencia, type ItemChecklist } from "@/components/checklist/itens-competencia";
import { competenciaAtual, hojeISO, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { parametro } from "@/lib/busca";

export const metadata: Metadata = { title: "Pendências" };

interface Resumo {
  total: number;
  obrigatorios: number;
  concluidos: number;
  nao_se_aplica: number;
  nao_se_aplica_solicitado: number;
  enviados: number;
  correcao: number;
  pendentes: number;
  atrasados: number;
  percentual: number | null;
  proximo_prazo: string | null;
}

type Nome = { nome: string } | null;

export default async function PaginaPendencias({ params, searchParams }: PageProps<"/e/[empresaId]/pendencias">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.ver")) return <Alerta tom="alerta">Seu acesso não inclui as pendências desta empresa.</Alerta>;
  const gerenciar = ctx.pode("checklist.gerenciar");
  const atual = competenciaAtual();
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(atual, -1);
  const base = `/e/${empresaId}/pendencias`;

  const carregar = () =>
    ctx.supabase
      .from("checklist_itens")
      .select(
        "*, rc:perfis!checklist_itens_responsavel_cliente_id_fkey(nome), re:perfis!checklist_itens_responsavel_equipe_id_fkey(nome), documentos!documentos_checklist_item_fk(id, nome_original, status, enviado_em, excluido_em, upload_status)",
      )
      .eq("empresa_id", empresaId)
      .eq("competencia", comp)
      .order("prazo")
      .order("titulo");

  let { data: itens } = await carregar();
  // Gera o checklist do mês na primeira visita (operação idempotente).
  if (!itens?.length && comp <= somarMeses(atual, 1)) {
    const { data: criados } = await ctx.supabase.rpc("gerar_checklist_competencia", { p_empresa_id: empresaId, p_competencia: comp });
    if (criados) ({ data: itens } = await carregar());
  }
  const ids = (itens ?? []).map((i) => i.id);

  const [{ data: resumo }, { data: historico }, { data: categorias }, { data: lembretes }, membros, equipe] = await Promise.all([
    ctx.supabase.rpc("resumo_checklist", { p_empresa_id: empresaId, p_competencia: comp }),
    ids.length
      ? ctx.supabase
          .from("checklist_historico")
          .select("id, item_id, acao, status_novo, motivo, alterado_em, autor:perfis!checklist_historico_alterado_por_fkey(nome)")
          .in("item_id", ids)
          .order("alterado_em", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] }),
    ctx.supabase.from("categorias_documento").select("codigo, nome").eq("ativo", true).eq("escritorio", false).order("ordem"),
    ctx.supabase.from("lembretes").select("id, created_at, tipo, regra, canais, destinatarios").eq("empresa_id", empresaId).eq("competencia", comp).order("created_at", { ascending: false }).limit(10),
    gerenciar
      ? ctx.supabase
          .from("empresa_membros")
          .select("user_id, perfil:perfis!empresa_membros_user_id_fkey(nome)")
          .eq("empresa_id", empresaId)
          .eq("ativo", true)
          .in("papel", ["cliente_titular", "cliente_colaborador"])
      : Promise.resolve({ data: [] }),
    gerenciar ? ctx.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome") : Promise.resolve({ data: [] }),
  ]);

  const nomesCat = new Map((categorias ?? []).map((c) => [c.codigo, c.nome]));
  const lista: ItemChecklist[] = (itens ?? []).map((i) => ({
    id: i.id,
    titulo: i.titulo,
    descricao: i.descricao,
    categoria_codigo: i.categoria_codigo,
    categoria_nome: nomesCat.get(i.categoria_codigo) ?? i.categoria_codigo,
    obrigatorio: i.obrigatorio,
    quantidade_minima: i.quantidade_minima,
    prazo: i.prazo,
    status: i.status,
    correcao_motivo: i.correcao_motivo,
    nao_aplica_justificativa: i.nao_aplica_justificativa,
    nao_aplica_resposta: i.nao_aplica_resposta,
    conclusao_observacao: i.conclusao_observacao,
    observacao_equipe: gerenciar ? i.observacao_equipe : null,
    responsavel_cliente_id: i.responsavel_cliente_id,
    responsavel_equipe_id: i.responsavel_equipe_id,
    responsavel_cliente: (i.rc as Nome)?.nome ?? null,
    responsavel_equipe: (i.re as Nome)?.nome ?? null,
    documentos: ((i.documentos as { id: string; nome_original: string; status: string | null; enviado_em: string | null; excluido_em: string | null; upload_status: string }[]) ?? [])
      .filter((d) => !d.excluido_em && d.upload_status === "concluido")
      .map((d) => ({ id: d.id, nome: d.nome_original, status: d.status, enviado_em: d.enviado_em })),
    historico: (historico ?? [])
      .filter((h) => h.item_id === i.id)
      .slice(0, 15)
      .map((h) => ({ id: h.id, acao: h.acao, status_novo: h.status_novo, motivo: h.motivo, alterado_em: h.alterado_em, autor: (h.autor as Nome)?.nome ?? null })),
  }));
  const r = (resumo ?? null) as Resumo | null;

  return (
    <>
      <CabecalhoPagina
        titulo="Pendências do mês"
        descricao="O que o escritório precisa receber para fechar o mês. Enviar o arquivo não conclui o item: ele é concluído depois da conferência da equipe."
        acoes={
          <form className="flex items-center gap-2">
            <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Competência" className="w-52">
              {listaCompetencias(24, 1).map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </Select>
            <Button type="submit" variante="secundario">
              Ver
            </Button>
          </form>
        }
      />

      {r && r.total > 0 ? (
        <>
          <Card className="mb-4">
            <CardContent className="space-y-3 pt-4 sm:pt-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm text-muted-foreground">Competência {formatarCompetencia(comp, true)}</p>
                  <p className="text-2xl font-bold text-titulo numero">{r.percentual == null ? "—" : `${r.percentual}%`}</p>
                  <p className="text-xs text-muted-foreground">dos itens obrigatórios concluídos ou dispensados</p>
                </div>
                {r.proximo_prazo ? (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CalendarClock className="size-4" /> Próximo prazo: {formatarData(r.proximo_prazo)}
                  </p>
                ) : null}
              </div>
              <Progresso valor={r.percentual} rotulo="Percentual de conclusão" />
            </CardContent>
          </Card>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Indicador rotulo="Faltantes" valor={r.pendentes} tom={r.pendentes ? "alerta" : "neutro"} />
            <Indicador rotulo="Atrasados" valor={r.atrasados} tom={r.atrasados ? "perigo" : "neutro"} />
            <Indicador rotulo="Correção" valor={r.correcao} tom={r.correcao ? "perigo" : "neutro"} />
            <Indicador rotulo="Enviados" valor={r.enviados} detalhe="aguardando conferência" tom="info" />
            <Indicador rotulo="Concluídos" valor={r.concluidos} tom="sucesso" />
            <Indicador rotulo="Não se aplica" valor={r.nao_se_aplica + r.nao_se_aplica_solicitado} detalhe={r.nao_se_aplica_solicitado ? `${r.nao_se_aplica_solicitado} em revisão` : undefined} />
          </div>
        </>
      ) : null}

      {lista.length ? (
        <ItensCompetencia
          empresaId={empresaId}
          competencia={comp.slice(0, 7)}
          itens={lista}
          hoje={hojeISO()}
          podeEnviar={ctx.pode("documentos.enviar")}
          podeGerenciar={gerenciar}
          categorias={categorias ?? []}
          clientes={(membros.data ?? []).map((m) => ({ id: m.user_id, nome: (m.perfil as Nome)?.nome ?? "—" }))}
          equipe={equipe.data ?? []}
        />
      ) : (
        <EstadoVazio
          icone={ListChecks}
          titulo="Nenhuma pendência para este mês"
          descricao={
            gerenciar ? (
              <>
                Configure o checklist da empresa em{" "}
                <Link className="underline" href={`/escritorio/empresas/${empresaId}?aba=checklist`}>
                  Empresas → Checklist mensal
                </Link>{" "}
                ou solicite um documento avulso.
              </>
            ) : (
              "O escritório ainda não cadastrou os documentos exigidos para este mês."
            )
          }
          acao={
            gerenciar ? (
              <ItensCompetencia
                empresaId={empresaId}
                competencia={comp.slice(0, 7)}
                itens={[]}
                hoje={hojeISO()}
                podeEnviar={false}
                podeGerenciar
                categorias={categorias ?? []}
                clientes={(membros.data ?? []).map((m) => ({ id: m.user_id, nome: (m.perfil as Nome)?.nome ?? "—" }))}
                equipe={equipe.data ?? []}
              />
            ) : undefined
          }
        />
      )}

      {lembretes?.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-titulo">Lembretes enviados nesta competência</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {lembretes.map((l) => (
              <li key={l.id}>
                {formatarDataHora(l.created_at)} · {l.tipo === "manual" ? "enviado pela equipe" : `automático (${l.regra})`} · {l.canais.join(", ")} · {l.destinatarios}{" "}
                destinatário(s)
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="mt-6 text-xs text-muted-foreground">
        <Link href={urlCom(base, {}, { competencia: somarMeses(comp, -1).slice(0, 7) })} className="underline-offset-2 hover:underline">
          ← {formatarCompetencia(somarMeses(comp, -1), true)}
        </Link>
        {comp < somarMeses(atual, 1) ? (
          <>
            {" · "}
            <Link href={urlCom(base, {}, { competencia: somarMeses(comp, 1).slice(0, 7) })} className="underline-offset-2 hover:underline">
              {formatarCompetencia(somarMeses(comp, 1), true)} →
            </Link>
          </>
        ) : null}
      </p>
    </>
  );
}
