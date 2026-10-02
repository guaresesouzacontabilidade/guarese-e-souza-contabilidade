import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { CadastrarMfa } from "@/components/auth/cadastrar-mfa";
import { destinoSeguro } from "@/lib/requisicao";

export const metadata: Metadata = { title: "Ativar verificação em duas etapas" };

export default async function PaginaCadastrarMfa({ searchParams }: PageProps<"/mfa/cadastrar">) {
  const sp = await searchParams;
  const obrigatorio = sp.obrigatorio === "1";
  const proximo = destinoSeguro(typeof sp.proximo === "string" ? sp.proximo : null, obrigatorio ? "/painel" : "/conta");
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Ativar verificação em duas etapas</CardTitle>
        <CardDescription>Além da senha, será pedido um código do seu celular a cada novo acesso.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {obrigatorio ? (
          <Alerta tom="info">O escritório exige a verificação em duas etapas para o seu perfil de acesso.</Alerta>
        ) : null}
        <CadastrarMfa proximo={proximo} />
      </CardContent>
    </Card>
  );
}
