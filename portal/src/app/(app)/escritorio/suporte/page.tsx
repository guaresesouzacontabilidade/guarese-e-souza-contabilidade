import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { BotaoAcao } from "@/components/ui/acao";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { parametro } from "@/lib/busca";
import { formatarDataHora } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";
import { tratarDuvidaSuporte } from "@/lib/suporte/acoes";

export const metadata: Metadata = { title: "Dúvidas do suporte 24h" };

const PERIODOS = ["7", "30", "90"] as const;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const telaCurta = (t: string | null) => (t ?? "").replace(/^\/e\/:id/, "") || "/";

/**
 * O que os clientes perguntam ao suporte 24h: quanto o guia responde, o que foi
 * útil e as dúvidas sem resposta (ou marcadas "não ajudou") para completar o guia.
 * O texto só existe nessas dúvidas, com os números mascarados, e some em 180 dias.
 */
export default async function DuvidasSuporte({ searchParams }: PageProps<"/escritorio/suporte">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const dias = Number(parametro(sp, "dias", [...PERIODOS]) || "30");
  const situacao = parametro(sp, "situacao", ["pendentes", "tratadas", "todas"]) || "pendentes";
  const desde = new Date(new Date().getTime() - dias * 86400_000).toISOString();

  const [{ data: registros, error }, { data: duvidas }] = await Promise.all([
    s.supabase.from("suporte_perguntas").select("modo, achou, util, tela, trechos, equipe").gte("created_at", desde).limit(20000),
    (() => {
      let q = s.supabase
        .from("suporte_perguntas")
        .select("id, created_at, pergunta, achou, util, tela, equipe, tratada_em, empresa:empresas(razao_social, nome_fantasia)")
        .not("pergunta", "is", null)
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(300);
      if (situacao === "pendentes") q = q.is("tratada_em", null);
      if (situacao === "tratadas") q = q.not("tratada_em", "is", null);
      return q;
    })(),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar: {mensagemErro(error)}</Alerta>;

  const lista = registros ?? [];
  const achou = lista.filter((r) => r.achou).length;
  const uteis = lista.filter((r) => r.util === true).length;
  const naoUteis = lista.filter((r) => r.util === false).length;
  const ia = lista.filter((r) => r.modo === "ia").length;
  const porTela = new Map<string, { total: number; achou: number }>();
  for (const r of lista) {
    const t = telaCurta(r.tela);
    const v = porTela.get(t) ?? { total: 0, achou: 0 };
    v.total++;
    if (r.achou) v.achou++;
    porTela.set(t, v);
  }
  const porTrecho = new Map<string, number>();
  for (const r of lista) for (const t of r.trechos ?? []) porTrecho.set(t, (porTrecho.get(t) ?? 0) + 1);
  const topTelas = [...porTela.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const topTrechos = [...porTrecho.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const link = (q: Record<string, string>) => `/escritorio/suporte?${new URLSearchParams({ dias: String(dias), situacao, ...q })}`;

  return (
    <>
      <CabecalhoPagina
        titulo="Dúvidas do suporte 24h"
        descricao="O que clientes e equipe perguntam no botão Ajuda, o que o guia respondeu e as dúvidas sem resposta para completar o guia."
        acoes={
          <div className="flex gap-1">
            {PERIODOS.map((p) => (
              <Link key={p} href={link({ dias: p })} className={`rounded-lg border px-3 py-1.5 text-sm ${String(dias) === p ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                {p} dias
              </Link>
            ))}
          </div>
        }
      />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="suporte-indicadores">
          <Indicador rotulo="Perguntas" valor={lista.length} detalhe={`${ia} respondida(s) pela IA`} />
          <Indicador rotulo="O guia respondeu" valor={pct(achou, lista.length)} detalhe={`${lista.length - achou} sem resposta`} tom={lista.length && achou / lista.length < 0.7 ? "alerta" : "sucesso"} />
          <Indicador rotulo="Ajudou" valor={pct(uteis, uteis + naoUteis)} detalhe={`${uteis} sim · ${naoUteis} não`} />
          <Indicador rotulo="Para tratar" valor={(duvidas ?? []).filter((d) => !d.tratada_em).length} detalhe="dúvidas sem resposta ou que não ajudaram" tom="alerta" />
        </div>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Dúvidas para completar o guia</CardTitle>
              <CardDescription>O texto aparece só aqui, com os números mascarados, e é apagado em 180 dias. Depois de completar o guia, marque como tratada.</CardDescription>
            </div>
            <div className="flex gap-1 text-sm">
              {(["pendentes", "tratadas", "todas"] as const).map((v) => (
                <Link key={v} href={link({ situacao: v })} className={`rounded-lg border px-2.5 py-1 ${situacao === v ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                  {v === "pendentes" ? "Para tratar" : v === "tratadas" ? "Tratadas" : "Todas"}
                </Link>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {(duvidas ?? []).length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Dúvida</Th>
                    <Th>Por quê</Th>
                    <Th>Tela</Th>
                    <Th>Quando</Th>
                    <Th />
                  </Tr>
                </THead>
                <TBody>
                  {(duvidas ?? []).map((d) => {
                    const e = d.empresa as unknown as { razao_social: string; nome_fantasia: string | null } | null;
                    return (
                      <Tr key={d.id} data-testid="duvida-suporte">
                        <Td className="max-w-md">
                          <p className="whitespace-pre-wrap">{d.pergunta}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.equipe ? "Equipe do escritório" : (e?.nome_fantasia ?? e?.razao_social ?? "Cliente")}
                          </p>
                        </Td>
                        <Td>{!d.achou ? <Badge variante="alerta">Sem resposta no guia</Badge> : <Badge variante="perigo">Não ajudou</Badge>}</Td>
                        <Td className="text-xs text-muted-foreground">{telaCurta(d.tela)}</Td>
                        <Td className="whitespace-nowrap text-xs">{formatarDataHora(d.created_at)}</Td>
                        <Td className="text-right">
                          <BotaoAcao tamanho="sm" variante={d.tratada_em ? "fantasma" : "contorno"} acao={tratarDuvidaSuporte.bind(null, d.id, !d.tratada_em)}>
                            {d.tratada_em ? "Reabrir" : "Tratada"}
                          </BotaoAcao>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <EstadoVazio icone={LifeBuoy} titulo={situacao === "pendentes" ? "Nenhuma dúvida para tratar" : "Nenhuma dúvida no período"} />
            )}
          </CardContent>
        </Card>

        {lista.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Telas com mais perguntas</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <Tr>
                      <Th>Tela</Th>
                      <Th className="text-right">Perguntas</Th>
                      <Th className="text-right">Guia respondeu</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {topTelas.map(([t, v]) => (
                      <Tr key={t}>
                        <Td className="text-xs">{t}</Td>
                        <Td className="text-right">{v.total}</Td>
                        <Td className="text-right">{pct(v.achou, v.total)}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Partes do guia mais usadas</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {topTrechos.map(([t, n]) => (
                    <li key={t} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{t}</span>
                      <span className="shrink-0 text-muted-foreground">{n}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
