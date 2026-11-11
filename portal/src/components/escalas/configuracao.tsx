"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, RefreshCw, Shuffle, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Label, Select } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { distribuirDeslocamentos } from "@/lib/escalas/gerador";
import { datasFacultativas, feriadosNacionais } from "@/lib/escalas/feriados";
import { descreverTurno, duracaoTrabalho, formatarHoras } from "@/lib/escalas/horas";
import { MODELOS, MODELO_POR_CHAVE } from "@/lib/escalas/modelos";
import { ATIVIDADES, CHAVES_MODELO, DIAS_CURTOS, ORDEM_SEMANA, ROTULO_ATIVIDADE, type ConfigEscala, type Pessoa, type Turno } from "@/lib/escalas/tipos";
import { corDoTurno } from "./codigos";

export interface FuncionarioCadastro {
  id: string;
  nome: string;
  cargo: string | null;
  jornada_semanal: number;
  nao_trabalha: number[];
  domingo_quinzenal: boolean;
  menor_idade: boolean;
  ativo: boolean;
}

type Mudar = (f: (c: ConfigEscala) => ConfigEscala) => void;

const RISCO = { baixo: null, medio: { texto: "Pede documento", variante: "alerta" as const }, alto: { texto: "Risco alto", variante: "perigo" as const } };

function Dias({ valor, aoMudar, nome }: { valor: number[]; aoMudar: (v: number[]) => void; nome: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={nome}>
      {ORDEM_SEMANA.map((d) => {
        const ativo = valor.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={ativo}
            onClick={() => aoMudar(ativo ? valor.filter((x) => x !== d) : [...valor, d].sort())}
            className={cn("min-h-9 min-w-11 rounded-lg border px-2 text-xs", ativo ? "border-primary bg-secondary font-semibold text-secondary-foreground" : "border-border hover:bg-muted")}
          >
            {DIAS_CURTOS[d]}
          </button>
        );
      })}
    </div>
  );
}

function novaPessoa(f: FuncionarioCadastro, turno: string, i: number): Pessoa {
  return {
    id: f.id,
    nome: f.nome,
    cargo: f.cargo,
    jornadaSemanal: Number(f.jornada_semanal),
    naoTrabalha: f.nao_trabalha ?? [],
    domingoQuinzenal: f.domingo_quinzenal,
    menorIdade: f.menor_idade,
    modelo: "6x1",
    turnos: [turno],
    diasTrabalho: [1, 2, 3, 4, 5],
    folgasPreferidas: [],
    deslocamento: i % 60,
  };
}

/** Pessoas da escala: modelo, turno, dias e posição no ciclo de cada uma. */
export function ConfigPessoas({ config, mudar, funcionarios, empresaId }: { config: ConfigEscala; mudar: Mudar; funcionarios: FuncionarioCadastro[]; empresaId: string }) {
  const fora = funcionarios.filter((f) => f.ativo && !config.pessoas.some((p) => p.id === f.id));
  const [incluir, setIncluir] = React.useState("");
  const alterar = (id: string, parcial: Partial<Pessoa>) => mudar((c) => ({ ...c, pessoas: c.pessoas.map((p) => (p.id === id ? { ...p, ...parcial } : p)) }));
  const cadastro = new Map(funcionarios.map((f) => [f.id, f]));
  const desatualizadas = config.pessoas.filter((p) => {
    const f = cadastro.get(p.id);
    return (
      f &&
      (f.nome !== p.nome ||
        f.cargo !== p.cargo ||
        Number(f.jornada_semanal) !== p.jornadaSemanal ||
        f.domingo_quinzenal !== p.domingoQuinzenal ||
        f.menor_idade !== p.menorIdade ||
        [...(f.nao_trabalha ?? [])].sort().join() !== [...p.naoTrabalha].sort().join())
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {fora.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="incluir-pessoa">Incluir na escala</Label>
              <Select id="incluir-pessoa" value={incluir} onChange={(e) => setIncluir(e.target.value)} className="min-w-56">
                <option value="">Escolha um funcionário</option>
                {fora.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variante="contorno"
              disabled={!incluir}
              onClick={() => {
                const f = fora.find((x) => x.id === incluir);
                if (!f) return;
                mudar((c) => ({ ...c, pessoas: [...c.pessoas, novaPessoa(f, c.turnos[0].id, c.pessoas.length)] }));
                setIncluir("");
              }}
            >
              <Plus /> Incluir
            </Button>
          </div>
        ) : null}
        <Button variante="contorno" onClick={() => mudar((c) => ({ ...c, pessoas: distribuirDeslocamentos(c.pessoas) }))} title="Coloca cada pessoa numa posição diferente do ciclo, para as folgas caírem em dias diferentes">
          <Shuffle /> Espalhar folgas
        </Button>
        {desatualizadas.length ? (
          <Button
            variante="contorno"
            onClick={() =>
              mudar((c) => ({
                ...c,
                pessoas: c.pessoas.map((p) => {
                  const f = cadastro.get(p.id);
                  return f
                    ? { ...p, nome: f.nome, cargo: f.cargo, jornadaSemanal: Number(f.jornada_semanal), naoTrabalha: f.nao_trabalha ?? [], domingoQuinzenal: f.domingo_quinzenal, menorIdade: f.menor_idade }
                    : p;
                }),
              }))
            }
          >
            <RefreshCw /> Atualizar {desatualizadas.length} pessoa(s) com o cadastro
          </Button>
        ) : null}
        <Link href={`/e/${empresaId}/escalas/funcionarios`} className="ml-auto text-sm text-primary hover:underline">
          Cadastro de funcionários
        </Link>
      </div>

      {!config.pessoas.length ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma pessoa nesta escala. Cadastre os funcionários e inclua aqui.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {config.pessoas.map((p) => {
          const m = MODELO_POR_CHAVE[p.modelo];
          const risco = RISCO[m.risco];
          const turnosDaPessoa = p.turnos.map((id) => config.turnos.find((t) => t.id === id)).filter(Boolean) as Turno[];
          const horasSemana = turnosDaPessoa[0] ? duracaoTrabalho(turnosDaPessoa[0]) : 0;
          return (
            <Card key={p.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{p.nome}</CardTitle>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.cargo ? <Badge>{p.cargo}</Badge> : null}
                    <Badge variante="contorno">{formatarHoras(p.jornadaSemanal * 60)}/semana</Badge>
                    {p.naoTrabalha.length ? <Badge variante="info">Não trabalha: {p.naoTrabalha.map((d) => DIAS_CURTOS[d]).join(", ")}</Badge> : null}
                    {p.domingoQuinzenal ? <Badge variante="info">Domingo quinzenal</Badge> : null}
                    {p.menorIdade ? <Badge variante="alerta">Menor de idade</Badge> : null}
                  </div>
                </div>
                <Button
                  variante="fantasma"
                  tamanho="iconeSm"
                  aria-label={`Tirar ${p.nome} da escala`}
                  title="Tirar da escala"
                  onClick={() => mudar((c) => ({ ...c, pessoas: c.pessoas.filter((x) => x.id !== p.id) }))}
                >
                  <UserMinus />
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`modelo-${p.id}`}>Modelo de escala</Label>
                    <Select id={`modelo-${p.id}`} value={p.modelo} onChange={(e) => alterar(p.id, { modelo: e.target.value as Pessoa["modelo"] })}>
                      {CHAVES_MODELO.map((k) => (
                        <option key={k} value={k}>
                          {MODELO_POR_CHAVE[k].nome}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {p.modelo === "revezamento" ? (
                    <fieldset className="space-y-1.5">
                      <legend className="text-sm font-medium">Turnos do rodízio</legend>
                      <div className="flex flex-wrap gap-1.5">
                        {config.turnos.map((t) => (
                          <label key={t.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-2 text-xs">
                            <Checkbox
                              checked={p.turnos.includes(t.id)}
                              onChange={(e) => {
                                const nova = e.target.checked ? [...p.turnos, t.id] : p.turnos.filter((x) => x !== t.id);
                                if (nova.length && nova.length <= 4) alterar(p.id, { turnos: nova });
                              }}
                            />
                            {t.nome}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor={`turno-${p.id}`}>Turno</Label>
                      <Select id={`turno-${p.id}`} value={p.turnos[0]} onChange={(e) => alterar(p.id, { turnos: [e.target.value] })}>
                        {config.turnos.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nome} ({t.inicio}–{t.fim})
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {m.comoFunciona} {risco ? <Badge variante={risco.variante}>{risco.texto}</Badge> : null}
                </p>
                {turnosDaPessoa[0] ? (
                  <p className="text-xs text-muted-foreground">
                    {formatarHoras(horasSemana)} por dia no turno {turnosDaPessoa[0].nome}.
                  </p>
                ) : null}
                {p.modelo === "parcial" || p.modelo === "personalizada" ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Dias em que trabalha</p>
                    <Dias nome="Dias em que trabalha" valor={p.diasTrabalho} aoMudar={(v) => alterar(p.id, { diasTrabalho: v })} />
                  </div>
                ) : m.tipo === "semanal" ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Folga de preferência</p>
                    <Dias nome="Dias preferidos para folga" valor={p.folgasPreferidas} aoMudar={(v) => alterar(p.id, { folgasPreferidas: v })} />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={`desloc-${p.id}`}>Posição no ciclo</Label>
                  <Input
                    id={`desloc-${p.id}`}
                    type="number"
                    min={0}
                    max={60}
                    value={p.deslocamento}
                    onChange={(e) => alterar(p.id, { deslocamento: Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))) })}
                    className="h-9 w-20"
                  />
                  <span className="text-xs text-muted-foreground">Mude para a pessoa começar o ciclo (ou a vez do domingo) em outro dia.</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const proximoId = (turnos: Turno[]) => (["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"] as const).find((id) => !turnos.some((t) => t.id === id));

/** Turnos, funcionamento, cobertura mínima, regras e feriados. */
export function ConfigEmpresa({ config, mudar, competencia }: { config: ConfigEscala; mudar: Mudar; competencia: string }) {
  const alterarTurno = (id: string, parcial: Partial<Turno>) => mudar((c) => ({ ...c, turnos: c.turnos.map((t) => (t.id === id ? { ...t, ...parcial } : t)) }));
  const [novoFeriado, setNovoFeriado] = React.useState({ data: "", nome: "" });
  const sugestoes = [...feriadosNacionais(competencia), ...datasFacultativas(competencia)].filter((f) => !config.feriados.some((x) => x.data === f.data));
  const primeiroDia = competencia;
  const ultimoDia = new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7)), 0)).toISOString().slice(0, 10);

  return (
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Turnos</CardTitle>
          <CardDescription>Horários de trabalho. O intervalo não conta como hora trabalhada. Turno que passa da meia-noite: fim menor que o início.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {config.turnos.map((t) => {
            const usado = config.pessoas.some((p) => p.turnos.includes(t.id));
            return (
              <div key={t.id} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
                <span className="mb-2 inline-block size-3 rounded-full" style={{ backgroundColor: corDoTurno(config.turnos, t.id) }} aria-hidden />
                <div className="space-y-1.5">
                  <Label htmlFor={`tn-${t.id}`}>Nome</Label>
                  <Input id={`tn-${t.id}`} value={t.nome} maxLength={30} onChange={(e) => alterarTurno(t.id, { nome: e.target.value })} className="w-40" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`ti-${t.id}`}>Entrada</Label>
                  <Input id={`ti-${t.id}`} type="time" value={t.inicio} onChange={(e) => e.target.value && alterarTurno(t.id, { inicio: e.target.value })} className="w-32" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`tf-${t.id}`}>Saída</Label>
                  <Input id={`tf-${t.id}`} type="time" value={t.fim} onChange={(e) => e.target.value && alterarTurno(t.id, { fim: e.target.value })} className="w-32" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`tv-${t.id}`}>Intervalo (min)</Label>
                  <Input
                    id={`tv-${t.id}`}
                    type="number"
                    min={0}
                    max={240}
                    step={5}
                    value={t.intervaloMin}
                    onChange={(e) => alterarTurno(t.id, { intervaloMin: Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0))) })}
                    className="w-24"
                  />
                </div>
                <p className="mb-2 text-xs text-muted-foreground">{descreverTurno(t)}</p>
                <Button
                  variante="fantasma"
                  tamanho="iconeSm"
                  className="mb-1 ml-auto"
                  disabled={config.turnos.length <= 1 || usado}
                  title={usado ? "Há pessoas neste turno" : "Excluir turno"}
                  aria-label={`Excluir turno ${t.nome}`}
                  onClick={() => mudar((c) => ({ ...c, turnos: c.turnos.filter((x) => x.id !== t.id), cobertura: c.cobertura.filter((k) => k.turno !== t.id) }))}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <Button
            variante="contorno"
            disabled={!proximoId(config.turnos)}
            onClick={() =>
              mudar((c) => {
                const id = proximoId(c.turnos)!;
                return { ...c, turnos: [...c.turnos, { id, nome: `Turno ${id.slice(1)}`, inicio: "14:00", fim: "22:20", intervaloMin: 60 }], cobertura: [...c.cobertura, { turno: id, minimo: [0, 0, 0, 0, 0, 0, 0] }] };
              })
            }
          >
            <Plus /> Novo turno
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Funcionamento da empresa</CardTitle>
          <CardDescription>Nos dias fechados, todos folgam.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {ORDEM_SEMANA.map((d) => {
            const f = config.funcionamento[d];
            const mudarDia = (parcial: Partial<typeof f>) => mudar((c) => ({ ...c, funcionamento: c.funcionamento.map((x, i) => (i === d ? { ...x, ...parcial } : x)) }));
            return (
              <div key={d} className="flex flex-wrap items-center gap-2">
                <label className="inline-flex w-24 items-center gap-2 text-sm">
                  <Checkbox checked={f.aberto} onChange={(e) => mudarDia({ aberto: e.target.checked })} /> {DIAS_CURTOS[d]}
                </label>
                <Input type="time" aria-label={`Abre ${DIAS_CURTOS[d]}`} value={f.inicio} disabled={!f.aberto} onChange={(e) => e.target.value && mudarDia({ inicio: e.target.value })} className="h-9 w-32" />
                <span className="text-xs text-muted-foreground">às</span>
                <Input type="time" aria-label={`Fecha ${DIAS_CURTOS[d]}`} value={f.fim} disabled={!f.aberto} onChange={(e) => e.target.value && mudarDia({ fim: e.target.value })} className="h-9 w-32" />
                {!f.aberto ? <Badge>Fechado</Badge> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mínimo de pessoas por turno</CardTitle>
          <CardDescription>O gerador evita dar folga quando o turno ficaria abaixo do mínimo.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="pr-2 text-left font-medium">Turno</th>
                {ORDEM_SEMANA.map((d) => (
                  <th key={d} className="px-1 text-center text-xs font-medium">
                    {DIAS_CURTOS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.turnos.map((t) => {
                const k = config.cobertura.find((x) => x.turno === t.id) ?? { turno: t.id, minimo: [0, 0, 0, 0, 0, 0, 0] };
                return (
                  <tr key={t.id}>
                    <th scope="row" className="pr-2 text-left font-normal">
                      {t.nome}
                    </th>
                    {ORDEM_SEMANA.map((d) => (
                      <td key={d} className="p-0.5">
                        <Input
                          type="number"
                          min={0}
                          max={200}
                          aria-label={`Mínimo no turno ${t.nome}, ${DIAS_CURTOS[d]}`}
                          value={k.minimo[d]}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0)));
                            mudar((c) => {
                              const atual = c.cobertura.find((x) => x.turno === t.id) ?? { turno: t.id, minimo: [0, 0, 0, 0, 0, 0, 0] };
                              const novo = { ...atual, minimo: atual.minimo.map((m, i) => (i === d ? v : m)) };
                              return { ...c, cobertura: [...c.cobertura.filter((x) => x.turno !== t.id), novo] };
                            });
                          }}
                          className="h-9 w-14 px-2 text-center"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regras da empresa</CardTitle>
          <CardDescription>Marque só o que a convenção coletiva da categoria permite.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="atividade">Atividade</Label>
            <Select id="atividade" value={config.regras.atividade} onChange={(e) => mudar((c) => ({ ...c, regras: { ...c.regras, atividade: e.target.value as ConfigEscala["regras"]["atividade"] } }))}>
              {ATIVIDADES.map((a) => (
                <option key={a} value={a}>
                  {ROTULO_ATIVIDADE[a]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="domingo">Domingo de folga pelo menos a cada</Label>
            <Select
              id="domingo"
              value={String(config.regras.domingoACadaSemanas)}
              onChange={(e) => mudar((c) => ({ ...c, regras: { ...c.regras, domingoACadaSemanas: Number(e.target.value) === 7 ? 7 : 3 } }))}
            >
              <option value="3">3 semanas (comércio — Lei 10.101/2000; a Justiça do Trabalho aplica também a outras atividades)</option>
              <option value="7">7 semanas (atividade autorizada a abrir aos domingos — Portaria MTP 671/2021)</option>
            </Select>
          </div>
          {(
            [
              ["trabalhaFeriados", "A empresa abre nos feriados", "No comércio, depende de convenção coletiva. Desmarcado, todos folgam nos feriados."],
              ["intervaloReduzido", "Convenção coletiva permite intervalo de 30 minutos", "Sem isso, quem trabalha mais de 6 horas tem 1 hora de intervalo."],
              ["revezamento8h", "Negociação coletiva permite revezamento de 8 horas", "Sem isso, os turnos de revezamento são de 6 horas (Súmula 423 do TST)."],
            ] as const
          ).map(([chave, rotulo, ajuda]) => (
            <label key={chave} className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={config.regras[chave]} onChange={(e) => mudar((c) => ({ ...c, regras: { ...c.regras, [chave]: e.target.checked } }))} />
              <span>
                {rotulo}
                <span className="block text-xs text-muted-foreground">{ajuda}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feriados do mês</CardTitle>
          <CardDescription>Os nacionais já vêm marcados. Acrescente os do estado e do município.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-1">
            {config.feriados.map((f) => (
              <li key={f.data} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5">
                <span>
                  <span className="tabular-nums">{f.data.slice(8, 10)}/{f.data.slice(5, 7)}</span> — {f.nome}
                </span>
                <Button variante="fantasma" tamanho="iconeSm" aria-label={`Tirar ${f.nome}`} onClick={() => mudar((c) => ({ ...c, feriados: c.feriados.filter((x) => x.data !== f.data) }))}>
                  <Trash2 />
                </Button>
              </li>
            ))}
            {!config.feriados.length ? <li className="text-muted-foreground">Nenhum feriado neste mês.</li> : null}
          </ul>
          {sugestoes.length ? (
            <div className="flex flex-wrap gap-2">
              {sugestoes.map((f) => (
                <Button key={f.data} variante="contorno" tamanho="sm" onClick={() => mudar((c) => ({ ...c, feriados: [...c.feriados, f].sort((a, b) => a.data.localeCompare(b.data)) }))}>
                  <Plus /> {f.nome} ({f.data.slice(8, 10)}/{f.data.slice(5, 7)})
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="fer-data">Data</Label>
              <Input id="fer-data" type="date" min={primeiroDia} max={ultimoDia} value={novoFeriado.data} onChange={(e) => setNovoFeriado((v) => ({ ...v, data: e.target.value }))} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fer-nome">Nome</Label>
              <Input id="fer-nome" value={novoFeriado.nome} maxLength={80} placeholder="Ex.: Aniversário da cidade" onChange={(e) => setNovoFeriado((v) => ({ ...v, nome: e.target.value }))} className="w-56" />
            </div>
            <Button
              variante="contorno"
              disabled={!novoFeriado.data || novoFeriado.nome.trim().length < 2 || novoFeriado.data < primeiroDia || novoFeriado.data > ultimoDia || config.feriados.some((x) => x.data === novoFeriado.data)}
              onClick={() => {
                mudar((c) => ({ ...c, feriados: [...c.feriados, { data: novoFeriado.data, nome: novoFeriado.nome.trim() }].sort((a, b) => a.data.localeCompare(b.data)) }));
                setNovoFeriado({ data: "", nome: "" });
              }}
            >
              <Plus /> Acrescentar
            </Button>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground xl:col-span-2">
        Modelos disponíveis: {MODELOS.map((m) => m.nome).join(", ")}. Veja como funciona cada um em{" "}
        <span className="font-medium">Modelos de escala</span>.
      </p>
    </div>
  );
}
