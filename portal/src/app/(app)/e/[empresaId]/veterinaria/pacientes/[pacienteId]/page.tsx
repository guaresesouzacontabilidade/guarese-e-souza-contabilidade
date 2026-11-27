import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, FilePlus2, FileText, Syringe } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { BotaoNovoAtendimento, DialogoAgendamento } from "@/components/veterinaria/agenda";
import { BotaoExcluirPaciente, DialogoPaciente } from "@/components/veterinaria/cadastros";
import { AvisoSemVeterinario, ClinicaIndisponivel, DialogoMotivo } from "@/components/veterinaria/comuns";
import { BotaoAbrirConta } from "@/components/veterinaria/conta";
import { DialogoVacina } from "@/components/veterinaria/vacina";
import { cancelarVacinacao } from "@/lib/veterinaria/acoes";
import { formatarCpf, formatarData, formatarDataHora, formatarTelefone } from "@/lib/formatos";
import { hojeClinica, obterContextoClinica } from "@/lib/veterinaria/contexto";
import {
  DOSES,
  ESPECIES,
  PORTES,
  SEXOS,
  STATUS_ATENDIMENTO,
  TIPOS_ATENDIMENTO,
  TIPOS_DOCUMENTO,
  TIPOS_RECEITA,
  idadeAnimal,
} from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Ficha do animal" };

export default async function PaginaPaciente({ params }: PageProps<"/e/[empresaId]/veterinaria/pacientes/[pacienteId]">) {
  const { empresaId, pacienteId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!/^[0-9a-f-]{36}$/i.test(pacienteId)) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const hoje = hojeClinica();
  const [{ data: p }, { data: vacinas }, { data: atendimentos }, { data: receitas }, { data: documentos }, { data: catalogo }, { data: vets }, { data: cfg }, { data: tutores }] =
    await Promise.all([
      ctx.supabase.from("vet_pacientes").select("*, tutor:vet_tutores(id, nome, cpf, telefone)").eq("id", pacienteId).eq("empresa_id", empresaId).maybeSingle(),
      ctx.supabase
        .from("vet_vacinacoes")
        .select("id, vacina_nome, fabricante, partida, validade, dose, aplicada_em, origem, veterinario_externo, proxima_dose_em, cancelada_em, cancelada_motivo, veterinario:vet_veterinarios(nome)")
        .eq("paciente_id", pacienteId)
        .order("aplicada_em", { ascending: false }),
      ctx.supabase
        .from("vet_atendimentos")
        .select("id, numero, data_hora, tipo, status, diagnostico_presuntivo, diagnostico_conclusivo, peso_kg, veterinario:vet_veterinarios(nome)")
        .eq("paciente_id", pacienteId)
        .order("data_hora", { ascending: false })
        .limit(100),
      ctx.supabase.from("vet_receitas").select("id, numero, tipo, emitida_em, cancelada_em, veterinario:vet_veterinarios(nome)").eq("paciente_id", pacienteId).order("emitida_em", { ascending: false }).limit(50),
      ctx.supabase.from("vet_documentos").select("id, numero, tipo, emitido_em, cancelado_em").eq("paciente_id", pacienteId).order("emitido_em", { ascending: false }).limit(50),
      ctx.supabase.from("vet_vacinas").select("id, nome, fabricante, doses_iniciais, intervalo_doses_dias, reforco_dias").eq("empresa_id", empresaId).eq("ativa", true).order("ordem"),
      ctx.supabase.from("vet_veterinarios").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
      ctx.supabase.from("vet_config").select("duracao_padrao_min").eq("empresa_id", empresaId).maybeSingle(),
      ctx.supabase.from("vet_tutores").select("id, nome").eq("empresa_id", empresaId).order("nome").limit(2000),
    ]);
  if (!p) notFound();
  const tutor = p.tutor as unknown as { id: string; nome: string; cpf: string | null; telefone: string | null };
  const vet = ctx.veterinario;
  const obito = Boolean(p.obito_em);
  const idade = idadeAnimal(p.nascimento);

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {p.nome}
            {obito ? <Badge variante="neutro">óbito em {formatarData(p.obito_em)}</Badge> : !p.ativo ? <Badge>inativo</Badge> : null}
          </span>
        }
        descricao={`${ESPECIES[p.especie] ?? p.especie}${p.especie === "outra" && p.especie_outra ? ` (${p.especie_outra})` : ""}${p.raca ? ` · ${p.raca}` : ""} · ${SEXOS[p.sexo] ?? p.sexo}${p.castrado ? " castrado(a)" : ""}${idade ? ` · ${idade}${p.nascimento_estimado ? " (presumida)" : ""}` : ""}`}
        voltar={{ href: `${base}/tutores/${tutor.id}`, rotulo: `Tutor: ${tutor.nome}` }}
        acoes={
          <>
            <DialogoPaciente empresaId={empresaId} paciente={{ ...p, tutor_id: p.tutor_id }} tutores={tutores ?? []} />
            {!obito ? (
              <DialogoAgendamento
                empresaId={empresaId}
                veterinarios={vets ?? []}
                dia={hoje}
                duracaoPadrao={cfg?.duracao_padrao_min ?? 30}
                paciente={{ id: p.id, nome: p.nome, especie: p.especie, tutor: tutor.nome, tutor_id: tutor.id }}
              />
            ) : null}
            <BotaoAbrirConta empresaId={empresaId} dados={{ paciente_id: p.id }} />
            {ctx.gerente ? <BotaoExcluirPaciente empresaId={empresaId} pacienteId={p.id} tutorId={tutor.id} /> : null}
          </>
        }
      />
      {p.alergias ? (
        <Alerta tom="perigo" titulo="Alergias e alertas" className="mb-4">
          {p.alergias}
        </Alerta>
      ) : null}
      {!vet ? (
        <div className="mb-4">
          <AvisoSemVeterinario gerente={ctx.gerente} empresaId={empresaId} />
        </div>
      ) : !obito ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-2 pt-6">
            <BotaoNovoAtendimento empresaId={empresaId} pacienteId={p.id} />
            <DialogoVacina empresaId={empresaId} pacienteId={p.id} catalogo={catalogo ?? []} origem="clinica" hoje={hoje} />
            <Button asChild variante="contorno" tamanho="sm">
              <Link href={`${base}/receitas/nova?paciente=${p.id}`}>
                <FilePlus2 /> Nova receita
              </Link>
            </Button>
            <Button asChild variante="contorno" tamanho="sm">
              <Link href={`${base}/documentos/novo?paciente=${p.id}`}>
                <FileText /> Atestado ou termo
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-2 pt-6">
            <Button asChild variante="contorno" tamanho="sm">
              <Link href={`${base}/documentos/novo?paciente=${p.id}&tipo=termo_retirada_corpo`}>
                <FileText /> Termo de retirada do corpo
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Tutor</dt>
                <dd>
                  <Link href={`${base}/tutores/${tutor.id}`} className="text-primary hover:underline">
                    {tutor.nome}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {[tutor.cpf ? formatarCpf(tutor.cpf) : null, tutor.telefone ? formatarTelefone(tutor.telefone) : null].filter(Boolean).join(" · ")}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nascimento</dt>
                <dd>{p.nascimento ? `${formatarData(p.nascimento)}${p.nascimento_estimado ? " (aproximado)" : ""}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Peso</dt>
                <dd>{p.peso_kg ? `${String(p.peso_kg).replace(".", ",")} kg` : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Pelagem e porte</dt>
                <dd>{[p.pelagem, p.porte ? PORTES[p.porte] : null].filter(Boolean).join(" · ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Microchip</dt>
                <dd className="numero">{p.microchip ?? "—"}</dd>
              </div>
              {p.sinais_particulares ? (
                <div>
                  <dt className="text-muted-foreground">Sinais particulares</dt>
                  <dd>{p.sinais_particulares}</dd>
                </div>
              ) : null}
              {p.observacoes ? (
                <div>
                  <dt className="text-muted-foreground">Observações</dt>
                  <dd className="whitespace-pre-line">{p.observacoes}</dd>
                </div>
              ) : null}
              {obito ? (
                <div>
                  <dt className="text-muted-foreground">Óbito</dt>
                  <dd>
                    {formatarDataHora(p.obito_em)}
                    {p.obito_causa ? ` — ${p.obito_causa}` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-4 flex flex-col gap-2">
              <Button asChild variante="contorno" tamanho="sm">
                <a href={`/api/veterinaria/${empresaId}/carteira/${p.id}`} target="_blank" rel="noopener">
                  <FileDown /> Carteira de vacinação (PDF)
                </a>
              </Button>
              <Button asChild variante="contorno" tamanho="sm">
                <a href={`/api/veterinaria/${empresaId}/prontuario/${p.id}`} target="_blank" rel="noopener">
                  <FileDown /> Cópia do prontuário (PDF)
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Syringe className="size-5" /> Carteira de vacinação
              </CardTitle>
              {!obito ? <DialogoVacina empresaId={empresaId} pacienteId={p.id} catalogo={catalogo ?? []} origem="externa" hoje={hoje} /> : null}
            </CardHeader>
            <CardContent className="p-0">
              {vacinas?.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Data</Th>
                      <Th>Vacina</Th>
                      <Th className="hidden md:table-cell">Partida e validade</Th>
                      <Th>Próxima</Th>
                      <Th className="text-right" />
                    </Tr>
                  </THead>
                  <TBody>
                    {vacinas.map((v) => {
                      const quem = (v.veterinario as unknown as { nome: string } | null)?.nome ?? v.veterinario_externo;
                      return (
                        <Tr key={v.id} className={v.cancelada_em ? "opacity-50" : undefined}>
                          <Td className="numero align-top">{formatarData(v.aplicada_em)}</Td>
                          <Td className="align-top">
                            <span className="font-medium">{v.vacina_nome}</span> <span className="text-muted-foreground">· {DOSES[v.dose] ?? v.dose}</span>
                            <span className="block text-xs text-muted-foreground">
                              {v.origem === "externa" ? "carteira anterior" : (v.fabricante ?? "")}
                              {quem ? ` · ${quem}` : ""}
                              {v.cancelada_em ? ` · cancelada: ${v.cancelada_motivo}` : ""}
                            </span>
                          </Td>
                          <Td className="hidden align-top text-xs md:table-cell">
                            {v.partida ? `Partida ${v.partida}` : "—"}
                            {v.validade ? <span className="block text-muted-foreground">val. {formatarData(v.validade)}</span> : null}
                          </Td>
                          <Td className="align-top">
                            {v.proxima_dose_em && !v.cancelada_em ? (
                              <span className={v.proxima_dose_em < hoje ? "font-medium text-perigo" : ""}>{formatarData(v.proxima_dose_em)}</span>
                            ) : (
                              "—"
                            )}
                          </Td>
                          <Td className="align-top text-right">
                            {!v.cancelada_em && (v.origem === "externa" || vet || ctx.gerente) ? (
                              <DialogoMotivo
                                acao={cancelarVacinacao.bind(null, empresaId, v.id)}
                                titulo="Cancelar este registro de vacina?"
                                descricao="O registro fica no histórico, marcado como cancelado."
                                rotuloBotao="Cancelar"
                              />
                            ) : null}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              ) : (
                <EstadoVazio icone={Syringe} titulo="Nenhuma vacina registrada" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prontuário (atendimentos)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {atendimentos?.length ? (
                <Table>
                  <THead>
                    <Tr>
                      <Th>Nº e data</Th>
                      <Th>Tipo e diagnóstico</Th>
                      <Th className="hidden md:table-cell">Veterinário</Th>
                      <Th>Situação</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {atendimentos.map((a) => (
                      <Tr key={a.id}>
                        <Td className="align-top">
                          <Link href={`${base}/atendimentos/${a.id}`} className="font-medium text-primary hover:underline">
                            nº {a.numero}
                          </Link>
                          <span className="block text-xs text-muted-foreground">{formatarDataHora(a.data_hora)}</span>
                        </Td>
                        <Td className="align-top">
                          {TIPOS_ATENDIMENTO[a.tipo] ?? a.tipo}
                          <span className="block text-xs text-muted-foreground">{a.diagnostico_conclusivo ?? a.diagnostico_presuntivo ?? ""}</span>
                        </Td>
                        <Td className="hidden align-top md:table-cell">{(a.veterinario as unknown as { nome: string } | null)?.nome}</Td>
                        <Td className="align-top">
                          <Badge variante={STATUS_ATENDIMENTO[a.status]?.tom ?? "neutro"}>{STATUS_ATENDIMENTO[a.status]?.rotulo ?? a.status}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <EstadoVazio titulo="Nenhum atendimento ainda" />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Receitas</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {receitas?.length ? (
                  receitas.map((r) => (
                    <Link key={r.id} href={`${base}/receitas/${r.id}`} className={`block rounded-lg px-2 py-1.5 hover:bg-muted ${r.cancelada_em ? "opacity-50" : ""}`}>
                      nº {r.numero} · {TIPOS_RECEITA[r.tipo]?.rotulo ?? r.tipo}
                      <span className="block text-xs text-muted-foreground">
                        {formatarData(r.emitida_em)} · {(r.veterinario as unknown as { nome: string } | null)?.nome}
                        {r.cancelada_em ? " · cancelada" : ""}
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="text-muted-foreground">Nenhuma receita.</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Atestados e termos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {documentos?.length ? (
                  documentos.map((d) => (
                    <Link key={d.id} href={`${base}/documentos/${d.id}`} className={`block rounded-lg px-2 py-1.5 hover:bg-muted ${d.cancelado_em ? "opacity-50" : ""}`}>
                      {TIPOS_DOCUMENTO[d.tipo]?.rotulo ?? d.tipo}
                      <span className="block text-xs text-muted-foreground">
                        nº {d.numero} · {formatarData(d.emitido_em)}
                        {d.cancelado_em ? " · cancelado" : ""}
                      </span>
                    </Link>
                  ))
                ) : (
                  <p className="text-muted-foreground">Nenhum documento.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
