"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { estadoInicial } from "@/lib/acoes";
import { desbloquearSessao } from "./acoes";

export function FormularioDesbloqueio({ proximo, email }: { proximo: string; email: string }) {
  const [estado, acao, pendente] = useActionState(desbloquearSessao, estadoInicial);
  const [verSenha, setVerSenha] = useState(false);
  return (
    <div className="space-y-4">
      <form action={acao} className="space-y-4" noValidate>
        {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
        <input type="hidden" name="proximo" value={proximo} />
        {/* Ajuda o gerenciador de senhas do navegador a reconhecer a conta */}
        <input type="email" name="usuario" autoComplete="username" value={email} readOnly hidden />
        <Campo rotulo="Senha" htmlFor="senha">
          <div className="relative">
            <Input id="senha" name="senha" type={verSenha ? "text" : "password"} autoComplete="current-password" required autoFocus className="pr-11" />
            <button
              type="button"
              onClick={() => setVerSenha((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
            >
              {verSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Campo>
        <Button type="submit" className="w-full" tamanho="lg" disabled={pendente}>
          <LockOpen />
          {pendente ? "Conferindo..." : "Continuar"}
        </Button>
      </form>
      <form action="/auth/sair" method="post" className="text-center">
        <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Não é você? Sair e entrar com outra conta
        </button>
      </form>
    </div>
  );
}
