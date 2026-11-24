import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, FileText, LineChart, Lock } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { AvisoSemProfissional, FisioIndisponivel, GraficoDor } from "@/components/fisioterapia/comuns";
import { DialogoAgendamento } from "@/components/fisioterapia/agenda";
import { DialogoPacote, DialogoPaciente, DialogoRecebimento } from "@/components/fisioterapia/cadastros";
import { BotoesProntuario, DialogoDocumento } from "@/components/fisioterapia/prontuario";
import { obterContextoFisio } from "@/lib/fisioterapia/contexto";
import { hojeClinica } from "@/lib/veterinaria/contexto";
import { diaLocal, horaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { ESTADOS_CIVIS, FORMAS_RECEBIMENTO, GENEROS, MOTIVOS_ALTA, STATUS_AGENDA, TIPOS_AGENDA, TIPOS_DOCUMENTO, idade } from "@/lib/fisioterapia/rotulos";
import { opcoesClinica } from "../../dados";

export const metadata: Metadata = { title: "Paciente" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Registro = {
  id: string;
  quando: string;
  tipo: "avaliacao" | "evolucao" | "documento";
  titulo: string;
  resumo: string;
  status: string;
  profissional: string;
};

export default async function PaginaPacienteFisio({ params }: PageProps<"/e/[empresaId]/fisioterapia/pacientes/[pacienteId]">) {
  const { empresaId, pacienteId } = await params;
  if (!UUID.test(pacienteId)) notFound();
  const ctx = await obterContextoFisio(empresaId);
  if (!ctx.recepcao) return <FisioIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const base = `/e/${empresaId}/fisioterapia`;
  const hoje = hojeClinica();
  const [{ data: p }, { data: pacotes }, { data: agenda }, { data: recebimentos }, opcoes] = await Promise.all([
    ctx.supabase.from("fisio_pacientes").select("*").eq("id", pacienteId).eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.rpc("fisio_pacotes_resumo", { p_empresa_id: empresaId, p_paciente_id: pacienteId }),
    ctx.supabase
      .from("fisio_agenda")
      .select("id, inicio, tipo, status, profissional:fisio_profissionais(nome)")
      .eq("paciente_id", pacienteId)
      .order("inicio", { ascending: false })
      .limit(60),
    ctx.supabase.from("fisio_recebimentos").select("id, data, descricao, forma, valor, cancelado_em").eq("paciente_id", pacienteId).order("data", { ascending: false }).limit(30),
    opcoesClinica(ctx, empresaId),
  ]);
  if (!p) notFound();

  // Prontuário: só o fisioterapeuta da clínica lê (o banco também bloqueia para os demais)
  let registros: Registro[] = [];
  let dor: { data: string; antes: number | null; depois: number | null }[] = [];
  let plano: string | null = null;
  let emAlta = false;
  if (ctx.profissional) {
    const [{ data: av }, { data: ev }, { data: docs }] = await Promise.all([
      ctx.supabase
        .from("fisio_avaliacoes")
        .select("id, numero, tipo, data_hora, status, queixa_principal, diagnostico, objetivos, condutas, dor_eva, profissional:fisio_profissionais(nome)")
        .eq("paciente_id", pacienteId)
        .order("data_hora", { ascending: false }),
      ctx.supabase
        .from("fisio_evolucoes")
        .select("id, numero, tipo, data_hora, status, subjetivo, analise, dor_antes, dor_depois, condutas, alta_motivo, profissional:fisio_profissionais(nome)")
        .eq("paciente_id", pacienteId)
        .order("data_hora", { ascending: false }),
      ctx.supabase.from("fisio_documentos").select("id, numero, tipo, titulo, emitido_em, cancelado_em, profissional:fisio_profissionais(nome)").eq("paciente_id", pacienteId).order("emitido_em", { ascending: false }),
    ]);
    const nome = (x: unknown) => (x as { nome?: string } | null)?.nome ?? "";
    registros = [
      ...(av ?? []).map((a) => ({
        id: a.id,
        quando: a.data_hora,
        tipo: "avaliacao" as const,
        titulo: `${a.tipo === "reavaliacao" ? "Reavaliação" : "Avaliação inicial"} nº ${a.numero}`,
        resumo: [a.queixa_principal, a.diagnostico ? `Diagnóstico: ${a.diagnostico}` : null, a.dor_eva !== null ? `Dor ${a.dor_eva}/10` : null].filter(Boolean).join(" · "),
        status: a.status,
        profissional: nome(a.profissional),
      })),
      ...(ev ?? []).map((e) => ({
        id: e.id,
        quando: e.data_hora,
        tipo: "evolucao" as const,
        titulo: e.tipo === "alta" ? `Alta nº ${e.numero}` : `Evolução nº ${e.numero}`,
        resumo:
          e.tipo === "alta"
            ? `${MOTIVOS_ALTA[e.alta_motivo ?? ""] ?? ""}${e.analise ? ` · ${e.analise}` : ""}`
            : [e.subjetivo, e.dor_antes !== null || e.dor_depois !== null ? `Dor ${e.dor_antes ?? "—"} → ${e.dor_depois ?? "—"}` : null, e.condutas.length ? e.condutas.join(", ") : null]
                .filter(Boolean)
                .join(" · "),
        status: e.status,
        profissional: nome(e.profissional),
      })),
      ...(docs ?? []).map((d) => ({
        id: d.id,
        quando: d.emitido_em,
        tipo: "documento" as const,
        titulo: `${TIPOS_DOCUMENTO[d.tipo]?.rotulo ?? d.titulo} nº ${d.numero}`,
        resumo: d.titulo,
        status: d.cancelado_em ? "cancelada" : "finalizada",
        profissional: nome(d.profissional),
      })),
    ].sort((a, b) => b.quando.localeCompare(a.quando));
    dor = (ev ?? [])
      .filter((e) => e.status === "finalizada" && e.tipo === "sessao")
      .map((e) => ({ data: diaLocal(e.data_hora), antes: e.dor_antes, depois: e.dor_depois }))
      .reverse();
    const ultimaAv = (av ?? []).find((a) => a.status === "finalizada");
    plano = ultimaAv ? [ultimaAv.objetivos, ultimaAv.condutas].filter(Boolean).join(" — ") : null;
    const ultimaAlta = (ev ?? []).find((e) => e.tipo === "alta" && e.status === "finalizada");
    emAlta = Boolean(ultimaAlta && (!ultimaAv || ultimaAlta.data_hora > ultimaAv.data_hora));
  }

  const i = idade(p.nascimento, hoje);
  const proximos = (agenda ?? []).filter((a) => a.inicio >= new Date().toISOString() && ["agendado", "confirmado"].includes(a.status)).reverse();
  const historico = (agenda ?? []).filter((a) => !proximos.includes(a)).slice(0, 15);
  const ativos = (pacotes ?? []).filter((k) => k.status === "ativo");
  const endereco = [p.logradouro, p.numero, p.complemento, p.bairro, p.cidade && p.uf ? `${p.cidade}/${p.uf}` : p.cidade].filter(Boolean).join(", ");

  return (
    <>
      <CabecalhoPagina
        titulo={p.nome_social || p.nome}
        descricao={[i !== null ? `${i} anos` : null, p.convenio || "particular", p.telefone ? formatarTelefone(p.telefone) : null].filter(Boolean).join(" · ")}
        voltar={{ href: `${base}/pacientes`, rotulo: "Pacientes" }}
        acoes={
          <div className="flex flex-wrap gap-2">
            <DialogoAgendamento
              empresaId={empresaId}
              profissionais={opcoes.profissionais}
              pacientes={opcoes.pacientes}
              pacienteId={p.id}
              dia={hoje}
              duracaoPadrao={50}
              rotulo="Agendar"
            />
            <DialogoPaciente
              empresaId={empresaId}
              paciente={{ ...p, aceita_whatsapp: p.aceita_whatsapp, consentimento_em: p.consentimento_em }}
            />
          </div>
        }
      />
      {!p.consentimento_em ? (
        <p className="mb-4 rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm">
          Falta registrar a autorização do paciente para o uso dos dados de saúde (LGPD). Peça a autorização e marque no cadastro.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="size-5" /> Prontuário
                  {emAlta ? <Badge variante="sucesso">Em alta</Badge> : null}
                </CardTitle>
                <CardDescription>Avaliação, evolução de cada sessão, alta e documentos — com o nome e o CREFITO de quem atendeu.</CardDescription>
              </div>
              {ctx.profissional ? (
                <div className="flex flex-wrap gap-2">
                  <BotoesProntuario empresaId={empresaId} pacienteId={p.id} temAvaliacao={registros.some((r) => r.tipo === "avaliacao" && r.status === "finalizada")} />
                  <DialogoDocumento empresaId={empresaId} pacienteId={p.id} paciente={p.nome} hoje={hoje} hora={horaLocal(new Date().toISOString())} />
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {!ctx.profissional ? (
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Lock className="size-4" /> Prontuário sigiloso: só os fisioterapeutas da clínica leem.
                  </p>
                  <AvisoSemProfissional gerente={ctx.gerente} empresaId={empresaId} />
                </div>
              ) : registros.length ? (
                <ol className="space-y-3">
                  {registros.map((r) => (
                    <li key={`${r.tipo}-${r.id}`} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`${base}/${r.tipo === "avaliacao" ? "avaliacoes" : r.tipo === "evolucao" ? "evolucoes" : "documentos"}/${r.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.titulo}
                        </Link>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {formatarData(diaLocal(r.quando))} {horaLocal(r.quando)} · {r.profissional}
                          {r.status === "aberta" ? <Badge variante="alerta">Rascunho</Badge> : r.status === "cancelada" ? <Badge>Cancelado</Badge> : null}
                        </span>
                      </div>
                      {r.resumo ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.resumo}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <EstadoVazio icone={FileText} titulo="Prontuário vazio" descricao="Comece pela avaliação inicial." />
              )}
            </CardContent>
          </Card>

          {ctx.profissional ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LineChart className="size-5" /> Evolução da dor
                </CardTitle>
                {plano ? <CardDescription>Plano terapêutico: {plano}</CardDescription> : null}
              </CardHeader>
              <CardContent>
                <GraficoDor pontos={dor} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Horários</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <h3 className="mb-1 font-medium">Próximos</h3>
                {proximos.length ? (
                  <ul className="space-y-1">
                    {proximos.map((a) => (
                      <li key={a.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          {formatarData(diaLocal(a.inicio))} {horaLocal(a.inicio)} · {TIPOS_AGENDA[a.tipo] ?? a.tipo} · {(a.profissional as unknown as { nome: string } | null)?.nome ?? ""}
                        </span>
                        <Badge variante={STATUS_AGENDA[a.status]?.tom ?? "neutro"}>{STATUS_AGENDA[a.status]?.rotulo ?? a.status}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Nenhum horário marcado.</p>
                )}
              </div>
              {historico.length ? (
                <div>
                  <h3 className="mb-1 font-medium">Anteriores</h3>
                  <ul className="space-y-1">
                    {historico.map((a) => (
                      <li key={a.id} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                        <span>
                          {formatarData(diaLocal(a.inicio))} {horaLocal(a.inicio)} · {TIPOS_AGENDA[a.tipo] ?? a.tipo}
                        </span>
                        <Badge variante={STATUS_AGENDA[a.status]?.tom ?? "neutro"}>{STATUS_AGENDA[a.status]?.rotulo ?? a.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Pacotes</CardTitle>
              <DialogoPacote empresaId={empresaId} pacienteId={p.id} hoje={hoje} />
            </CardHeader>
            <CardContent className="space-y-3">
              {(pacotes ?? []).length ? (
                (pacotes ?? []).map((k) => {
                  const falta = Math.max(Number(k.valor_total) - Number(k.recebido), 0);
                  return (
                    <div key={k.id} className={`rounded-lg border border-border p-3 text-sm ${k.status !== "ativo" ? "opacity-60" : ""}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{k.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            {k.convenio ? `${k.convenio}${k.guia ? ` · guia ${k.guia}` : ""}` : "Particular"} · desde {formatarData(k.inicio)}
                            {k.validade ? ` · vale até ${formatarData(k.validade)}` : ""}
                          </p>
                        </div>
                        <DialogoPacote
                          empresaId={empresaId}
                          pacienteId={p.id}
                          hoje={hoje}
                          pacote={{ id: k.id, descricao: k.descricao, sessoes: k.sessoes, valor_total: Number(k.valor_total), inicio: k.inicio, validade: k.validade, convenio: k.convenio, guia: k.guia, status: k.status }}
                        />
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full bg-primary" style={{ width: `${Math.min((k.usadas * 100) / k.sessoes, 100)}%` }} />
                      </div>
                      <p className="mt-1 text-xs">
                        <span className="numero font-medium">
                          {k.usadas} de {k.sessoes}
                        </span>{" "}
                        sessões usadas · {k.agendadas} agendada(s)
                      </p>
                      {Number(k.valor_total) > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {formatarMoeda(k.valor_total)} · recebido {formatarMoeda(k.recebido)}
                          {falta > 0 ? ` · falta ${formatarMoeda(falta)}` : " · quitado"}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum pacote. Sessões avulsas usam o valor da sessão da clínica.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>Recebimentos</CardTitle>
              <DialogoRecebimento
                empresaId={empresaId}
                pacientes={opcoes.pacientes}
                pacienteId={p.id}
                rotulo="Receber"
                pacotes={ativos.map((k) => ({ id: k.id, descricao: k.descricao, falta: Math.max(Number(k.valor_total) - Number(k.recebido), 0) }))}
              />
            </CardHeader>
            <CardContent>
              {recebimentos?.length ? (
                <ul className="space-y-1 text-sm">
                  {recebimentos.map((r) => (
                    <li key={r.id} className={`flex justify-between gap-2 ${r.cancelado_em ? "line-through opacity-60" : ""}`}>
                      <span className="min-w-0 truncate">
                        {formatarData(r.data)} · {r.descricao} · {FORMAS_RECEBIMENTO[r.forma] ?? r.forma}
                      </span>
                      <span className="numero shrink-0">{formatarMoeda(r.valor)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum recebimento.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Identificação</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <Item rotulo="Nome completo" valor={p.nome} />
                <Item rotulo="CPF" valor={p.cpf ? formatarDocumento(p.cpf) : null} />
                <Item rotulo="Nascimento" valor={p.nascimento ? `${formatarData(p.nascimento)}${i !== null ? ` (${i} anos)` : ""}` : null} />
                <Item rotulo="Gênero" valor={p.genero ? GENEROS[p.genero] : null} />
                <Item rotulo="Estado civil" valor={p.estado_civil ? ESTADOS_CIVIS[p.estado_civil] : null} />
                <Item rotulo="Naturalidade" valor={p.naturalidade} />
                <Item rotulo="Profissão" valor={p.profissao} />
                <Item rotulo="Endereço" valor={endereco || null} />
                <Item rotulo="E-mail" valor={p.email} />
                <Item rotulo="Responsável" valor={p.responsavel} />
                <Item rotulo="Emergência" valor={p.contato_emergencia} />
                <Item rotulo="Convênio" valor={p.convenio ? `${p.convenio}${p.carteirinha ? ` · carteirinha ${p.carteirinha}` : ""}` : "Particular"} />
                <Item rotulo="Médico que encaminhou" valor={p.medico_encaminhador} />
                <Item rotulo="Consentimento LGPD" valor={p.consentimento_em ? `registrado em ${formatarData(diaLocal(p.consentimento_em))}` : "não registrado"} />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-words">{valor || "—"}</dd>
    </div>
  );
}
