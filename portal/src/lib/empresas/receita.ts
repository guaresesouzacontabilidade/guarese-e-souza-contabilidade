import { z } from "zod";
import { formatarTelefone, somenteDigitos, validarCnpj } from "@/lib/formatos";

/**
 * Consulta dos dados cadastrais de um CNPJ nos dados abertos da Receita
 * Federal (Cadastro Nacional da Pessoa Jurídica), pela BrasilAPI — serviço
 * público e gratuito, de código aberto, que publica a base oficial da Receita
 * (atualizada mensalmente). Se ela estiver fora do ar, a consulta usa a Minha
 * Receita, que publica a mesma base no mesmo formato.
 *
 * O servidor do portal envia só o número do CNPJ; o navegador não fala com
 * esses serviços. Os dados vêm como estão na Receita e são conferidos pela
 * equipe antes de salvar.
 */

export const FONTES_CNPJ = [
  { nome: "BrasilAPI", url: (cnpj: string) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}` },
  { nome: "Minha Receita", url: (cnpj: string) => `https://minhareceita.org/${cnpj}` },
] as const;

const texto = z.preprocess((v) => (typeof v === "string" ? v.trim() : v == null ? null : String(v)), z.string().nullable().optional());
const numero = z.preprocess((v) => (v == null || v === "" ? null : Number(v)), z.number().nullable().optional());

/** Formato da resposta (BrasilAPI e Minha Receita usam os mesmos nomes de campos). */
const RespostaCnpj = z.object({
  cnpj: texto,
  razao_social: texto,
  nome_fantasia: texto,
  descricao_situacao_cadastral: texto,
  data_situacao_cadastral: texto,
  descricao_motivo_situacao_cadastral: texto,
  data_inicio_atividade: texto,
  natureza_juridica: texto,
  porte: texto,
  capital_social: numero,
  descricao_identificador_matriz_filial: texto,
  cnae_fiscal: numero,
  cnae_fiscal_descricao: texto,
  cnaes_secundarios: z.array(z.object({ codigo: numero, descricao: texto })).nullable().optional(),
  descricao_tipo_de_logradouro: texto,
  logradouro: texto,
  numero: texto,
  complemento: texto,
  bairro: texto,
  municipio: texto,
  uf: texto,
  cep: texto,
  codigo_municipio_ibge: numero,
  ddd_telefone_1: texto,
  ddd_telefone_2: texto,
  email: texto,
  opcao_pelo_simples: z.boolean().nullable().optional(),
  data_opcao_pelo_simples: texto,
  data_exclusao_do_simples: texto,
  opcao_pelo_mei: z.boolean().nullable().optional(),
  data_opcao_pelo_mei: texto,
  data_exclusao_do_mei: texto,
  regime_tributario: z.array(z.object({ ano: numero, forma_de_tributacao: texto })).nullable().optional(),
  qsa: z
    .array(z.object({ nome_socio: texto, qualificacao_socio: texto, data_entrada_sociedade: texto }))
    .nullable()
    .optional(),
});

/** Retrato da consulta (também guardado com a empresa, para referência). */
export const DadosReceitaSchema = z.object({
  cnpj: z.string().regex(/^\d{14}$/),
  razaoSocial: z.string().max(300),
  nomeFantasia: z.string().max(300).nullable(),
  situacao: z.string().max(60).nullable(),
  situacaoDesde: z.string().max(10).nullable(),
  motivoSituacao: z.string().max(200).nullable(),
  abertura: z.string().max(10).nullable(),
  naturezaJuridica: z.string().max(200).nullable(),
  porte: z.string().max(60).nullable(),
  capitalSocial: z.number().nullable(),
  matriz: z.boolean().nullable(),
  cnaePrincipal: z.object({ codigo: z.string().max(12), descricao: z.string().max(300).nullable() }).nullable(),
  cnaesSecundarios: z.array(z.object({ codigo: z.string().max(12), descricao: z.string().max(300).nullable() })).max(200),
  endereco: z.object({
    logradouro: z.string().max(300).nullable(),
    numero: z.string().max(40).nullable(),
    complemento: z.string().max(300).nullable(),
    bairro: z.string().max(200).nullable(),
    municipio: z.string().max(200).nullable(),
    uf: z.string().max(2).nullable(),
    cep: z.string().max(8).nullable(),
    codigoIbge: z.string().max(7).nullable(),
  }),
  telefones: z.array(z.string().max(30)).max(2),
  email: z.string().max(200).nullable(),
  simples: z.object({ optante: z.boolean().nullable(), desde: z.string().max(10).nullable(), excluidoEm: z.string().max(10).nullable() }),
  mei: z.object({ optante: z.boolean().nullable(), desde: z.string().max(10).nullable(), excluidoEm: z.string().max(10).nullable() }),
  tributacao: z.object({ ano: z.number(), forma: z.string().max(120) }).nullable(),
  socios: z.array(z.object({ nome: z.string().max(300), qualificacao: z.string().max(200).nullable(), desde: z.string().max(10).nullable() })).max(200),
  fonte: z.string().max(120),
  consultadoEm: z.string().max(40),
});
export type DadosReceita = z.infer<typeof DadosReceitaSchema>;

export class ErroConsultaCnpj extends Error {}

const data = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const vazio = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** "6920601" → "6920-6/01" */
export function formatarCnae(codigo: number | string | null | undefined): string | null {
  const d = String(codigo ?? "").replace(/\D/g, "").padStart(7, "0");
  return /^\d{7}$/.test(d) && d !== "0000000" ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : null;
}

export function normalizarRespostaCnpj(json: unknown, fonte: string, agora = new Date()): DadosReceita {
  const r = RespostaCnpj.safeParse(json);
  if (!r.success || !r.data.razao_social) throw new ErroConsultaCnpj("A consulta voltou num formato inesperado.");
  const d = r.data;
  const tipo = vazio(d.descricao_tipo_de_logradouro);
  const logradouro = vazio(d.logradouro);
  // A Receita guarda o tipo (RUA, AVENIDA...) separado do nome
  const logradouroCompleto = logradouro && tipo && !logradouro.toUpperCase().startsWith(tipo.toUpperCase()) ? `${tipo} ${logradouro}` : logradouro;
  const tributacao = (d.regime_tributario ?? [])
    .filter((t) => t.ano && t.forma_de_tributacao)
    .sort((a, b) => (b.ano ?? 0) - (a.ano ?? 0))[0];
  const situacao = vazio(d.descricao_situacao_cadastral);
  return {
    cnpj: somenteDigitos(d.cnpj ?? ""),
    razaoSocial: d.razao_social!.slice(0, 300),
    nomeFantasia: vazio(d.nome_fantasia)?.slice(0, 300) ?? null,
    situacao: situacao?.slice(0, 60) ?? null,
    situacaoDesde: data(d.data_situacao_cadastral),
    motivoSituacao: vazio(d.descricao_motivo_situacao_cadastral) && d.descricao_motivo_situacao_cadastral !== "SEM MOTIVO" ? d.descricao_motivo_situacao_cadastral!.slice(0, 200) : null,
    abertura: data(d.data_inicio_atividade),
    naturezaJuridica: vazio(d.natureza_juridica)?.slice(0, 200) ?? null,
    porte: vazio(d.porte)?.slice(0, 60) ?? null,
    capitalSocial: d.capital_social ?? null,
    matriz: d.descricao_identificador_matriz_filial ? d.descricao_identificador_matriz_filial.toUpperCase() === "MATRIZ" : null,
    cnaePrincipal: formatarCnae(d.cnae_fiscal) ? { codigo: formatarCnae(d.cnae_fiscal)!, descricao: vazio(d.cnae_fiscal_descricao)?.slice(0, 300) ?? null } : null,
    cnaesSecundarios: (d.cnaes_secundarios ?? [])
      .map((c) => ({ codigo: formatarCnae(c.codigo), descricao: vazio(c.descricao)?.slice(0, 300) ?? null }))
      .filter((c): c is { codigo: string; descricao: string | null } => Boolean(c.codigo))
      .slice(0, 200),
    endereco: {
      logradouro: logradouroCompleto?.slice(0, 300) ?? null,
      numero: vazio(d.numero)?.slice(0, 40) ?? null,
      complemento: vazio(d.complemento)?.slice(0, 300) ?? null,
      bairro: vazio(d.bairro)?.slice(0, 200) ?? null,
      municipio: vazio(d.municipio)?.slice(0, 200) ?? null,
      uf: vazio(d.uf)?.toUpperCase().slice(0, 2) ?? null,
      cep: somenteDigitos(d.cep ?? "").slice(0, 8) || null,
      codigoIbge: d.codigo_municipio_ibge ? String(d.codigo_municipio_ibge).slice(0, 7) : null,
    },
    telefones: [d.ddd_telefone_1, d.ddd_telefone_2]
      .map((t) => somenteDigitos(t ?? ""))
      .filter((t) => /^\d{10,11}$/.test(t) && !/^0+$/.test(t.slice(2)))
      .map((t) => formatarTelefone(t))
      .slice(0, 2),
    email: vazio(d.email)?.toLowerCase().slice(0, 200) ?? null,
    simples: { optante: d.opcao_pelo_simples ?? null, desde: data(d.data_opcao_pelo_simples), excluidoEm: data(d.data_exclusao_do_simples) },
    mei: { optante: d.opcao_pelo_mei ?? null, desde: data(d.data_opcao_pelo_mei), excluidoEm: data(d.data_exclusao_do_mei) },
    tributacao: tributacao ? { ano: tributacao.ano!, forma: tributacao.forma_de_tributacao!.slice(0, 120) } : null,
    socios: (d.qsa ?? [])
      .filter((s) => vazio(s.nome_socio))
      .map((s) => ({ nome: s.nome_socio!.slice(0, 300), qualificacao: vazio(s.qualificacao_socio)?.slice(0, 200) ?? null, desde: data(s.data_entrada_sociedade) }))
      .slice(0, 200),
    fonte: `Receita Federal — dados abertos do CNPJ (via ${fonte})`,
    consultadoEm: agora.toISOString(),
  };
}

/** Regime sugerido pelos dados da Receita (o escritório confirma). */
export function regimeSugerido(d: DadosReceita): string | null {
  if (d.mei.optante) return "mei";
  if (d.simples.optante) return "simples_nacional";
  const forma = d.tributacao?.forma.toUpperCase() ?? "";
  if (forma.includes("REAL")) return "lucro_real";
  if (forma.includes("PRESUMIDO")) return "lucro_presumido";
  if (forma.includes("ARBITRADO")) return "lucro_arbitrado";
  if (forma.includes("IMUNE") || forma.includes("ISENTA")) return "imune_isenta";
  return null;
}

/** Sócio administrador ou só sócio (para os contatos da empresa). */
export function funcaoDoSocio(qualificacao: string | null): "socio_administrador" | "socio" {
  return /administrador|presidente|diretor|titular/i.test(qualificacao ?? "") ? "socio_administrador" : "socio";
}

/**
 * Consulta o CNPJ (BrasilAPI e, se ela falhar, a Minha Receita). Erros de
 * conexão ou serviço fora do ar viram mensagem clara — nada é inventado.
 */
export async function consultarCnpjReceita(cnpjInformado: string, opcoes: { fetch?: typeof fetch; tempoLimiteMs?: number } = {}): Promise<DadosReceita> {
  const cnpj = somenteDigitos(cnpjInformado);
  if (!validarCnpj(cnpj)) throw new ErroConsultaCnpj("CNPJ inválido. Confira os números.");
  const buscar = opcoes.fetch ?? fetch;
  let naoEncontrado = false;
  for (const fonte of FONTES_CNPJ) {
    try {
      const resp = await buscar(fonte.url(cnpj), {
        headers: { Accept: "application/json", "User-Agent": "PortalGuaresesON/1.0" },
        signal: AbortSignal.timeout(opcoes.tempoLimiteMs ?? 12_000),
        cache: "no-store",
      });
      if (resp.status === 404) {
        naoEncontrado = true;
        continue;
      }
      if (!resp.ok) continue;
      return normalizarRespostaCnpj(await resp.json(), fonte.nome);
    } catch (e) {
      if (e instanceof ErroConsultaCnpj) throw e;
      // Fora do ar ou lento: tenta a próxima fonte
    }
  }
  if (naoEncontrado) {
    throw new ErroConsultaCnpj("CNPJ não encontrado na base da Receita. Empresas abertas há poucas semanas podem ainda não constar (a base é atualizada uma vez por mês).");
  }
  throw new ErroConsultaCnpj("A consulta à Receita está indisponível agora. Tente de novo em alguns minutos ou preencha os dados à mão.");
}
