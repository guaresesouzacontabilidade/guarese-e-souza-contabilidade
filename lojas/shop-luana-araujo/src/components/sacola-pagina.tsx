"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { linkWhatsApp, mensagemPedido, moeda, ROTULO_PAGAMENTO, valorEntrega } from "@/lib/catalogo";
import { chaveItem, useSacola } from "@/lib/sacola";
import type { Entrega, FormaPagamento, PedidoRegistrado } from "@/lib/tipos";
import { IconeWhatsApp } from "./icones";

type LojaSacola = { nome: string; whatsapp: string | null; entregas: Entrega[]; pagamentos: FormaPagamento[]; pedido_minimo: number | null };

const mascaraTelefone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

function Rotulo({ htmlFor, children, opcional }: { htmlFor: string; children: React.ReactNode; opcional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children} {opcional ? <span className="font-normal text-suave">(opcional)</span> : null}
    </label>
  );
}

type Precos = Record<string, { nome: string; preco: number; disponivel: boolean } | null>;

async function buscarPrecos(ids: string): Promise<Precos | null> {
  if (!ids) return null;
  try {
    const r = await fetch(`/api/sacola?ids=${encodeURIComponent(ids)}`, { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()) as { produtos: Precos }).produtos;
  } catch {
    // Sem conexão agora: o portal confere de novo ao enviar.
    return null;
  }
}

export function SacolaPagina({ loja }: { loja: LojaSacola }) {
  const sacola = useSacola();
  const [nome, setNome] = React.useState("");
  const [telefone, setTelefone] = React.useState("");
  const [entregaId, setEntregaId] = React.useState(loja.entregas.length === 1 ? loja.entregas[0].id : "");
  const [endereco, setEndereco] = React.useState("");
  const [pagamento, setPagamento] = React.useState<FormaPagamento | "">(loja.pagamentos.length === 1 ? loja.pagamentos[0] : "");
  const [troco, setTroco] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [aceite, setAceite] = React.useState(false);
  const [erros, setErros] = React.useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [pedido, setPedido] = React.useState<PedidoRegistrado | null>(null);
  const [indisponiveis, setIndisponiveis] = React.useState<Set<string>>(new Set());
  const [avisoPreco, setAvisoPreco] = React.useState(false);
  const topo = React.useRef<HTMLDivElement>(null);

  const entrega = loja.entregas.find((e) => e.id === entregaId) ?? null;
  const frete = entrega?.valor ?? 0;
  const total = Math.round((sacola.subtotal + frete) * 100) / 100;
  const abaixoMinimo = loja.pedido_minimo !== null && sacola.subtotal < loja.pedido_minimo;
  const idsSacola = sacola.itens.map((i) => i.produto_id).join(",");

  // Confere preço e disponibilidade atuais (a sacola pode ter sido montada há dias)
  const aplicarPrecos = React.useCallback(
    (produtos: Precos) => {
      const fora = new Set<string>();
      let mudou = false;
      for (const i of sacola.itens) {
        const atual = produtos[i.produto_id];
        if (!atual || !atual.disponivel) {
          fora.add(chaveItem(i));
          continue;
        }
        if (atual.preco !== i.preco || atual.nome !== i.nome) {
          mudou = mudou || atual.preco !== i.preco;
          sacola.atualizar(chaveItem(i), { preco: atual.preco, nome: atual.nome });
        }
      }
      setIndisponiveis(fora);
      if (mudou) setAvisoPreco(true);
    },
    [sacola],
  );

  React.useEffect(() => {
    let vivo = true;
    void buscarPrecos(idsSacola).then((precos) => {
      if (vivo && precos) aplicarPrecos(precos);
    });
    return () => {
      vivo = false;
    };
    // Só quando muda o conjunto de produtos (não a cada quantidade)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsSacola]);

  const validar = () => {
    const e: Record<string, string> = {};
    if (nome.trim().length < 2) e.nome = "Informe o seu nome.";
    if (!/^[1-9]\d{9,10}$/.test(telefone.replace(/\D/g, ""))) e.telefone = "Informe o WhatsApp com DDD, como (63) 99999-9999.";
    if (!entrega) e.entrega = "Escolha como quer receber.";
    if (entrega?.endereco && endereco.trim().length < 8) e.endereco = "Informe rua, número e bairro.";
    if (!pagamento) e.pagamento = "Escolha a forma de pagamento.";
    if (!aceite) e.aceite = "Marque para a loja poder atender o pedido.";
    return e;
  };

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErroGeral(null);
    const e = validar();
    setErros(e);
    if (Object.keys(e).length) {
      const primeiro = document.getElementById(`campo-${Object.keys(e)[0]}`);
      primeiro?.focus();
      return;
    }
    if (indisponiveis.size) {
      setErroGeral("Tire da sacola os produtos que esgotaram para continuar.");
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch("/api/pedido", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome,
          telefone,
          entrega: entregaId,
          endereco: entrega?.endereco ? endereco : undefined,
          pagamento,
          troco_para: pagamento === "dinheiro" && troco ? Number(troco.replace(/\./g, "").replace(",", ".")) : null,
          observacao,
          aceite,
          site: (document.getElementById("campo-site") as HTMLInputElement | null)?.value ?? "",
          itens: sacola.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, variacao: i.variacao })),
          total_visto: total,
        }),
      });
      const corpo = (await r.json().catch(() => null)) as { ok: boolean; pedido?: PedidoRegistrado; mensagem?: string; precosMudaram?: boolean } | null;
      if (corpo?.ok && corpo.pedido) {
        setPedido(corpo.pedido);
        sacola.limpar();
        requestAnimationFrame(() => topo.current?.scrollIntoView({ block: "start" }));
        return;
      }
      setErroGeral(corpo?.mensagem ?? "Não conseguimos enviar agora. Tente de novo em instantes.");
      if (corpo?.precosMudaram) {
        const precos = await buscarPrecos(idsSacola);
        if (precos) aplicarPrecos(precos);
      }
    } catch {
      setErroGeral("Sem conexão com a loja agora. Confira a internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  // Pedido registrado: botão para mandar a mensagem pronta no WhatsApp
  if (pedido) {
    const link = linkWhatsApp(pedido.whatsapp, mensagemPedido(pedido));
    return (
      <div ref={topo} className="conteudo max-w-2xl scroll-mt-28 pt-12 md:pt-16">
        <div className="surgir">
          <span className="inline-flex size-12 items-center justify-center rounded-full bg-tinta text-white">
            <Check className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-6 text-4xl md:text-5xl">Pedido nº {pedido.numero} registrado</h1>
          <p className="mt-4 text-suave">
            A loja já recebeu o seu pedido. Toque no botão para enviar o resumo no WhatsApp e combinar o pagamento e a entrega.
          </p>
          <a href={link} target="_blank" rel="noopener noreferrer" className="botao mt-8 w-full sm:w-auto">
            <IconeWhatsApp className="size-5" /> Enviar no WhatsApp
          </a>
          <div className="mt-12 border-t border-linha pt-6">
            <h2 className="font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.18em]">Resumo</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {pedido.itens.map((i, n) => (
                <li key={n} className="flex justify-between gap-4">
                  <span>
                    {i.quantidade}× {i.nome}
                    {i.variacao ? <span className="text-suave"> · {i.rotulo_variacao}: {i.variacao}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums">{moeda(i.total)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-6 space-y-2 border-t border-linha pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-suave">{pedido.entrega}</dt>
                <dd className="tabular-nums">{pedido.frete_a_combinar ? "A combinar" : pedido.frete ? moeda(pedido.frete) : "Grátis"}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {moeda(pedido.total)}
                  {pedido.frete_a_combinar ? " + frete" : ""}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-suave">Pagamento</dt>
                <dd>{pedido.pagamento}</dd>
              </div>
            </dl>
          </div>
          <Link href="/" className="botao-contorno mt-10">
            Continuar comprando
          </Link>
        </div>
      </div>
    );
  }

  if (!sacola.itens.length) {
    return (
      <div className="conteudo flex flex-col items-center py-24 text-center md:py-32">
        <h1 className="text-4xl md:text-5xl">Sua sacola está vazia</h1>
        <p className="mt-4 max-w-sm text-suave">Escolha os produtos e eles aparecem aqui para você enviar o pedido.</p>
        <Link href="/#novidades" className="botao mt-8">
          Ver novidades
        </Link>
      </div>
    );
  }

  return (
    <div ref={topo} className="conteudo pt-8 md:pt-12">
      <h1 className="text-4xl md:text-5xl">Sacola</h1>
      {avisoPreco ? (
        <p className="mt-4 border-l-2 border-alerta bg-superficie px-4 py-3 text-sm" role="status">
          Alguns preços mudaram desde que você colocou os produtos na sacola. Os valores abaixo já estão atualizados.
        </p>
      ) : null}
      <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_26rem] lg:gap-16">
        {/* Itens */}
        <section aria-labelledby="titulo-itens">
          <h2 id="titulo-itens" className="sr-only">
            Produtos na sacola
          </h2>
          <ul className="divide-y divide-linha border-y border-linha">
            {sacola.itens.map((i) => {
              const k = chaveItem(i);
              const fora = indisponiveis.has(k);
              return (
                <li key={k} className="grid grid-cols-[5rem_1fr] gap-4 py-5 sm:grid-cols-[6rem_1fr]">
                  <Link href={i.url} className="relative aspect-square overflow-hidden bg-areia" aria-label={i.nome}>
                    {i.foto ? <Image src={i.foto} alt="" fill sizes="96px" className={`object-cover ${fora ? "opacity-50" : ""}`} /> : null}
                  </Link>
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={i.url} className="line-clamp-2 text-sm hover:underline">
                          {i.nome}
                        </Link>
                        {i.variacao ? (
                          <p className="mt-0.5 text-xs text-suave">
                            {i.rotulo_variacao}: {i.variacao}
                          </p>
                        ) : null}
                        {fora ? <p className="mt-1 text-xs font-medium text-erro">Esgotou — tire da sacola para continuar</p> : null}
                      </div>
                      <button type="button" onClick={() => sacola.remover(k)} className="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center text-suave hover:text-texto" aria-label={`Tirar ${i.nome} da sacola`}>
                        <Trash2 className="size-4" strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                      <div className="flex items-center border border-borda" role="group" aria-label={`Quantidade de ${i.nome}`}>
                        <button type="button" className="inline-flex size-10 items-center justify-center disabled:text-borda" disabled={i.quantidade <= 1 || fora} onClick={() => sacola.alterar(k, i.quantidade - 1)} aria-label="Diminuir">
                          <Minus className="size-3.5" aria-hidden="true" />
                        </button>
                        <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">
                          {i.quantidade}
                        </span>
                        <button type="button" className="inline-flex size-10 items-center justify-center disabled:text-borda" disabled={i.quantidade >= i.maximo || fora} onClick={() => sacola.alterar(k, i.quantidade + 1)} aria-label="Aumentar">
                          <Plus className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{moeda(i.preco * i.quantidade)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center text-sm text-suave underline-offset-4 hover:text-texto hover:underline">
            Continuar comprando
          </Link>
        </section>

        {/* Pedido */}
        <section aria-labelledby="titulo-pedido" className="lg:sticky lg:top-28 lg:self-start">
          <h2 id="titulo-pedido" className="text-3xl">
            Finalizar pedido
          </h2>
          <form onSubmit={enviar} noValidate className="mt-6 space-y-7">
            {/* Campo isca para robôs (escondido de pessoas e leitores de tela) */}
            <input id="campo-site" name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

            <fieldset className="space-y-4">
              <legend className="sobretitulo mb-3">Seus dados</legend>
              <div>
                <Rotulo htmlFor="campo-nome">Nome</Rotulo>
                <input id="campo-nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" aria-invalid={!!erros.nome} aria-describedby={erros.nome ? "erro-nome" : undefined} maxLength={120} />
                {erros.nome ? <p id="erro-nome" className="mt-1.5 text-sm text-erro">{erros.nome}</p> : null}
              </div>
              <div>
                <Rotulo htmlFor="campo-telefone">WhatsApp</Rotulo>
                <input id="campo-telefone" className="campo" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} inputMode="tel" autoComplete="tel-national" placeholder="(63) 99999-9999" aria-invalid={!!erros.telefone} aria-describedby={erros.telefone ? "erro-telefone" : undefined} />
                {erros.telefone ? <p id="erro-telefone" className="mt-1.5 text-sm text-erro">{erros.telefone}</p> : null}
              </div>
            </fieldset>

            <fieldset>
              <legend className="sobretitulo mb-3">Entrega</legend>
              <div id="campo-entrega" tabIndex={-1} role="radiogroup" aria-label="Forma de entrega" aria-describedby={erros.entrega ? "erro-entrega" : undefined} className="space-y-2">
                {loja.entregas.map((e) => (
                  <label key={e.id} className={`flex min-h-14 items-start gap-3 border px-4 py-3 transition-colors ${entregaId === e.id ? "border-tinta bg-superficie" : "border-borda hover:border-suave"}`}>
                    <input type="radio" name="entrega" value={e.id} checked={entregaId === e.id} onChange={() => setEntregaId(e.id)} className="mt-1 size-4 accent-[#1c1917]" />
                    <span className="flex-1">
                      <span className="flex justify-between gap-3 text-sm font-medium">
                        {e.nome} <span className="shrink-0 tabular-nums">{valorEntrega(e)}</span>
                      </span>
                      {e.detalhe ? <span className="mt-0.5 block text-xs leading-relaxed text-suave">{e.detalhe}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              {erros.entrega ? <p id="erro-entrega" className="mt-1.5 text-sm text-erro">{erros.entrega}</p> : null}
              {entrega?.endereco ? (
                <div className="mt-4">
                  <Rotulo htmlFor="campo-endereco">Endereço de entrega</Rotulo>
                  <textarea id="campo-endereco" className="campo min-h-24" value={endereco} onChange={(e) => setEndereco(e.target.value)} autoComplete="street-address" placeholder="Rua, número, bairro e um ponto de referência" maxLength={200} aria-invalid={!!erros.endereco} aria-describedby={erros.endereco ? "erro-endereco" : undefined} />
                  {erros.endereco ? <p id="erro-endereco" className="mt-1.5 text-sm text-erro">{erros.endereco}</p> : null}
                </div>
              ) : null}
            </fieldset>

            <fieldset>
              <legend className="sobretitulo mb-3">Pagamento</legend>
              <p className="-mt-1 mb-3 text-xs text-suave">O pagamento é combinado no WhatsApp da loja depois do pedido.</p>
              <div id="campo-pagamento" tabIndex={-1} role="radiogroup" aria-label="Forma de pagamento" aria-describedby={erros.pagamento ? "erro-pagamento" : undefined} className="flex flex-wrap gap-2">
                {loja.pagamentos.map((f) => (
                  <button key={f} type="button" role="radio" aria-checked={pagamento === f} onClick={() => setPagamento(f)} className="opcao">
                    {ROTULO_PAGAMENTO[f]}
                  </button>
                ))}
              </div>
              {erros.pagamento ? <p id="erro-pagamento" className="mt-1.5 text-sm text-erro">{erros.pagamento}</p> : null}
              {pagamento === "dinheiro" ? (
                <div className="mt-4">
                  <Rotulo htmlFor="campo-troco" opcional>
                    Troco para quanto?
                  </Rotulo>
                  <input id="campo-troco" className="campo" value={troco} onChange={(e) => setTroco(e.target.value.replace(/[^\d,.]/g, "").slice(0, 10))} inputMode="decimal" placeholder="Ex.: 100" />
                </div>
              ) : null}
            </fieldset>

            <div>
              <Rotulo htmlFor="campo-observacao" opcional>
                Observação
              </Rotulo>
              <textarea id="campo-observacao" className="campo min-h-20" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} placeholder="Ex.: é para presente" />
            </div>

            <dl className="space-y-2 border-t border-tinta pt-5 text-sm">
              <div className="flex justify-between">
                <dt className="text-suave">Produtos ({sacola.quantidade})</dt>
                <dd className="tabular-nums">{moeda(sacola.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-suave">Entrega</dt>
                <dd className="tabular-nums">{entrega ? valorEntrega(entrega) : "—"}</dd>
              </div>
              <div className="flex justify-between pt-2 text-lg font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {moeda(total)}
                  {entrega && entrega.valor === null ? <span className="text-sm font-normal text-suave"> + frete</span> : null}
                </dd>
              </div>
            </dl>

            <div>
              <label className="flex items-start gap-3 text-sm">
                <input id="campo-aceite" type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#1c1917]" aria-invalid={!!erros.aceite} aria-describedby={erros.aceite ? "erro-aceite" : undefined} />
                <span className="text-suave">
                  Concordo que a {loja.nome} use meu nome, WhatsApp e endereço para atender este pedido, como explica a{" "}
                  <Link href="/privacidade" className="text-texto underline underline-offset-2">
                    política de privacidade
                  </Link>
                  .
                </span>
              </label>
              {erros.aceite ? <p id="erro-aceite" className="mt-1.5 text-sm text-erro">{erros.aceite}</p> : null}
            </div>

            {abaixoMinimo ? <p className="text-sm text-alerta">O pedido mínimo do site é de {moeda(loja.pedido_minimo as number)}.</p> : null}
            {erroGeral ? (
              <p className="border-l-2 border-erro bg-superficie px-4 py-3 text-sm text-erro" role="alert">
                {erroGeral}
              </p>
            ) : null}

            <button type="submit" className="botao w-full" disabled={enviando || abaixoMinimo}>
              {enviando ? "Enviando o pedido…" : "Enviar pedido"}
            </button>
            <p className="text-center text-xs leading-relaxed text-suave">Depois de enviar, a conversa no WhatsApp da loja abre com o resumo do pedido.</p>
          </form>
        </section>
      </div>
    </div>
  );
}
