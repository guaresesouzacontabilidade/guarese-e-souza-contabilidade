import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnviarDocumentos, type ItemPendente } from "@/components/documentos/enviar-documentos";
import { competenciaAtual, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { STATUS_CHECKLIST } from "@/lib/rotulos";

export const metadata: Metadata = { title: "Enviar documentos" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function PaginaEnviar({ params, searchParams }: PageProps<"/e/[empresaId]/enviar">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("documentos.enviar")) {
    return <Alerta tom="alerta">Seu acesso não permite enviar documentos desta empresa. Fale com o responsável da empresa ou com o escritório.</Alerta>;
  }
  const itemId = typeof sp.item === "string" && UUID.test(sp.item) ? sp.item : null;
  const atual = competenciaAtual();
  const padrao = somarMeses(atual, -1);

  const [{ data: categorias }, { data: itens }, { data: escritorio }] = await Promise.all([
    ctx.supabase.from("categorias_documento").select("codigo, nome, descricao, extensoes").eq("ativo", true).eq("escritorio", false).order("ordem"),
    ctx.supabase
      .from("checklist_itens")
      .select("id, titulo, categoria_codigo, competencia, status, prazo")
      .eq("empresa_id", empresaId)
      .gte("competencia", somarMeses(atual, -12))
      .order("prazo"),
    ctx.supabase.from("escritorio").select("upload_tamanho_maximo_mb").single(),
  ]);
  const todos = (itens ?? []) as ItemPendente[];
  const itemFixo = itemId ? todos.find((i) => i.id === itemId) ?? null : null;
  const categoriaInicial = typeof sp.categoria === "string" && (categorias ?? []).some((c) => c.codigo === sp.categoria) ? sp.categoria : undefined;
  const abertos = todos.filter((i) => !["concluido", "nao_se_aplica"].includes(i.status));
  const doMes = todos.filter((i) => i.competencia === padrao);

  return (
    <>
      <CabecalhoPagina
        titulo="Enviar documentos"
        descricao="Envie os documentos do mês. Você recebe a confirmação de recebimento na hora e acompanha a conferência do escritório."
        voltar={itemFixo ? { href: `/e/${empresaId}/pendencias?competencia=${itemFixo.competencia.slice(0, 7)}`, rotulo: "Voltar às pendências" } : undefined}
      />
      {itemId && !itemFixo ? <Alerta tom="alerta" className="mb-4">A pendência indicada não foi encontrada. Escolha o tipo de documento abaixo.</Alerta> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <EnviarDocumentos
          empresaId={empresaId}
          documentoEmpresa={ctx.acesso.documento}
          categorias={categorias ?? []}
          itens={abertos}
          competencias={listaCompetencias(24, 1)}
          competenciaPadrao={padrao.slice(0, 7)}
          limiteMb={escritorio?.upload_tamanho_maximo_mb ?? 50}
          itemFixo={itemFixo}
          categoriaInicial={categoriaInicial}
          baseDocumentos={`/e/${empresaId}/documentos`}
        />
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Pendências de {formatarCompetencia(padrao, true)}</CardTitle>
            </CardHeader>
            <CardContent>
              {doMes.length ? (
                <ul className="space-y-3 text-sm">
                  {doMes.map((i) => {
                    const st = STATUS_CHECKLIST[i.status];
                    return (
                      <li key={i.id} className="space-y-1">
                        <Link href={`/e/${empresaId}/enviar?item=${i.id}`} className="block hover:underline">
                          {i.titulo}
                        </Link>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          prazo {formatarData(i.prazo)}
                          <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? i.status}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma pendência cadastrada para este mês.</p>
              )}
              <Link href={`/e/${empresaId}/pendencias`} className="mt-3 inline-block text-sm text-primary underline-offset-2 hover:underline">
                Ver todas as pendências
              </Link>
            </CardContent>
          </Card>
          <div className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-sucesso" aria-hidden="true" />
            <p>
              Os arquivos ficam em armazenamento privado e criptografado, acessível apenas por quem tem permissão nesta empresa. Cada arquivo passa por verificação
              de segurança antes de ser lido.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
