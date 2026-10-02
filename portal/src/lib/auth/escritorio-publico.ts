import "server-only";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { envPublico } from "@/lib/env";
import { urlLogo } from "@/components/marca/logo";

export interface EscritorioPublico {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  site: string | null;
  instagram: string | null;
  nome_sistema: string;
  descricao_sistema: string;
  mensagem_login: string;
  logo_path: string | null;
  logo_atualizado_em: string | null;
}

const PADRAO: EscritorioPublico = {
  nome_fantasia: "GUARESE'S ON CONTABILIDADE",
  razao_social: "GUARESE'S ON SOLUCOES EMPRESARIAIS LTDA",
  cnpj: "62935399000150",
  logradouro: "Praça do Centenário",
  numero: "713",
  bairro: "Centro",
  cidade: "Porto Nacional",
  uf: "TO",
  cep: "77500000",
  email: "onguaresescontato@gmail.com",
  telefone: null,
  whatsapp: null,
  site: null,
  instagram: null,
  nome_sistema: "Portal Guarese's ON",
  descricao_sistema: "Documentos, contabilidade e gestão financeira em um só lugar.",
  mensagem_login:
    "Bem-vindo ao seu Portal Guarese's ON. Envie seus documentos, acompanhe suas pendências e entenda a saúde financeira da sua empresa.",
  logo_path: null,
  logo_atualizado_em: null,
};

/** Dados públicos do escritório (tela de login, rodapés, PDFs). */
export const obterEscritorioPublico = cache(async (): Promise<EscritorioPublico & { logoUrl: string | null }> => {
  try {
    const anon = createClient(envPublico.supabaseUrl(), envPublico.supabaseChavePublica(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await anon.rpc("escritorio_publico");
    const e = { ...PADRAO, ...((data as Partial<EscritorioPublico>) ?? {}) };
    return { ...e, logoUrl: urlLogo(e.logo_path, e.logo_atualizado_em) };
  } catch {
    return { ...PADRAO, logoUrl: null };
  }
});
