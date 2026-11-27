"use client";

import * as React from "react";
import { Ban } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Select, Textarea } from "@/components/ui/form";
import { cancelarNota } from "@/lib/nfse-emissao/acoes";
import { MOTIVOS_CANCELAMENTO } from "@/lib/nfse-emissao/rotulos";

export function CancelarNota({ empresaId, id, numero }: { empresaId: string; id: string; numero: string | null }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <Ban /> Cancelar nota
      </Button>
      <DialogContent
        titulo={`Cancelar a nota${numero ? ` nº ${numero}` : ""}`}
        descricao="O cancelamento é registrado no Emissor Nacional e não pode ser desfeito. O prazo para cancelar depende das regras do município."
      >
        <FormularioAcao acao={cancelarNota.bind(null, empresaId, id)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Motivo" htmlFor="motivo" obrigatorio erro={estado.erros?.motivo}>
                <Select id="motivo" name="motivo" defaultValue="1">
                  {Object.entries(MOTIVOS_CANCELAMENTO).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Explique o motivo" htmlFor="justificativa" obrigatorio erro={estado.erros?.justificativa} ajuda="De 15 a 255 caracteres. Vai para o registro do cancelamento.">
                <Textarea id="justificativa" name="justificativa" rows={3} minLength={15} maxLength={255} />
              </Campo>
              <div className="flex justify-end gap-2">
                <Button type="button" variante="contorno" onClick={() => setAberto(false)}>
                  Voltar
                </Button>
                <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Enviando...">
                  Cancelar a nota
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
