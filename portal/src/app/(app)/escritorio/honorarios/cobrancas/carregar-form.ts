import "server-only";
import type { Sessao } from "@/lib/auth/sessao";
import { buscarTudo } from "@/lib/supabase/paginar";

/** Empresas (com os contatos da ficha) e linhas de receita para o formulário de cobrança. */
export async function dadosFormularioCobranca(s: Pick<Sessao, "supabase">) {
  const [empresas, { data: fichas }, { data: categorias }] = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia, email").eq("ativa", true).order("razao_social").range(de, ate)),
    s.supabase.from("honorarios_fichas").select("empresa_id, contato_email, contato_whatsapp, whatsapp_autorizado"),
    s.supabase.from("escritorio_categorias").select("id, codigo, nome, chave").eq("tipo", "receita_operacional").eq("ativa", true).order("codigo"),
  ]);
  const porEmpresa = new Map((fichas ?? []).map((f) => [f.empresa_id, f]));
  return {
    empresas: empresas.map((e) => {
      const f = porEmpresa.get(e.id);
      return { id: e.id, nome: e.nome_fantasia ?? e.razao_social, email: f?.contato_email ?? e.email ?? null, whatsapp: f?.contato_whatsapp ?? null, autorizado: f?.whatsapp_autorizado ?? false };
    }),
    categorias: categorias ?? [],
  };
}
