import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { CancelarRegistro, DialogoAdendo, FormEvolucao } from "@/components/fisioterapia/prontuario";
import { Assinatura, CampoLido, ListaAdendos } from "@/components/fisioterapia/registro";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { diaLocal, horaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData } from "@/lib/formatos";
import { MOTIVOS_ALTA } from "@/lib/fisioterapia/rotulos";

export const metadata: Metadata = { title: "Evolução da sessão" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaEvolucao({ params }: PageProps<"/e/[empresaId]/fisioterapia/evolucoes/[evolucaoId]">) {
  const { empresaId, evolucaoId } = await params;
  if (!UUID.test(evolucaoId)) notFound();
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!ctx.profissional) return <EstadoVazio icone={Lock} titulo="Prontuário sigiloso" descricao="Só os fisioterapeutas da clínica, com o próprio usuário, leem o prontuário." />;
  const base = `/e/${empresaId}/fisioterapia`;
  const [{ data: e }, { data: adendos }] = await Promise.all([
    ctx.supabase
      .from("fisio_evolucoes")
      .select("*, paciente:fisio_pacientes(id, nome), profissional:fisio_profissionais(id, nome, crefito, crefito_regiao)")
      .eq("id", evolucaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("fisio_adendos").select("id, texto, created_at, profissional:fisio_profissionais(nome, crefito, crefito_regiao)").eq("evolucao_id", evolucaoId).order("created_at"),
  ]);
  if (!e) notFound();
  const paciente = e.paciente as unknown as { id: string; nome: string };
  const prof = e.profissional as unknown as { id: string; nome: string; crefito: string; crefito_regiao: number };
  const minha = prof.id === ctx.profissional.id;
  const alta = e.tipo === "alta";
  // Plano terapêutico da última avaliação finalizada (referência para a sessão)
  const { data: av } = await ctx.supabase
    .from("fisio_avaliacoes")
    .select("objetivos, condutas")
    .eq("paciente_id", paciente.id)
    .eq("status", "finalizada")
    .order("data_hora", { ascending: false })
    .limit(1)
    .maybeSingle();
  const plano = av ? [av.objetivos, av.condutas].filter(Boolean).join(" — ") : null;
  // Sessão de número X do tratamento (evoluções finalizadas até esta)
  const { count: sessaoN } = await ctx.supabase
    .from("fisio_evolucoes")
    .select("id", { count: "exact", head: true })
    .eq("paciente_id", paciente.id)
    .eq("tipo", "sessao")
    .neq("status", "cancelada")
    .lte("data_hora", e.data_hora);

  return (
    <>
      <CabecalhoPagina
        titulo={alta ? `Alta nº ${e.numero}` : `Evolução — ${sessaoN ?? 1}ª sessão`}
        descricao={`${paciente.nome} · ${formatarData(diaLocal(e.data_hora))} ${horaLocal(e.data_hora)} · ${prof.nome}`}
        voltar={{ href: `${base}/pacientes/${paciente.id}`, rotulo: paciente.nome }}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {e.status === "aberta" ? <Badge variante="alerta">Rascunho</Badge> : e.status === "cancelada" ? <Badge>Cancelada</Badge> : <Badge variante="sucesso">Finalizada</Badge>}
            {e.status === "finalizada" ? <DialogoAdendo empresaId={empresaId} tipo="evolucao" id={e.id} /> : null}
            {e.status === "aberta" && minha ? <CancelarRegistro empresaId={empresaId} tipo="evolucao" id={e.id} /> : null}
          </div>
        }
      />
      {e.status === "aberta" && minha ? (
        <Card>
          <CardContent className="pt-6">
            <FormEvolucao empresaId={empresaId} evolucao={e} plano={plano} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {e.status === "aberta" ? <p className="text-sm text-muted-foreground">Rascunho de {prof.nome}: só quem abriu a evolução pode preenchê-la.</p> : null}
          {e.status === "cancelada" ? <p className="text-sm text-muted-foreground">Cancelada: {e.cancelado_motivo}</p> : null}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <dl className="grid gap-3 md:grid-cols-2">
                {alta ? <CampoLido rotulo="Motivo da alta" valor={MOTIVOS_ALTA[e.alta_motivo ?? ""] ?? e.alta_motivo} /> : null}
                {!alta && (e.dor_antes !== null || e.dor_depois !== null) ? <CampoLido rotulo="Dor (antes → depois)" valor={`${e.dor_antes ?? "—"}/10 → ${e.dor_depois ?? "—"}/10`} /> : null}
                <CampoLido rotulo={alta ? "Como o paciente está" : "S — Subjetivo"} valor={e.subjetivo} />
                <CampoLido rotulo={alta ? "Reavaliação final" : "O — Objetivo"} valor={e.objetivo} />
                <CampoLido rotulo={alta ? "Resultado do tratamento" : "A — Avaliação"} valor={e.analise} />
                <CampoLido rotulo={alta ? "Recomendações" : "P — Plano"} valor={e.plano} />
                <CampoLido rotulo="Recursos usados" valor={e.condutas.join(", ")} />
                <CampoLido rotulo="Intercorrências" valor={e.intercorrencias} />
                <CampoLido rotulo="Orientações ao paciente" valor={e.orientacoes} />
              </dl>
              <Assinatura profissional={prof} finalizadoEm={e.finalizado_em} />
            </CardContent>
          </Card>
          <ListaAdendos adendos={(adendos ?? []) as never} />
        </div>
      )}
    </>
  );
}
