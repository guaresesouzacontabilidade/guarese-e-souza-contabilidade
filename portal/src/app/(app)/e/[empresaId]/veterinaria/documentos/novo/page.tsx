import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { AvisoSemVeterinario, ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { FormularioDocumento } from "@/components/veterinaria/documento";
import { formatarData } from "@/lib/formatos";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { DOSES, ESPECIES, pendenciasTutor } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Atestado ou termo" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaNovoDocumento({ params, searchParams }: PageProps<"/e/[empresaId]/veterinaria/documentos/novo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const pacienteId = typeof sp.paciente === "string" && UUID.test(sp.paciente) ? sp.paciente : null;
  const atendimentoId = typeof sp.atendimento === "string" && UUID.test(sp.atendimento) ? sp.atendimento : null;
  if (!pacienteId) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const [{ data: p }, { data: vacinas }] = await Promise.all([
    ctx.supabase
      .from("vet_pacientes")
      .select("id, nome, especie, obito_em, tutor:vet_tutores(nome, cpf, logradouro, cidade)")
      .eq("id", pacienteId)
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    ctx.supabase
      .from("vet_vacinacoes")
      .select("id, vacina_nome, dose, aplicada_em")
      .eq("paciente_id", pacienteId)
      .eq("origem", "clinica")
      .is("cancelada_em", null)
      .order("aplicada_em", { ascending: false })
      .limit(30),
  ]);
  if (!p) notFound();
  const tutor = p.tutor as unknown as { nome: string; cpf: string | null; logradouro: string | null; cidade: string | null };
  return (
    <>
      <CabecalhoPagina
        titulo="Atestado ou termo"
        descricao={`${p.nome} (${ESPECIES[p.especie] ?? p.especie}) · tutor ${tutor.nome}`}
        voltar={atendimentoId ? { href: `${base}/atendimentos/${atendimentoId}`, rotulo: "Atendimento" } : { href: `${base}/pacientes/${p.id}`, rotulo: `Ficha de ${p.nome}` }}
      />
      {!ctx.veterinario ? (
        <AvisoSemVeterinario gerente={ctx.gerente} empresaId={empresaId} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <FormularioDocumento
              empresaId={empresaId}
              pacienteId={p.id}
              atendimentoId={atendimentoId}
              tipoInicial={typeof sp.tipo === "string" ? sp.tipo : p.obito_em ? "termo_retirada_corpo" : "atestado_sanitario"}
              vacinacoes={(vacinas ?? []).map((v) => ({ id: v.id, rotulo: `${formatarData(v.aplicada_em)} — ${v.vacina_nome} (${DOSES[v.dose] ?? v.dose})` }))}
              tutorSemDados={pendenciasTutor(tutor)}
              obito={Boolean(p.obito_em)}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
