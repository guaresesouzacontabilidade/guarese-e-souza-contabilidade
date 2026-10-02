import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TermosUso } from "@/components/auth/textos-legais";
import { VERSAO_TERMOS } from "@/lib/termos";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Termos de uso" };

export default function Pagina() {
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle className="text-xl">Termos de uso</CardTitle>
        <p className="text-xs text-muted-foreground">Versão de {formatarData(VERSAO_TERMOS)}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <TermosUso />
        <Link href="/login" className="text-sm text-primary hover:underline">
          Voltar ao portal
        </Link>
      </CardContent>
    </Card>
  );
}
