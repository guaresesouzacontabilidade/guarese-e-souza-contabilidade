import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioSenha } from "@/components/auth/formulario-senha";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Defina sua senha" };

export default async function Pagina() {
  // Conta com verificação em duas etapas: o provedor só aceita a nova senha
  // depois do código do aplicativo autenticador.
  const supabase = await criarClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims) {
    const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel?.nextLevel === "aal2" && nivel.currentLevel !== "aal2") redirect("/mfa?proximo=/definir-senha");
  }
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Defina sua senha</CardTitle>
        <CardDescription>Bem-vindo! Crie a senha que você usará para acessar o Catarinense Tech.</CardDescription>
      </CardHeader>
      <CardContent>
        <FormularioSenha textoBotao="Ativar meu acesso" origem="/definir-senha" />
      </CardContent>
    </Card>
  );
}
