import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PoliticaPrivacidade, TermosUso } from "@/components/auth/textos-legais";
import { obterSessao } from "@/lib/auth/sessao";
import { FormularioAceite } from "./formulario";

export const metadata: Metadata = { title: "Termos e privacidade" };

export default async function PaginaAceite() {
  const s = await obterSessao();
  if (!s) redirect("/login");
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-lg">Antes de começar</CardTitle>
        <CardDescription>Leia como o portal funciona e como seus dados são protegidos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="max-h-[45dvh] space-y-8 overflow-y-auto rounded-lg border border-border p-4">
          <section>
            <h2 className="mb-2 text-base font-semibold">Termos de uso</h2>
            <TermosUso />
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold">Política de privacidade</h2>
            <PoliticaPrivacidade />
          </section>
        </div>
        <FormularioAceite />
      </CardContent>
    </Card>
  );
}
