"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { estadoInicial } from "@/lib/acoes";
import { solicitarRecuperacao } from "./acoes";

export function FormularioRecuperacao() {
  const [estado, acao, pendente] = useActionState(solicitarRecuperacao, estadoInicial);
  if (estado.ok) return <Alerta tom="sucesso">{estado.mensagem}</Alerta>;
  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.mensagem ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
      <Campo rotulo="E-mail" htmlFor="email" erro={estado.erros?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Campo>
      <Button type="submit" className="w-full" disabled={pendente}>
        <Mail />
        {pendente ? "Enviando..." : "Enviar link"}
      </Button>
    </form>
  );
}
