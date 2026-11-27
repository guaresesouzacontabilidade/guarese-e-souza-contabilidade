import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientesNfe, TransportadoresNfe } from "@/components/nfe/lista-cadastros";
import type { Destinatario, Transportador } from "@/components/nfe/cadastros";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Clientes e transportadores (NF-e)" };

export default async function CadastrosNfe({ params }: PageProps<"/e/[empresaId]/notas-produto/cadastros">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("nfe.emitir") && !ctx.pode("nfe.configurar")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de NF-e desta empresa.</Alerta>;

  const [{ data: clientes, error }, { data: transportadores }] = await Promise.all([
    ctx.supabase.from("nfe_destinatarios").select("*, municipio:municipios(nome, uf)").eq("empresa_id", empresaId).order("nome").limit(2000),
    ctx.supabase.from("nfe_transportadores").select("*").eq("empresa_id", empresaId).order("nome").limit(1000),
  ]);
  if (error) return <Alerta tom="perigo">Não foi possível carregar os cadastros: {mensagemErro(error)}</Alerta>;
  const listaClientes = (clientes ?? []).map((c) => {
    const m = c.municipio as { nome?: string; uf?: string } | null;
    return { ...c, municipio: m?.nome ?? null, uf: m?.uf ?? null };
  }) as Destinatario[];

  return (
    <>
      <CabecalhoPagina
        titulo="Clientes e transportadores"
        descricao="Compradores e transportadores usados nas notas de produto desta empresa."
        voltar={{ href: `/e/${empresaId}/notas-produto`, rotulo: "Notas de produto" }}
      />
      {!ctx.pode("nfe.emitir") ? <Alerta tom="info" className="mb-4">Somente quem emite as notas cadastra e altera clientes e transportadores.</Alerta> : null}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Clientes (compradores)</CardTitle>
            <CardDescription>A inscrição estadual do comprador contribuinte é obrigatória: confira com ele.</CardDescription>
          </CardHeader>
          <CardContent>
            <ClientesNfe empresaId={empresaId} clientes={listaClientes} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Transportadores</CardTitle>
            <CardDescription>Caminhoneiros e transportadoras, com placa e RNTRC.</CardDescription>
          </CardHeader>
          <CardContent>
            <TransportadoresNfe empresaId={empresaId} transportadores={(transportadores ?? []) as Transportador[]} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
