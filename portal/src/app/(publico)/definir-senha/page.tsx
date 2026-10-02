import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioSenha } from "@/components/auth/formulario-senha";

export const metadata: Metadata = { title: "Defina sua senha" };

export default function Pagina() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Defina sua senha</CardTitle>
        <CardDescription>Bem-vindo! Crie a senha que você usará para acessar o Portal Guarese’s ON.</CardDescription>
      </CardHeader>
      <CardContent>
        <FormularioSenha textoBotao="Ativar meu acesso" />
      </CardContent>
    </Card>
  );
}
