import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { Logo } from "@/components/marca/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmarLink } from "./acoes";

export const metadata: Metadata = { title: "Confirmar acesso" };

const TITULOS: Record<string, { titulo: string; texto: string; botao: string }> = {
  invite: { titulo: "Ativar acesso", texto: "Você foi convidado para o Portal Guarese's ON. Continue para definir sua senha.", botao: "Continuar e definir senha" },
  recovery: { titulo: "Redefinir senha", texto: "Continue para criar uma nova senha de acesso.", botao: "Continuar" },
  email_change: { titulo: "Confirmar novo e-mail", texto: "Confirme a alteração do e-mail do seu acesso.", botao: "Confirmar" },
};

/**
 * A confirmação exige um clique (POST) para evitar que verificadores automáticos
 * de links consumam o token de uso único.
 */
export default async function PaginaConfirmar({ searchParams }: PageProps<"/auth/confirm">) {
  const sp = await searchParams;
  const tipo = typeof sp.type === "string" ? sp.type : "";
  const info = TITULOS[tipo] ?? { titulo: "Confirmar acesso", texto: "Continue para acessar o portal.", botao: "Continuar" };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/60 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Logo className="mb-2 h-12" />
          <CardTitle className="text-lg">{info.titulo}</CardTitle>
          <CardDescription>{info.texto}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={confirmarLink}>
            <input type="hidden" name="token_hash" value={typeof sp.token_hash === "string" ? sp.token_hash : ""} />
            <input type="hidden" name="type" value={tipo} />
            <input type="hidden" name="next" value={typeof sp.next === "string" ? sp.next : ""} />
            <Button type="submit" className="w-full" tamanho="lg">
              <KeyRound />
              {info.botao}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
