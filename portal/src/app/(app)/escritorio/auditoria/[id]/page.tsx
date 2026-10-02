import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAdmin } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarDataHora } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { ACOES_AUDITORIA, rotuloAcao, rotuloEntidade } from "@/lib/auditoria/rotulos";
import { compararDados, formatarValor, type CampoAlterado } from "@/lib/auditoria/diff";

export const metadata: Metadata = { title: "Registro de auditoria" };

const ROTULO_TIPO: Record<CampoAlterado["tipo"], { rotulo: string; tom: "sucesso" | "perigo" | "info" | "neutro" }> = {
  incluido: { rotulo: "Incluído", tom: "sucesso" },
  removido: { rotulo: "Removido", tom: "perigo" },
  alterado: { rotulo: "Alterado", tom: "info" },
  igual: { rotulo: "Sem mudança", tom: "neutro" },
};

function Valor({ v, destaque }: { v: unknown; destaque?: "antes" | "depois" }) {
  if (v === undefined) return <span className="text-muted-foreground">—</span>;
  const texto = formatarValor(v);
  return (
    <pre
      className={cn(
        "max-w-md whitespace-pre-wrap break-words rounded px-1.5 py-0.5 font-mono text-xs",
        destaque === "antes" && "bg-perigo-bg text-perigo-fg",
        destaque === "depois" && "bg-sucesso-bg text-sucesso-fg",
      )}
    >
      {texto}
    </pre>
  );
}

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/** Detalhe de um registro de auditoria: dados antes/depois, IP e navegador. */
export default async function DetalheAuditoria({ params }: PageProps<"/escritorio/auditoria/[id]">) {
  const { id } = await params;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const s = await exigirAdmin();
  const { data: r } = await s.supabase.from("auditoria").select("*").eq("id", Number(id)).maybeSingle();
  if (!r) notFound();

  const [{ data: perfil }, { data: empresa }] = await Promise.all([
    r.user_id ? s.supabase.from("perfis").select("nome, email, tipo").eq("id", r.user_id).maybeSingle() : Promise.resolve({ data: null }),
    r.empresa_id ? s.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("id", r.empresa_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const campos = compararDados(r.dados_antes, r.dados_depois);
  const mostrarAntes = r.dados_antes !== null;
  const mostrarDepois = r.dados_depois !== null;
  const tom = ACOES_AUDITORIA[r.acao]?.tom ?? "neutro";
  const rota = "/escritorio/auditoria";

  return (
    <>
      <CabecalhoPagina
        titulo={`${rotuloAcao(r.acao)} · ${rotuloEntidade(r.entidade)}`}
        descricao={`Registro nº ${r.id} · ${formatarDataHora(r.ocorrido_em)}`}
        voltar={{ href: rota, rotulo: "Auditoria" }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Item rotulo="Ação">
                <Badge variante={tom}>{rotuloAcao(r.acao)}</Badge>{" "}
                <span className="text-xs text-muted-foreground">({r.acao})</span>
              </Item>
              <Item rotulo="Entidade">
                {rotuloEntidade(r.entidade)} <span className="text-xs text-muted-foreground">({r.entidade})</span>
              </Item>
              <Item rotulo="Identificador do registro">
                {r.entidade_id ? (
                  <Link href={`${rota}?entidade=${encodeURIComponent(r.entidade)}&registro=${encodeURIComponent(r.entidade_id)}`} className="font-mono text-xs text-primary hover:underline">
                    {r.entidade_id}
                  </Link>
                ) : (
                  "—"
                )}
              </Item>
              <Item rotulo="Usuário">
                {r.user_id ? (
                  <>
                    <Link href={`${rota}?usuario=${r.user_id}`} className="text-primary hover:underline">
                      {perfil?.nome ?? "Usuário"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{r.user_email ?? perfil?.email ?? "e-mail removido"}</span>
                  </>
                ) : (
                  "Sistema (rotina automática ou processamento)"
                )}
              </Item>
              <Item rotulo="Empresa">
                {r.empresa_id ? (
                  empresa ? (
                    <Link href={`${rota}?empresa=${empresa.id}`} className="text-primary hover:underline">
                      {empresa.nome_fantasia ?? empresa.razao_social}
                    </Link>
                  ) : (
                    "Empresa removida"
                  )
                ) : (
                  "—"
                )}
              </Item>
              <Item rotulo="Data e hora">{formatarDataHora(r.ocorrido_em)}</Item>
              <Item rotulo="Endereço IP">{r.ip ?? "Não registrado"}</Item>
              <Item rotulo="Navegador (user agent)">
                <span className="text-xs">{r.user_agent ?? "Não registrado"}</span>
              </Item>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {campos.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Dados {mostrarAntes && mostrarDepois ? "antes e depois" : mostrarDepois ? "incluídos" : "excluídos"}</CardTitle>
                <CardDescription>
                  {mostrarAntes && mostrarDepois
                    ? "Somente os campos alterados são registrados."
                    : mostrarDepois
                      ? "Valores gravados na inclusão do registro."
                      : "Valores do registro no momento da exclusão."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <tr>
                      <Th>Campo</Th>
                      {mostrarAntes ? <Th>Antes</Th> : null}
                      {mostrarDepois ? <Th>Depois</Th> : null}
                      {mostrarAntes && mostrarDepois ? <Th className="hidden sm:table-cell">Mudança</Th> : null}
                    </tr>
                  </THead>
                  <TBody>
                    {campos.map((c) => (
                      <Tr key={c.campo}>
                        <Td className="align-top font-mono text-xs">{c.campo}</Td>
                        {mostrarAntes ? (
                          <Td className="align-top">
                            <Valor v={c.antes} destaque={mostrarDepois && c.tipo !== "igual" ? "antes" : undefined} />
                          </Td>
                        ) : null}
                        {mostrarDepois ? (
                          <Td className="align-top">
                            <Valor v={c.depois} destaque={mostrarAntes && c.tipo !== "igual" ? "depois" : undefined} />
                          </Td>
                        ) : null}
                        {mostrarAntes && mostrarDepois ? (
                          <Td className="hidden align-top sm:table-cell">
                            <Badge variante={ROTULO_TIPO[c.tipo].tom}>{ROTULO_TIPO[c.tipo].rotulo}</Badge>
                          </Td>
                        ) : null}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Alerta tom="info">Este evento não registra dados de antes e depois.</Alerta>
          )}

          {r.detalhes !== null ? (
            <Card>
              <CardHeader>
                <CardTitle>Detalhes do evento</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(r.detalhes, null, 2)}</pre>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
