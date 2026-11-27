import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Pencil, Scale } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { AcoesNorma, ValidarEmLote } from "@/components/obrigacoes/catalogo";
import { parametro } from "@/lib/busca";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { descreverAplicabilidade, descreverPrazo, type RegraObrigacao } from "@/lib/obrigacoes/regras";
import { ETAPAS, STATUS_NORMA, TIPO_NORMA } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Atualizações normativas" };

const ABAS = [
  { valor: "proposta", rotulo: "Aguardando validação" },
  { valor: "validada", rotulo: "Validadas — falta aplicar" },
  { valor: "aplicada", rotulo: "Aplicadas" },
  { valor: "rejeitada", rotulo: "Rejeitadas" },
] as const;

export default async function Normas({ searchParams }: PageProps<"/escritorio/obrigacoes/normas">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const status = parametro(sp, "status", ABAS.map((a) => a.valor)) || "proposta";
  const admin = s.perfil.tipo === "admin";

  const [{ data: normas }, contagens] = await Promise.all([
    s.supabase
      .from("atualizacoes_normativas")
      .select(
        "*, obrigacao:obrigacoes(id, nome, periodicidade), proposta:obrigacao_regras!atualizacoes_normativas_regra_proposta_id_fkey(*), anterior:obrigacao_regras!atualizacoes_normativas_regra_anterior_id_fkey(id, vigencia_inicio, fonte_titulo)",
      )
      .eq("status", status)
      .order(status === "aplicada" ? "aplicada_em" : "proposta_em", { ascending: false })
      .limit(200),
    Promise.all(ABAS.map((a) => s.supabase.from("atualizacoes_normativas").select("id", { count: "exact", head: true }).eq("status", a.valor))),
  ]);
  const autores = [...new Set((normas ?? []).flatMap((n) => [n.proposta_por, n.validada_por, n.aplicada_por, n.rejeitada_por]).filter(Boolean) as string[])];
  const { data: perfis } = autores.length ? await s.supabase.from("perfis").select("id, nome").in("id", autores) : { data: [] };
  const nome = new Map((perfis ?? []).map((p) => [p.id, p.nome]));
  const base = "/escritorio/obrigacoes/normas";

  return (
    <>
      <CabecalhoPagina
        titulo="Atualizações normativas"
        descricao="Mudanças nas regras entram como proposta, com a fonte oficial e a data da consulta. Um administrador confere a fonte, valida e aplica; só então os prazos mudam."
        acoes={admin && status === "proposta" ? <ValidarEmLote ids={(normas ?? []).map((n) => n.id)} /> : null}
      />
      <ol className="mb-5 grid gap-2 sm:grid-cols-3">
        {[
          { n: 1, t: "Proposta", d: "Qualquer pessoa da equipe registra a regra com fonte e data." },
          { n: 2, t: "Validação", d: "O administrador confere a norma na fonte oficial." },
          { n: 3, t: "Aplicação", d: "A regra passa a valer; tarefas abertas são recalculadas." },
        ].map((p) => (
          <li key={p.n} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{p.n}</span>
            <span>
              <span className="block text-sm font-semibold text-titulo">{p.t}</span>
              <span className="block text-xs text-muted-foreground">{p.d}</span>
            </span>
          </li>
        ))}
      </ol>
      <nav aria-label="Situação" className="-mx-3 mb-4 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1.5">
          {ABAS.map((a, i) => (
            <li key={a.valor}>
              <Link
                href={urlCom(base, {}, { status: a.valor === "proposta" ? null : a.valor })}
                aria-current={status === a.valor ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                  status === a.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {a.rotulo}
                <span className={cn("rounded-full px-1.5 text-xs font-semibold", status === a.valor ? "bg-primary-foreground/20" : "bg-muted")}>{contagens[i]?.count ?? 0}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {!admin && (status === "proposta" || status === "validada") ? (
        <Alerta tom="info" className="mb-4">
          Somente administradores validam e aplicam. Você pode registrar e corrigir propostas.
        </Alerta>
      ) : null}

      {(normas ?? []).length ? (
        <div className="space-y-3">
          {(normas ?? []).map((n) => {
            const o = n.obrigacao as unknown as { id: string; nome: string; periodicidade: string } | null;
            const r = n.proposta as unknown as RegraObrigacao | null;
            const ant = n.anterior as unknown as { id: string; vigencia_inicio: string; fonte_titulo: string } | null;
            const st = STATUS_NORMA[n.status] ?? { rotulo: n.status, tom: "neutro" as const };
            const resultado = n.resultado as { tarefas_recalculadas?: number; tarefas_geradas?: number } | null;
            return (
              <article id={`n-${n.id}`} key={n.id} className="scroll-mt-20 rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variante={st.tom}>{st.rotulo}</Badge>
                      <Badge variante="contorno">{TIPO_NORMA[n.tipo]}</Badge>
                      <span className="text-xs text-muted-foreground">vigência a partir de {formatarCompetencia(n.vigencia_inicio)}</span>
                    </div>
                    <h2 className="text-base font-semibold text-titulo">{n.titulo}</h2>
                    {o ? (
                      <Link href={`/escritorio/obrigacoes/catalogo/${o.id}`} className="text-sm text-primary hover:underline">
                        {o.nome}
                      </Link>
                    ) : null}
                    {n.resumo ? <p className="text-sm text-muted-foreground">{n.resumo}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {n.status === "proposta" && n.regra_proposta_id ? (
                      <Button asChild variante="fantasma" tamanho="sm">
                        <Link href={`${base}/${n.id}/editar`}>
                          <Pencil /> Corrigir
                        </Link>
                      </Button>
                    ) : null}
                    {admin ? <AcoesNorma id={n.id} status={n.status} fonteUrl={n.fonte_url} /> : null}
                  </div>
                </div>
                {r ? (
                  <div className="mt-3 grid gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2">
                    {r.prazo_entrega ? (
                      <p>
                        <span className="font-medium">{ETAPAS.entrega.prazo}:</span> {descreverPrazo(r.prazo_entrega, o?.periodicidade)}
                      </p>
                    ) : null}
                    {r.prazo_pagamento ? (
                      <p>
                        <span className="font-medium">{ETAPAS.pagamento.prazo}:</span> {descreverPrazo(r.prazo_pagamento, o?.periodicidade)}
                      </p>
                    ) : null}
                    {r.prazo_apuracao ? (
                      <p>
                        <span className="font-medium">Meta da apuração:</span> {descreverPrazo(r.prazo_apuracao, o?.periodicidade)}
                      </p>
                    ) : null}
                    {!r.prazo_entrega && !r.prazo_pagamento && !r.prazo_apuracao ? <p className="text-muted-foreground">Sem prazo definido (a regulamentar).</p> : null}
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      Aplica-se a: {descreverAplicabilidade(r)}
                      {r.vigencia_fim ? ` · até ${formatarCompetencia(r.vigencia_fim)}` : ""}
                      {r.municipios?.length || r.ufs?.length ? ` · ${r.municipios?.length ? "regra municipal" : `estado ${r.ufs?.join(", ")}`}` : ""}
                    </p>
                  </div>
                ) : null}
                {ant ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Substitui/encerra a regra vigente desde {formatarCompetencia(ant.vigencia_inicio)} ({ant.fonte_titulo}).
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Scale className="size-3.5" /> Fonte:{" "}
                    {n.fonte_url ? (
                      <a href={n.fonte_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground underline">
                        {n.fonte_titulo} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="font-medium text-foreground">{n.fonte_titulo}</span>
                    )}
                  </span>
                  {n.fonte_publicada_em ? <span>publicada em {formatarData(n.fonte_publicada_em)}</span> : null}
                  <span>consultada em {formatarData(n.fonte_consultada_em)}</span>
                  <span>proposta por {n.proposta_por ? nome.get(n.proposta_por) ?? "equipe" : "catálogo inicial do portal"} em {formatarDataHora(n.proposta_em)}</span>
                  {n.validada_em ? (
                    <span>
                      validada por {n.validada_por ? nome.get(n.validada_por) ?? "administrador" : "administrador"} em {formatarDataHora(n.validada_em)}
                      {n.validacao_observacao ? ` (“${n.validacao_observacao}”)` : ""}
                    </span>
                  ) : null}
                  {n.aplicada_em ? (
                    <span>
                      aplicada em {formatarDataHora(n.aplicada_em)}
                      {resultado ? ` · ${resultado.tarefas_geradas ?? 0} tarefa(s) gerada(s), ${resultado.tarefas_recalculadas ?? 0} recalculada(s)` : ""}
                    </span>
                  ) : null}
                  {n.rejeitada_em ? <span>rejeitada em {formatarDataHora(n.rejeitada_em)}: {n.motivo_rejeicao}</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EstadoVazio icone={Scale} titulo="Nada nesta situação" descricao={status === "proposta" ? "Nenhuma proposta aguardando validação." : undefined} />
      )}
    </>
  );
}
