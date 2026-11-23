import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopiarPix } from "@/components/honorarios/cobrancas";
import { numeroCobranca } from "@/lib/honorarios/comum";
import { dadosEscritorio, pixDaCobranca, valorParaPagar } from "@/lib/honorarios/montar";
import { qrSvg } from "@/lib/honorarios/qr";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { cobrancaPorToken } from "./carregar";

export const metadata: Metadata = { title: "Pagamento de honorários", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Página de pagamento enviada ao cliente (link com código aleatório, sem
 * login): só o necessário para pagar — sem CPF/CNPJ nem outros dados.
 */
export default async function PaginaPagamento({ params }: PageProps<"/pagar/[token]">) {
  const { token } = await params;
  const r = await cobrancaPorToken(token);
  if (!r) notFound();
  const { c, itens } = r;
  const escritorio = await dadosEscritorio();
  const pagar = valorParaPagar(c);
  const pix = pixDaCobranca(c, pagar.valor);
  const qr = pix ? await qrSvg(pix) : null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1 text-center">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{escritorio.nome}</p>
        <CardTitle className="text-xl">{c.descricao}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {c.pagador_nome} · cobrança nº {numeroCobranca(c)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.situacao === "paga" ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-sucesso" />
            <p className="font-semibold">Pagamento recebido em {formatarData(c.pago_em)}.</p>
            <p className="text-sm text-muted-foreground">Obrigado! O recibo foi enviado por e-mail e está no portal.</p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p className="text-3xl font-bold text-titulo">{formatarMoeda(pagar.valor)}</p>
              <p className="text-sm text-muted-foreground">
                {pagar.atualizado
                  ? `Venceu em ${formatarData(c.vencimento)} · inclui multa ${formatarMoeda(pagar.atualizado.multa)} e juros ${formatarMoeda(pagar.atualizado.juros)} até hoje`
                  : `Vencimento em ${formatarData(c.vencimento)}`}
              </p>
            </div>
            {pix && qr ? (
              <>
                <div className="mx-auto w-56 rounded-xl border border-border bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
                <p className="text-center text-sm">Abra o aplicativo do seu banco, escolha Pix e aponte a câmera para o QR code — ou copie o código:</p>
                <p className="break-all rounded-md border border-dashed border-border bg-muted/40 p-2 font-mono text-xs">{pix}</p>
                <div className="flex justify-center">
                  <CopiarPix codigo={pix} />
                </div>
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground">Fale com o escritório para receber os dados de pagamento.</p>
            )}
            <details className="rounded-lg border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium">O que está sendo cobrado</summary>
              <ul className="mt-2 space-y-1">
                {itens.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span>{i.descricao}</span>
                    <span className="whitespace-nowrap">{formatarMoeda(i.valor)}</span>
                  </li>
                ))}
              </ul>
            </details>
            <p className="text-center text-xs text-muted-foreground">Depois de pagar, o escritório confere o pagamento e envia o recibo.</p>
          </>
        )}
        <div className="flex justify-center">
          <Button asChild variante="fantasma" tamanho="sm">
            <a href={`/pagar/${token}/pdf`}>
              <FileDown /> Baixar em PDF
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
