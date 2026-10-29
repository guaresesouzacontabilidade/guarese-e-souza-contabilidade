import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AcoesAgendamento, DialogoAgendamento } from "@/components/veterinaria/agenda";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { formatarData, formatarTelefone } from "@/lib/formatos";
import { hojeClinica, obterContextoClinica, somarDias } from "@/lib/veterinaria/contexto";
import { ESPECIES, STATUS_AGENDA, TIPOS_AGENDA, diaLocal, horaLocal, limitesDoDia } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Agenda da clínica" };

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default async function PaginaAgenda({ params, searchParams }: PageProps<"/e/[empresaId]/veterinaria/agenda">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const hoje = hojeClinica();
  const dia = typeof sp.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hoje;
  const base = `/e/${empresaId}/veterinaria`;
  const semana = Array.from({ length: 7 }, (_, i) => somarDias(dia, i - 3));
  const { inicio, fim } = limitesDoDia(dia);
  const [{ data: agenda }, { data: semanaAg }, { data: vets }, { data: cfg }] = await Promise.all([
    ctx.supabase
      .from("vet_agenda")
      .select(
        "id, inicio, duracao_min, tipo, status, nome_avulso, telefone_avulso, observacoes, atendimento_id, veterinario_id, paciente:vet_pacientes(id, nome, especie, tutor_id), tutor:vet_tutores(nome, telefone), veterinario:vet_veterinarios(nome)",
      )
      .eq("empresa_id", empresaId)
      .gte("inicio", inicio)
      .lte("inicio", fim)
      .order("inicio"),
    ctx.supabase
      .from("vet_agenda")
      .select("inicio, status")
      .eq("empresa_id", empresaId)
      .gte("inicio", limitesDoDia(semana[0]).inicio)
      .lte("inicio", limitesDoDia(semana[6]).fim)
      .not("status", "in", "(cancelado,faltou)"),
    ctx.supabase.from("vet_veterinarios").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("vet_config").select("duracao_padrao_min").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  const porDia = new Map<string, number>();
  for (const a of semanaAg ?? []) porDia.set(diaLocal(a.inicio), (porDia.get(diaLocal(a.inicio)) ?? 0) + 1);
  const duracao = cfg?.duracao_padrao_min ?? 30;

  return (
    <>
      <CabecalhoPagina
        titulo="Agenda"
        descricao="Consultas, retornos, vacinas, cirurgias e banho e tosa. Quem chega sem cadastro entra pelo nome e telefone."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
        acoes={<DialogoAgendamento empresaId={empresaId} veterinarios={vets ?? []} dia={dia} duracaoPadrao={duracao} />}
      />
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Semana anterior">
          <Link href={`${base}/agenda?dia=${somarDias(dia, -7)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        {semana.map((d) => {
          const [a, m, dd] = d.split("-").map(Number);
          const sem = DIAS_SEMANA[new Date(Date.UTC(a, m - 1, dd)).getUTCDay()];
          return (
            <Link
              key={d}
              href={`${base}/agenda?dia=${d}`}
              className={`min-w-16 rounded-xl border px-3 py-2 text-center text-sm ${d === dia ? "border-primary bg-primary text-primary-foreground" : d === hoje ? "border-primary/50" : "border-border hover:bg-muted"}`}
            >
              <span className="block text-xs uppercase">{sem}</span>
              <span className="block font-semibold">{`${String(dd).padStart(2, "0")}/${String(m).padStart(2, "0")}`}</span>
              <span className="block text-xs opacity-80">{porDia.get(d) ?? 0}</span>
            </Link>
          );
        })}
        <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Próxima semana">
          <Link href={`${base}/agenda?dia=${somarDias(dia, 7)}`}>
            <ChevronRight />
          </Link>
        </Button>
        {dia !== hoje ? (
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={`${base}/agenda`}>Hoje</Link>
          </Button>
        ) : null}
      </div>
      <h2 className="mb-2 font-semibold">{formatarData(dia)}</h2>
      {agenda?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Hora</Th>
                  <Th>Animal e tutor</Th>
                  <Th className="hidden md:table-cell">Tipo e veterinário</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Ações</Th>
                </Tr>
              </THead>
              <TBody>
                {agenda.map((a) => {
                  const p = a.paciente as unknown as { id: string; nome: string; especie: string; tutor_id: string } | null;
                  const t = a.tutor as unknown as { nome: string; telefone: string | null } | null;
                  const v = a.veterinario as unknown as { nome: string } | null;
                  const st = STATUS_AGENDA[a.status];
                  const editavel = ["agendado", "confirmado", "chegou"].includes(a.status);
                  return (
                    <Tr key={a.id} className={["cancelado", "faltou"].includes(a.status) ? "opacity-60" : undefined}>
                      <Td className="numero align-top font-semibold">
                        {horaLocal(a.inicio)}
                        <span className="block text-xs font-normal text-muted-foreground">{a.duracao_min} min</span>
                      </Td>
                      <Td className="align-top">
                        {p ? (
                          <Link href={`${base}/pacientes/${p.id}`} className="font-medium text-primary hover:underline">
                            {p.nome}
                          </Link>
                        ) : (
                          <span className="font-medium">{a.nome_avulso}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {p ? `${ESPECIES[p.especie] ?? p.especie} · ${t?.nome ?? ""}${t?.telefone ? ` · ${formatarTelefone(t.telefone)}` : ""}` : `sem cadastro${a.telefone_avulso ? ` · ${formatarTelefone(a.telefone_avulso)}` : ""}`}
                        </span>
                        {a.observacoes ? <span className="block text-xs text-muted-foreground">Obs.: {a.observacoes}</span> : null}
                      </Td>
                      <Td className="hidden align-top md:table-cell">
                        {TIPOS_AGENDA[a.tipo] ?? a.tipo}
                        <span className="block text-xs text-muted-foreground">{v?.nome ?? "qualquer veterinário"}</span>
                      </Td>
                      <Td className="align-top">
                        <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? a.status}</Badge>
                      </Td>
                      <Td className="align-top">
                        <div className="flex flex-wrap items-start justify-end gap-1">
                          {editavel ? (
                            <DialogoAgendamento
                              empresaId={empresaId}
                              veterinarios={vets ?? []}
                              duracaoPadrao={duracao}
                              agendamento={{
                                id: a.id,
                                dia: diaLocal(a.inicio),
                                hora: horaLocal(a.inicio),
                                duracao_min: a.duracao_min,
                                tipo: a.tipo,
                                paciente: p ? { id: p.id, nome: p.nome, especie: p.especie, tutor: t?.nome ?? "", tutor_id: p.tutor_id } : null,
                                nome_avulso: a.nome_avulso,
                                telefone_avulso: a.telefone_avulso,
                                veterinario_id: a.veterinario_id,
                                observacoes: a.observacoes,
                              }}
                            />
                          ) : null}
                          <AcoesAgendamento
                            empresaId={empresaId}
                            agendaId={a.id}
                            status={a.status}
                            podeAtender={Boolean(ctx.veterinario)}
                            temPaciente={Boolean(p)}
                            atendimentoId={a.atendimento_id}
                          />
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={CalendarDays} titulo="Nenhum horário neste dia" />
      )}
    </>
  );
}
