import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AcoesRascunho, EditarTextos } from "@/components/relatorios/acoes-relatorio";
import { VisualizacaoRelatorio } from "@/components/relatorios/visualizacao";
import { situacaoPeriodo } from "@/lib/relatorios/cabecalho";
import { lerSnapshot, TIPOS_RELATORIO, type TipoRelatorio } from "@/lib/relatorios/snapshot";
import { formatarData, formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Relatório" };
const UUID = /^[0-9a-f-]{36}$/i;

export default async function VerRelatorio({ params }: PageProps<"/e/[empresaId]/relatorios/publicados/[relatorioId]">) {
  const { empresaId, relatorioId } = await params;
  if (!UUID.test(relatorioId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  const { data: rel } = await ctx.supabase
    .from("relatorios_publicados")
    .select("id, tipo, titulo, periodo_inicio, periodo_fim, versao, situacao, status, dados, resumo_texto, comentarios_contador, limitacoes, publicado_em, atualizado_em, gerado_em")
    .eq("id", relatorioId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!rel) notFound();
  const dados = lerSnapshot(rel.dados);
  const rascunho = rel.status === "rascunho";
  const podePublicar = ctx.pode("relatorios.publicar");
  if (!rascunho && !podePublicar) {
    await ctx.supabase.rpc("registrar_acesso_relatorio", { p_id: rel.id, p_tipo: "visualizacao" });
  }
  const revisado = rascunho ? (await situacaoPeriodo(ctx.supabase, empresaId, rel.periodo_inicio, rel.periodo_fim)) === "revisado" : rel.situacao === "revisado";
  const arquivo = (formato: string) => `/api/relatorios/${rel.id}/arquivo?formato=${formato}`;
  const limitacoes = Array.isArray(rel.limitacoes) ? (rel.limitacoes as string[]) : [];

  return (
    <>
      <CabecalhoPagina
        titulo={rel.titulo}
        voltar={{ href: `/e/${empresaId}/relatorios/publicados`, rotulo: "Relatórios do escritório" }}
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {TIPOS_RELATORIO[rel.tipo as TipoRelatorio]?.rotulo ?? rel.tipo} · {formatarData(rel.periodo_inicio)} a {formatarData(rel.periodo_fim)}
            </span>
            {rascunho ? (
              <Badge variante="neutro">Rascunho</Badge>
            ) : (
              <>
                <Badge variante={rel.situacao === "revisado" ? "sucesso" : "alerta"}>{rel.situacao === "revisado" ? "Revisado" : "Preliminar"}</Badge>
                <Badge variante="contorno">Versão {rel.versao}</Badge>
                {rel.status === "substituido" ? <Badge variante="neutro">Substituído</Badge> : null}
              </>
            )}
          </span>
        }
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={arquivo("pdf")}>
                <FileDown /> PDF
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={arquivo("xlsx")}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
          </>
        }
      />

      {rascunho ? (
        <Alerta tom="info" className="mb-5" titulo="Rascunho — o cliente ainda não vê este relatório">
          Números calculados em {formatarDataHora(rel.atualizado_em)}. Revise o resumo, acrescente seus comentários e publique. Ao publicar, ele sai como{" "}
          <strong>{revisado ? "revisado" : "preliminar"}</strong> {revisado ? "(período fechado)." : "(o período ainda não foi fechado)."}
        </Alerta>
      ) : rel.status === "substituido" ? (
        <Alerta tom="alerta" className="mb-5">
          Existe uma versão mais nova deste relatório. Esta versão fica guardada para consulta.
        </Alerta>
      ) : rel.situacao !== "revisado" ? (
        <Alerta tom="info" className="mb-5" titulo="Relatório preliminar">
          Publicado em {formatarDataHora(rel.publicado_em)}, antes do fechamento do período. Os números ainda podem mudar.
        </Alerta>
      ) : null}

      {rascunho && podePublicar ? (
        <Card className="mb-6">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Revisão do rascunho</CardTitle>
            <AcoesRascunho empresaId={empresaId} relatorioId={rel.id} revisado={revisado} />
          </CardHeader>
          <CardContent>
            <EditarTextos
              empresaId={empresaId}
              relatorioId={rel.id}
              titulo={rel.titulo}
              resumo={rel.resumo_texto ?? ""}
              comentarios={rel.comentarios_contador ?? ""}
            />
          </CardContent>
        </Card>
      ) : null}

      {dados ? (
        <VisualizacaoRelatorio tipo={rel.tipo} dados={dados} resumo={rel.resumo_texto} comentarios={rel.comentarios_contador} limitacoes={limitacoes} />
      ) : (
        <Alerta tom="alerta">Este relatório não tem números guardados.</Alerta>
      )}
    </>
  );
}
