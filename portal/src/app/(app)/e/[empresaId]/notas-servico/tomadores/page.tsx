import type { Metadata } from "next";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent } from "@/components/ui/card";
import { TomadoresSalvos } from "@/components/nfse/tomadores";
import { mensagemErro } from "@/lib/acoes";
import type { TomadorSalvo } from "@/lib/nfse-emissao/acoes";

export const metadata: Metadata = { title: "Tomadores salvos" };

/** Tomadores (CPF/CNPJ) salvos para escolher ao emitir a nota de serviço. */
export default async function Tomadores({ params }: PageProps<"/e/[empresaId]/notas-servico/tomadores">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const base = `/e/${empresaId}/notas-servico`;
  if (!ctx.pode("nfse.emitir")) return <Alerta tom="alerta">Seu acesso não inclui a emissão de notas desta empresa.</Alerta>;

  const { data, error } = await ctx.supabase
    .from("nfse_tomadores")
    .select("id, tipo, documento, nome, email, telefone, endereco, ultimo_uso_em")
    .eq("empresa_id", empresaId)
    .order("nome")
    .limit(2000);
  if (error) return <Alerta tom="perigo">Não foi possível carregar os tomadores: {mensagemErro(error)}</Alerta>;

  return (
    <>
      <CabecalhoPagina
        titulo="Tomadores salvos"
        descricao="Clientes (CPF ou CNPJ) para quem a empresa emite nota de serviço. Ao emitir, é só escolher na lista: nome, endereço e contato já vêm preenchidos."
        voltar={{ href: base, rotulo: "Notas de serviço" }}
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <TomadoresSalvos empresaId={empresaId} tomadores={(data ?? []) as TomadorSalvo[]} />
        </CardContent>
      </Card>
    </>
  );
}
