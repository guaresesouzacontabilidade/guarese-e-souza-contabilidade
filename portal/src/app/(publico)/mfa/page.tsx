import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerificarMfa } from "@/components/auth/verificar-mfa";
import { destinoSeguro } from "@/lib/requisicao";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function PaginaMfa({ searchParams }: PageProps<"/mfa">) {
  const sp = await searchParams;
  const proximo = destinoSeguro(typeof sp.proximo === "string" ? sp.proximo : null);
  const trocaSenha = proximo === "/redefinir-senha" || proximo === "/definir-senha";
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Verificação em duas etapas</CardTitle>
        <CardDescription>
          {trocaSenha
            ? "Sua conta tem verificação em duas etapas. Para criar a nova senha, informe antes o código do aplicativo autenticador."
            : "Para sua segurança, informe o código do aplicativo autenticador."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VerificarMfa proximo={proximo} />
        {trocaSenha ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Sem acesso ao aplicativo (celular trocado ou perdido)? Peça ao administrador do escritório para remover a verificação em duas etapas da sua
            conta e depois peça um novo link de senha.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
