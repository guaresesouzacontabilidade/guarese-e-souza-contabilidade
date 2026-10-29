import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, FileText, PackageMinus, Paperclip, Syringe } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { BotaoFinalizarAtendimento, DialogoAdendo, EnvioAnexo, FormularioProntuario } from "@/components/veterinaria/atendimento";
import { ClinicaIndisponivel, DialogoMotivo } from "@/components/veterinaria/comuns";
import { BotaoAbrirConta } from "@/components/veterinaria/conta";
import { FormularioUso } from "@/components/veterinaria/usos";
import { DialogoVacina } from "@/components/veterinaria/vacina";
import { cancelarAtendimento, cancelarUso } from "@/lib/veterinaria/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarQuantidade, un } from "@/lib/gestao/rotulos";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { hojeClinica, obterContextoClinica } from "@/lib/veterinaria/contexto";
import { DOSES, ESPECIES, STATUS_ATENDIMENTO, TIPOS_ATENDIMENTO, TIPOS_DOCUMENTO, TIPOS_RECEITA, idadeAnimal } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Atendimento" };

function Bloco({ rotulo, texto }: { rotulo: string; texto: string | null | undefined }) {
  if (!texto) return null;
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="whitespace-pre-line text-sm">{texto}</dd>
    </div>
  );
}

export default async function PaginaAtendimento({ params }: PageProps<"/e/[empresaId]/veterinaria/atendimentos/[atendimentoId]">) {
  const { empresaId, atendimentoId } = await params;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  if (!/^[0-9a-f-]{36}$/i.test(atendimentoId)) notFound();
  const base = `/e/${empresaId}/veterinaria`;
  const { data: a } = await ctx.supabase
    .from("vet_atendimentos")
    .select("*, paciente:vet_pacientes(id, nome, especie, raca, sexo, nascimento, alergias, peso_kg), tutor:vet_tutores(id, nome), veterinario:vet_veterinarios(id, nome, crmv, crmv_uf)")
    .eq("id", atendimentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!a) notFound();
  const [{ data: adendos }, { data: anexos }, { data: vacinas }, { data: receitas }, { data: documentos }, { data: catalogo }, { data: usos }, { data: produtos }] = await Promise.all([
    ctx.supabase.from("vet_adendos").select("id, texto, created_at, veterinario:vet_veterinarios(nome, crmv, crmv_uf)").eq("atendimento_id", atendimentoId).order("created_at"),
    ctx.supabase.from("vet_anexos").select("id, nome, descricao, mime, created_at, confirmado_em").eq("atendimento_id", atendimentoId).not("confirmado_em", "is", null).order("created_at"),
    ctx.supabase.from("vet_vacinacoes").select("id, vacina_nome, dose, partida, fabricante, proxima_dose_em, cancelada_em").eq("atendimento_id", atendimentoId).order("created_at"),
    ctx.supabase.from("vet_receitas").select("id, numero, tipo, cancelada_em").eq("atendimento_id", atendimentoId).order("numero"),
    ctx.supabase.from("vet_documentos").select("id, numero, tipo, cancelado_em").eq("atendimento_id", atendimentoId).order("numero"),
    ctx.supabase.from("vet_vacinas").select("id, nome, fabricante, doses_iniciais, intervalo_doses_dias, reforco_dias").eq("empresa_id", empresaId).eq("ativa", true).order("ordem"),
    ctx.supabase
      .from("vet_usos")
      .select("id, descricao, quantidade, unidade, vacinacao_id, cancelado_em, cancelado_motivo, created_at, conta_item:vet_conta_itens(total, cancelado_em)")
      .eq("atendimento_id", atendimentoId)
      .order("created_at"),
    ctx.supabase
      .from("nfe_produtos")
      .select("id, descricao, unidade, valor_unitario, estoque_atual, controla_estoque")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("descricao")
      .limit(500),
  ]);
  const p = a.paciente as unknown as { id: string; nome: string; especie: string; raca: string | null; sexo: string; nascimento: string | null; alergias: string | null };
  const t = a.tutor as unknown as { id: string; nome: string };
  const v = a.veterinario as unknown as { id: string; nome: string; crmv: string; crmv_uf: string };
  const meu = ctx.veterinario?.id === v.id;
  const editavel = a.status === "aberto" && meu;
  const st = STATUS_ATENDIMENTO[a.status];
  const hoje = hojeClinica();

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Atendimento nº {a.numero} <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? a.status}</Badge>
          </span>
        }
        descricao={`${p.nome} (${ESPECIES[p.especie] ?? p.especie}${p.raca ? `, ${p.raca}` : ""}${idadeAnimal(p.nascimento) ? `, ${idadeAnimal(p.nascimento)}` : ""}) · tutor ${t.nome} · ${formatarDataHora(a.data_hora)} · ${v.nome} (CRMV-${v.crmv_uf} ${v.crmv})`}
        voltar={{ href: `${base}/pacientes/${p.id}`, rotulo: `Ficha de ${p.nome}` }}
        acoes={
          <>
            {a.status !== "cancelado" ? <BotaoAbrirConta empresaId={empresaId} dados={{ atendimento_id: a.id }} /> : null}
            {editavel ? (
              <>
                <DialogoMotivo
                  acao={cancelarAtendimento.bind(null, empresaId, a.id)}
                  titulo="Cancelar o atendimento?"
                  descricao="Só para atendimento aberto por engano, sem vacina, receita ou documento."
                  rotuloBotao="Cancelar"
                />
                <BotaoFinalizarAtendimento empresaId={empresaId} atendimentoId={a.id} />
              </>
            ) : null}
            {a.status === "finalizado" && ctx.veterinario ? <DialogoAdendo empresaId={empresaId} atendimentoId={a.id} /> : null}
          </>
        }
      />
      {p.alergias ? (
        <Alerta tom="perigo" titulo="Alergias e alertas" className="mb-4">
          {p.alergias}
        </Alerta>
      ) : null}
      {a.status === "aberto" && !meu ? (
        <Alerta tom="info" className="mb-4">
          Este atendimento está aberto por {v.nome}. Só quem abriu preenche e finaliza o prontuário.
        </Alerta>
      ) : null}
      {a.status === "cancelado" ? (
        <Alerta tom="alerta" className="mb-4">
          Atendimento cancelado: {a.cancelado_motivo}
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Prontuário</CardTitle>
          </CardHeader>
          <CardContent>
            {editavel ? (
              <FormularioProntuario empresaId={empresaId} atendimentoId={a.id} p={a} />
            ) : (
              <dl className="space-y-3">
                <Bloco rotulo="Tipo" texto={`${TIPOS_ATENDIMENTO[a.tipo] ?? a.tipo}${a.local ? ` · ${a.local}` : ""}`} />
                <Bloco rotulo="Relato do responsável" texto={a.relato} />
                <Bloco rotulo="Anamnese" texto={a.anamnese} />
                <Bloco
                  rotulo="Parâmetros"
                  texto={[
                    a.peso_kg ? `Peso ${String(a.peso_kg).replace(".", ",")} kg` : null,
                    a.temperatura ? `Temp. ${String(a.temperatura).replace(".", ",")} °C` : null,
                    a.frequencia_cardiaca ? `FC ${a.frequencia_cardiaca} bpm` : null,
                    a.frequencia_respiratoria ? `FR ${a.frequencia_respiratoria} mpm` : null,
                    a.tpc ? `TPC ${String(a.tpc).replace(".", ",")} s` : null,
                    a.mucosas ? `Mucosas: ${a.mucosas}` : null,
                    a.hidratacao ? `Hidratação: ${a.hidratacao}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                <Bloco rotulo="Estado geral" texto={a.estado_geral} />
                <Bloco rotulo="Achados do exame" texto={a.exame_fisico} />
                <Bloco rotulo="Diagnóstico presuntivo" texto={a.diagnostico_presuntivo} />
                <Bloco rotulo="Diagnóstico conclusivo" texto={a.diagnostico_conclusivo} />
                <Bloco rotulo="Procedimentos" texto={a.procedimentos} />
                <Bloco rotulo="Tratamento" texto={a.tratamento} />
                <Bloco rotulo="Orientações" texto={a.orientacoes} />
                <Bloco rotulo="Retorno" texto={a.retorno_em ? `${formatarData(a.retorno_em)}${a.retorno_motivo ? ` — ${a.retorno_motivo}` : ""}` : null} />
                {a.finalizado_em ? <p className="text-xs text-muted-foreground">Finalizado em {formatarDataHora(a.finalizado_em)}.</p> : null}
                {adendos?.length ? (
                  <div className="space-y-2 border-t border-border pt-3">
                    <h3 className="font-semibold">Adendos</h3>
                    {adendos.map((d) => {
                      const dv = d.veterinario as unknown as { nome: string; crmv: string; crmv_uf: string } | null;
                      return (
                        <div key={d.id} className="rounded-lg border border-border p-2 text-sm">
                          <p className="whitespace-pre-line">{d.texto}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatarDataHora(d.created_at)} · {dv?.nome} (CRMV-{dv?.crmv_uf} {dv?.crmv})
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Syringe className="size-5" /> Vacinas aplicadas
              </CardTitle>
              {editavel ? <DialogoVacina empresaId={empresaId} pacienteId={p.id} atendimentoId={a.id} catalogo={catalogo ?? []} origem="clinica" hoje={hoje} /> : null}
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {vacinas?.length ? (
                vacinas.map((x) => (
                  <p key={x.id} className={x.cancelada_em ? "opacity-50" : undefined}>
                    <strong>{x.vacina_nome}</strong> · {DOSES[x.dose] ?? x.dose}
                    <span className="block text-xs text-muted-foreground">
                      {x.fabricante} · partida {x.partida}
                      {x.proxima_dose_em ? ` · próxima ${formatarData(x.proxima_dose_em)}` : ""}
                      {x.cancelada_em ? " · cancelada" : ""}
                    </span>
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground">Nenhuma vacina neste atendimento.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageMinus className="size-5" /> Medicamentos e materiais usados
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {usos?.length ? (
                <ul className="space-y-2">
                  {usos.map((u) => {
                    const item = u.conta_item as unknown as { total: number | string; cancelado_em: string | null } | null;
                    return (
                      <li key={u.id} className={`flex items-start justify-between gap-2 ${u.cancelado_em ? "opacity-50" : ""}`}>
                        <span>
                          <strong>{u.descricao}</strong> · {formatarQuantidade(u.quantidade)} {un(u.unidade)}
                          <span className="block text-xs text-muted-foreground">
                            {formatarDataHora(u.created_at)}
                            {u.vacinacao_id ? " · dose da vacina aplicada" : ""}
                            {item && !item.cancelado_em ? ` · cobrado ${formatarMoeda(item.total)}` : item ? " · cobrança cancelada" : " · sem cobrança"}
                            {u.cancelado_em ? ` · cancelado: ${u.cancelado_motivo}` : ""}
                          </span>
                        </span>
                        {!u.cancelado_em && !u.vacinacao_id ? (
                          <DialogoMotivo
                            acao={cancelarUso.bind(null, empresaId, u.id)}
                            titulo="Cancelar este lançamento?"
                            descricao="O produto volta ao estoque e, se foi cobrado, sai da conta do tutor (com a conta ainda aberta)."
                            rotuloBotao="Cancelar"
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nada lançado. O que for usado aqui sai do estoque do pet shop e farmácia.</p>
              )}
              {a.status !== "cancelado" ? <FormularioUso empresaId={empresaId} atendimentoId={a.id} produtos={produtos ?? []} /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Receitas e documentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(receitas ?? []).map((r) => (
                <Link key={r.id} href={`${base}/receitas/${r.id}`} className={`block hover:underline ${r.cancelada_em ? "opacity-50" : ""}`}>
                  Receita nº {r.numero} · {TIPOS_RECEITA[r.tipo]?.rotulo ?? r.tipo}
                </Link>
              ))}
              {(documentos ?? []).map((d) => (
                <Link key={d.id} href={`${base}/documentos/${d.id}`} className={`block hover:underline ${d.cancelado_em ? "opacity-50" : ""}`}>
                  {TIPOS_DOCUMENTO[d.tipo]?.rotulo ?? d.tipo} nº {d.numero}
                </Link>
              ))}
              {ctx.veterinario && a.status !== "cancelado" ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild variante="contorno" tamanho="sm">
                    <Link href={`${base}/receitas/nova?paciente=${p.id}&atendimento=${a.id}`}>
                      <FilePlus2 /> Nova receita
                    </Link>
                  </Button>
                  <Button asChild variante="contorno" tamanho="sm">
                    <Link href={`${base}/documentos/novo?paciente=${p.id}&atendimento=${a.id}`}>
                      <FileText /> Atestado ou termo
                    </Link>
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="size-5" /> Laudos e imagens
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {anexos?.length ? (
                <ul className="space-y-1">
                  {anexos.map((x) => (
                    <li key={x.id}>
                      <a href={`/api/veterinaria/${empresaId}/anexos/${x.id}`} target="_blank" rel="noopener" className="text-primary hover:underline">
                        {x.descricao || x.nome}
                      </a>
                      <span className="block text-xs text-muted-foreground">{formatarDataHora(x.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Nenhum anexo. Laudos de exames ficam guardados no prontuário (Res. CFMV nº 1.321/2020).</p>
              )}
              {a.status !== "cancelado" ? <EnvioAnexo empresaId={empresaId} atendimentoId={a.id} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
