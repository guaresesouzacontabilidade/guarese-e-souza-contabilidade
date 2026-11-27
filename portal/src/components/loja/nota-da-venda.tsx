"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2, FileText, Loader2, Receipt, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { emitirNotaDaVenda, type SituacaoNotaVenda } from "@/lib/gestao/acoes";
import { DOCUMENTO_FISCAL, type DocumentoFiscal } from "@/lib/gestao/rotulos";
import { EM_ANDAMENTO, SITUACAO_NFE, type SituacaoNfe } from "@/lib/nfe-emissao/rotulos";

/** Situações em que a venda pediu nota e ela ainda não saiu: dá para emitir de novo daqui. */
const PENDENTES = new Set(["rejeitada", "falha", "descartada", "cancelada"]);

/**
 * Nota fiscal da venda (cupom ou NF-e) na tela da venda: situação, impressão
 * do cupom e, quando a nota pedida no caixa não saiu, o botão para emitir de
 * novo. Quem vende acompanha só a nota da própria venda.
 */
export function NotaDaVenda({
  empresaId,
  vendaId,
  pedida,
  nota,
  disponiveis,
  podeVerNotas,
}: {
  empresaId: string;
  vendaId: string;
  /** Documento escolhido no caixa (vazio quando a venda não pediu nota). */
  pedida: DocumentoFiscal | null;
  nota: SituacaoNotaVenda | null;
  /** Documentos que dá para emitir agora (para o botão de emitir de novo). */
  disponiveis: Record<DocumentoFiscal, boolean>;
  /** Quem emite notas pela tela de notas (abre a nota e o DANFE da NF-e). */
  podeVerNotas: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  const situacao = nota?.situacao ?? null;
  const andamento = situacao ? EM_ANDAMENTO.includes(situacao as SituacaoNfe) : false;
  const documento: DocumentoFiscal | null = nota?.modelo === 65 ? "nfce" : nota?.modelo === 55 ? "nfe" : pedida;

  // Enquanto a SEFAZ responde, a página se atualiza sozinha
  React.useEffect(() => {
    if (!andamento) return;
    const t = window.setTimeout(() => router.refresh(), 4000);
    return () => window.clearTimeout(t);
  }, [andamento, router, situacao]);

  if (!documento) return null;
  const pendente = !situacao || PENDENTES.has(situacao);
  // A nota pedida no caixa que não saiu: emitir de novo (a recusada volta com o mesmo número)
  if (pendente && !pedida) return null;

  async function emitir(d: DocumentoFiscal) {
    setEnviando(true);
    const r = await emitirNotaDaVenda(empresaId, vendaId, d);
    setEnviando(false);
    if (!r.ok) return toast.error(r.mensagem ?? "A nota não pôde ser enviada.");
    toast.success(r.mensagem);
    router.refresh();
  }

  const sit = situacao ? SITUACAO_NFE[situacao as SituacaoNfe] : null;
  const nome = DOCUMENTO_FISCAL[documento].longo;
  const opcoes: DocumentoFiscal[] = situacao === "falha" || situacao === "rejeitada" ? [documento] : (["nfce", "nfe"] as DocumentoFiscal[]).filter((d) => disponiveis[d]);

  return (
    <div
      className={`space-y-2 rounded-xl border p-3 text-sm ${pendente ? "border-alerta/50 bg-alerta/5" : "border-border"}`}
      data-testid="nota-da-venda"
      role={pendente ? "alert" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <FileCheck2 className="size-4 text-primary" />
          {nome}
          {nota?.numero ? ` nº ${nota.numero}` : ""}
          {nota?.ambiente === "homologacao" ? <Badge variante="alerta">teste</Badge> : null}
        </span>
        {pendente ? (
          <Badge variante="alerta">Nota pendente</Badge>
        ) : andamento ? (
          <Badge variante="info">
            <Loader2 className="animate-spin" /> Enviando à SEFAZ
          </Badge>
        ) : sit ? (
          <Badge variante={sit.tom}>{sit.rotulo}</Badge>
        ) : null}
      </div>
      {pendente ? (
        <p className="text-xs">
          {situacao === "falha"
            ? "A SEFAZ não respondeu. Envie de novo: o portal confere antes, para não emitir duas vezes."
            : situacao === "rejeitada"
              ? "A SEFAZ recusou a nota. Confira o motivo, corrija o que for preciso (cadastro do cliente ou do produto) e envie de novo."
              : "Esta venda pediu nota fiscal no caixa, mas a nota ainda não saiu."}
        </p>
      ) : sit && !andamento ? (
        <p className="text-xs text-muted-foreground">{sit.ajuda}</p>
      ) : null}
      {nota?.motivo && (pendente || situacao === "denegada") ? <p className="text-xs text-perigo">{nota.motivo}</p> : null}
      <div className="flex flex-wrap gap-2">
        {situacao === "autorizada" && documento === "nfce" ? (
          <Button asChild tamanho="sm">
            <a href={`/impressao/cupom/${vendaId}`} target="_blank" rel="noopener">
              <Receipt /> Imprimir cupom
            </a>
          </Button>
        ) : null}
        {situacao === "autorizada" && documento === "nfe" && podeVerNotas && nota?.id ? (
          <Button asChild tamanho="sm">
            <a href={`/api/nfe/${empresaId}/${nota.id}`} target="_blank" rel="noopener">
              <FileText /> Imprimir DANFE
            </a>
          </Button>
        ) : null}
        {pendente
          ? opcoes.map((d) => (
              <Button key={d} tamanho="sm" variante={d === documento ? "primario" : "contorno"} onClick={() => emitir(d)} disabled={enviando}>
                {enviando ? <Loader2 className="animate-spin" /> : <RotateCw />} {situacao === "falha" ? "Enviar de novo" : d === "nfe" ? "Emitir NF-e" : "Emitir cupom fiscal"}
              </Button>
            ))
          : null}
        {podeVerNotas && nota?.id ? (
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={`/e/${empresaId}/notas-produto/${nota.id}`}>Ver a nota</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
