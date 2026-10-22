import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterSessao } from "@/lib/auth/sessao";
import { BotaoImprimir } from "@/components/loja/acoes-venda";
import { FORMAS_PAGAMENTO, formatarQuantidade, hora, parcelasDoPrazo, type FormaPagamento, un } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";

export const metadata: Metadata = { title: "Comprovante" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Comprovante da venda (bobina de 80 mm ou folha A4). Não é documento fiscal. */
export default async function Comprovante({ params, searchParams }: PageProps<"/impressao/venda/[vendaId]">) {
  const { vendaId } = await params;
  const sp = await searchParams;
  if (!UUID.test(vendaId)) notFound();
  const s = await obterSessao();
  if (!s) notFound();
  const { data: v } = await s.supabase
    .from("vendas")
    .select("*, vendedor:perfis!vendas_vendedor_id_fkey(nome), venda_itens(*), venda_pagamentos(*)")
    .eq("id", vendaId)
    .maybeSingle();
  if (!v) notFound();
  const [{ data: e }, { data: cfg }] = await Promise.all([
    s.supabase.from("empresas").select("razao_social, nome_fantasia, documento, logradouro, numero, bairro, cidade, uf, cep, telefone, logo_path, logo_atualizado_em, demonstracao").eq("id", v.empresa_id).maybeSingle(),
    s.supabase.from("gestao_config").select("mensagem_comprovante").eq("empresa_id", v.empresa_id).maybeSingle(),
  ]);
  if (!e) notFound();
  const a4 = sp.formato === "a4";
  const orcamento = v.tipo === "orcamento";
  const itens = [...(v.venda_itens ?? [])].sort((a, b) => a.ordem - b.ordem);
  const prazo = (v.venda_pagamentos ?? []).filter((p) => p.forma === "a_prazo" && p.primeiro_vencimento);
  const endereco = [[e.logradouro, e.numero].filter(Boolean).join(", "), e.bairro, [e.cidade, e.uf].filter(Boolean).join("/"), e.cep ? `CEP ${formatarCep(e.cep)}` : null]
    .filter(Boolean)
    .join(" · ");
  const linha = <hr className="my-2 border-0 border-t border-dashed border-black/50" />;

  return (
    <>
      <style>{`@page { size: ${a4 ? "A4" : "80mm auto"}; margin: ${a4 ? "14mm" : "3mm"}; } @media print { body { background: #fff !important; } }`}</style>
      <div className="nao-imprimir sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b border-black/10 bg-white/95 p-3 text-sm">
        <BotaoImprimir rotulo={orcamento ? "Imprimir orçamento" : "Imprimir comprovante"} />
        <a href={`?formato=${a4 ? "80mm" : "a4"}`} className="rounded-md border border-black/20 px-3 py-2 hover:bg-black/5">
          {a4 ? "Formato bobina 80 mm" : "Formato folha A4"}
        </a>
      </div>
      <main className={`mx-auto bg-white p-3 font-mono text-black ${a4 ? "max-w-[190mm] text-[13px]" : "max-w-[76mm] text-[11px]"} leading-snug`}>
        <header className="text-center">
          {e.logo_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/empresas/${v.empresa_id}/logo${e.logo_atualizado_em ? `?v=${encodeURIComponent(e.logo_atualizado_em)}` : ""}`}
              alt={`Logo de ${e.nome_fantasia ?? e.razao_social}`}
              className={`mx-auto mb-1 w-auto object-contain ${a4 ? "max-h-20 max-w-[60mm]" : "max-h-14 max-w-[50mm]"}`}
            />
          ) : null}
          {e.demonstracao ? <p className="mb-1 border border-black px-1 text-[0.85em] font-bold">DEMONSTRAÇÃO — DADOS FICTÍCIOS</p> : null}
          <p className="text-[1.15em] font-bold uppercase">{e.nome_fantasia ?? e.razao_social}</p>
          {e.nome_fantasia ? <p>{e.razao_social}</p> : null}
          <p>CNPJ {formatarDocumento(e.documento)}</p>
          {endereco ? <p>{endereco}</p> : null}
          {e.telefone ? <p>Tel. {formatarTelefone(e.telefone)}</p> : null}
        </header>
        {linha}
        <p className="text-center font-bold">
          {orcamento ? `ORÇAMENTO Nº ${v.numero}` : `COMPROVANTE DE VENDA Nº ${v.numero}`}
          {v.status === "cancelada" ? " — CANCELADO" : ""}
        </p>
        <p className="text-center text-[0.9em]">NÃO É DOCUMENTO FISCAL</p>
        <p className="mt-1">
          {formatarData(v.data)} {hora(v.created_at)}
          {(v.vendedor as { nome?: string } | null)?.nome ? ` · Vendedor: ${(v.vendedor as { nome?: string }).nome}` : ""}
        </p>
        <p>Cliente: {v.cliente_nome ?? "Consumidor"}</p>
        {v.cliente_documento ? <p>CPF/CNPJ: {formatarDocumento(v.cliente_documento)}</p> : null}
        {v.cliente_telefone ? <p>Telefone: {formatarTelefone(v.cliente_telefone)}</p> : null}
        {orcamento && v.validade ? <p className="font-bold">Válido até {formatarData(v.validade)}</p> : null}
        {linha}
        <ol className="space-y-1">
          {itens.map((i, n) => (
            <li key={i.id}>
              <p>
                {String(n + 1).padStart(2, "0")} {i.descricao}
              </p>
              {i.pecas ? (
                <p className="pl-3">
                  {formatarQuantidade(i.pecas, 3)} pç{i.comprimento_m ? ` × ${formatarQuantidade(i.comprimento_m, 3)} m` : ""}
                </p>
              ) : null}
              <p className="flex justify-between gap-2 pl-3">
                <span>
                  {formatarQuantidade(i.quantidade)} {un(i.unidade)} × {formatarMoeda(i.preco_unitario)}
                  {dec(i.desconto).gt(0) ? ` (−${formatarMoeda(i.desconto)})` : ""}
                </span>
                <span className="font-bold">{formatarMoeda(i.total)}</span>
              </p>
            </li>
          ))}
        </ol>
        {linha}
        <Linha rotulo="Subtotal" valor={formatarMoeda(v.subtotal)} />
        {dec(v.desconto).gt(0) ? <Linha rotulo="Desconto" valor={`− ${formatarMoeda(v.desconto)}`} /> : null}
        {dec(v.frete).gt(0) ? <Linha rotulo="Frete/entrega" valor={formatarMoeda(v.frete)} /> : null}
        <div className="text-[1.2em] font-bold">
          <Linha rotulo="TOTAL" valor={formatarMoeda(v.total)} />
        </div>
        {!orcamento ? (
          <>
            {linha}
            {(v.venda_pagamentos ?? []).map((p) => (
              <div key={p.id}>
                <Linha rotulo={`${FORMAS_PAGAMENTO[p.forma as FormaPagamento]}${p.parcelas > 1 ? ` ${p.parcelas}x` : ""}`} valor={formatarMoeda(p.valor)} />
                {p.forma === "dinheiro" && p.valor_recebido != null && dec(p.valor_recebido).gt(dec(p.valor)) ? (
                  <>
                    <Linha rotulo="  Recebido" valor={formatarMoeda(p.valor_recebido)} />
                    <Linha rotulo="  Troco" valor={formatarMoeda(dec(p.valor_recebido).minus(dec(p.valor)))} />
                  </>
                ) : null}
              </div>
            ))}
            {prazo.length ? (
              <>
                {linha}
                <p className="font-bold">Parcelas a prazo</p>
                {prazo.flatMap((p) =>
                  parcelasDoPrazo(p.valor, p.parcelas, p.primeiro_vencimento!, p.intervalo_dias ?? 30).map((x) => (
                    <Linha key={`${p.id}-${x.numero}`} rotulo={`${x.numero}ª venc. ${formatarData(x.vencimento)}`} valor={formatarMoeda(x.valor)} />
                  )),
                )}
                <p className="mt-6 border-t border-black pt-1 text-center">Assinatura do cliente</p>
                <p className="text-center text-[0.85em]">Reconheço a dívida acima e me comprometo a pagá-la nos vencimentos.</p>
              </>
            ) : null}
          </>
        ) : null}
        {v.entrega || v.observacao ? (
          <>
            {linha}
            {v.entrega ? <p>Entrega: {v.entrega}</p> : null}
            {v.observacao ? <p>Obs.: {v.observacao}</p> : null}
          </>
        ) : null}
        {cfg?.mensagem_comprovante ? (
          <>
            {linha}
            <p className="whitespace-pre-line text-center">{cfg.mensagem_comprovante}</p>
          </>
        ) : null}
        {linha}
        <p className="text-center text-[0.85em]">Portal Guarese&apos;s ON</p>
      </main>
    </>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <p className="flex justify-between gap-2 whitespace-pre">
      <span>{rotulo}</span>
      <span>{valor}</span>
    </p>
  );
}
