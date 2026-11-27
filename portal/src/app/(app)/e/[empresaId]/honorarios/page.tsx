import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, FileDown, HandCoins } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopiarPix } from "@/components/honorarios/cobrancas";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { numeroCobranca, situacaoExibida } from "@/lib/honorarios/comum";
import { pixDaCobranca, valorParaPagar } from "@/lib/honorarios/montar";
import { qrSvg } from "@/lib/honorarios/qr";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Honorários do escritório" };

/** Cobranças do escritório para a empresa (quem cuida do financeiro dela): Pix para pagar e histórico. */
export default async function HonorariosCliente({ params }: PageProps<"/e/[empresaId]/honorarios">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (ctx.equipe) redirect("/escritorio/honorarios/cobrancas");
  if (!ctx.pode("financeiro.ver")) redirect(`/e/${empresaId}`);
  const { data } = await ctx.supabase
    .from("honorarios_cobrancas")
    .select("*")
    .eq("empresa_id", empresaId)
    .in("situacao", ["aberta", "paga"])
    .order("vencimento", { ascending: false })
    .limit(60);
  const cobrancas = data ?? [];
  const abertas = cobrancas.filter((c) => c.situacao === "aberta").sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const pagas = cobrancas.filter((c) => c.situacao === "paga");
  const hoje = hojeISO();
  const comPix = await Promise.all(
    abertas.map(async (c) => {
      const pagar = valorParaPagar(c, hoje);
      const pix = pixDaCobranca(c, pagar.valor);
      return { c, pagar, pix, qr: pix ? await qrSvg(pix) : null };
    }),
  );

  return (
    <div className="space-y-5">
      <CabecalhoPagina titulo="Honorários do escritório" descricao="As cobranças do escritório para a sua empresa. Pague pelo Pix; o recibo chega por e-mail e fica em Documentos." />
      {comPix.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {comPix.map(({ c, pagar, pix, qr }) => {
            const sit = situacaoExibida(c, hoje);
            return (
              <Card key={c.id}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{c.descricao}</CardTitle>
                    <p className="text-xs text-muted-foreground">Cobrança nº {numeroCobranca(c)}</p>
                  </div>
                  <Badge variante={sit.tom === "neutro" ? "neutro" : sit.tom}>{sit.rotulo}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-2xl font-bold text-titulo">{formatarMoeda(pagar.valor)}</p>
                    <p className="text-sm text-muted-foreground">
                      {pagar.atualizado
                        ? `Venceu em ${formatarData(c.vencimento)} · com multa ${formatarMoeda(pagar.atualizado.multa)} e juros ${formatarMoeda(pagar.atualizado.juros)} até hoje`
                        : `Vence em ${formatarData(c.vencimento)}`}
                    </p>
                  </div>
                  {pix && qr ? (
                    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                      <div className="w-40 shrink-0 rounded-lg border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
                      <div className="min-w-0 space-y-2">
                        <p className="text-sm">Aponte a câmera do aplicativo do banco para o QR code, ou copie o código:</p>
                        <p className="break-all rounded-md border border-dashed border-border bg-muted/40 p-2 font-mono text-[11px]">{pix}</p>
                        <CopiarPix codigo={pix} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Fale com o escritório para receber os dados de pagamento.</p>
                  )}
                  <Button asChild variante="fantasma" tamanho="sm">
                    <a href={`/api/honorarios/${c.id}/pdf`}>
                      <FileDown /> Baixar em PDF
                    </a>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EstadoVazio icone={CheckCircle2} titulo="Nada para pagar" descricao="Quando o escritório enviar uma cobrança, ela aparece aqui com o Pix." />
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Pagamentos feitos</h2>
        {pagas.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {pagas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {c.descricao}
                  <span className="block text-xs text-muted-foreground">pago em {formatarData(c.pago_em)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">{formatarMoeda(c.valor_pago)}</span>
                  {c.recibo_id ? (
                    <a href={`/api/honorarios/${c.id}/recibo`} className="text-xs text-primary underline">
                      Recibo
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVazio icone={HandCoins} titulo="Nenhum pagamento ainda" />
        )}
        {pagas.length ? (
          <p className="text-xs text-muted-foreground">
            Os recibos ficam em{" "}
            <Link href={`/e/${empresaId}/documentos`} className="underline">
              Documentos
            </Link>
            .
          </p>
        ) : null}
      </section>
    </div>
  );
}
