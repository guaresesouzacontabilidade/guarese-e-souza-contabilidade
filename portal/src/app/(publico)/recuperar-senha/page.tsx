import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormularioRecuperacao } from "./formulario";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function PaginaRecuperarSenha() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Recuperar senha</CardTitle>
        <CardDescription>Informe o e-mail do seu acesso. Enviaremos um link para você criar uma nova senha.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormularioRecuperacao />
        <Link href="/login" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Voltar para o login
        </Link>
      </CardContent>
    </Card>
  );
}
