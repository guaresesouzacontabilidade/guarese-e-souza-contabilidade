import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, CalendarPlus, ListTodo } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { BotaoAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import {
  ConfigurarObrigacao,
  FormCadastroOperacional,
  HistoricoRegimes,
  RemoverConfiguracao,
  type ConfigObrigacao,
  type PeriodoRegime,
} from "@/components/obrigacoes/empresa";
import { parametro } from "@/lib/busca";
import { competenciaAtual, lerCompetencia, listaCompetencias } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDocumento } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { gerarTarefas } from "@/lib/obrigacoes/acoes";
import { ESFERAS, ETAPAS, MODOS_CONFIG, SITUACAO_CALENDARIO, STATUS_TAREFA } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Calendário da empresa" };

const APLICAVEIS = new Set(["aplica", "sem_prazo", "falta_cadastro", "aguardando_validacao", "sem_regra"]);

export default async function EmpresaOperacional({ params, searchParams }: PageProps<"/escritorio/obrigacoes/empresas/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await exigirEquipe();
  const atual = competenciaAtual();
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? atual;

  const { data: empresa } = await s.supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia, documento, regime_tributario, uf, cidade, municipio_ibge, contribuinte_icms, contribuinte_iss, tem_empregados, tem_pro_labore, contador_responsavel_id, ativa")
    .eq("id", id)
    .maybeSingle();
  if (!empresa) notFound();

  const [{ data: periodos }, calendario, { data: configs }, { data: equipe }, { data: tarefas }, { data: municipios }, { data: municipio }] = await Promise.all([
    s.supabase.from("empresa_regimes").select("id, regime, inicio, fim, lucro_real_apuracao, observacao").eq("empresa_id", id).order("inicio", { ascending: false }),
    s.supabase.rpc("calendario_empresa", { p_empresa_id: id, p_competencia: comp }),
    s.supabase.from("empresa_obrigacoes").select("*").eq("empresa_id", id).order("vigencia_inicio", { ascending: false }),
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    s.supabase.from("tarefas").select("id, obrigacao_id, etapa, status").eq("empresa_id", id).eq("competencia", comp),
    empresa.uf ? s.supabase.from("municipios").select("ibge, nome").eq("uf", empresa.uf).order("nome") : Promise.resolve({ data: [] }),
    empresa.municipio_ibge ? s.supabase.from("municipios").select("nome, uf").eq("ibge", empresa.municipio_ibge).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  if (calendario.error) {
    return <Alerta tom="perigo">Você não tem acesso ao calendário desta empresa. Peça ao administrador para vincular você à empresa.</Alerta>;
  }
  const nomes = new Map((equipe ?? []).map((p) => [p.id, p.nome]));
  const linhas = [...(calendario.data ?? [])].sort(
    (a, b) => (SITUACAO_CALENDARIO[a.situacao]?.ordem ?? 99) - (SITUACAO_CALENDARIO[b.situacao]?.ordem ?? 99) || a.nome.localeCompare(b.nome, "pt-BR"),
  );
  const aplicaveis = linhas.filter((l) => APLICAVEIS.has(l.situacao));
  const outras = linhas.filter((l) => !APLICAVEIS.has(l.situacao));
  const obrigacoes = linhas.map((l) => ({ id: l.obrigacao_id, nome: l.nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const nomeObrigacao = new Map(obrigacoes.map((o) => [o.id, o.nome]));
  const configsLista = (configs ?? []) as ConfigObrigacao[];
  const tarefasPorObrigacao = new Map<string, { id: string; etapa: string; status: string }[]>();
  for (const t of tarefas ?? []) tarefasPorObrigacao.set(t.obrigacao_id, [...(tarefasPorObrigacao.get(t.obrigacao_id) ?? []), t]);
  const alertas = aplicaveis.filter((l) => l.situacao === "sem_regra" || l.situacao === "aguardando_validacao" || l.situacao === "falta_cadastro").length;

  const linhaCalendario = (l: (typeof linhas)[number]) => {
    const sit = SITUACAO_CALENDARIO[l.situacao] ?? { rotulo: l.situacao, tom: "neutro" as const };
    const doMes = (tarefasPorObrigacao.get(l.obrigacao_id) ?? []).sort((a, b) => Object.keys(ETAPAS).indexOf(a.etapa) - Object.keys(ETAPAS).indexOf(b.etapa));
    const config = configsLista.find((c) => c.id === l.config_id) ?? null;
    return (
      <Tr key={l.obrigacao_id}>
        <Td className="min-w-[14rem] max-w-[22rem]">
          <p className="font-medium">{l.nome}</p>
          <p className="text-xs text-muted-foreground">
            {ESFERAS[l.esfera] ?? l.esfera} · {l.periodicidade}
            {l.tributos?.length ? ` · ${l.tributos.join(", ")}` : ""}
          </p>
        </Td>
        <Td className="min-w-[14rem] max-w-[24rem]">
          <Badge variante={sit.tom}>{sit.rotulo}</Badge>
          {l.modo !== "automatico" ? (
            <Badge variante={MODOS_CONFIG[l.modo]?.tom ?? "neutro"} className="ml-1">
              {l.modo === "incluida" ? "incluída" : "excluída"}
            </Badge>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground">{l.motivo}</p>
          {l.fonte ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fonte:{" "}
              {l.fonte_url ? (
                <a href={l.fonte_url} target="_blank" rel="noreferrer" className="underline">
                  {l.fonte}
                </a>
              ) : (
                l.fonte
              )}
            </p>
          ) : null}
        </Td>
        <Td className="whitespace-nowrap text-sm">
          {l.prazo_entrega ? <p>Entrega: {formatarData(l.prazo_entrega)}</p> : null}
          {l.prazo_pagamento ? <p>Pagamento: {formatarData(l.prazo_pagamento)}</p> : null}
          {!l.prazo_entrega && !l.prazo_pagamento ? <span className="text-muted-foreground">—</span> : null}
        </Td>
        <Td>
          {doMes.length ? (
            <ul className="space-y-1">
              {doMes.map((t) => (
                <li key={t.id}>
                  <Link href={`/escritorio/obrigacoes/tarefas/${t.id}`} className="inline-flex items-center gap-1.5 text-xs hover:underline">
                    <span className="text-muted-foreground">{ETAPAS[t.etapa]?.rotulo}:</span>
                    <Badge variante={STATUS_TAREFA[t.status]?.tom ?? "neutro"}>{STATUS_TAREFA[t.status]?.rotulo ?? t.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-muted-foreground">{l.situacao === "aplica" ? "não geradas" : "—"}</span>
          )}
        </Td>
        <Td className="hidden text-sm xl:table-cell">
          <p>{l.responsavel_id ? nomes.get(l.responsavel_id) ?? "—" : "—"}</p>
          {l.revisor_id ? <p className="text-xs text-muted-foreground">Revisão: {nomes.get(l.revisor_id) ?? "—"}</p> : null}
        </Td>
        <Td className="text-right">
          <div className="flex justify-end gap-1">
            <ConfigurarObrigacao
              empresaId={id}
              obrigacoes={obrigacoes}
              equipe={equipe ?? []}
              config={config}
              obrigacaoId={l.obrigacao_id}
              competencia={comp}
              rotulo={config ? "Editar" : "Configurar"}
            />
            {config ? <RemoverConfiguracao configId={config.id} empresaId={id} /> : null}
          </div>
        </Td>
      </Tr>
    );
  };

  const cabecalhoTabela = (
    <THead>
      <tr>
        <Th>Obrigação</Th>
        <Th>Situação na competência</Th>
        <Th>Prazos legais</Th>
        <Th>Tarefas</Th>
        <Th className="hidden xl:table-cell">Responsáveis</Th>
        <Th className="w-28" />
      </tr>
    </THead>
  );

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: "/escritorio/obrigacoes/empresas", rotulo: "Tabela operacional" }}
        titulo={empresa.razao_social}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {empresa.nome_fantasia ? <span>{empresa.nome_fantasia} ·</span> : null}
            {formatarDocumento(empresa.documento)}
            <Badge variante="primario">{REGIMES[empresa.regime_tributario] ?? empresa.regime_tributario}</Badge>
            {municipio ? <Badge variante="contorno">{`${municipio.nome}/${municipio.uf}`}</Badge> : <Badge variante="alerta">Município não identificado</Badge>}
          </span>
        }
        acoes={
          <>
            <Button variante="contorno" asChild>
              <Link href={`/escritorio/obrigacoes/tarefas?empresa=${id}`}>
                <ListTodo /> Tarefas da empresa
              </Link>
            </Button>
            <Button variante="fantasma" asChild>
              <Link href={`/escritorio/empresas/${id}`}>
                Cadastro completo <ArrowUpRight />
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Cadastro operacional</CardTitle>
            <CardDescription>Local e características que definem quais obrigações se aplicam.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormCadastroOperacional
              empresaId={id}
              inicial={{
                uf: municipio?.uf ?? empresa.uf,
                municipio_ibge: empresa.municipio_ibge,
                contribuinte_icms: empresa.contribuinte_icms,
                contribuinte_iss: empresa.contribuinte_iss,
                tem_empregados: empresa.tem_empregados,
                tem_pro_labore: empresa.tem_pro_labore,
              }}
              municipiosIniciais={municipios ?? []}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Regimes tributários</CardTitle>
            <CardDescription>Histórico por competência (Simples Nacional, Lucro Presumido, Lucro Real e Lucro Arbitrado, entre outros).</CardDescription>
          </CardHeader>
          <CardContent>
            <HistoricoRegimes empresaId={id} periodos={(periodos ?? []) as PeriodoRegime[]} competenciaAtual={atual} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Calendário de obrigações — {formatarCompetencia(comp, true)}</CardTitle>
            <CardDescription>O que se aplica nesta competência, por quê, com qual fonte e em que data. Nenhum prazo é presumido sem regra validada.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex items-center gap-2">
              <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Competência" className="w-48">
                {listaCompetencias(18, 6).map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </Select>
              <Button type="submit" variante="contorno" tamanho="sm">
                Ver
              </Button>
            </form>
            <BotaoAcao tamanho="sm" acao={gerarTarefas.bind(null, comp.slice(0, 7), id)}>
              <CalendarPlus /> Gerar tarefas
            </BotaoAcao>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {alertas ? (
            <Alerta tom="alerta" titulo={`${alertas} obrigação(ões) sem data definida`}>
              Valide as regras propostas em Atualizações normativas ou cadastre a regra do estado/município com a fonte oficial. Até lá, nenhuma data é presumida.
            </Alerta>
          ) : null}
          <Table>
            {cabecalhoTabela}
            <TBody>{aplicaveis.map(linhaCalendario)}</TBody>
          </Table>
          {outras.length ? (
            <details className="group rounded-lg border border-border">
              <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                Obrigações que não se aplicam nesta competência ({outras.length})
              </summary>
              <div className="border-t border-border p-2">
                <Table>
                  {cabecalhoTabela}
                  <TBody>{outras.map(linhaCalendario)}</TBody>
                </Table>
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {configsLista.length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Configurações por vigência</CardTitle>
            <CardDescription>Inclusões, exclusões, responsáveis e prazos internos próprios desta empresa.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <tr>
                  <Th>Obrigação</Th>
                  <Th>Aplicação</Th>
                  <Th>Vigência</Th>
                  <Th className="hidden md:table-cell">Responsáveis</Th>
                  <Th className="hidden lg:table-cell">Motivo</Th>
                  <Th className="w-28" />
                </tr>
              </THead>
              <TBody>
                {configsLista.map((c) => (
                  <Tr key={c.id} className={cn(c.vigencia_fim && c.vigencia_fim < atual ? "opacity-60" : "")}>
                    <Td className="font-medium">{nomeObrigacao.get(c.obrigacao_id) ?? "—"}</Td>
                    <Td>
                      <Badge variante={MODOS_CONFIG[c.modo]?.tom ?? "neutro"}>{MODOS_CONFIG[c.modo]?.rotulo ?? c.modo}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">
                      {formatarCompetencia(c.vigencia_inicio)} a {c.vigencia_fim ? formatarCompetencia(c.vigencia_fim) : "em diante"}
                    </Td>
                    <Td className="hidden text-sm md:table-cell">
                      {c.responsavel_id ? nomes.get(c.responsavel_id) : "Contador da empresa"}
                      {c.revisor_id ? <span className="block text-xs text-muted-foreground">Revisão: {nomes.get(c.revisor_id)}</span> : null}
                      {c.prazo_interno_dias_uteis != null ? <span className="block text-xs text-muted-foreground">Prazo interno: {c.prazo_interno_dias_uteis} dia(s) útil(eis)</span> : null}
                    </Td>
                    <Td className="hidden max-w-xs text-sm text-muted-foreground lg:table-cell">{c.motivo ?? "—"}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <ConfigurarObrigacao empresaId={id} obrigacoes={obrigacoes} equipe={equipe ?? []} config={c} competencia={comp} rotulo="Editar" />
                        <RemoverConfiguracao configId={c.id} empresaId={id} />
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
