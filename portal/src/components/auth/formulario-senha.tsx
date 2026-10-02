"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { estadoInicial } from "@/lib/acoes";
import { definirSenha } from "./acoes-senha";

export function FormularioSenha({ textoBotao = "Salvar senha" }: { textoBotao?: string }) {
  const [estado, acao, pendente] = useActionState(definirSenha, estadoInicial);
  return (
    <form action={acao} className="space-y-4" noValidate>
      {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
      <Campo
        rotulo="Nova senha"
        htmlFor="senha"
        erro={estado.erros?.senha}
        ajuda="Mínimo de 10 caracteres, com letras maiúsculas, minúsculas e números."
      >
        <Input id="senha" name="senha" type="password" autoComplete="new-password" required />
      </Campo>
      <Campo rotulo="Confirme a nova senha" htmlFor="confirmacao" erro={estado.erros?.confirmacao}>
        <Input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" required />
      </Campo>
      <Button type="submit" className="w-full" disabled={pendente}>
        <KeyRound />
        {pendente ? "Salvando..." : textoBotao}
      </Button>
    </form>
  );
}
