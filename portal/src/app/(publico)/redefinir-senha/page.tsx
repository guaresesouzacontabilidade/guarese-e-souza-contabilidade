import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioSenha } from "@/components/auth/formulario-senha";
import { criarClienteServidor } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Crie uma nova senha" };

export default async function Pagina() {
  // Conta com verificação em duas etapas: o provedor só aceita a nova senha
  // depois do código do aplicativo autenticador.
  const supabase = await criarClienteServidor();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims) {
    const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel?.nextLevel === "aal2" && nivel.currentLevel !== "aal2") redirect("/mfa?proximo=/redefinir-senha");
  }
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Crie uma nova senha</CardTitle>
        <CardDescription>Escolha uma nova senha para o seu acesso.</CardDescription>
      </CardHeader>
      <CardContent>
        <FormularioSenha textoBotao="Salvar nova senha" origem="/redefinir-senha" />
      </CardContent>
    </Card>
  );
}
