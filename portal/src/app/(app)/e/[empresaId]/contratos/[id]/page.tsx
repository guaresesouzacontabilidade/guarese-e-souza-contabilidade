import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, FileDown } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AssinarContrato } from "@/components/honorarios/contratos";
import { TextoContrato } from "@/components/honorarios/texto-contrato";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import type { Clausula, PartesContrato } from "@/lib/honorarios/contrato";
import { numeroContrato } from "@/lib/honorarios/contratos-comum";
import { emailConfigurado } from "@/lib/email/enviar";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Contrato" };

export default async function ContratoCliente({ params }: PageProps<"/e/[empresaId]/contratos/[id]">) {
  const { empresaId, id } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (ctx.equipe) redirect(`/escritorio/honorarios/contratos/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: c } = await ctx.supabase.from("honorarios_contratos").select("*").eq("id", id).eq("empresa_id", empresaId).maybeSingle();
  if (!c) notFound();
  const titular = ctx.acesso.papel === "cliente_titular";
  const dados = c.dados as unknown as { partes: PartesContrato };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <CabecalhoPagina titulo={c.titulo} descricao={`nº ${numeroContrato(c)}`} voltar={{ href: `/e/${empresaId}/contratos`, rotulo: "Contratos" }} />
      <div className="flex flex-wrap gap-2">
        <Button asChild variante="contorno">
          <a href={`/api/honorarios/contratos/${c.id}/pdf${c.final_path ? "?via=final" : ""}`}>
            <FileDown /> {c.final_path ? "Baixar a via assinada" : "Baixar em PDF"}
          </a>
        </Button>
      </div>
      {c.situacao === "assinado" ? (
        <Alerta tom="sucesso" titulo="Assinado">
          {c.aceite_nome} assinou em {formatarDataHora(c.aceite_em)}. A via assinada traz o registro das assinaturas.
        </Alerta>
      ) : null}
      <Card>
        <CardContent className="max-h-[60vh] overflow-y-auto pt-6">
          <TextoContrato partes={dados.partes} clausulas={c.clausulas as unknown as Clausula[]} />
        </CardContent>
      </Card>
      {c.situacao === "enviado" ? (
        titular ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary" /> Assinar
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AssinarContrato id={c.id} hash={c.arquivo_hash ?? ""} comCodigo={emailConfigurado()} nome={ctx.sessao.perfil.nome} />
            </CardContent>
          </Card>
        ) : (
          <Alerta tom="info">Só o sócio titular da empresa assina. Peça para ele entrar no portal.</Alerta>
        )
      ) : null}
    </div>
  );
}
