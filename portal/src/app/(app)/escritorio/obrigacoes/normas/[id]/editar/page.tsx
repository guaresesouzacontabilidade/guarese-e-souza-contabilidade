import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { FormRegra } from "@/components/obrigacoes/form-regra";
import { hojeISO } from "@/lib/competencia";
import { editarProposta } from "@/lib/obrigacoes/acoes";
import { carregarLocalEscritorio } from "@/lib/obrigacoes/local";
import type { RegraObrigacao } from "@/lib/obrigacoes/regras";

export const metadata: Metadata = { title: "Corrigir proposta" };

/** Correção de uma proposta antes da validação (a regra proposta ainda não vale). */
export default async function EditarProposta({ params }: PageProps<"/escritorio/obrigacoes/normas/[id]/editar">) {
  const { id } = await params;
  const s = await exigirEquipe();
  const { data: n } = await s.supabase
    .from("atualizacoes_normativas")
    .select("*, obrigacao:obrigacoes(id, nome, periodicidade, etapas, esfera), proposta:obrigacao_regras!atualizacoes_normativas_regra_proposta_id_fkey(*)")
    .eq("id", id)
    .maybeSingle();
  if (!n) notFound();
  const o = n.obrigacao as unknown as { id: string; nome: string; periodicidade: string; etapas: string[]; esfera: string };
  const regra = n.proposta as unknown as RegraObrigacao | null;
  const [{ data: empresas }, local] = await Promise.all([
    s.supabase.from("empresas").select("id, razao_social").eq("ativa", true).order("razao_social"),
    carregarLocalEscritorio(s.supabase),
  ]);
  return (
    <>
      <CabecalhoPagina voltar={{ href: "/escritorio/obrigacoes/normas", rotulo: "Atualizações normativas" }} titulo="Corrigir proposta" descricao={`${o.nome} — ${n.titulo}`} />
      {n.status !== "proposta" || !regra ? (
        <Alerta tom="alerta">Somente propostas ainda não validadas podem ser corrigidas. Para mudar uma regra validada, registre uma nova proposta de alteração.</Alerta>
      ) : (
        <FormRegra
          acao={editarProposta.bind(null, id)}
          obrigacao={{ nome: o.nome, periodicidade: o.periodicidade, etapas: o.etapas, esfera: o.esfera }}
          inicial={{
            titulo: n.titulo,
            resumo: n.resumo,
            fonte_titulo: n.fonte_titulo,
            fonte_url: n.fonte_url,
            fonte_publicada_em: n.fonte_publicada_em,
            fonte_consultada_em: n.fonte_consultada_em,
            regra,
          }}
          hoje={hojeISO()}
          empresas={(empresas ?? []).map((e) => ({ id: e.id, nome: e.razao_social }))}
          local={local}
          destino={`/escritorio/obrigacoes/normas#n-${id}`}
        />
      )}
    </>
  );
}
