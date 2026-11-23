import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSignature } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { SITUACOES_CONTRATO, numeroContrato } from "@/lib/honorarios/contratos-comum";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Contratos com o escritório" };

export default async function ContratosCliente({ params }: PageProps<"/e/[empresaId]/contratos">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (ctx.equipe) redirect("/escritorio/honorarios/contratos");
  const { data } = await ctx.supabase.from("honorarios_contratos").select("id, ano, numero, titulo, situacao, enviado_em, aceite_em").eq("empresa_id", empresaId).order("enviado_em", { ascending: false });
  const lista = data ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <CabecalhoPagina titulo="Contratos com o escritório" descricao="O contrato de prestação de serviços, os aditivos e o distrato. O sócio titular lê e assina aqui." />
      {lista.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {lista.map((c) => {
            const sit = SITUACOES_CONTRATO[c.situacao as keyof typeof SITUACOES_CONTRATO];
            return (
              <li key={c.id}>
                <Link href={`/e/${empresaId}/contratos/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:text-primary">
                  <span>
                    <span className="block font-medium">{c.titulo}</span>
                    <span className="block text-xs text-muted-foreground">
                      nº {numeroContrato(c)} · {formatarData((c.aceite_em ?? c.enviado_em ?? "").slice(0, 10))}
                    </span>
                  </span>
                  <Badge variante={c.situacao === "enviado" ? "alerta" : sit.tom}>{c.situacao === "enviado" ? "Para assinar" : sit.rotulo}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EstadoVazio icone={FileSignature} titulo="Nenhum contrato por aqui" descricao="Quando o escritório enviar o contrato, ele aparece aqui para você assinar." />
      )}
    </div>
  );
}
