"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { estadoInicial } from "@/lib/acoes";
import { aceitarTermos } from "./acoes";

export function FormularioAceite() {
  const [estado, acao, pendente] = useActionState(aceitarTermos, estadoInicial);
  return (
    <form action={acao} className="space-y-4">
      {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
      <label className="flex items-start gap-3 text-sm">
        <Checkbox name="concordo" className="mt-0.5" required />
        <span>Li e concordo com os Termos de uso e com a Política de privacidade do Portal Guarese&apos;s ON.</span>
      </label>
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Registrando..." : "Concordar e continuar"}
      </Button>
    </form>
  );
}
