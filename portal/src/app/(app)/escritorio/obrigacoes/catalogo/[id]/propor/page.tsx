import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { FormRegra } from "@/components/obrigacoes/form-regra";
import { parametro } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { proporRegra } from "@/lib/obrigacoes/acoes";
import type { RegraObrigacao } from "@/lib/obrigacoes/regras";
import { carregarLocalEscritorio } from "@/lib/obrigacoes/local";

export const metadata: Metadata = { title: "Propor regra" };

export default async function ProporRegra({ params, searchParams }: PageProps<"/escritorio/obrigacoes/catalogo/[id]/propor">) {
  const { id } = await params;
  const sp = await searchParams;
  const s = await exigirEquipe();
  const anterior = parametro(sp, "anterior");
  const [{ data: o }, { data: regra }, { data: empresas }, local] = await Promise.all([
    s.supabase.from("obrigacoes").select("id, nome, periodicidade, etapas, esfera").eq("id", id).maybeSingle(),
    /^[0-9a-f-]{36}$/i.test(anterior) ? s.supabase.from("obrigacao_regras").select("*").eq("id", anterior).eq("obrigacao_id", id).eq("status", "validada").maybeSingle() : Promise.resolve({ data: null }),
    s.supabase.from("empresas").select("id, razao_social").eq("ativa", true).order("razao_social"),
    carregarLocalEscritorio(s.supabase),
  ]);
  if (!o) notFound();
  const base = regra as unknown as RegraObrigacao | null;
  const hoje = hojeISO();

  return (
    <>
      <CabecalhoPagina
        voltar={{ href: `/escritorio/obrigacoes/catalogo/${id}`, rotulo: o.nome }}
        titulo={base ? "Propor alteração da regra" : "Propor regra"}
        descricao={
          base
            ? "A regra atual continua valendo até a nova ser validada e aplicada; a partir da vigência informada, a anterior é encerrada e as tarefas abertas são recalculadas."
            : `Nova regra de prazo para ${o.nome}, com a fonte oficial. Ela só passa a valer depois de validada e aplicada por um administrador.`
        }
      />
      <FormRegra
        acao={proporRegra.bind(null, id, base?.id ?? null)}
        obrigacao={{ nome: o.nome, periodicidade: o.periodicidade, etapas: o.etapas, esfera: o.esfera }}
        inicial={{
          regra: base ? { ...base, vigencia_inicio: hoje, vigencia_fim: null } : null,
          fonte_consultada_em: hoje,
        }}
        hoje={hoje}
        empresas={(empresas ?? []).map((e) => ({ id: e.id, nome: e.razao_social }))}
        local={local}
        destino="/escritorio/obrigacoes/normas"
      />
    </>
  );
}
