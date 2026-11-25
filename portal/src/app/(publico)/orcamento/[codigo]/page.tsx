import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BotaoImprimir } from "@/components/loja/acoes-venda";
import { criarClienteServidor } from "@/lib/supabase/server";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { formatarQuantidade, un } from "@/lib/gestao/rotulos";

export const metadata: Metadata = { title: "Orçamento", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface ItemPublico {
  descricao: string;
  unidade: string;
  pecas: number | null;
  comprimento_m: number | null;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  total: number;
}

interface OrcamentoPublico {
  numero: number;
  data: string;
  validade: string | null;
  situacao: "aberto" | "vencido" | "convertido";
  cliente: string | null;
  loja: string;
  razao_social: string;
  cnpj: string | null;
  endereco: string | null;
  telefone: string | null;
  demonstracao: boolean;
  itens: ItemPublico[];
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
  observacao: string | null;
  mensagem: string | null;
}

/**
 * Orçamento que a loja mandou pelo WhatsApp (link com código aleatório, sem
 * login). Mostra o mesmo que o papel do orçamento, sem CPF, telefone nem
 * endereço do cliente — só o primeiro nome.
 */
export default async function OrcamentoDoCliente({ params }: PageProps<"/orcamento/[codigo]">) {
  const { codigo } = await params;
  if (!/^[a-z0-9]{16}$/.test(codigo)) notFound();
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("gestao_orcamento_publico", { p_codigo: codigo });
  const o = data as unknown as OrcamentoPublico | null;
  if (!o) notFound();

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="space-y-1 text-center">
        {o.demonstracao ? <p className="mx-auto w-fit rounded border border-border px-2 text-xs font-bold">DEMONSTRAÇÃO — DADOS FICTÍCIOS</p> : null}
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{o.loja}</p>
        <CardTitle className="text-xl">Orçamento nº {o.numero}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {o.cliente ? `Olá, ${o.cliente}! ` : ""}Feito em {formatarData(o.data)}
          {o.validade ? ` · válido até ${formatarData(o.validade)}` : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {o.situacao === "convertido" ? (
          <p className="rounded-lg bg-sucesso-bg p-3 text-center text-sm text-sucesso-fg">Este orçamento já virou compra. Obrigado!</p>
        ) : o.situacao === "vencido" ? (
          <p className="rounded-lg bg-alerta-bg p-3 text-center text-sm text-alerta-fg">
            Este orçamento venceu em {formatarData(o.validade)}. Os preços podem ter mudado: fale com a loja para atualizar.
          </p>
        ) : null}

        <ol className="divide-y divide-border rounded-xl border border-border text-sm" aria-label="Itens do orçamento">
          {o.itens.map((i, n) => (
            <li key={n} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="break-words font-medium">{i.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {i.pecas ? `${formatarQuantidade(i.pecas, 3)} pç${i.comprimento_m ? ` × ${formatarQuantidade(i.comprimento_m, 3)} m` : ""} · ` : ""}
                  {formatarQuantidade(i.quantidade)} {un(i.unidade)} × {formatarMoeda(i.preco_unitario)}
                  {dec(i.desconto).gt(0) ? ` (−${formatarMoeda(i.desconto)})` : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold numero">{formatarMoeda(i.total)}</span>
            </li>
          ))}
        </ol>

        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Produtos</dt>
            <dd className="numero">{formatarMoeda(o.subtotal)}</dd>
          </div>
          {dec(o.desconto).gt(0) ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Desconto</dt>
              <dd className="numero">− {formatarMoeda(o.desconto)}</dd>
            </div>
          ) : null}
          {dec(o.frete).gt(0) ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Frete / entrega</dt>
              <dd className="numero">{formatarMoeda(o.frete)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
            <dt>Total</dt>
            <dd className="numero" data-testid="total-orcamento">{formatarMoeda(o.total)}</dd>
          </div>
        </dl>

        {o.observacao ? <p className="text-sm">Obs.: {o.observacao}</p> : null}
        {o.mensagem ? <p className="whitespace-pre-line text-center text-sm text-muted-foreground">{o.mensagem}</p> : null}

        <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{o.loja}</p>
          {o.razao_social !== o.loja ? <p>{o.razao_social}</p> : null}
          {o.cnpj ? <p>CNPJ {formatarDocumento(o.cnpj)}</p> : null}
          {o.endereco ? <p>{o.endereco}</p> : null}
          {o.telefone ? (
            <a href={`tel:+55${o.telefone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Phone className="size-3.5" /> {formatarTelefone(o.telefone)}
            </a>
          ) : null}
          <p>Orçamento não é documento fiscal.</p>
        </div>

        <div className="nao-imprimir flex justify-center">
          <BotaoImprimir rotulo="Imprimir ou salvar em PDF" />
        </div>
      </CardContent>
    </Card>
  );
}
