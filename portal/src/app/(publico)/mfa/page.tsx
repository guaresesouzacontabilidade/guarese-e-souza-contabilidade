import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerificarMfa } from "@/components/auth/verificar-mfa";
import { destinoSeguro } from "@/lib/requisicao";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default async function PaginaMfa({ searchParams }: PageProps<"/mfa">) {
  const sp = await searchParams;
  const proximo = destinoSeguro(typeof sp.proximo === "string" ? sp.proximo : null);
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Verificação em duas etapas</CardTitle>
        <CardDescription>Para sua segurança, informe o código do aplicativo autenticador.</CardDescription>
      </CardHeader>
      <CardContent>
        <VerificarMfa proximo={proximo} />
      </CardContent>
    </Card>
  );
}
