import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AtualizarAoVivo } from "@/components/tempo-real/atualizar-ao-vivo";
import { AcoesCliente, FormAndamentoEquipe } from "@/components/solicitacoes/solicitacoes";
import { EM_ABERTO, STATUS_SOLICITACAO } from "@/lib/solicitacoes/rotulos";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Solicitação" };
const UUID = /^[0-9a-f-]{36}$/i;

const DESCRICAO_EVENTO: Record<string, string> = {
  criada: "Solicitação aberta",
  status: "Situação alterada",
  responsavel: "Responsável definido",
  prazo: "Prazo definido",
  comentario: "Comentário",
};

export default async function PaginaSolicitacao({ params }: PageProps<"/e/[empresaId]/solicitacoes/[solicitacaoId]">) {
  const { empresaId, solicitacaoId } = await params;
  if (!UUID.test(solicitacaoId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) notFound();
  const { data: s } = await ctx.supabase
    .from("solicitacoes")
    .select("*, servico:servicos_catalogo(nome, documentos_necessarios), responsavel:perfis!solicitacoes_responsavel_id_fkey(nome), autor:perfis!solicitacoes_solicitado_por_fkey(nome)")
    .eq("id", solicitacaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!s) notFound();
  const [eventos, equipe] = await Promise.all([
    ctx.supabase
      .from("solicitacao_eventos")
      .select("id, tipo, status_anterior, status_novo, comentario, ocorrido_em, usuario:perfis!solicitacao_eventos_usuario_id_fkey(nome)")
      .eq("solicitacao_id", solicitacaoId)
      .order("ocorrido_em"),
    ctx.equipe ? ctx.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome") : Promise.resolve({ data: [] }),
  ]);
  const st = STATUS_SOLICITACAO[s.status];
  const servico = s.servico as unknown as { nome: string; documentos_necessarios: string | null } | null;
  const nome = (v: unknown) => (v as { nome: string } | null)?.nome ?? null;
  const atrasada = s.prazo && s.prazo < hojeISO() && EM_ABERTO.includes(s.status);

  return (
    <>
      <AtualizarAoVivo
        canal={`solicitacao-${solicitacaoId}`}
        assinaturas={[
          { tabela: "solicitacoes", filtro: `id=eq.${solicitacaoId}`, evento: "UPDATE" },
          { tabela: "solicitacao_eventos", filtro: `solicitacao_id=eq.${solicitacaoId}`, evento: "INSERT" },
        ]}
      />
      <CabecalhoPagina
        titulo={`#${s.numero} · ${s.titulo}`}
        descricao={servico?.nome}
        voltar={{ href: `/e/${empresaId}/solicitacoes`, rotulo: "Solicitações" }}
        acoes={
          s.conversa_id ? (
            <Button asChild variante="contorno">
              <Link href={`/e/${empresaId}/mensagens/${s.conversa_id}`}>
                <MessagesSquare /> Conversa e anexos
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Andamento</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l border-border pl-4">
                {(eventos.data ?? []).map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
                    <p className="text-sm">
                      <span className="font-medium">{DESCRICAO_EVENTO[e.tipo] ?? e.tipo}</span>
                      {e.tipo === "status" && e.status_novo ? `: ${STATUS_SOLICITACAO[e.status_novo]?.rotulo ?? e.status_novo}` : ""}
                      {(e.tipo === "responsavel" || e.tipo === "prazo") && e.comentario ? `: ${e.comentario}` : ""}
                    </p>
                    {e.comentario && e.tipo !== "responsavel" && e.tipo !== "prazo" ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{e.comentario}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {formatarDataHora(e.ocorrido_em)}
                      {nome(e.usuario) ? ` · ${nome(e.usuario)}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          {ctx.equipe ? (
            <Card>
              <CardHeader>
                <CardTitle>Atualizar</CardTitle>
              </CardHeader>
              <CardContent>
                <FormAndamentoEquipe
                  empresaId={empresaId}
                  solicitacaoId={solicitacaoId}
                  status={s.status}
                  responsavelId={s.responsavel_id}
                  prazo={s.prazo}
                  equipe={(equipe.data ?? []) as { id: string; nome: string }[]}
                />
              </CardContent>
            </Card>
          ) : (
            <AcoesCliente empresaId={empresaId} solicitacaoId={solicitacaoId} status={s.status} />
          )}
        </div>
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Situação</p>
              <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? s.status}</Badge>
              {s.prioridade === "urgente" ? <Badge variante="alerta" className="ml-1">Urgente</Badge> : null}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Prazo previsto</p>
              <p className={atrasada ? "text-perigo" : undefined}>{s.prazo ? formatarData(s.prazo) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Responsável no escritório</p>
              <p>{nome(s.responsavel) ?? "A definir"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Aberta por</p>
              <p>
                {nome(s.autor) ?? "—"} em {formatarDataHora(s.created_at)}
              </p>
            </div>
            {s.descricao ? (
              <div>
                <p className="text-xs text-muted-foreground">Detalhes</p>
                <p className="whitespace-pre-wrap">{s.descricao}</p>
              </div>
            ) : null}
            {servico?.documentos_necessarios && EM_ABERTO.includes(s.status) ? (
              <div className="rounded-md bg-muted p-2 text-xs">
                <span className="font-medium">Costuma ser preciso:</span> {servico.documentos_necessarios}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
