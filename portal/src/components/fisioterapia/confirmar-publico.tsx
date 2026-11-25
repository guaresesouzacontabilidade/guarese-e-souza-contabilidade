"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Textarea } from "@/components/ui/form";
import { responderConfirmacao } from "@/lib/fisioterapia/confirmacao-publica";

/** Botões do paciente: confirmar a presença ou avisar que não vai (com o motivo, opcional). */
export function RespostaConfirmacao({ codigo }: { codigo: string }) {
  const router = useRouter();
  const [desmarcar, setDesmarcar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendente, iniciar] = React.useTransition();

  const responder = (resposta: "confirmou" | "desmarcou") =>
    iniciar(async () => {
      setErro(null);
      const r = await responderConfirmacao(codigo, resposta, motivo);
      if (r.ok) router.refresh();
      else setErro(r.mensagem ?? "Não foi possível registrar. Tente de novo ou ligue para a clínica.");
    });

  return (
    <div className="space-y-3">
      {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
      {!desmarcar ? (
        <div className="grid gap-2">
          <Button className="h-12 text-base" onClick={() => responder("confirmou")} disabled={pendente}>
            {pendente ? <Loader2 className="animate-spin" /> : <CalendarCheck />} Confirmar presença
          </Button>
          <Button variante="contorno" className="h-12 text-base" onClick={() => setDesmarcar(true)} disabled={pendente}>
            <CalendarX /> Não vou poder ir
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Campo rotulo="Quer contar o motivo? (opcional)" htmlFor="motivo-desmarcar">
            <Textarea id="motivo-desmarcar" rows={2} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
          <div className="grid grid-cols-2 gap-2">
            <Button variante="fantasma" onClick={() => setDesmarcar(false)} disabled={pendente}>
              Voltar
            </Button>
            <Button variante="perigo" onClick={() => responder("desmarcou")} disabled={pendente}>
              {pendente ? <Loader2 className="animate-spin" /> : null} Desmarcar horário
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
