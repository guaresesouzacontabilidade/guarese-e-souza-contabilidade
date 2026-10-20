"use client";

import * as React from "react";
import { Ban, FilePenLine } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { cancelarNota, cartaCorrecao } from "@/lib/nfe-emissao/acoes";

export function CancelarNfe({ empresaId, id, numero, autorizadaEm }: { empresaId: string; id: string; numero: number; autorizadaEm: string | null }) {
  const [aberto, setAberto] = React.useState(false);
  // Horas desde a autorização, medidas ao abrir o pedido de cancelamento
  const [horas, setHoras] = React.useState(0);
  return (
    <>
      <Button
        variante="contorno"
        onClick={() => {
          setHoras(autorizadaEm ? (Date.now() - new Date(autorizadaEm).getTime()) / 3_600_000 : 0);
          setAberto(true);
        }}
      >
        <Ban /> Cancelar nota
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={`Cancelar a NF-e nº ${numero}`} descricao="O pedido de cancelamento vai para a SEFAZ com o certificado da empresa.">
          <FormularioAcao acao={cancelarNota.bind(null, empresaId, id)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                {horas > 24 ? (
                  <Alerta tom="alerta">
                    A nota foi autorizada há mais de 24 horas. A maioria das SEFAZ só aceita o cancelamento em até 24 horas; depois disso, pode ser preciso um pedido
                    extemporâneo pelo site da SEFAZ ou uma nota de entrada. Fale com o escritório.
                  </Alerta>
                ) : (
                  <Alerta tom="info">Só cancele se a mercadoria não saiu. Se ela já circulou, fale com o escritório antes.</Alerta>
                )}
                <Campo rotulo="Motivo do cancelamento" htmlFor="justificativa" obrigatorio erro={estado.erros?.justificativa} ajuda="De 15 a 255 caracteres.">
                  <Textarea id="justificativa" name="justificativa" rows={3} maxLength={255} minLength={15} />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Enviando...">
                    Cancelar a nota
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

export function CartaCorrecaoNfe({ empresaId, id, numero }: { empresaId: string; id: string; numero: number }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <FilePenLine /> Carta de correção
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={`Carta de correção da NF-e nº ${numero}`} descricao="A última carta substitui as anteriores: escreva todas as correções juntas.">
          <FormularioAcao acao={cartaCorrecao.bind(null, empresaId, id)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                <Alerta tom="info">
                  A carta de correção não pode mudar valores, quantidades, alíquotas, o emitente, o comprador nem as datas. Serve, por exemplo, para placa,
                  endereço de entrega, peso ou texto da natureza.
                </Alerta>
                <Campo rotulo="Correção" htmlFor="correcao" obrigatorio erro={estado.erros?.correcao} ajuda="De 15 a 1.000 caracteres.">
                  <Textarea id="correcao" name="correcao" rows={5} maxLength={1000} minLength={15} />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Enviando...">
                    Enviar carta de correção
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
