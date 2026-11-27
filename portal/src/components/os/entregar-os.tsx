"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCheck, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Input } from "@/components/ui/form";
import { formatarMoeda } from "@/lib/dinheiro";
import { entregarOs } from "@/lib/os/acoes";
import { QuadroAssinatura } from "./assinatura";
import { FormRecebimento, useResumoRecebimento, Valores } from "./receber-os";

/**
 * Entrega da OS: confere o que falta receber (e recebe na hora, se precisar),
 * registra quem retirou, o documento e a assinatura na tela.
 */
export function DialogoEntregar({ empresaId, osId, aoFechar, aoEntregar }: { empresaId: string; osId: string; aoFechar: () => void; aoEntregar: () => void }) {
  const { resumo, erro, carregar } = useResumoRecebimento(empresaId, osId);
  const [nome, setNome] = React.useState("");
  const [documento, setDocumento] = React.useState("");
  const [assinatura, setAssinatura] = React.useState<string | null>(null);
  const [assinar, setAssinar] = React.useState(false);
  const [receber, setReceber] = React.useState(false);
  const [pendente, iniciar] = React.useTransition();

  const exigeAssinatura = Boolean(resumo?.exigirAssinatura);
  const bloqueadoPagamento = Boolean(resumo && resumo.exigirPagamento && resumo.falta > 0);
  const mostrarQuadro = exigeAssinatura || assinar;
  const podeConfirmar = resumo && !bloqueadoPagamento && (!exigeAssinatura || (assinatura && nome.trim().length >= 2));

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent titulo={resumo ? `Entregar a OS nº ${resumo.numero}` : "Entregar"} descricao={resumo ? `Cliente: ${resumo.cliente}` : undefined} largura="md">
        {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
        {!resumo && !erro ? <Loader2 className="mx-auto my-6 size-6 animate-spin text-muted-foreground" /> : null}
        {resumo ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!podeConfirmar) return;
              iniciar(async () => {
                const r = await entregarOs(empresaId, osId, { retirado_por: nome, retirado_documento: documento, assinatura: mostrarQuadro ? assinatura : null });
                if (r.ok) {
                  toast.success(`OS nº ${resumo.numero} entregue.`);
                  aoEntregar();
                } else toast.error(r.mensagem ?? "Não foi possível entregar.");
              });
            }}
          >
            {resumo.total > 0 ? <Valores r={resumo} /> : null}
            {resumo.falta > 0 ? (
              <div className="space-y-2">
                <Alerta tom={bloqueadoPagamento ? "alerta" : "info"}>
                  Falta receber {formatarMoeda(resumo.falta)}.{bloqueadoPagamento ? " A loja pede o pagamento antes da entrega." : " Dá para entregar e receber depois."}
                </Alerta>
                {resumo.podeReceber && !receber ? (
                  <Button type="button" variante="contorno" tamanho="sm" onClick={() => setReceber(true)}>
                    <Wallet /> Receber agora
                  </Button>
                ) : null}
                {receber ? (
                  <div className="rounded-lg border border-border p-3">
                    <FormRecebimento
                      key={`${resumo.recebido}-${resumo.aReceber}`}
                      empresaId={empresaId}
                      osId={osId}
                      r={resumo}
                      aoRegistrar={() => {
                        setReceber(false);
                        carregar();
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Quem retirou?" htmlFor="os-retirado" obrigatorio={exigeAssinatura} ajuda={exigeAssinatura ? undefined : "Opcional."}>
                <Input id="os-retirado" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoComplete="off" />
              </Campo>
              <Campo rotulo="Documento (CPF ou RG)" htmlFor="os-retirado-doc" ajuda="Opcional.">
                <Input id="os-retirado-doc" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={30} autoComplete="off" />
              </Campo>
            </div>
            {mostrarQuadro ? (
              <div>
                <p className="mb-1 text-sm font-medium">Assinatura de quem retira{exigeAssinatura ? " (obrigatória)" : ""}</p>
                <QuadroAssinatura aoMudar={setAssinatura} desabilitado={pendente} />
              </div>
            ) : (
              <Button type="button" variante="link" tamanho="sm" onClick={() => setAssinar(true)}>
                Pegar a assinatura na tela (opcional)
              </Button>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={!podeConfirmar || pendente}>
                {pendente ? <Loader2 className="animate-spin" /> : <CheckCheck />} Confirmar entrega
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
