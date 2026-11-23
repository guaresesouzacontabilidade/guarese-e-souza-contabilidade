import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assinarComEscritorio, certificadoValidoDoEscritorio } from "@/lib/assinatura/escritorio";
import { formatarDataHora, formatarDocumento, nomeMes } from "@/lib/formatos";
import { criarClienteAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { identificacaoPartes, type Clausula, type ConteudoContrato, type OpcoesContrato, type PartesContrato } from "./contrato";
import { gerarPdfContrato, type ContratoPdf, type RegistroAssinaturas } from "./contrato-pdf";
import { numeroContrato } from "./contratos-comum";

export { numeroContrato };

type Cliente = SupabaseClient<Database>;
export type LinhaContrato = Database["public"]["Tables"]["honorarios_contratos"]["Row"];

const BUCKET = "contratos";
export const TITULOS = {
  contrato: "Contrato de prestação de serviços contábeis",
  aditivo: "Termo aditivo ao contrato de prestação de serviços contábeis",
  distrato: "Distrato do contrato de prestação de serviços contábeis",
} as const;

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function endereco(e: { logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null } | null) {
  if (!e) return null;
  const t = [[e.logradouro, e.numero ? `nº ${e.numero}` : null].filter(Boolean).join(", "), e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")]
    .filter((p) => p && String(p).trim())
    .join(", ");
  return t || null;
}

/** Partes do contrato (cadastro do escritório e da empresa cliente). */
export async function partesDoContrato(supabase: Cliente, empresaId: string): Promise<PartesContrato & { cidadeEscritorio: string }> {
  const [{ data: esc }, { data: emp }] = await Promise.all([
    criarClienteAdmin().from("escritorio").select("razao_social, nome_fantasia, cnpj, logradouro, numero, bairro, cidade, uf, contador_nome, contador_crc").eq("id", 1).single(),
    supabase.from("empresas").select("razao_social, documento, logradouro, numero, bairro, cidade, uf").eq("id", empresaId).single(),
  ]);
  return {
    escritorio: {
      razao_social: esc?.razao_social ?? "",
      nome_fantasia: esc?.nome_fantasia ?? null,
      cnpj: esc?.cnpj ?? "",
      endereco: endereco(esc ?? null),
      cidade: esc?.cidade ?? null,
      uf: esc?.uf ?? null,
      contador_nome: esc?.contador_nome ?? null,
      contador_crc: esc?.contador_crc ?? null,
    },
    cliente: { razao_social: emp?.razao_social ?? "", documento: emp?.documento ?? "", endereco: endereco(emp ?? null) },
    cidadeEscritorio: [esc?.cidade, esc?.uf].filter(Boolean).join("/") || "Porto Nacional/TO",
  };
}

/** Conteúdo do contrato pela ficha atual do cliente e pela configuração da cobrança. */
export async function conteudoDaFicha(supabase: Cliente, empresaId: string, opcoes: OpcoesContrato): Promise<ConteudoContrato | { erro: string }> {
  const [{ data: ficha }, { data: cfg }, partes] = await Promise.all([
    supabase.from("honorarios_fichas").select("*").eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("honorarios_config").select("competencia_referencia, cobrar_encargos, multa_percentual, juros_mes_percentual").single(),
    partesDoContrato(supabase, empresaId),
  ]);
  if (!ficha) return { erro: "Cadastre antes a ficha de honorários do cliente (Clientes e valores)." };
  if (!ficha.servicos.length) return { erro: "Marque na ficha os serviços que o cliente contratou." };
  return {
    partes: { escritorio: partes.escritorio, cliente: partes.cliente },
    condicoes: {
      valor_mensal: Number(ficha.valor_mensal),
      dia_vencimento: ficha.dia_vencimento,
      inicio: ficha.inicio,
      servicos: ficha.servicos,
      funcionarios_inclusos: ficha.funcionarios_inclusos,
      valor_funcionario_extra: ficha.valor_funcionario_extra === null ? null : Number(ficha.valor_funcionario_extra),
      notas_inclusas: ficha.notas_inclusas,
      valor_nota_extra: ficha.valor_nota_extra === null ? null : Number(ficha.valor_nota_extra),
      decimo_terceiro: ficha.decimo_terceiro,
      decimo_terceiro_mes: ficha.decimo_terceiro_mes,
      reajuste_indice: ficha.reajuste_indice,
      reajuste_mes: ficha.reajuste_mes,
      competencia_referencia: cfg?.competencia_referencia ?? "mes_anterior",
      cobrar_encargos: cfg?.cobrar_encargos ?? true,
      multa_percentual: Number(cfg?.multa_percentual ?? 2),
      juros_mes_percentual: Number(cfg?.juros_mes_percentual ?? 1),
    },
    opcoes,
  };
}

function dataPorExtenso(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} de ${nomeMes(m).toLowerCase()} de ${a}`;
}

/** Dados do PDF a partir da linha guardada (o texto é a fotografia do rascunho). */
export async function dadosPdf(c: LinhaContrato, registro?: RegistroAssinaturas): Promise<ContratoPdf> {
  const dados = c.dados as unknown as { partes: PartesContrato; cidade?: string };
  const partes = dados.partes;
  const { data: esc } = await criarClienteAdmin().from("escritorio").select("nome_fantasia, telefone, email, cidade, uf").eq("id", 1).single();
  const cidade = dados.cidade ?? ([esc?.cidade, esc?.uf].filter(Boolean).join("/") || "Porto Nacional/TO");
  return {
    numero: numeroContrato(c),
    titulo: c.titulo,
    escritorio: {
      nome: esc?.nome_fantasia ?? partes.escritorio.razao_social,
      razao_social: partes.escritorio.razao_social,
      cnpj: partes.escritorio.cnpj,
      endereco: partes.escritorio.endereco,
      contato: [esc?.telefone, esc?.email].filter(Boolean).join(" · ") || null,
    },
    preambulo: identificacaoPartes(partes),
    clausulas: c.clausulas as unknown as Clausula[],
    localData: `${cidade}, ${dataPorExtenso((c.enviado_em ?? c.created_at).slice(0, 10))}.`,
    assinaturas: {
      contratada: `${partes.escritorio.razao_social} — CNPJ ${formatarDocumento(partes.escritorio.cnpj)}`,
      contratante: `${partes.cliente.razao_social} — ${formatarDocumento(partes.cliente.documento)}`,
    },
    registro,
  };
}

/**
 * Gera o PDF do rascunho, assina com o certificado do escritório (quando
 * houver) e guarda com o resumo SHA-256 (é esse arquivo que o cliente lê e aceita).
 */
export async function gerarArquivoEnvio(supabase: Cliente, c: LinhaContrato): Promise<{ assinado: boolean; aviso?: string } | { erro: string }> {
  let pdf = await gerarPdfContrato(await dadosPdf(c));
  let assinado = false;
  let aviso: string | undefined;
  const cert = await certificadoValidoDoEscritorio();
  if ("quem" in cert) {
    const r = assinarComEscritorio(pdf, cert, { motivo: `${c.titulo} nº ${numeroContrato(c)}`, local: "Portal do escritório", contato: "", data: new Date() });
    pdf = r.pdf;
    assinado = r.assinado;
    if (!r.assinado) aviso = `o PDF saiu sem assinatura digital (${r.erro})`;
  } else if (cert.erro) aviso = `o PDF saiu sem assinatura digital (${cert.erro})`;
  const caminho = `${c.ano}/${c.id}-envio-${Date.now()}.pdf`;
  const admin = criarClienteAdmin();
  const { error: erroUp } = await admin.storage.from(BUCKET).upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
  if (erroUp) return { erro: "Não foi possível guardar o PDF do contrato." };
  const { error } = await supabase.rpc("honorarios_contrato_registrar_arquivo", { p_id: c.id, p_path: caminho, p_hash: sha256(pdf), p_assinado: assinado });
  if (error) {
    await admin.storage.from(BUCKET).remove([caminho]);
    return { erro: error.message };
  }
  if (c.arquivo_path) await admin.storage.from(BUCKET).remove([c.arquivo_path]);
  return { assinado, aviso };
}

/** Via final: o mesmo texto + o registro das assinaturas, assinada pelo escritório (quando houver certificado). */
export async function gerarViaFinal(contratoId: string): Promise<{ ok: true } | { erro: string }> {
  const admin = criarClienteAdmin();
  const { data: c } = await admin.from("honorarios_contratos").select("*").eq("id", contratoId).single();
  if (!c || c.situacao !== "assinado" || !c.aceite_em || !c.arquivo_hash) return { erro: "Contrato não assinado." };
  const cert = await certificadoValidoDoEscritorio();
  const agora = new Date();
  const registro: RegistroAssinaturas = {
    hashEnvio: c.arquivo_hash,
    escritorio: "quem" in cert ? { titular: cert.quem.titular, documento: cert.quem.documento, data: formatarDataHora(agora.toISOString()) } : null,
    cliente: {
      nome: c.aceite_nome ?? "",
      cpf: c.aceite_cpf ?? "",
      email: c.aceite_email,
      data: formatarDataHora(c.aceite_em),
      ip: c.aceite_ip,
      navegador: c.aceite_user_agent,
      metodo: c.aceite_metodo ?? "sessao",
    },
  };
  let pdf = await gerarPdfContrato(await dadosPdf(c, registro));
  if ("quem" in cert) pdf = assinarComEscritorio(pdf, cert, { motivo: `${c.titulo} nº ${numeroContrato(c)} — via final`, local: "Portal do escritório", contato: "", data: agora }).pdf;
  const caminho = `${c.ano}/${c.id}-final-${Date.now()}.pdf`;
  const { error: erroUp } = await admin.storage.from(BUCKET).upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
  if (erroUp) return { erro: "Não foi possível guardar a via final." };
  const { error } = await admin.rpc("honorarios_contrato_registrar_final", { p_id: c.id, p_path: caminho, p_hash: sha256(pdf), p_documento_id: c.documento_id as string });
  if (error) return { erro: error.message };
  if (c.final_path) await admin.storage.from(BUCKET).remove([c.final_path]);
  return { ok: true };
}

export async function baixarArquivoContrato(caminho: string): Promise<Buffer | null> {
  const { data } = await criarClienteAdmin().storage.from(BUCKET).download(caminho);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

export function nomeArquivoContrato(c: Pick<LinhaContrato, "tipo" | "ano" | "numero">, final: boolean) {
  return `${c.tipo === "contrato" ? "Contrato" : c.tipo === "aditivo" ? "Aditivo" : "Distrato"}_${String(c.numero).padStart(4, "0")}_${c.ano}${final ? "_assinado" : ""}.pdf`;
}
