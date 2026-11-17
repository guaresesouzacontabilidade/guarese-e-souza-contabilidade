"use client";

import * as React from "react";
import { Ban, Send, ShieldCheck } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Textarea } from "@/components/ui/form";
import { assinarRecibo, cancelarRecibo, publicarRecibo } from "@/lib/recibos/acoes";

/** Publica depois, nos documentos da empresa (Recibos). */
export function PublicarRecibo({ reciboId }: { reciboId: string }) {
  return (
    <BotaoAcao variante="contorno" tamanho="sm" acao={publicarRecibo.bind(null, reciboId)}>
      <Send /> Publicar para o cliente
    </BotaoAcao>
  );
}

/** Assina digitalmente um recibo emitido sem assinatura (ex.: antes do certificado). */
export function AssinarRecibo({ reciboId }: { reciboId: string }) {
  return (
    <BotaoAcao variante="contorno" tamanho="sm" acao={assinarRecibo.bind(null, reciboId)}>
      <ShieldCheck /> Assinar
    </BotaoAcao>
  );
}

/** Cancelamento com motivo: o recibo fica na lista, marcado como cancelado. */
export function CancelarRecibo({ reciboId, numero, publicado }: { reciboId: string; numero: string; publicado: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="fantasma" tamanho="sm" onClick={() => setAberto(true)}>
        <Ban /> Cancelar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo={`Cancelar o recibo nº ${numero}?`}
          descricao={`Ele continua na lista e o PDF passa a sair com a marca “CANCELADO”. O número não é usado de novo.${publicado ? " O PDF publicado sai dos documentos do cliente." : ""}`}
        >
          <FormularioAcao acao={cancelarRecibo.bind(null, reciboId)} aoSucesso={() => setAberto(false)} manterAoErrar className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Motivo" htmlFor={`motivo-recibo-${reciboId}`} erro={estado.erros?.motivo} obrigatorio>
                  <Textarea id={`motivo-recibo-${reciboId}`} name="motivo" rows={2} maxLength={300} placeholder="Ex.: valor digitado errado" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Cancelando...">
                    <Ban /> Cancelar o recibo
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}
