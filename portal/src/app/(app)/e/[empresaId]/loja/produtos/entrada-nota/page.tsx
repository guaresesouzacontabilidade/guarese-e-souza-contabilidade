import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileInput } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { EntradaPorNota } from "@/components/loja/produtos";
import { BotaoEntradaAutomatica } from "@/components/loja/entrada-automatica";
import { ImportarNota } from "@/components/loja/importar-nota";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { carregarProdutosLoja } from "@/lib/gestao/dados";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDocumento } from "@/lib/formatos";

export const metadata: Metadata = { title: "Entrada de mercadorias" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Margem sugerida para os produtos novos: a última usada, ou a margem mais comum dos produtos da loja. */
function margemSugerida(lembrada: number | null, produtos: { valor_unitario: number | null; preco_custo: number | null }[]) {
  if (lembrada !== null) return String(lembrada).replace(".", ",");
  const margens = produtos
    .filter((p) => (p.preco_custo ?? 0) > 0 && (p.valor_unitario ?? 0) > 0)
    .map((p) => ((p.valor_unitario! - p.preco_custo!) / p.preco_custo!) * 100)
    .filter((m) => m >= 0 && m <= 1000)
    .sort((a, b) => a - b);
  if (!margens.length) return "";
  return String(Math.round(margens[Math.floor(margens.length / 2)]));
}

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
      ctx.supabase
        .from("documento_fiscal_itens")
        .select("numero_item, codigo, descricao, ncm, gtin, unidade, quantidade, valor_unitario, valor_total, valor_desconto")
        .eq("documento_fiscal_id", notaId)
        .order("numero_item"),
      carregarProdutosLoja(ctx.supabase, empresaId, { ativos: true }),
      ctx.supabase.from("estoque_movimentos").select("id", { count: "exact", head: true }).eq("documento_fiscal_id", notaId),
    ]);
    if (!nota || nota.operacao !== "entrada") notFound();
    const fornecedor = (nota.emitente_documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const { data: vinculos } = fornecedor
      ? await ctx.supabase.from("estoque_vinculos").select("codigo_fornecedor, produto_id, fator").eq("empresa_id", empresaId).eq("fornecedor_documento", fornecedor).limit(5000)
      : { data: [] };
    return (
      <>
        <CabecalhoPagina
          titulo={`Nota ${nota.numero ?? ""} — ${nota.emitente_nome ?? "fornecedor"}`}
          descricao={`${formatarDocumento(nota.emitente_documento)} · emitida em ${formatarData(nota.data_emissao)} · ${formatarMoeda(nota.valor_total)}`}
          voltar={{ href: base, rotulo: "Entrada de mercadorias" }}
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
                vinculos={(vinculos ?? []).map((v) => ({ codigo: v.codigo_fornecedor, produto_id: v.produto_id, fator: String(v.fator) }))}
                itens={(itens ?? []).map((i) => ({
                  numero_item: i.numero_item,
                  codigo: i.codigo,
                  descricao: i.descricao,
                  ncm: i.ncm,
                  gtin: i.gtin,
                  unidade: i.unidade,
                  quantidade: i.quantidade == null ? null : String(i.quantidade),
                  valor_unitario: i.valor_unitario == null ? null : String(i.valor_unitario),
                  valor_total: i.valor_total == null ? null : String(i.valor_total),
                  valor_desconto: i.valor_desconto == null ? null : String(i.valor_desconto),
                }))}
              />
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  const [{ data: notas }, { data: lancadas }, { data: cfg }, { count: qtdVinculos }, { data: pelosPdfs }, { data: precos }] = await Promise.all([
    ctx.supabase
      .from("documentos_fiscais")
      .select("id, numero, emitente_nome, data_emissao, valor_total, modelo, chave_acesso")
      .eq("empresa_id", empresaId)
      .eq("operacao", "entrada")
      .eq("cancelada_evento", false)
      .in("modelo", ["55", "65"])
      .order("data_emissao", { ascending: false })
      .limit(100),
    ctx.supabase.from("estoque_movimentos").select("documento_fiscal_id").eq("empresa_id", empresaId).not("documento_fiscal_id", "is", null).limit(10000),
    ctx.supabase.from("gestao_config").select("entrada_automatica, margem_entrada").eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("estoque_vinculos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId),
    ctx.supabase
      .from("estoque_notas_pdf")
      .select("id, chave, numero, emitente_nome, emitente_documento, data_emissao, valor_total, created_at")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(50),
    ctx.supabase.from("nfe_produtos").select("valor_unitario, preco_custo").eq("empresa_id", empresaId).eq("ativo", true).gt("preco_custo", 0).limit(2000),
  ]);
  const automatica = cfg?.entrada_automatica === true;
  const chavesPdf = new Set((pelosPdfs ?? []).map((n) => n.chave));
  const feitas = new Set((lancadas ?? []).map((m) => m.documento_fiscal_id));
  return (
    <>
      <CabecalhoPagina
        titulo="Entrada de mercadorias"
        descricao="Importe o XML ou o PDF da nota de compra e o portal lança tudo no estoque. As notas que já chegam ao portal (XML enviado ou busca automática) também aparecem aqui."
        voltar={{ href: `/e/${empresaId}/loja/produtos`, rotulo: "Produtos e estoque" }}
      />
      <NavegacaoLoja empresaId={empresaId} configurar />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Importar nota de compra (XML ou PDF)</CardTitle>
          <CardDescription>
            Escolha o XML ou o PDF (DANFE) da nota do fornecedor. O portal lê a nota e lança todos os itens no estoque, com a quantidade e o custo: cada item
            vai para o produto já ligado a ele, com o mesmo código de barras ou com o mesmo nome; o que ainda não existe é cadastrado. O XML também fica nos
            documentos da empresa para o escritório. Prefira o XML: o PDF só é lançado quando a leitura confere com os totais da nota.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportarNota empresaId={empresaId} margemInicial={margemSugerida(cfg?.margem_entrada ?? null, precos ?? [])} />
        </CardContent>
      </Card>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Entrada automática <Badge variante={automatica ? "sucesso" : "neutro"}>{automatica ? "Ligada" : "Desligada"}</Badge>
          </CardTitle>
          <CardDescription>
            {automatica
              ? "Quando chega uma nota de compra e todos os itens já estão ligados a produtos da loja, ela entra sozinha no estoque (quantidade × fator e custo da nota) e você recebe um aviso. Nota com item novo fica aqui esperando a sua conferência."
              : "Ligada, a nota de compra que chegar com todos os itens já ligados a produtos da loja entra sozinha no estoque, e você recebe um aviso. Os itens ficam ligados quando você dá entrada numa nota do fornecedor com “Lembrar” marcado."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <BotaoEntradaAutomatica empresaId={empresaId} ligada={automatica} />
          <Link href={`${base}/vinculos`} className="text-sm font-medium text-primary hover:underline">
            Itens de fornecedor ligados ({qtdVinculos ?? 0})
          </Link>
        </CardContent>
      </Card>
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
                      {feitas.has(n.id) || (n.chave_acesso && chavesPdf.has(n.chave_acesso)) ? (
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
            <EstadoVazio
              icone={FileInput}
              titulo="Nenhuma nota de compra no portal"
              descricao="Importe a nota acima, envie o XML em Enviar documentos ou ligue as notas automáticas com o certificado digital."
            />
          )}
        </CardContent>
      </Card>
      {(pelosPdfs ?? []).length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Notas lançadas pelo PDF</CardTitle>
            <CardDescription>Notas que entraram no estoque pela leitura do PDF. Quando o XML de uma delas chegar ao portal, ela não entra de novo.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <tr>
                  <Th>Emissão</Th>
                  <Th>Fornecedor</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Lançada em</Th>
                </tr>
              </THead>
              <TBody>
                {(pelosPdfs ?? []).map((n) => (
                  <Tr key={n.id}>
                    <Td className="numero">{formatarData(n.data_emissao)}</Td>
                    <Td>
                      {n.emitente_nome ?? formatarDocumento(n.emitente_documento)}
                      <span className="block text-xs text-muted-foreground">Nota {n.numero ?? "—"}</span>
                    </Td>
                    <Td className="text-right numero">{formatarMoeda(n.valor_total)}</Td>
                    <Td className="text-right numero">{formatarData(n.created_at)}</Td>
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
