import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { FormularioCobranca } from "@/components/honorarios/cobrancas";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { numeroCobranca } from "@/lib/honorarios/comum";
import { hojeISO } from "@/lib/competencia";
import { dadosFormularioCobranca } from "../../carregar-form";

export const metadata: Metadata = { title: "Editar cobrança" };

export default async function EditarCobranca({ params }: PageProps<"/escritorio/honorarios/cobrancas/[id]/editar">) {
  const s = await exigirHonorarios();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: c } = await s.supabase.from("honorarios_cobrancas").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  if (c.situacao !== "rascunho" && c.situacao !== "aberta") redirect(`/escritorio/honorarios/cobrancas/${id}`);
  const [{ data: itens }, { empresas, categorias }] = await Promise.all([
    s.supabase.from("honorarios_cobranca_itens").select("descricao, categoria_id, quantidade, valor_unitario").eq("cobranca_id", id).order("ordem"),
    dadosFormularioCobranca(s),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <CabecalhoPagina titulo={`Editar cobrança nº ${numeroCobranca(c)}`} descricao={c.pagador_nome} voltar={{ href: `/escritorio/honorarios/cobrancas/${id}`, rotulo: "Cobrança" }} />
      <Card>
        <CardContent className="pt-6">
          <FormularioCobranca
            empresas={empresas}
            categorias={categorias}
            hoje={hojeISO()}
            inicial={{
              id: c.id,
              pagador: c.pagador_nome,
              descricao: c.descricao,
              vencimento: c.vencimento,
              contato_email: c.contato_email,
              contato_whatsapp: c.contato_whatsapp,
              whatsapp_autorizado: c.whatsapp_autorizado,
              situacao: c.situacao,
              itens: (itens ?? []).map((i) => ({ descricao: i.descricao, categoria_id: i.categoria_id, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario) })),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
