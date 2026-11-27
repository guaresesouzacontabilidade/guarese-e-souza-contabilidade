"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { estadoInicial } from "@/lib/acoes";
import { entrar } from "./acoes";

export function FormularioLogin({ proximo, aviso }: { proximo?: string; aviso?: string | null }) {
  const [estado, acao, pendente] = useActionState(entrar, estadoInicial);
  const [verSenha, setVerSenha] = useState(false);
  return (
    <form action={acao} className="space-y-4" noValidate>
      {aviso ? <Alerta tom="alerta">{aviso}</Alerta> : null}
      {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
      <input type="hidden" name="proximo" value={proximo ?? ""} />
      <Campo rotulo="E-mail" htmlFor="email" erro={estado.erros?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required autoFocus />
      </Campo>
      <Campo rotulo="Senha" htmlFor="senha" erro={estado.erros?.senha}>
        <div className="relative">
          <Input id="senha" name="senha" type={verSenha ? "text" : "password"} autoComplete="current-password" required className="pr-11" />
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
        <LogIn />
        {pendente ? "Entrando..." : "Entrar"}
      </Button>
      <div className="text-center text-sm">
        <Link href="/recuperar-senha" className="text-primary underline-offset-4 hover:underline">
          Esqueci minha senha
        </Link>
      </div>
    </form>
  );
}
