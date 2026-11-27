import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { criarClienteServidor } from "@/lib/supabase/server";
import { destinoSeguro } from "@/lib/requisicao";
import { FormularioDesbloqueio } from "./formulario-desbloqueio";

export const metadata: Metadata = { title: "Continuar no portal" };

/** Sessão mantida no dia e travada porque o portal foi fechado: volta com a senha, sem o código. */
export default async function PaginaDesbloquear({ searchParams }: PageProps<"/desbloquear">) {
  const sp = await searchParams;
  const pedido = destinoSeguro(typeof sp.proximo === "string" ? sp.proximo : null);
  const proximo = pedido.startsWith("/desbloquear") ? "/painel" : pedido;
  const supabase = await criarClienteServidor();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const { data: estado } = await supabase.rpc("estado_acesso");
  if (!(estado as { sessao_bloqueada?: boolean } | null)?.sessao_bloqueada) redirect(proximo);
  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-lg">Bem-vindo de volta</CardTitle>
        <CardDescription>
          O portal foi fechado. Como você já confirmou o código da verificação em duas etapas hoje neste aparelho, basta a senha de{" "}
          <strong className="text-foreground">{email}</strong> para continuar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormularioDesbloqueio proximo={proximo} email={email} />
      </CardContent>
    </Card>
  );
}
