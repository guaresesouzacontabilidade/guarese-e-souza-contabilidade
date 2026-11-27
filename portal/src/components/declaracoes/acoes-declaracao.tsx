"use client";

import * as React from "react";
import { Ban, FileUp } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { cancelarDeclaracao, enviarDeclaracaoAssinada } from "@/lib/declaracoes/acoes";

/** Envio do PDF assinado (certificado digital, gov.br ou à mão e digitalizado). */
export function EnviarDeclaracaoAssinada({ empresaId, declaracaoId, substituir }: { empresaId: string; declaracaoId: string; substituir: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="contorno" tamanho="sm" onClick={() => setAberto(true)}>
        <FileUp /> {substituir ? "Trocar a assinada" : "Enviar a assinada"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo="Enviar a declaração assinada"
          descricao="Envie o PDF depois das assinaturas do representante legal e do contador — com certificado digital, pelo gov.br (assinador.iti.br) ou à mão e digitalizado. O arquivo fica guardado aqui para o escritório e o cliente."
        >
          <FormularioAcao acao={enviarDeclaracaoAssinada.bind(null, empresaId, declaracaoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="PDF assinado" htmlFor={`assinada-${declaracaoId}`} erro={estado.erros?.arquivo} ajuda="Arquivo PDF de até 10 MB." obrigatorio>
                  <Input id={`assinada-${declaracaoId}`} name="arquivo" type="file" accept="application/pdf,.pdf" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Enviando...">
                    <FileUp /> Enviar
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

/** Cancelamento (equipe): a declaração fica no histórico, marcada como cancelada. */
export function CancelarDeclaracao({ empresaId, declaracaoId }: { empresaId: string; declaracaoId: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="fantasma" tamanho="sm" onClick={() => setAberto(true)}>
        <Ban /> Cancelar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo="Cancelar esta declaração?"
          descricao="Ela continua no histórico e o PDF passa a sair com a marca “CANCELADA”. Para corrigir valores, emita uma nova (dá para usar esta como base)."
        >
          <FormularioAcao acao={cancelarDeclaracao.bind(null, empresaId, declaracaoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Motivo" htmlFor={`motivo-${declaracaoId}`} erro={estado.erros?.motivo} obrigatorio>
                  <Textarea id={`motivo-${declaracaoId}`} name="motivo" rows={2} maxLength={500} placeholder="Ex.: valor de março corrigido" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Cancelando...">
                    <Ban /> Cancelar a declaração
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
