"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, CreditCard, FileCheck2, FileText, Loader2, MapPin, Plus, QrCode, Receipt, Search, ShoppingCart, Trash2, UserPlus, UserRound, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { finalizarVenda, salvarClienteLoja, salvarOrcamento, situacaoNfeDaVenda, type ResultadoNfeVenda, type VendaEntrada } from "@/lib/gestao/acoes";
import { FORMAS_PAGAMENTO, formatarQuantidade, modoMedida, quantidadePorPecas, secaoPeca, un, type FormaPagamento, type NfeNaVenda } from "@/lib/gestao/rotulos";
import { buscarProdutos } from "@/lib/gestao/busca-produtos";
import { EM_ANDAMENTO, SITUACAO_NFE, type SituacaoNfe } from "@/lib/nfe-emissao/rotulos";
import { FormDestinatario, type Destinatario } from "@/components/nfe/cadastros";

export interface ProdutoPdv {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  gtin: string | null;
  grupo: string | null;
  valor_unitario: string | null;
  estoque_atual: string;
  controla_estoque: boolean;
  espessura_cm: string | null;
  largura_cm: string | null;
  comprimento_m: string | null;
}

export interface ClientePdv {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
}

interface Linha {
  chave: string;
  produto: ProdutoPdv;
  pecas: string;
  comprimento: string;
  quantidade: string;
  preco: string;
  desconto: string;
}

interface Pagamento {
  chave: string;
  forma: FormaPagamento;
  valor: string;
  recebido: string;
  parcelas: number;
  vencimento: string;
}

export interface OrcamentoInicial {
  id: string;
  numero: number;
  cliente: ClientePdv | null;
  clienteNome: string | null;
  itens: { produto_id: string; pecas: string | null; comprimento_m: string | null; quantidade: string; preco_unitario: string; desconto: string }[];
  desconto: string;
  frete: string;
  observacao: string | null;
  entrega: string | null;
}

const ICONES: Record<FormaPagamento, React.ComponentType<{ className?: string }>> = {
  dinheiro: Banknote,
  pix: QrCode,
  cartao_debito: CreditCard,
  cartao_credito: CreditCard,
  a_prazo: Wallet,
  outro: Receipt,
};

const BR = (v: Decimal | number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : formatarMoeda(v, { semSimbolo: true }));
const ler = (t: string) => lerValorBR(t) ?? new Decimal(0);
let seq = 0;
const novaChave = () => `k${++seq}`;

function quantidadeDaLinha(l: Linha): Decimal | null {
  if (modoMedida(l.produto) !== "direto") return quantidadePorPecas(l.produto, ler(l.pecas), l.comprimento ? ler(l.comprimento) : null);
  const q = lerValorBR(l.quantidade);
  return q && q.gt(0) ? q.toDecimalPlaces(4) : null;
}

function totalDaLinha(l: Linha): Decimal {
  const q = quantidadeDaLinha(l);
  if (!q) return new Decimal(0);
  return q.times(ler(l.preco)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).minus(ler(l.desconto));
}

function hojeMais(dias: number) {
  const d = new Date(Date.now() - 3 * 3600 * 1000 + dias * 86400000);
  return d.toISOString().slice(0, 10);
}

export function PontoDeVenda({
  empresaId,
  sessaoId,
  caixaNome,
  produtos,
  clientes: clientesIniciais,
  permitirPrazo,
  orcamento,
  nfe,
}: {
  empresaId: string;
  sessaoId: string;
  caixaNome: string;
  produtos: ProdutoPdv[];
  clientes: ClientePdv[];
  permitirPrazo: boolean;
  orcamento: OrcamentoInicial | null;
  /** NF-e na hora da venda (caixinha "Emitir NF-e"). */
  nfe: NfeNaVenda;
}) {
  const router = useRouter();
  const porId = React.useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);
  const [clientes, setClientes] = React.useState(clientesIniciais);
  const [busca, setBusca] = React.useState("");
  const [linhas, setLinhas] = React.useState<Linha[]>(() =>
    (orcamento?.itens ?? []).flatMap((i) => {
      const p = porId.get(i.produto_id);
      if (!p) return [];
      return [{ chave: novaChave(), produto: p, pecas: i.pecas ? formatarQuantidade(i.pecas, 3) : "", comprimento: i.comprimento_m ? formatarQuantidade(i.comprimento_m, 3) : "", quantidade: i.pecas ? "" : formatarQuantidade(i.quantidade), preco: BR(i.preco_unitario), desconto: Number(i.desconto) ? BR(i.desconto) : "" }];
    }),
  );
  const [cliente, setCliente] = React.useState<ClientePdv | null>(orcamento?.cliente ?? null);
  const [clienteNome, setClienteNome] = React.useState(orcamento?.clienteNome ?? "");
  const [buscaCliente, setBuscaCliente] = React.useState("");
  const [desconto, setDesconto] = React.useState(orcamento && Number(orcamento.desconto) ? BR(orcamento.desconto) : "");
  const [frete, setFrete] = React.useState(orcamento && Number(orcamento.frete) ? BR(orcamento.frete) : "");
  const [observacao, setObservacao] = React.useState(orcamento?.observacao ?? "");
  const [entrega, setEntrega] = React.useState(orcamento?.entrega ?? "");
  const [pagamentos, setPagamentos] = React.useState<Pagamento[]>([]);
  const [enviando, setEnviando] = React.useState<"venda" | "orcamento" | null>(null);
  const [concluida, setConcluida] = React.useState<{ id: string; numero: number; troco: number; total: number; nfe?: ResultadoNfeVenda } | null>(null);
  const [emitirNfe, setEmitirNfe] = React.useState(nfe.disponivel && nfe.marcadaPadrao);
  const [comEndereco, setComEndereco] = React.useState(() => new Set(nfe.documentosComEndereco));
  const [enderecoNfe, setEnderecoNfe] = React.useState(false);
  const [novoCliente, setNovoCliente] = React.useState(false);
  const buscaRef = React.useRef<HTMLInputElement>(null);

  const subtotal = linhas.reduce((s, l) => s.plus(totalDaLinha(l)), new Decimal(0));
  const total = subtotal.minus(ler(desconto)).plus(ler(frete));
  const pago = pagamentos.reduce((s, p) => s.plus(ler(p.valor)), new Decimal(0));
  const falta = total.minus(pago);
  const troco = pagamentos
    .filter((p) => p.forma === "dinheiro" && p.recebido)
    .reduce((s, p) => s.plus(Decimal.max(ler(p.recebido).minus(ler(p.valor)), 0)), new Decimal(0));

  const termo = busca.trim().toLowerCase();
  const { itens: encontrados, total: totalEncontrados } = React.useMemo(() => buscarProdutos(produtos, busca, 30), [produtos, busca]);

  function adicionar(p: ProdutoPdv) {
    const modo = modoMedida(p);
    setLinhas((ls) => [
      ...ls,
      {
        chave: novaChave(),
        produto: p,
        pecas: modo === "direto" ? "" : "1",
        comprimento: modo === "direto" ? "" : p.comprimento_m ? formatarQuantidade(p.comprimento_m, 3) : "",
        quantidade: modo === "direto" ? "1" : "",
        preco: BR(p.valor_unitario),
        desconto: "",
      },
    ]);
    setBusca("");
    buscaRef.current?.focus();
  }

  function aoTeclarBusca(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exato = produtos.find((p) => p.gtin === termo || p.codigo.toLowerCase() === termo);
    if (exato) adicionar(exato);
    else if (encontrados.length === 1) adicionar(encontrados[0]);
  }

  function atualizarLinha(chave: string, campo: keyof Linha, valor: string) {
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  }

  function adicionarPagamento(forma: FormaPagamento) {
    const restante = Decimal.max(falta, 0);
    setPagamentos((ps) => [
      ...ps,
      { chave: novaChave(), forma, valor: BR(restante), recebido: "", parcelas: 1, vencimento: forma === "a_prazo" ? hojeMais(30) : "" },
    ]);
  }

  function atualizarPagamento(chave: string, dados: Partial<Pagamento>) {
    setPagamentos((ps) => ps.map((p) => (p.chave === chave ? { ...p, ...dados } : p)));
  }

  function montarVenda(): VendaEntrada {
    return {
      sessao_id: sessaoId,
      orcamento_id: orcamento?.id ?? null,
      cliente_id: cliente?.id ?? null,
      cliente_nome: cliente ? undefined : clienteNome.trim() || undefined,
      itens: linhas.map((l) => ({
        produto_id: l.produto.id,
        pecas: modoMedida(l.produto) !== "direto" ? l.pecas : null,
        comprimento_m: modoMedida(l.produto) !== "direto" ? l.comprimento : null,
        quantidade: modoMedida(l.produto) === "direto" ? l.quantidade : null,
        preco_unitario: l.preco,
        desconto: l.desconto || null,
      })),
      desconto: desconto || undefined,
      frete: frete || undefined,
      pagamentos: pagamentos.map((p) => ({
        forma: p.forma,
        valor: p.valor,
        valor_recebido: p.forma === "dinheiro" && p.recebido ? p.recebido : null,
        parcelas: p.parcelas,
        primeiro_vencimento: p.forma === "a_prazo" ? p.vencimento : null,
      })),
      observacao: observacao || undefined,
      entrega: entrega || undefined,
    };
  }

  const docCliente = cliente?.documento ?? null;
  const pendenciaNfe = !emitirNfe
    ? null
    : !cliente
      ? "Para a NF-e, escolha ou cadastre o cliente (com CPF ou CNPJ)."
      : !docCliente
        ? "O cliente não tem CPF/CNPJ no cadastro. Cadastre-o de novo com o documento para a nota."
        : !comEndereco.has(docCliente)
          ? "Falta o endereço do cliente para a nota."
          : null;

  async function concluir() {
    if (!linhas.length) return toast.error("Adicione pelo menos um produto.");
    if (pendenciaNfe) return toast.error(`${pendenciaNfe} Ou desmarque "Emitir NF-e".`);
    if (!pagamentos.length) return toast.error("Escolha a forma de pagamento.");
    if (!falta.isZero()) return toast.error(falta.gt(0) ? `Falta informar ${formatarMoeda(falta)} no pagamento.` : `Os pagamentos passam do total em ${formatarMoeda(falta.negated())}.`);
    setEnviando("venda");
    const r = await finalizarVenda(empresaId, montarVenda(), { emitirNfe });
    setEnviando(null);
    if (!r.ok || !r.dados) return toast.error(r.mensagem ?? "Não foi possível concluir a venda.");
    setConcluida(r.dados);
    router.refresh();
  }

  async function guardarOrcamento() {
    if (!linhas.length) return toast.error("Adicione pelo menos um produto.");
    setEnviando("orcamento");
    const v = montarVenda();
    const r = await salvarOrcamento(empresaId, orcamento?.id ?? null, v);
    setEnviando(null);
    if (!r.ok || !r.dados) return toast.error(r.mensagem ?? "Não foi possível salvar o orçamento.");
    toast.success(r.mensagem);
    router.push(`/e/${empresaId}/loja/vendas/${r.dados.id}`);
  }

  function novaVenda() {
    setConcluida(null);
    setEmitirNfe(nfe.disponivel && nfe.marcadaPadrao);
    setLinhas([]);
    setPagamentos([]);
    setCliente(null);
    setClienteNome("");
    setDesconto("");
    setFrete("");
    setObservacao("");
    setEntrega("");
    if (orcamento) router.replace(`/e/${empresaId}/loja/vender`);
    setTimeout(() => buscaRef.current?.focus(), 50);
  }

  const clientesFiltrados = buscaCliente.trim()
    ? clientes
        .filter((c) => c.nome.toLowerCase().includes(buscaCliente.trim().toLowerCase()) || (c.documento ?? "").includes(buscaCliente.replace(/\D/g, "") || "#"))
        .slice(0, 6)
    : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        {orcamento ? (
          <Alerta tom="info" titulo={`Venda a partir do orçamento nº ${orcamento.numero}`}>
            Confira os itens e os preços e informe o pagamento. Ao concluir, o orçamento fica marcado como convertido.
          </Alerta>
        ) : null}
        <Card>
          <CardContent className="space-y-3 pt-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={buscaRef}
                autoFocus
                aria-label="Buscar produto"
                placeholder="Buscar produto pelo nome, código ou código de barras"
                className="h-12 pl-9 text-base"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={aoTeclarBusca}
              />
            </div>
            {encontrados.length ? (
              <ul className="max-h-[26rem] divide-y divide-border overflow-y-auto rounded-xl border border-border" aria-label="Produtos encontrados">
                {encontrados.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => adicionar(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent">
                      <span className="min-w-0">
                        <span className="block break-words font-medium">{p.descricao}</span>
                        <span className="text-xs text-muted-foreground">
                          Cód. {p.codigo}
                          {secaoPeca(p) ? ` · ${secaoPeca(p)}` : ""}
                          {p.controla_estoque ? ` · estoque ${formatarQuantidade(p.estoque_atual)} ${un(p.unidade)}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm font-semibold numero">
                        {p.valor_unitario ? formatarMoeda(p.valor_unitario) : "sem preço"}
                        <span className="block text-xs font-normal text-muted-foreground">por {un(p.unidade)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : busca.trim() ? (
              <p className="text-sm text-muted-foreground">Nenhum produto encontrado. Tente outra palavra do nome ou o código.</p>
            ) : null}
            {totalEncontrados > encontrados.length ? (
              <p className="text-xs text-muted-foreground">
                Mostrando {encontrados.length} de {totalEncontrados} produtos. Digite mais uma palavra (modelo, cor, tamanho) para achar mais rápido.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="size-5 text-primary" /> Itens da venda
            </CardTitle>
            <span className="text-sm text-muted-foreground">{caixaNome}</span>
          </CardHeader>
          <CardContent>
            {linhas.length ? (
              <ul className="space-y-3" aria-label="Itens da venda">
                {linhas.map((l) => {
                  const modo = modoMedida(l.produto);
                  const q = quantidadeDaLinha(l);
                  const semEstoque = l.produto.controla_estoque && q && q.gt(l.produto.estoque_atual);
                  return (
                    <li key={l.chave} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{l.produto.descricao}</p>
                          <p className="text-xs text-muted-foreground">
                            Cód. {l.produto.codigo}
                            {secaoPeca(l.produto) ? ` · seção ${secaoPeca(l.produto)}` : ""} · preço por {un(l.produto.unidade)}
                          </p>
                        </div>
                        <Button variante="fantasma" tamanho="iconeSm" aria-label={`Tirar ${l.produto.descricao}`} onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>
                          <Trash2 />
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {modo === "direto" ? (
                          <Campo rotulo={`Quantidade (${un(l.produto.unidade)})`} htmlFor={`q-${l.chave}`}>
                            <Input id={`q-${l.chave}`} inputMode="decimal" value={l.quantidade} onChange={(e) => atualizarLinha(l.chave, "quantidade", e.target.value)} />
                          </Campo>
                        ) : (
                          <>
                            <Campo rotulo="Peças" htmlFor={`p-${l.chave}`}>
                              <Input id={`p-${l.chave}`} inputMode="decimal" value={l.pecas} onChange={(e) => atualizarLinha(l.chave, "pecas", e.target.value)} />
                            </Campo>
                            <Campo rotulo="Comprimento (m)" htmlFor={`c-${l.chave}`}>
                              <Input id={`c-${l.chave}`} inputMode="decimal" value={l.comprimento} onChange={(e) => atualizarLinha(l.chave, "comprimento", e.target.value)} />
                            </Campo>
                          </>
                        )}
                        <Campo rotulo={`Preço por ${un(l.produto.unidade)}`} htmlFor={`v-${l.chave}`}>
                          <Input id={`v-${l.chave}`} inputMode="decimal" value={l.preco} onChange={(e) => atualizarLinha(l.chave, "preco", e.target.value)} />
                        </Campo>
                        <Campo rotulo="Desconto (R$)" htmlFor={`d-${l.chave}`}>
                          <Input id={`d-${l.chave}`} inputMode="decimal" value={l.desconto} onChange={(e) => atualizarLinha(l.chave, "desconto", e.target.value)} />
                        </Campo>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">
                          {modo !== "direto" ? (q ? `${formatarQuantidade(q)} ${un(l.produto.unidade)}` : "informe peças e comprimento") : null}
                          {semEstoque ? <Badge variante="alerta" className="ml-2">acima do estoque ({formatarQuantidade(l.produto.estoque_atual)})</Badge> : null}
                        </span>
                        <span className="font-semibold numero">{formatarMoeda(totalDaLinha(l))}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">Busque um produto acima para começar a venda.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4 text-primary" /> Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {cliente ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{cliente.nome}</p>
                  {cliente.documento ? <p className="text-xs text-muted-foreground">{formatarDocumento(cliente.documento)}</p> : null}
                </div>
                <Button variante="fantasma" tamanho="iconeSm" aria-label="Trocar cliente" onClick={() => setCliente(null)}>
                  <X />
                </Button>
              </div>
            ) : (
              <>
                <Input aria-label="Buscar cliente" placeholder="Buscar cliente (nome ou CPF/CNPJ)" value={buscaCliente} onChange={(e) => setBuscaCliente(e.target.value)} />
                {clientesFiltrados.length ? (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {clientesFiltrados.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setCliente(c); setBuscaCliente(""); }}>
                          {c.nome}
                          {c.documento ? <span className="ml-1 text-xs text-muted-foreground">{formatarDocumento(c.documento)}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  <Input aria-label="Nome do cliente (sem cadastro)" placeholder="Ou só o nome, sem cadastro" value={clienteNome} onChange={(e) => setClienteNome(e.target.value)} />
                  <Button variante="contorno" tamanho="icone" aria-label="Cadastrar cliente" onClick={() => setNovoCliente(true)}>
                    <UserPlus />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Para vender a prazo, escolha ou cadastre o cliente.</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pagamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Produtos</dt><dd className="numero">{formatarMoeda(subtotal)}</dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground"><label htmlFor="pdv-desconto">Desconto (R$)</label></dt>
                <dd><Input id="pdv-desconto" inputMode="decimal" className="h-8 w-28 text-right" value={desconto} onChange={(e) => setDesconto(e.target.value)} /></dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground"><label htmlFor="pdv-frete">Frete / entrega (R$)</label></dt>
                <dd><Input id="pdv-frete" inputMode="decimal" className="h-8 w-28 text-right" value={frete} onChange={(e) => setFrete(e.target.value)} /></dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
                <dt>Total</dt>
                <dd className="numero">{formatarMoeda(total)}</dd>
              </div>
            </dl>

            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Formas de pagamento">
              {(["dinheiro", "pix", "cartao_debito", "cartao_credito", "a_prazo"] as FormaPagamento[])
                .filter((f) => f !== "a_prazo" || permitirPrazo)
                .map((f) => {
                  const Icone = ICONES[f];
                  return (
                    <Button key={f} variante="contorno" tamanho="sm" className="h-auto flex-col gap-1 py-2 text-xs" onClick={() => adicionarPagamento(f)} disabled={!linhas.length}>
                      <Icone className="size-4" /> {FORMAS_PAGAMENTO[f]}
                    </Button>
                  );
                })}
            </div>

            {pagamentos.length ? (
              <ul className="space-y-2" aria-label="Pagamentos da venda">
                {pagamentos.map((p) => (
                  <li key={p.chave} className="space-y-2 rounded-lg border border-border p-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm font-medium">{FORMAS_PAGAMENTO[p.forma]}</span>
                      <Input aria-label={`Valor em ${FORMAS_PAGAMENTO[p.forma]}`} inputMode="decimal" className="h-8 w-28 text-right" value={p.valor} onChange={(e) => atualizarPagamento(p.chave, { valor: e.target.value })} />
                      <Button variante="fantasma" tamanho="iconeSm" aria-label={`Tirar ${FORMAS_PAGAMENTO[p.forma]}`} onClick={() => setPagamentos((ps) => ps.filter((x) => x.chave !== p.chave))}>
                        <X />
                      </Button>
                    </div>
                    {p.forma === "dinheiro" ? (
                      <div className="flex items-center justify-end gap-2 text-sm">
                        <label htmlFor={`rec-${p.chave}`} className="text-muted-foreground">Recebido</label>
                        <Input id={`rec-${p.chave}`} inputMode="decimal" className="h-8 w-28 text-right" placeholder={p.valor} value={p.recebido} onChange={(e) => atualizarPagamento(p.chave, { recebido: e.target.value })} />
                      </div>
                    ) : null}
                    {p.forma === "a_prazo" || p.forma === "cartao_credito" ? (
                      <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                        <label htmlFor={`parc-${p.chave}`} className="text-muted-foreground">Parcelas</label>
                        <Select id={`parc-${p.chave}`} className="h-8 w-20" value={p.parcelas} onChange={(e) => atualizarPagamento(p.chave, { parcelas: Number(e.target.value) })}>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>{n}x</option>
                          ))}
                        </Select>
                        {p.forma === "a_prazo" ? (
                          <>
                            <label htmlFor={`venc-${p.chave}`} className="text-muted-foreground">1º vencimento</label>
                            <Input id={`venc-${p.chave}`} type="date" className="h-8 w-40" value={p.vencimento} onChange={(e) => atualizarPagamento(p.chave, { vencimento: e.target.value })} />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {pagamentos.length ? (
              <p className={cn("text-right text-sm font-semibold", falta.isZero() ? "text-sucesso" : "text-alerta")}>
                {falta.gt(0) ? `Falta ${formatarMoeda(falta)}` : falta.lt(0) ? `Passou ${formatarMoeda(falta.negated())}` : "Pagamento completo"}
                {troco.gt(0) ? <span className="block text-base text-primary">Troco: {formatarMoeda(troco)}</span> : null}
              </p>
            ) : null}

            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Observação e entrega</summary>
              <div className="mt-2 space-y-2">
                <Input aria-label="Observação" placeholder="Observação (sai no comprovante)" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
                <Input aria-label="Endereço de entrega" placeholder="Endereço de entrega" value={entrega} onChange={(e) => setEntrega(e.target.value)} />
              </div>
            </details>

            {nfe.configurada ? (
              <div className="space-y-2 rounded-lg border border-border p-2.5 text-sm">
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox checked={emitirNfe} disabled={!nfe.disponivel} onChange={(e) => setEmitirNfe(e.target.checked)} aria-label="Emitir NF-e ao concluir a venda" />
                  <FileCheck2 className="size-4 text-primary" /> Emitir NF-e ao concluir
                  {nfe.ambiente === "homologacao" && nfe.disponivel ? <Badge variante="alerta">teste</Badge> : null}
                </label>
                {!nfe.disponivel ? <p className="text-xs text-muted-foreground">{nfe.motivo}</p> : null}
                {pendenciaNfe ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-alerta-fg">
                    <span>{pendenciaNfe}</span>
                    {docCliente && !comEndereco.has(docCliente) ? (
                      <Button variante="contorno" tamanho="sm" onClick={() => setEnderecoNfe(true)}>
                        <MapPin /> Completar endereço
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <Button className="h-12 w-full text-base" onClick={concluir} disabled={enviando !== null || !linhas.length}>
              {enviando === "venda" ? <Loader2 className="animate-spin" /> : <Receipt />} {emitirNfe ? "Concluir venda e emitir NF-e" : "Concluir venda"}
            </Button>
            <div className="flex gap-2">
              <Button variante="contorno" className="flex-1" onClick={guardarOrcamento} disabled={enviando !== null || !linhas.length}>
                {enviando === "orcamento" ? <Loader2 className="animate-spin" /> : <FileText />} Salvar orçamento
              </Button>
              <Button variante="fantasma" onClick={novaVenda} disabled={enviando !== null}>
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <NovoCliente
        aberto={novoCliente}
        aoFechar={() => setNovoCliente(false)}
        empresaId={empresaId}
        aoCriar={(c) => {
          setClientes((cs) => [c, ...cs]);
          setCliente(c);
        }}
      />

      <Dialog open={enderecoNfe} onOpenChange={setEnderecoNfe}>
        <DialogContent titulo="Endereço do cliente para a NF-e" descricao="Fica cadastrado para as próximas notas deste cliente." largura="lg">
          {cliente && docCliente ? (
            <FormDestinatario
              empresaId={empresaId}
              inicial={destinatarioInicial(cliente, docCliente)}
              aoSalvar={() => {
                setComEndereco((s) => new Set(s).add(docCliente));
                setEnderecoNfe(false);
                toast.success("Endereço cadastrado. Já dá para emitir a NF-e.");
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(concluida)} onOpenChange={(v) => !v && novaVenda()}>
        <DialogContent titulo={concluida ? `Venda nº ${concluida.numero} concluída` : "Venda concluída"} descricao="O estoque e o financeiro já foram atualizados.">
          {concluida ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-secondary p-4 text-center">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="font-titulo text-3xl font-bold numero">{formatarMoeda(concluida.total)}</p>
                {Number(concluida.troco) > 0 ? <p className="mt-1 text-lg font-semibold text-primary">Troco: {formatarMoeda(concluida.troco)}</p> : null}
              </div>
              {concluida.nfe ? <NfeDaVendaConcluida empresaId={empresaId} vendaId={concluida.id} nfe={concluida.nfe} /> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variante="contorno" asChild>
                  <Link href={`/impressao/venda/${concluida.id}`} target="_blank">
                    <Receipt /> Comprovante
                  </Link>
                </Button>
                <Button variante="contorno" asChild>
                  <Link href={`/e/${empresaId}/loja/vendas/${concluida.id}`}>Ver a venda</Link>
                </Button>
                <Button onClick={novaVenda} autoFocus>
                  <Plus /> Nova venda
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NovoCliente({ aberto, aoFechar, empresaId, aoCriar }: { aberto: boolean; aoFechar: () => void; empresaId: string; aoCriar: (c: ClientePdv) => void }) {
  const [nome, setNome] = React.useState("");
  const [documento, setDocumento] = React.useState("");
  const [telefone, setTelefone] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await salvarClienteLoja(empresaId, { nome, documento, telefone });
    setEnviando(false);
    if (!r.ok || !r.dados) return toast.error(r.mensagem ?? "Não foi possível cadastrar.");
    aoCriar({ id: r.dados.id, nome: r.dados.nome, documento: documento.replace(/\D/g, "") || null, telefone: telefone.replace(/\D/g, "") || null });
    toast.success("Cliente cadastrado.");
    setNome("");
    setDocumento("");
    setTelefone("");
    aoFechar();
  }
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent titulo="Cadastrar cliente" descricao="Fica no cadastro de clientes da empresa, também usado no Financeiro.">
        <form onSubmit={salvar} className="space-y-3">
          <Campo rotulo="Nome" htmlFor="nc-nome" obrigatorio>
            <Input id="nc-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="CPF ou CNPJ" htmlFor="nc-doc">
              <Input id="nc-doc" inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} />
            </Campo>
            <Campo rotulo="Telefone / WhatsApp" htmlFor="nc-tel">
              <Input id="nc-tel" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={enviando}>
              {enviando ? <Loader2 className="animate-spin" /> : <UserPlus />} Cadastrar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dados do cliente do caixa para começar o cadastro do endereço da NF-e. */
function destinatarioInicial(c: ClientePdv, documento: string): Destinatario {
  const cpf = documento.length === 11;
  return {
    id: "",
    tipo: cpf ? "cpf" : "cnpj",
    documento,
    nome: c.nome.slice(0, 60),
    indicador_ie: cpf ? 9 : 1,
    inscricao_estadual: null,
    logradouro: "",
    numero: "",
    complemento: null,
    bairro: "",
    municipio_ibge: null,
    uf: null,
    municipio: null,
    codigo_pais: null,
    pais: null,
    cidade_exterior: null,
    cep: null,
    telefone: c.telefone,
    email: null,
  };
}

/** Situação da NF-e enviada ao concluir a venda: acompanha até a SEFAZ responder. */
function NfeDaVendaConcluida({ empresaId, vendaId, nfe }: { empresaId: string; vendaId: string; nfe: ResultadoNfeVenda }) {
  const [estado, setEstado] = React.useState<{ situacao: string; numero: number; serie: number; motivo: string | null } | null>(null);
  React.useEffect(() => {
    if (!nfe.ok || !nfe.id) return;
    let vivo = true;
    let tentativas = 0;
    const consultar = async () => {
      const r = await situacaoNfeDaVenda(empresaId, nfe.id!);
      if (!vivo) return;
      if (r) setEstado(r);
      tentativas++;
      if (tentativas < 40 && (!r || EM_ANDAMENTO.includes(r.situacao as SituacaoNfe))) window.setTimeout(consultar, 3000);
    };
    consultar();
    return () => {
      vivo = false;
    };
  }, [empresaId, nfe.ok, nfe.id]);

  if (!nfe.ok || !nfe.id) {
    return (
      <Alerta tom="alerta" titulo="A venda foi concluída, mas a NF-e não saiu">
        {nfe.mensagem}{" "}
        <Link href={`/e/${empresaId}/notas-produto/nova?venda=${vendaId}`} className="underline">
          Emitir pela venda
        </Link>
      </Alerta>
    );
  }
  const sit = estado ? SITUACAO_NFE[estado.situacao as SituacaoNfe] : null;
  const andamento = !estado || EM_ANDAMENTO.includes(estado.situacao as SituacaoNfe);
  return (
    <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <FileCheck2 className="size-4 text-primary" />
          NF-e{estado ? ` nº ${estado.numero}` : ""}
        </span>
        {andamento ? (
          <Badge variante="info">
            <Loader2 className="animate-spin" /> Enviando à SEFAZ
          </Badge>
        ) : sit ? (
          <Badge variante={sit.tom}>{sit.rotulo}</Badge>
        ) : null}
      </div>
      {estado && !andamento ? <p className="text-xs text-muted-foreground">{sit?.ajuda}</p> : null}
      {estado?.motivo && !andamento && estado.situacao !== "autorizada" ? <p className="text-xs text-perigo">{estado.motivo}</p> : null}
      <div className="flex flex-wrap gap-2">
        {estado?.situacao === "autorizada" ? (
          <Button asChild tamanho="sm">
            <a href={`/api/nfe/${empresaId}/${nfe.id}`} target="_blank" rel="noopener">
              <FileText /> Imprimir DANFE
            </a>
          </Button>
        ) : null}
        <Button asChild variante="contorno" tamanho="sm">
          <Link href={`/e/${empresaId}/notas-produto/${nfe.id}`}>Ver a nota</Link>
        </Button>
      </div>
    </div>
  );
}
