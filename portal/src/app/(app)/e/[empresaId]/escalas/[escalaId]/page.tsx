import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { EditorEscala } from "@/components/escalas/editor";
import { GradeEscala } from "@/components/escalas/grade";
import { BotaoImprimirEscala } from "@/components/escalas/imprimir";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { formatarDataHora, nomeMes } from "@/lib/formatos";
import { conferirEscala } from "@/lib/escalas/conferencia";
import { historicoDaGrade } from "@/lib/escalas/gerador";
import { descreverTurno } from "@/lib/escalas/horas";
import { configSchema, gradeSchema, type Historico } from "@/lib/escalas/tipos";

export const metadata: Metadata = { title: "Escala do mês" };
/** O assistente de IA pode levar até um minuto e meio para responder. */
export const maxDuration = 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mesAnterior(competencia: string) {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
}

export default async function PaginaEscala({ params }: PageProps<"/e/[empresaId]/escalas/[escalaId]">) {
  const { empresaId, escalaId } = await params;
  if (!UUID.test(escalaId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  const gerenciar = ctx.pode("escalas.gerenciar");
  if (!gerenciar && !ctx.pode("escalas.ver")) notFound();

  const { data: escala } = await ctx.supabase
    .from("escalas")
    .select("id, nome, competencia, status, config, grade, ia_resumo, publicada_em")
    .eq("id", escalaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!escala) notFound();
  const config = configSchema.safeParse(escala.config);
  const grade = gradeSchema.safeParse(escala.grade);
  const mesTexto = `${nomeMes(Number(escala.competencia.slice(5, 7))).toLowerCase()} de ${escala.competencia.slice(0, 4)}`;
  if (!config.success || !grade.success) {
    return <Alerta tom="perigo">Esta escala tem dados num formato que o portal não reconhece. Fale com o escritório.</Alerta>;
  }

  // Mês anterior (para continuar a contagem de folgas e domingos)
  const { data: anterior } = await ctx.supabase
    .from("escalas")
    .select("grade")
    .eq("empresa_id", empresaId)
    .eq("competencia", mesAnterior(escala.competencia))
    .order("status", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const gAnterior = gradeSchema.safeParse(anterior?.grade ?? {});
  const historico: Historico = gAnterior.success ? historicoDaGrade(gAnterior.data) : {};

  if (!gerenciar) {
    const conf = conferirEscala(config.data, escala.competencia, grade.data, historico);
    return (
      <>
        <CabecalhoPagina
          titulo={escala.nome}
          descricao={
            <span className="flex flex-wrap items-center gap-2">
              <span>{mesTexto.charAt(0).toUpperCase() + mesTexto.slice(1)}</span>
              <Badge variante="sucesso">Publicada</Badge>
              {escala.publicada_em ? <span>em {formatarDataHora(escala.publicada_em)}</span> : null}
            </span>
          }
          voltar={{ href: `/e/${empresaId}/escalas`, rotulo: "Escalas" }}
          acoes={<BotaoImprimirEscala />}
        />
        <GradeEscala config={config.data} competencia={escala.competencia} grade={grade.data} conferencia={conf} />
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {config.data.turnos.map((t) => (
            <li key={t.id}>
              {t.nome}: {descreverTurno(t)}
            </li>
          ))}
          <li>F: folga · FÉ: férias · AF: afastamento</li>
        </ul>
      </>
    );
  }

  const [{ data: funcionarios }, { data: situacao }] = await Promise.all([
    ctx.supabase.from("escala_funcionarios").select("id, nome, cargo, jornada_semanal, nao_trabalha, domingo_quinzenal, menor_idade, ativo").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.rpc("escala_ia_situacao", { p_empresa_id: empresaId }),
  ]);
  const ia = situacao?.[0];

  return (
    <EditorEscala
      empresaId={empresaId}
      escala={{ id: escala.id, nome: escala.nome, competencia: escala.competencia, status: escala.status, ia_resumo: escala.ia_resumo, mesTexto }}
      configInicial={config.data}
      gradeInicial={grade.data}
      historico={historico}
      funcionarios={(funcionarios ?? []).map((f) => ({ ...f, jornada_semanal: Number(f.jornada_semanal) }))}
      situacaoIa={{ ligada: Boolean(ia?.ligada), limite: ia?.limite_diario ?? 0, usados: ia?.usados_hoje ?? 0 }}
      admin={ctx.sessao.perfil.tipo === "admin"}
    />
  );
}
