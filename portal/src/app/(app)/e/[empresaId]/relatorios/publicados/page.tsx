import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, FileText } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { TIPOS_RELATORIO, type TipoRelatorio } from "@/lib/relatorios/snapshot";
import { formatarData, formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Relatórios do escritório" };

export default async function RelatoriosPublicados({ params }: PageProps<"/e/[empresaId]/relatorios/publicados">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const podePublicar = ctx.pode("relatorios.publicar");
  if (!podePublicar && !ctx.pode("relatorios.ver")) return <Alerta tom="alerta">Seu acesso não inclui os relatórios publicados desta empresa.</Alerta>;
  const { data, error } = await ctx.supabase
    .from("relatorios_publicados")
    .select("id, tipo, titulo, periodo_inicio, periodo_fim, versao, situacao, status, publicado_em, atualizado_em")
    .eq("empresa_id", empresaId)
    .order("periodo_inicio", { ascending: false })
    .order("versao", { ascending: false })
    .limit(300);
  if (error) return <Alerta tom="perigo">Não foi possível carregar os relatórios: {error.message}</Alerta>;
  const rascunhos = (data ?? []).filter((r) => r.status === "rascunho");
  const publicados = (data ?? []).filter((r) => r.status !== "rascunho");
  const base = `/e/${empresaId}/relatorios/publicados`;

  return (
    <>
      <CabecalhoPagina
        titulo="Relatórios do escritório"
        descricao="Relatórios revisados e enviados pelo escritório. Cada publicação fica guardada com sua versão, para consulta futura."
        acoes={
          podePublicar ? (
            <Button asChild>
              <Link href={`${base}/novo`}>
                <FilePlus2 /> Preparar relatório
              </Link>
            </Button>
          ) : null
        }
      />

      {podePublicar && rascunhos.length ? (
        <section className="mb-6 space-y-2">
          <h2 className="text-base font-semibold">Rascunhos (o cliente ainda não vê)</h2>
          <ul className="divide-y divide-border rounded-lg border border-dashed border-border bg-card">
            {rascunhos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`${base}/${r.id}`} className="font-medium hover:underline">
                    {r.titulo}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {TIPOS_RELATORIO[r.tipo as TipoRelatorio]?.rotulo ?? r.tipo} · {formatarData(r.periodo_inicio)} a {formatarData(r.periodo_fim)} · atualizado{" "}
                    {formatarDataHora(r.atualizado_em)}
                  </p>
                </div>
                <Button asChild tamanho="sm" variante="contorno">
                  <Link href={`${base}/${r.id}`}>Revisar e publicar</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {publicados.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Relatório</Th>
              <Th>Período</Th>
              <Th>Situação</Th>
              <Th>Publicado em</Th>
            </tr>
          </THead>
          <TBody>
            {publicados.map((r) => (
              <Tr key={r.id} className={r.status === "substituido" ? "opacity-70" : undefined}>
                <Td className="max-w-[22rem]">
                  <Link href={`${base}/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{r.titulo}</span>
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {TIPOS_RELATORIO[r.tipo as TipoRelatorio]?.rotulo ?? r.tipo} · versão {r.versao}
                  </p>
                </Td>
                <Td className="whitespace-nowrap text-sm">
                  {formatarData(r.periodo_inicio)} a {formatarData(r.periodo_fim)}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <Badge variante={r.situacao === "revisado" ? "sucesso" : "alerta"}>{r.situacao === "revisado" ? "Revisado" : "Preliminar"}</Badge>
                    {r.status === "substituido" ? <Badge variante="neutro">Substituído por versão mais nova</Badge> : null}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-sm">{formatarDataHora(r.publicado_em)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio
          icone={FileText}
          titulo="Nenhum relatório publicado ainda"
          descricao={
            podePublicar
              ? "Prepare um relatório a partir dos números do período, revise o texto e publique para o cliente."
              : "Quando o escritório publicar relatórios da sua empresa, eles aparecerão aqui e você receberá um aviso."
          }
        />
      )}
    </>
  );
}
