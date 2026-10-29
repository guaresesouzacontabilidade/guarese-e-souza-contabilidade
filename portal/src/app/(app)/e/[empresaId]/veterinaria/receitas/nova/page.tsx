import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { AvisoSemVeterinario, ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { FormularioReceita } from "@/components/veterinaria/receita";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { ESPECIES, pendenciasTutor } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Nova receita" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaNovaReceita({ params, searchParams }: PageProps<"/e/[empresaId]/veterinaria/receitas/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const pacienteId = typeof sp.paciente === "string" && UUID.test(sp.paciente) ? sp.paciente : null;
  const atendimentoId = typeof sp.atendimento === "string" && UUID.test(sp.atendimento) ? sp.atendimento : null;
  const repetirId = typeof sp.repetir === "string" && UUID.test(sp.repetir) ? sp.repetir : null;
  if (!pacienteId) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const [{ data: p }, { data: anteriores }] = await Promise.all([
    ctx.supabase.from("vet_pacientes").select("id, nome, especie, tutor:vet_tutores(nome, cpf, logradouro, cidade)").eq("id", pacienteId).eq("empresa_id", empresaId).maybeSingle(),
    repetirId
      ? ctx.supabase.from("vet_receita_itens").select("medicamento, concentracao, forma_farmaceutica, quantidade, via, posologia, duracao, uso").eq("receita_id", repetirId).order("ordem")
      : Promise.resolve({ data: null }),
  ]);
  if (!p) notFound();
  const tutor = p.tutor as unknown as { nome: string; cpf: string | null; logradouro: string | null; cidade: string | null };
  return (
    <>
      <CabecalhoPagina
        titulo="Nova receita"
        descricao={`${p.nome} (${ESPECIES[p.especie] ?? p.especie}) · tutor ${tutor.nome}`}
        voltar={atendimentoId ? { href: `${base}/atendimentos/${atendimentoId}`, rotulo: "Atendimento" } : { href: `${base}/pacientes/${p.id}`, rotulo: `Ficha de ${p.nome}` }}
      />
      {!ctx.veterinario ? (
        <AvisoSemVeterinario gerente={ctx.gerente} empresaId={empresaId} />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <FormularioReceita
              empresaId={empresaId}
              pacienteId={p.id}
              atendimentoId={atendimentoId}
              temCadastroMapa={Boolean(ctx.veterinario.cadastro_mapa)}
              tutorSemDados={pendenciasTutor(tutor)}
              repetir={(anteriores ?? []).map((i) => ({
                medicamento: i.medicamento,
                concentracao: i.concentracao ?? "",
                forma_farmaceutica: i.forma_farmaceutica ?? "",
                quantidade: i.quantidade,
                via: i.via,
                posologia: i.posologia,
                duracao: i.duracao ?? "",
                uso: i.uso,
              }))}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
