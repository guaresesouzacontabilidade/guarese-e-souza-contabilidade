import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioSenha } from "@/components/auth/formulario-senha";

export const metadata: Metadata = { title: "Crie uma nova senha" };

export default function Pagina() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Crie uma nova senha</CardTitle>
        <CardDescription>Escolha uma nova senha para o seu acesso.</CardDescription>
      </CardHeader>
      <CardContent>
        <FormularioSenha textoBotao="Salvar nova senha" />
      </CardContent>
    </Card>
  );
}
