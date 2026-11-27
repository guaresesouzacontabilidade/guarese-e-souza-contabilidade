import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { FisioIndisponivel } from "@/components/fisioterapia/comuns";
import { CancelarRegistro, DialogoAdendo, FormAvaliacao } from "@/components/fisioterapia/prontuario";
import { Assinatura, CampoLido, ListaAdendos } from "@/components/fisioterapia/registro";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { diaLocal, horaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Avaliação fisioterapêutica" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaAvaliacao({ params }: PageProps<"/e/[empresaId]/fisioterapia/avaliacoes/[avaliacaoId]">) {
  const { empresaId, avaliacaoId } = await params;
  if (!UUID.test(avaliacaoId)) notFound();
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!ctx.profissional) return <EstadoVazio icone={Lock} titulo="Prontuário sigiloso" descricao="Só os fisioterapeutas da clínica, com o próprio usuário, leem o prontuário." />;
  const base = `/e/${empresaId}/fisioterapia`;
  const [{ data: a }, { data: adendos }] = await Promise.all([
    ctx.supabase
      .from("fisio_avaliacoes")
      .select("*, paciente:fisio_pacientes(id, nome), profissional:fisio_profissionais(id, nome, crefito, crefito_regiao)")
      .eq("id", avaliacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase.from("fisio_adendos").select("id, texto, created_at, profissional:fisio_profissionais(nome, crefito, crefito_regiao)").eq("avaliacao_id", avaliacaoId).order("created_at"),
  ]);
  if (!a) notFound();
  const paciente = a.paciente as unknown as { id: string; nome: string };
  const prof = a.profissional as unknown as { id: string; nome: string; crefito: string; crefito_regiao: number };
  const minha = prof.id === ctx.profissional.id;
  const titulo = `${a.tipo === "reavaliacao" ? "Reavaliação" : "Avaliação inicial"} nº ${a.numero}`;

  return (
    <>
      <CabecalhoPagina
        titulo={titulo}
        descricao={`${paciente.nome} · ${formatarData(diaLocal(a.data_hora))} ${horaLocal(a.data_hora)} · ${prof.nome}`}
        voltar={{ href: `${base}/pacientes/${paciente.id}`, rotulo: paciente.nome }}
        acoes={
          <div className="flex flex-wrap items-center gap-2">
            {a.status === "aberta" ? <Badge variante="alerta">Rascunho</Badge> : a.status === "cancelada" ? <Badge>Cancelada</Badge> : <Badge variante="sucesso">Finalizada</Badge>}
            {a.status === "finalizada" ? <DialogoAdendo empresaId={empresaId} tipo="avaliacao" id={a.id} /> : null}
            {a.status === "aberta" && minha ? <CancelarRegistro empresaId={empresaId} tipo="avaliacao" id={a.id} /> : null}
          </div>
        }
      />
      {a.status === "aberta" && minha ? (
        <Card>
          <CardContent className="pt-6">
            <FormAvaliacao empresaId={empresaId} avaliacao={a} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {a.status === "aberta" ? <p className="text-sm text-muted-foreground">Rascunho de {prof.nome}: só quem abriu a avaliação pode preenchê-la.</p> : null}
          {a.status === "cancelada" ? <p className="text-sm text-muted-foreground">Cancelada: {a.cancelado_motivo}</p> : null}
          <Card>
            <CardContent className="space-y-6 pt-6">
              <section className="space-y-3">
                <h2 className="font-semibold">História clínica</h2>
                <dl className="grid gap-3 md:grid-cols-2">
                  <CampoLido rotulo="Queixa principal" valor={a.queixa_principal} />
                  <CampoLido rotulo="História da doença atual" valor={a.historia_atual} />
                  <CampoLido rotulo="História pregressa" valor={a.historia_pregressa} />
                  <CampoLido rotulo="Antecedentes pessoais e familiares" valor={a.antecedentes} />
                  <CampoLido rotulo="Hábitos de vida" valor={a.habitos} />
                  <CampoLido rotulo="Medicamentos em uso" valor={a.medicamentos} />
                  <CampoLido rotulo="Tratamentos já realizados" valor={a.tratamentos_anteriores} />
                </dl>
              </section>
              <section className="space-y-3">
                <h2 className="font-semibold">Exame físico-funcional</h2>
                <dl className="grid gap-3 md:grid-cols-2">
                  <CampoLido rotulo="Dor (EVA)" valor={a.dor_eva !== null ? `${a.dor_eva}/10${a.dor_local ? ` — ${a.dor_local}` : ""}` : null} />
                  <CampoLido rotulo="Inspeção, palpação e postura" valor={a.exame_fisico} />
                  <CampoLido rotulo="Amplitude de movimento" valor={a.amplitude_movimento} />
                  <CampoLido rotulo="Força muscular" valor={a.forca_muscular} />
                  <CampoLido rotulo="Testes especiais" valor={a.testes_especiais} />
                  <CampoLido rotulo="Exames complementares" valor={a.exames_complementares} />
                </dl>
              </section>
              <section className="space-y-3">
                <h2 className="font-semibold">Diagnóstico, prognóstico e plano terapêutico</h2>
                <dl className="grid gap-3 md:grid-cols-2">
                  <CampoLido rotulo="Diagnóstico fisioterapêutico" valor={a.diagnostico} />
                  <CampoLido rotulo="CID do pedido médico" valor={a.cid} />
                  <CampoLido rotulo="Prognóstico" valor={a.prognostico} />
                  <CampoLido rotulo="Objetivos terapêuticos" valor={a.objetivos} />
                  <CampoLido rotulo="Recursos, métodos e técnicas" valor={a.condutas} />
                  <CampoLido
                    rotulo="Frequência e sessões"
                    valor={a.frequencia_semanal || a.sessoes_previstas ? `${a.frequencia_semanal ? `${a.frequencia_semanal}x por semana` : ""}${a.sessoes_previstas ? ` · cerca de ${a.sessoes_previstas} sessões` : ""}` : null}
                  />
                </dl>
              </section>
              <Assinatura profissional={prof} finalizadoEm={a.finalizado_em} />
            </CardContent>
          </Card>
          <ListaAdendos adendos={(adendos ?? []) as never} />
        </div>
      )}
    </>
  );
}
