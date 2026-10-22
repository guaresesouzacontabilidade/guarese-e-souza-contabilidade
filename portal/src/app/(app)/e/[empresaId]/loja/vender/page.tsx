import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { AbrirCaixa } from "@/components/loja/formularios-caixa";
import { PontoDeVenda, type ClientePdv, type OrcamentoInicial, type ProdutoPdv } from "@/components/loja/ponto-de-venda";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Vender" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown) => (v === null || v === undefined ? null : String(v));

export default async function PaginaVender({ params, searchParams }: PageProps<"/e/[empresaId]/loja/vender">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} />;

  const { data: abertos } = await ctx.supabase
    .from("caixa_sessoes")
    .select("id, caixa_nome, operador_id, aberto_em, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
    .eq("empresa_id", empresaId)
    .eq("status", "aberto")
    .order("aberto_em");
  const meu = (abertos ?? []).find((s) => s.operador_id === ctx.sessao.usuarioId);

  if (!meu) {
    const usados = new Set((abertos ?? []).map((s) => s.caixa_nome.toLowerCase()));
    let n = 1;
    while (usados.has(`caixa ${n}`)) n++;
    return (
      <>
        <CabecalhoPagina titulo="Vender" descricao="Para começar a vender, abra o caixa com o troco que está na gaveta." />
        <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Abrir o caixa</CardTitle>
            </CardHeader>
            <CardContent>
              <AbrirCaixa empresaId={empresaId} sugestaoNome={`Caixa ${n}`} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Caixas abertos agora</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(abertos ?? []).length ? (
                (abertos ?? []).map((s) => (
                  <div key={s.id} className="rounded-lg border border-border p-2.5">
                    <p className="font-medium">{s.caixa_nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {(s.operador as { nome?: string } | null)?.nome ?? "—"} · desde {formatarDataHora(s.aberto_em)}
                    </p>
                    {ctx.gerente ? (
                      <Link href={`/e/${empresaId}/loja/caixa/${s.id}`} className="text-xs text-primary hover:underline">
                        Ver o caixa
                      </Link>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">Nenhum caixa aberto.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const orcamentoId = typeof sp.orcamento === "string" && UUID.test(sp.orcamento) ? sp.orcamento : null;
  const [produtosR, clientesR, cfgR, orcR] = await Promise.all([
    ctx.supabase
      .from("nfe_produtos")
      .select("id, codigo, descricao, unidade, gtin, grupo, valor_unitario, estoque_atual, controla_estoque, espessura_cm, largura_cm, comprimento_m")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("descricao")
      .limit(5000),
    ctx.supabase
      .from("contrapartes")
      .select("id, nome, documento, telefone")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .contains("papeis", ["cliente"])
      .order("nome")
      .limit(5000),
    ctx.supabase.from("gestao_config").select("permitir_venda_prazo").eq("empresa_id", empresaId).maybeSingle(),
    orcamentoId
      ? ctx.supabase
          .from("vendas")
          .select("id, numero, status, cliente_id, cliente_nome, desconto, frete, observacao, entrega, venda_itens(ordem, produto_id, pecas, comprimento_m, quantidade, preco_unitario, desconto)")
          .eq("id", orcamentoId)
          .eq("empresa_id", empresaId)
          .eq("tipo", "orcamento")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const produtos: ProdutoPdv[] = (produtosR.data ?? []).map((p) => ({
    id: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    unidade: p.unidade,
    gtin: p.gtin,
    grupo: p.grupo,
    valor_unitario: texto(p.valor_unitario),
    estoque_atual: String(p.estoque_atual ?? 0),
    controla_estoque: p.controla_estoque,
    espessura_cm: texto(p.espessura_cm),
    largura_cm: texto(p.largura_cm),
    comprimento_m: texto(p.comprimento_m),
  }));
  const clientes: ClientePdv[] = (clientesR.data ?? []).map((c) => ({ id: c.id, nome: c.nome, documento: c.documento, telefone: c.telefone }));

  const o = orcR.data;
  const orcamento: OrcamentoInicial | null =
    o && o.status === "aberto"
      ? {
          id: o.id,
          numero: Number(o.numero),
          cliente: clientes.find((c) => c.id === o.cliente_id) ?? null,
          clienteNome: o.cliente_id ? null : o.cliente_nome,
          itens: [...(o.venda_itens ?? [])]
            .sort((a, b) => a.ordem - b.ordem)
            .map((i) => ({
              produto_id: i.produto_id,
              pecas: texto(i.pecas),
              comprimento_m: texto(i.comprimento_m),
              quantidade: String(i.quantidade),
              preco_unitario: String(i.preco_unitario),
              desconto: String(i.desconto),
            })),
          desconto: String(o.desconto),
          frete: String(o.frete),
          observacao: o.observacao,
          entrega: o.entrega,
        }
      : null;

  return (
    <>
      <CabecalhoPagina
        titulo={orcamento ? `Vender o orçamento nº ${orcamento.numero}` : "Vender"}
        descricao={`${meu.caixa_nome} aberto desde ${formatarDataHora(meu.aberto_em)}. Cada venda já baixa o estoque e entra no Financeiro.`}
        acoes={
          <Button asChild variante="contorno">
            <Link href={`/e/${empresaId}/loja/caixa`}>
              <FileText /> Caixa do dia
            </Link>
          </Button>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente || ctx.equipe} />
      {orcamentoId && !orcamento ? (
        <Alerta tom="alerta" className="mb-4">
          Este orçamento não está mais em aberto (já virou venda ou foi cancelado).
        </Alerta>
      ) : null}
      {!produtos.length ? (
        <Alerta tom="info" className="mb-4" titulo="Nenhum produto cadastrado">
          {ctx.gerente ? (
            <>
              Cadastre os produtos em <Link href={`/e/${empresaId}/loja/produtos`} className="underline">Produtos e estoque</Link> para começar a vender.
            </>
          ) : (
            "Peça ao gerente da loja para cadastrar os produtos."
          )}
        </Alerta>
      ) : null}
      <PontoDeVenda
        key={orcamento?.id ?? "nova"}
        empresaId={empresaId}
        sessaoId={meu.id}
        caixaNome={meu.caixa_nome}
        produtos={produtos}
        clientes={clientes}
        permitirPrazo={cfgR.data?.permitir_venda_prazo ?? true}
        orcamento={orcamento}
      />
    </>
  );
}
