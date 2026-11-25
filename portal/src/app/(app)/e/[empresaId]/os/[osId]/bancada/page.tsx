import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { Alerta } from "@/components/ui/feedback";
import { Bancada, type OsBancada } from "@/components/os/bancada";
import type { PessoaOs } from "@/components/os/form-os";

export const metadata: Metadata = { title: "Bancada" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tela da bancada (aberta pelo QR Code da OS impressa ou da etiqueta). */
export default async function BancadaOs({ params }: PageProps<"/e/[empresaId]/os/[osId]/bancada">) {
  const { empresaId, osId } = await params;
  if (!UUID.test(osId)) notFound();
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("os.operar")) return <Alerta tom="alerta">Seu acesso não inclui as ordens de serviço desta empresa.</Alerta>;
  const [{ data: o }, { data: itens }, { data: equipe }, { data: fotos }] = await Promise.all([
    ctx.supabase.from("os_ordens").select("*").eq("id", osId).eq("empresa_id", empresaId).maybeSingle(),
    ctx.supabase.from("os_itens").select("descricao, quantidade, unidade, posicao, servico:os_servicos(setor)").eq("ordem_id", osId).order("posicao"),
    ctx.supabase.from("os_equipe").select("id, nome, cor, ativo").eq("empresa_id", empresaId).order("nome"),
    ctx.supabase.from("os_fotos").select("id, momento, legenda, mime, enviado_por").eq("ordem_id", osId).not("confirmado_em", "is", null).order("created_at"),
  ]);
  if (!o) notFound();
  const fechada = o.etapa === "entregue" || o.etapa === "cancelada";
  const os: OsBancada = {
    ...o,
    itens: (itens ?? []).map((i) => ({
      descricao: i.descricao,
      quantidade: i.quantidade,
      unidade: i.unidade,
      setor: (i.servico as { setor?: string | null } | null)?.setor ?? null,
    })),
  };
  return (
    <Bancada
      empresaId={empresaId}
      os={os}
      equipe={(equipe ?? []) as PessoaOs[]}
      podeEntregar
      fotos={(fotos ?? []).map((f) => ({
        id: f.id,
        momento: f.momento,
        legenda: f.legenda,
        mime: f.mime,
        podeExcluir: ctx.pode("os.gerenciar") || (f.enviado_por === ctx.sessao.usuarioId && !fechada),
      }))}
    />
  );
}
