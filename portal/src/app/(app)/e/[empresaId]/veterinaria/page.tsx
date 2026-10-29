import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ReceiptText, Stethoscope, Syringe } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AcoesAgendamento, DialogoAgendamento } from "@/components/veterinaria/agenda";
import { DialogoTutor } from "@/components/veterinaria/cadastros";
import { AvisoSemVeterinario, ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { hojeClinica, obterContextoClinica, somarDias } from "@/lib/veterinaria/contexto";
import { ESPECIES, STATUS_AGENDA, TIPOS_AGENDA, TIPOS_ATENDIMENTO, horaLocal, limitesDoDia } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Painel da clínica" };

interface Lembrete {
  tipo: "vacina" | "retorno";
  referencia_id: string;
  data_alvo: string;
  descricao: string;
  paciente_id: string;
  paciente: string;
  tutor: string;
  avisos: unknown[];
}

export default async function PaginaClinica({ params }: PageProps<"/e/[empresaId]/veterinaria">) {
  const { empresaId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const hoje = hojeClinica();
  const { inicio, fim } = limitesDoDia(hoje);
  const base = `/e/${empresaId}/veterinaria`;

  const [{ data: agenda }, { data: abertos }, { data: lembretes }, { data: contas }, { data: vets }, { data: cfg }] = await Promise.all([
    ctx.supabase
      .from("vet_agenda")
      .select("id, inicio, tipo, status, nome_avulso, atendimento_id, paciente:vet_pacientes(id, nome, especie), tutor:vet_tutores(nome), veterinario:vet_veterinarios(nome)")
      .eq("empresa_id", empresaId)
      .gte("inicio", inicio)
      .lte("inicio", fim)
      .order("inicio"),
    ctx.supabase
      .from("vet_atendimentos")
      .select("id, numero, data_hora, tipo, paciente:vet_pacientes(nome, especie), veterinario:vet_veterinarios(nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "aberto")
      .order("data_hora"),
    ctx.supabase.rpc("vet_lembretes_pendentes", { p_empresa_id: empresaId, p_ate: somarDias(hoje, 7) }),
    ctx.supabase.from("vet_contas").select("id").eq("empresa_id", empresaId).eq("status", "aberta"),
    ctx.supabase.from("vet_veterinarios").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    ctx.supabase.from("vet_config").select("duracao_padrao_min").eq("empresa_id", empresaId).maybeSingle(),
  ]);
  const listaLembretes = ((lembretes ?? []) as unknown as Lembrete[]).filter((l) => !l.avisos.length);
  const contasAbertas = contas ?? [];
  const { data: resumos } = contasAbertas.length
    ? await ctx.supabase.from("vet_conta_itens").select("total, conta_id").in("conta_id", contasAbertas.map((c) => c.id)).is("cancelado_em", null)
    : { data: [] };
  const aReceber = (resumos ?? []).reduce((t, i) => t + Number(i.total), 0);
  const ativos = (agenda ?? []).filter((a) => !["cancelado", "faltou"].includes(a.status));

  return (
    <>
      <CabecalhoPagina
        titulo="Clínica"
        descricao={`Hoje, ${formatarData(hoje)}: agenda, atendimentos em andamento e quem precisa ser lembrado.`}
        acoes={
          <>
            <DialogoTutor empresaId={empresaId} abrirAoCriar />
            <DialogoAgendamento empresaId={empresaId} veterinarios={vets ?? []} dia={hoje} duracaoPadrao={cfg?.duracao_padrao_min ?? 30} />
          </>
        }
      />
      {!ctx.veterinario ? (
        <div className="mb-4">
          <AvisoSemVeterinario gerente={ctx.gerente} empresaId={empresaId} />
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Agenda de hoje" valor={ativos.length} detalhe={`${ativos.filter((a) => a.status === "concluido").length} atendido(s)`} icone={CalendarDays} href={`${base}/agenda`} />
        <Indicador rotulo="Em atendimento" valor={(abertos ?? []).length} detalhe="prontuários abertos" icone={Stethoscope} tom={(abertos ?? []).length ? "alerta" : "neutro"} />
        <Indicador rotulo="Lembrar esta semana" valor={listaLembretes.length} detalhe="vacinas e retornos sem aviso" icone={Syringe} tom={listaLembretes.length ? "alerta" : "neutro"} href={`${base}/lembretes`} />
        <Indicador rotulo="Contas em aberto" valor={contasAbertas.length} detalhe={`serviços de ${formatarMoeda(aReceber)}`} icone={ReceiptText} href={`${base}/contas`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Agenda de hoje</CardTitle>
            <Button asChild variante="fantasma" tamanho="sm">
              <Link href={`${base}/agenda`}>Ver a semana</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {agenda?.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Hora</Th>
                    <Th>Animal</Th>
                    <Th className="hidden md:table-cell">Tipo</Th>
                    <Th>Situação</Th>
                    <Th className="text-right">Ações</Th>
                  </Tr>
                </THead>
                <TBody>
                  {agenda.map((a) => {
                    const p = a.paciente as unknown as { id: string; nome: string; especie: string } | null;
                    const t = a.tutor as unknown as { nome: string } | null;
                    const v = a.veterinario as unknown as { nome: string } | null;
                    const st = STATUS_AGENDA[a.status];
                    return (
                      <Tr key={a.id} className={["cancelado", "faltou"].includes(a.status) ? "opacity-60" : undefined}>
                        <Td className="numero align-top font-semibold">{horaLocal(a.inicio)}</Td>
                        <Td className="align-top">
                          {p ? (
                            <Link href={`${base}/pacientes/${p.id}`} className="font-medium text-primary hover:underline">
                              {p.nome}
                            </Link>
                          ) : (
                            <span className="font-medium">{a.nome_avulso}</span>
                          )}
                          <span className="block text-xs text-muted-foreground">
                            {p ? `${ESPECIES[p.especie] ?? p.especie} · ${t?.nome ?? ""}` : "sem cadastro"}
                            {v ? ` · ${v.nome}` : ""}
                          </span>
                        </Td>
                        <Td className="hidden align-top md:table-cell">{TIPOS_AGENDA[a.tipo] ?? a.tipo}</Td>
                        <Td className="align-top">
                          <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? a.status}</Badge>
                        </Td>
                        <Td className="align-top">
                          <AcoesAgendamento
                            empresaId={empresaId}
                            agendaId={a.id}
                            status={a.status}
                            podeAtender={Boolean(ctx.veterinario)}
                            temPaciente={Boolean(p)}
                            atendimentoId={a.atendimento_id}
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <EstadoVazio icone={CalendarDays} titulo="Nenhum horário hoje" descricao="Agende pelo botão “Agendar” ou atenda um animal direto pela ficha dele." />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Em atendimento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {abertos?.length ? (
                abertos.map((a) => {
                  const p = a.paciente as unknown as { nome: string; especie: string } | null;
                  const v = a.veterinario as unknown as { nome: string } | null;
                  return (
                    <Link key={a.id} href={`${base}/atendimentos/${a.id}`} className="block rounded-lg border border-border p-2 hover:bg-muted">
                      <strong>{p?.nome}</strong> <span className="text-muted-foreground">· {TIPOS_ATENDIMENTO[a.tipo] ?? a.tipo} · desde {horaLocal(a.data_hora)}</span>
                      <span className="block text-xs text-muted-foreground">{v?.nome}</span>
                    </Link>
                  );
                })
              ) : (
                <p className="text-muted-foreground">Nenhum prontuário aberto.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle>Lembrar esta semana</CardTitle>
              <Button asChild variante="fantasma" tamanho="sm">
                <Link href={`${base}/lembretes`}>Todos</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {listaLembretes.length ? (
                listaLembretes.slice(0, 6).map((l) => (
                  <Link key={`${l.referencia_id}-${l.data_alvo}`} href={`${base}/lembretes`} className="block rounded-lg border border-border p-2 hover:bg-muted">
                    <strong>{l.paciente}</strong> <span className="text-muted-foreground">· {l.tipo === "vacina" ? l.descricao : "Retorno"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatarData(l.data_alvo)}
                      {l.data_alvo < hoje ? " (atrasada)" : ""} · {l.tutor}
                    </span>
                  </Link>
                ))
              ) : (
                <p className="text-muted-foreground">Ninguém para lembrar nos próximos 7 dias.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
