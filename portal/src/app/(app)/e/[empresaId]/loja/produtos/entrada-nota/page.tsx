import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileInput } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { EntradaPorNota } from "@/components/loja/produtos";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarProdutosLoja } from "@/lib/gestao/dados";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Entrada por nota" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaEntradaNota({ params, searchParams }: PageProps<"/e/[empresaId]/loja/produtos/entrada-nota">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.gerente) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  const base = `/e/${empresaId}/loja/produtos/entrada-nota`;
  const notaId = typeof sp.nota === "string" && UUID.test(sp.nota) ? sp.nota : null;

  if (notaId) {
    const [{ data: nota }, { data: itens }, produtos, { count: jaLancada }] = await Promise.all([
      ctx.supabase.from("documentos_fiscais").select("id, numero, serie, emitente_nome, emitente_documento, data_emissao, valor_total, operacao").eq("id", notaId).eq("empresa_id", empresaId).maybeSingle(),
      ctx.supabase.from("documento_fiscal_itens").select("numero_item, codigo, descricao, unidade, quantidade, valor_unitario, valor_total").eq("documento_fiscal_id", notaId).order("numero_item"),
      carregarProdutosLoja(ctx.supabase, empresaId, { ativos: true }),
      ctx.supabase.from("estoque_movimentos").select("id", { count: "exact", head: true }).eq("documento_fiscal_id", notaId),
    ]);
    if (!nota || nota.operacao !== "entrada") notFound();
    return (
      <>
        <CabecalhoPagina
          titulo={`Nota ${nota.numero ?? ""} — ${nota.emitente_nome ?? "fornecedor"}`}
          descricao={`${formatarDocumento(nota.emitente_documento)} · emitida em ${formatarData(nota.data_emissao)} · ${formatarMoeda(nota.valor_total)}`}
          voltar={{ href: base, rotulo: "Notas de compra" }}
        />
        <NavegacaoLoja empresaId={empresaId} configurar />
        <Card>
          <CardContent className="pt-5">
            {jaLancada ? (
              <EstadoVazio titulo="Esta nota já deu entrada no estoque" descricao="Veja os movimentos na página de cada produto." />
            ) : (
              <EntradaPorNota
                empresaId={empresaId}
                documentoId={nota.id}
                produtos={produtos}
                itens={(itens ?? []).map((i) => ({
                  numero_item: i.numero_item,
                  codigo: i.codigo,
                  descricao: i.descricao,
                  unidade: i.unidade,
                  quantidade: i.quantidade == null ? null : String(i.quantidade),
                  valor_unitario: i.valor_unitario == null ? null : String(i.valor_unitario),
                  valor_total: i.valor_total == null ? null : String(i.valor_total),
                }))}
              />
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const [{ data: notas }, { data: lancadas }] = await Promise.all([
    ctx.supabase
      .from("documentos_fiscais")
      .select("id, numero, emitente_nome, data_emissao, valor_total, modelo")
      .eq("empresa_id", empresaId)
      .eq("operacao", "entrada")
      .eq("cancelada_evento", false)
      .in("modelo", ["55", "65"])
      .order("data_emissao", { ascending: false })
      .limit(100),
    ctx.supabase.from("estoque_movimentos").select("documento_fiscal_id").eq("empresa_id", empresaId).not("documento_fiscal_id", "is", null).limit(10000),
  ]);
  const feitas = new Set((lancadas ?? []).map((m) => m.documento_fiscal_id));
  return (
    <>
      <CabecalhoPagina
        titulo="Entrada por nota de compra"
        descricao="As notas de compra que chegam ao portal (XML enviado ou busca automática) aparecem aqui. Escolha uma para dar entrada no estoque com o custo certo."
        voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <Card>
        <CardHeader>
          <CardTitle>Notas de compra recebidas</CardTitle>
        </CardHeader>
        <CardContent>
          {(notas ?? []).length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Emissão</Th>
                  <Th>Fornecedor</Th>
                  <Th className="text-right">Valor</Th>
                  <Th />
                </tr>
              </THead>
              <TBody>
                {(notas ?? []).map((n) => (
                  <Tr key={n.id}>
                    <Td className="numero">{formatarData(n.data_emissao)}</Td>
                    <Td>
                      {n.emitente_nome ?? "—"}
                      <span className="block text-xs text-muted-foreground">Nota {n.numero ?? "—"}</span>
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(n.valor_total)}</Td>
                    <Td className="text-right">
                      {feitas.has(n.id) ? (
                        <Badge variante="sucesso">Já no estoque</Badge>
                      ) : (
                        <Link href={`${base}?nota=${n.id}`} className="text-sm font-medium text-primary hover:underline">
                          Dar entrada
                        </Link>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio icone={FileInput} titulo="Nenhuma nota de compra no portal" descricao="Envie o XML da nota em Enviar documentos, ou ligue as notas automáticas com o certificado digital." />
          )}
        </CardContent>
      </Card>
    </>
  );
}
