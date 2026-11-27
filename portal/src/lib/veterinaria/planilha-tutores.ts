import { validarCpf } from "@/lib/formatos";
import { normalizarTitulo, type Celula } from "@/lib/gestao/planilha-produtos";

/**
 * Planilha de tutores e animais vinda de outro sistema (Excel ou CSV).
 *
 * Aceita os formatos mais comuns de exportação:
 *  - uma linha por animal, com os dados do tutor repetidos em cada linha;
 *  - tutores e animais em abas (ou arquivos) separados, ligados pelo código do
 *    cliente;
 *  - só tutores (os animais podem ser cadastrados depois).
 * As colunas são reconhecidas pelo título (com os nomes usados por outros
 * sistemas) e quem importa pode corrigir o que cada coluna é. O mesmo tutor em
 * várias linhas (mesmo código, CPF ou nome e telefone) vira um cadastro só, e
 * o que já está no portal fica como está: o tutor já cadastrado só recebe os
 * animais novos.
 */

export const CAMPOS_TUTOR = [
  { chave: "tutor_codigo", titulo: "Código do cliente", ajuda: "Código do tutor no sistema antigo. Liga a aba de animais à aba de tutores (opcional)." },
  { chave: "tutor_nome", titulo: "Tutor", ajuda: "Nome do tutor (responsável). Obrigatório." },
  { chave: "cpf", titulo: "CPF", ajuda: "11 números. CPF inválido fica de fora (o tutor entra sem ele)." },
  { chave: "telefone", titulo: "Telefone", ajuda: "Com DDD. Dois números na mesma célula (separados por / ou ;) vão para Telefone e Telefone 2." },
  { chave: "telefone2", titulo: "Telefone 2", ajuda: "Outro telefone, com DDD." },
  { chave: "email", titulo: "E-mail", ajuda: "E-mail do tutor." },
  { chave: "cep", titulo: "CEP", ajuda: "8 números." },
  { chave: "logradouro", titulo: "Endereço", ajuda: "Rua, avenida (pode ser o endereço completo)." },
  { chave: "numero", titulo: "Número", ajuda: "Número da casa." },
  { chave: "complemento", titulo: "Complemento", ajuda: "Quadra, lote, apartamento." },
  { chave: "bairro", titulo: "Bairro", ajuda: "Bairro ou setor." },
  { chave: "cidade", titulo: "Cidade", ajuda: "Cidade." },
  { chave: "uf", titulo: "UF", ajuda: "Sigla do estado (TO) ou o nome (Tocantins)." },
  { chave: "tutor_observacoes", titulo: "Observações do tutor", ajuda: "Anotações sobre o tutor." },
] as const;

export const CAMPOS_ANIMAL = [
  { chave: "animal_nome", titulo: "Animal", ajuda: "Nome do animal. Linha sem animal cadastra só o tutor." },
  { chave: "especie", titulo: "Espécie", ajuda: "Cão, gato, ave, coelho, hamster, réptil, cavalo... Outra espécie entra como \"outra\" com o nome escrito." },
  { chave: "raca", titulo: "Raça", ajuda: "Raça (SRD para sem raça definida)." },
  { chave: "sexo", titulo: "Sexo", ajuda: "Macho ou fêmea (M ou F). \"Macho castrado\" também marca castrado." },
  { chave: "castrado", titulo: "Castrado", ajuda: "Sim ou não." },
  { chave: "nascimento", titulo: "Nascimento", ajuda: "Data (31/12/2020). Só mês e ano (12/2020) entra como data estimada." },
  { chave: "idade", titulo: "Idade", ajuda: "Usada quando não há nascimento: \"3 anos\", \"2 anos e 5 meses\", \"6 meses\". Vira nascimento estimado." },
  { chave: "pelagem", titulo: "Pelagem", ajuda: "Cor e tipo do pelo." },
  { chave: "porte", titulo: "Porte", ajuda: "Mini, pequeno, médio, grande ou gigante (P, M, G, GG)." },
  { chave: "peso", titulo: "Peso (kg)", ajuda: "Em kg (12,5). \"800 g\" também é aceito." },
  { chave: "microchip", titulo: "Microchip", ajuda: "6 a 23 letras ou números." },
  { chave: "alergias", titulo: "Alergias", ajuda: "Alergias conhecidas (aparecem em destaque na ficha)." },
  { chave: "animal_observacoes", titulo: "Observações do animal", ajuda: "Anotações sobre o animal." },
  { chave: "situacao", titulo: "Situação", ajuda: "\"Falecido\", \"óbito\" ou \"inativo\" cadastra o animal como inativo." },
] as const;

export type CampoTutor = (typeof CAMPOS_TUTOR)[number]["chave"];
export type CampoAnimal = (typeof CAMPOS_ANIMAL)[number]["chave"];
export type CampoImportacao = CampoTutor | CampoAnimal | "animal_codigo";
/** Títulos genéricos ("Nome", "Código", "Observações"): o que são depende das outras colunas da aba. */
type Generico = "nome" | "codigo" | "observacoes";

export const ROTULO_CAMPO: Record<CampoImportacao, string> = {
  ...(Object.fromEntries([...CAMPOS_TUTOR, ...CAMPOS_ANIMAL].map((c) => [c.chave, c.titulo])) as Record<CampoTutor | CampoAnimal, string>),
  animal_codigo: "Código do animal (ignorado)",
};

const TUTOR = "(tutor|tutora|cliente|proprietario|proprietaria|responsavel|dono|dona)";
const ALIASES: [CampoImportacao | Generico, RegExp][] = [
  ["tutor_codigo", new RegExp(`^(cod|codigo|id|n|num|numero|registro)( do| da)? ?${TUTOR}$|^${TUTOR} (cod|codigo|id)$|^(cod|codigo|id) ?(cli|prop)$`)],
  ["animal_codigo", /^(cod|codigo|id|n|num|numero|registro)( do| da)? ?(animal|pet|paciente)$|^(animal|pet|paciente) (cod|codigo|id)$/],
  ["tutor_observacoes", new RegExp(`^(observacoes|observacao|obs)( do| da)? ${TUTOR}$`)],
  ["animal_observacoes", /^(observacoes|observacao|obs)( do| da)? (animal|pet|paciente)$/],
  ["cpf", new RegExp(`^cpf( cnpj)?(( do| da)? ${TUTOR})?$|^(documento|doc|cpf ou cnpj)$`)],
  ["tutor_nome", new RegExp(`^(nome( do| da)? )?${TUTOR}( responsavel)?$|^nome completo( do| da)? ${TUTOR}$`)],
  ["animal_nome", /^(nome( do| da)? )?(animal|pet|paciente|bicho)$/],
  ["telefone2", /^(telefone|fone|tel|celular|cel|contato) ?2$|^(telefone|fone|tel) (fixo|residencial|comercial|secundario)$|^(fixo|outro telefone|segundo telefone)$/],
  ["telefone", /^(telefone|fone|tel|celular|cel|whatsapp|whats|zap|contato|telefones|celular whatsapp)( ?1| principal| celular)?$/],
  ["email", /^(e ?mail|email( do| da)? (tutor|cliente)|correio eletronico)$/],
  ["cep", /^cep/],
  ["logradouro", /^(endereco|logradouro|rua|end|endereco completo|endereco residencial|endereco do tutor)$/],
  ["numero", /^(numero|n|no|num|nro)$/],
  ["complemento", /^(complemento|compl)$/],
  ["bairro", /^(bairro|setor)$/],
  ["cidade", /^(cidade|municipio|localidade)$/],
  ["uf", /^(uf|estado)$/],
  ["especie", /^(especie|tipo|tipo de animal|tipo animal|especie animal|especie do animal)$/],
  ["raca", /^(raca|raca do animal)$/],
  ["sexo", /^(sexo|genero)$/],
  ["castrado", /^(castrado|castrada|castrado a|castracao|esterilizado|castrado s n)$/],
  ["nascimento", /^(nascimento|data de nascimento|data nascimento|dt nascimento|dt nasc|data nasc|nasc|aniversario)$/],
  ["idade", /^idade/],
  ["pelagem", /^(pelagem|cor|cor da pelagem|pelo|cor pelagem)$/],
  ["porte", /^porte/],
  ["peso", /^peso/],
  ["microchip", /^(microchip|micro chip|chip|n do microchip|numero do microchip)$/],
  ["alergias", /^(alergia|alergias)$/],
  ["situacao", /^(situacao|status|ativo|obito|falecido|falecida|data do obito|data obito)$/],
  ["nome", /^(nome|nome completo)$/],
  ["codigo", /^(cod|codigo|id|registro|n registro|matricula|ficha|n ficha|prontuario)$/],
  ["observacoes", /^(observacoes|observacao|obs|anotacoes|notas)$/],
];

const CAMPOS_DO_ANIMAL = new Set<string>(CAMPOS_ANIMAL.map((c) => c.chave));

/** O que cada coluna é, pelo título (sem resolver os genéricos). */
function campoDoTitulo(titulo: string): CampoImportacao | Generico | null {
  const t = normalizarTitulo(titulo);
  if (!t) return null;
  for (const [campo, re] of ALIASES) if (re.test(t)) return campo;
  return null;
}

export interface ColunaAba {
  indice: number;
  titulo: string;
  campo: CampoImportacao | null;
}

export interface AbaLida {
  /** Identifica a aba para a correção das colunas: "arquivo|aba". */
  id: string;
  arquivo: string;
  aba: string;
  tipo: "animais" | "tutores" | "ignorada";
  linhas: number;
  colunas: ColunaAba[];
  motivo?: string;
}

export interface AnimalImportacao {
  origem: string;
  nome: string;
  especie: string | null;
  especie_outra: string | null;
  raca: string | null;
  sexo: "macho" | "femea" | "indefinido";
  castrado: boolean;
  nascimento: string | null;
  nascimento_estimado: boolean;
  pelagem: string | null;
  porte: string | null;
  peso_kg: string | null;
  microchip: string | null;
  alergias: string | null;
  observacoes: string | null;
  ativo: boolean;
  /** Já está no portal (mesmo tutor e nome, ou o mesmo microchip): fica como está. */
  existente: boolean;
  erros: string[];
  avisos: string[];
}

export interface TutorImportacao {
  origem: string;
  nome: string | null;
  cpf: string | null;
  telefone: string | null;
  telefone2: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  observacoes: string | null;
  /** Tutor que já está no portal (mesmo CPF, ou mesmo nome e telefone): recebe só os animais novos. */
  existente: boolean;
  animais: AnimalImportacao[];
  erros: string[];
  avisos: string[];
}

export interface Existentes {
  tutores: { id: string; nome: string; cpf: string | null; telefone: string | null; telefone2: string | null }[];
  animais: { tutor_id: string; nome: string; microchip: string | null }[];
}

export interface ResultadoAnalise {
  abas: AbaLida[];
  tutores: TutorImportacao[];
  /** Linhas que não viraram cadastro (ex.: animal sem tutor). */
  linhasComErro: { origem: string; erros: string[] }[];
}

export interface OpcoesAnalise {
  /** DDD para telefones de 8 ou 9 números. */
  ddd?: string | null;
  /** Correções de quem importa: "arquivo|aba|coluna" → campo (ou "ignorar"). */
  mapa?: Record<string, CampoImportacao | "ignorar">;
  /** Data de hoje (AAAA-MM-DD), para a idade e as datas no futuro. */
  hoje: string;
}

// -----------------------------------------------------------------------------
// Valores
// -----------------------------------------------------------------------------

export function semAcento(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function texto(c: Celula | undefined): string | null {
  if (c == null) return null;
  const t = (typeof c === "number" ? (Number.isInteger(c) ? c.toFixed(0) : String(c)) : String(c)).replace(/\s+/g, " ").trim();
  return t === "" || t === "-" ? null : t;
}

function limitar(t: string | null, max: number, rotulo: string, avisos: string[]) {
  if (t && t.length > max) {
    avisos.push(`${rotulo} cortado em ${max} letras`);
    return t.slice(0, max).trim();
  }
  return t;
}

const ESPECIES: [RegExp, string][] = [
  [/^(cao|caes|cachorro|cachorra|canin[oa]s?|dog|c)$|cao|cachorr|canin/, "canina"],
  [/^(gato|gata|gatos|felin[oa]s?|cat|g)$|gat[oa]|felin/, "felina"],
  [/coelh|lagomorf/, "lagomorfo"],
  [/hamster|roedor|porquinho|chinchila|rato|camundong|gerbil|cobaia|prea/, "roedor"],
  [/ave|passaro|calopsita|papagaio|periquito|canario|galinha|pato|arara|agapornis/, "ave"],
  [/reptil|jabuti|tartaruga|cagado|cobra|serpente|iguana|lagarto|gecko|teiu/, "reptil"],
  [/equin|cavalo|egua|potro|jumento|mula|asinin/, "equina"],
  [/bovin|boi|vaca|bezerr|novilh|touro/, "bovina"],
  [/ovin|ovelha|carneiro|cordeiro/, "ovina"],
  [/caprin|cabra|bode|cabrito/, "caprina"],
  [/suin|porco|leitao|porca/, "suina"],
  [/peixe|aquario|betta|carpa/, "peixe"],
];

/** Espécie do sistema antigo → espécie do portal (ou "outra" com o nome escrito). */
export function lerEspecie(v: string | null): { especie: string | null; outra: string | null } {
  if (!v) return { especie: null, outra: null };
  const t = semAcento(v);
  for (const [re, especie] of ESPECIES) if (re.test(t)) return { especie, outra: null };
  return { especie: "outra", outra: v.slice(0, 60) };
}

export function lerSexo(v: string | null): { sexo: "macho" | "femea" | "indefinido"; castrado: boolean | null } {
  if (!v) return { sexo: "indefinido", castrado: null };
  const t = semAcento(v);
  const castrado = /castr|^(mc|fc)$/.test(t) ? true : /inteir|^(mi|fi)$/.test(t) ? false : null;
  if (/^m/.test(t)) return { sexo: "macho", castrado };
  if (/^f/.test(t)) return { sexo: "femea", castrado };
  return { sexo: "indefinido", castrado };
}

export function lerSimNao(v: string | null): boolean | null {
  if (!v) return null;
  const t = semAcento(v);
  if (/^(s|sim|x|1|true|verdadeiro|yes|y|castrad[oa]|c)$/.test(t)) return true;
  if (/^(n|nao|0|false|falso|no|inteir[oa])$/.test(t)) return false;
  return null;
}

export function lerPorte(v: string | null): string | null {
  if (!v) return null;
  const t = semAcento(v);
  if (/^(mini|toy|micro)/.test(t)) return "mini";
  if (/^(gg|xg|gigante|extra ?grande)/.test(t)) return "gigante";
  if (/^(p|pequeno)/.test(t)) return "pequeno";
  if (/^(m|medio)/.test(t)) return "medio";
  if (/^(g|grande)/.test(t)) return "grande";
  return null;
}

/** Peso em kg ("12,5", "12.5 kg", "800 g"); inválido = null. */
export function lerPeso(c: Celula | undefined): string | null {
  if (c == null) return null;
  let n: number;
  if (typeof c === "number") n = c;
  else {
    const t = semAcento(String(c)).replace(/\s/g, "");
    const m = /^(\d+(?:[.,]\d+)?)(kg|kgs|quilos?|g|gr|gramas?)?$/.exec(t);
    if (!m) return null;
    n = Number(m[1].replace(",", "."));
    if (m[2] && /^g/.test(m[2])) n = n / 1000;
  }
  if (!Number.isFinite(n) || n <= 0 || n >= 2000) return null;
  return String(Math.round(n * 1000) / 1000);
}

function dataValida(a: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Data de nascimento: data do Excel, "31/12/2020", "2020-12-31" ou só mês e ano ("12/2020", estimada). */
export function lerData(c: Celula | undefined): { data: string; estimada: boolean } | null {
  if (c == null) return null;
  if (typeof c === "number") {
    // Número de série do Excel (dias desde 30/12/1899)
    if (c < 1 || c > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86_400_000);
    return { data: dt.toISOString().slice(0, 10), estimada: false };
  }
  const t = String(c).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) {
    const d = dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { data: d, estimada: false } : null;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    let a = Number(m[3]);
    if (m[3].length === 2) a += a <= Number(new Date().getUTCFullYear().toString().slice(2)) ? 2000 : 1900;
    const d = dataValida(a, Number(m[2]), Number(m[1]));
    return d ? { data: d, estimada: false } : null;
  }
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) {
    const d = dataValida(Number(m[2]), Number(m[1]), 1);
    return d ? { data: d, estimada: true } : null;
  }
  m = /^(\d{4})$/.exec(t);
  if (m) {
    const d = dataValida(Number(m[1]), 1, 1);
    return d ? { data: d, estimada: true } : null;
  }
  return null;
}

/** Idade ("3 anos", "2a 5m", "6 meses", "3") → nascimento estimado a partir de hoje. */
export function nascimentoPelaIdade(v: string | null, hoje: string): string | null {
  if (!v) return null;
  const t = semAcento(v);
  let anos = 0;
  let meses = 0;
  const a = /(\d+(?:[.,]\d+)?)\s*(anos?|a)\b/.exec(t);
  const m = /(\d+)\s*(meses|mes|m)\b/.exec(t);
  if (a) anos = Number(a[1].replace(",", "."));
  if (m) meses = Number(m[1]);
  if (!a && !m) {
    if (!/^\d+(?:[.,]\d+)?$/.test(t)) return null;
    anos = Number(t.replace(",", "."));
  }
  const totalMeses = Math.round(anos * 12 + meses);
  if (!Number.isFinite(totalMeses) || totalMeses <= 0 || totalMeses > 12 * 60) return null;
  const [y, mo, d] = hoje.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 - totalMeses, Math.min(d, 28)));
  return dt.toISOString().slice(0, 10);
}

/** CPF: só números (o Excel tira o zero da frente); 14 números é CNPJ. */
export function lerCpf(v: string | null): { cpf: string | null; cnpj: string | null; invalido: boolean } {
  if (!v) return { cpf: null, cnpj: null, invalido: false };
  const d = v.replace(/\D/g, "");
  if (!d) return { cpf: null, cnpj: null, invalido: false };
  if (d.length === 14 || (d.length >= 12 && d.length <= 13)) return { cpf: null, cnpj: d.padStart(14, "0"), invalido: false };
  const cpf = d.length < 11 && d.length >= 9 ? d.padStart(11, "0") : d;
  return validarCpf(cpf) ? { cpf, cnpj: null, invalido: false } : { cpf: null, cnpj: null, invalido: true };
}

/** Telefones de uma célula (até dois, separados por / ; , ou "e"), só números, com DDD. */
export function lerTelefones(v: string | null, ddd: string | null): { telefones: string[]; invalidos: string[] } {
  const telefones: string[] = [];
  const invalidos: string[] = [];
  if (!v) return { telefones, invalidos };
  for (const parte of v.split(/[/;,|]| e | ou /i)) {
    let d = parte.replace(/\D/g, "");
    if (!d) continue;
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
    if ((d.length === 11 || d.length === 12) && d.startsWith("0")) d = d.slice(1);
    if ((d.length === 8 || d.length === 9) && ddd) d = ddd + d;
    if (d.length === 10 || d.length === 11) telefones.push(d);
    else invalidos.push(parte.trim());
  }
  return { telefones, invalidos };
}

export function lerEmail(v: string | null): string | null {
  if (!v) return null;
  const m = /[^@\s;,<>()]+@[^@\s;,<>()]+\.[^@\s;,<>()]+/.exec(v);
  return m && m[0].length <= 200 ? m[0].toLowerCase() : null;
}

const UFS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES", goias: "GO",
  maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE",
  piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR", "santa catarina": "SC",
  "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};
const SIGLAS = new Set(Object.values(UFS));

export function lerUf(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim().toUpperCase();
  if (SIGLAS.has(t)) return t;
  return UFS[semAcento(v)] ?? null;
}

/** "MARIA DA SILVA" → "Maria da Silva" (só para nomes todos em maiúsculas). */
export function nomeProprio(nome: string): string {
  if (nome !== nome.toUpperCase() || nome === nome.toLowerCase()) return nome;
  return nome
    .toLowerCase()
    .split(" ")
    .map((p, i) => (i > 0 && /^(da|de|do|das|dos|e)$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

const inativo = (v: string | null, titulo: string) => {
  if (!v) return false;
  const t = semAcento(v);
  const tituloObito = /obito|falecid/.test(semAcento(titulo));
  if (tituloObito) return !/^(n|nao|0|false|falso|vivo)$/.test(t);
  if (/^ativo$/.test(semAcento(titulo).trim())) return /^(n|nao|0|false|falso|inativo)$/.test(t);
  return /falec|obito|morto|morreu|inativ|desativ/.test(t);
};

// -----------------------------------------------------------------------------
// Abas e colunas
// -----------------------------------------------------------------------------

/** Acha a linha de títulos (até a 15ª) e decide o que cada coluna e a aba são. */
export function lerAba(arquivo: string, aba: string, linhas: Celula[][], mapa: OpcoesAnalise["mapa"] = {}): AbaLida & { inicio: number } {
  const id = `${arquivo}|${aba}`;
  let cabecalho = -1;
  let brutos: (CampoImportacao | Generico | null)[] = [];
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const campos = (linhas[i] ?? []).map((c) => (c == null ? null : campoDoTitulo(String(c))));
    if (campos.filter(Boolean).length >= 2) {
      cabecalho = i;
      brutos = campos;
      break;
    }
  }
  if (cabecalho < 0) return { id, arquivo, aba, tipo: "ignorada", linhas: 0, colunas: [], inicio: 0, motivo: "não encontramos os títulos das colunas (ex.: Tutor, Telefone, Animal, Espécie)" };

  const titulos = (linhas[cabecalho] ?? []).map((c) => (c == null ? "" : String(c).trim()));
  const corrigido = (j: number) => mapa[`${id}|${j}`];
  const presentes = new Set<string>();
  brutos.forEach((c, j) => {
    const m = corrigido(j);
    if (m && m !== "ignorar") presentes.add(m);
    else if (!m && c) presentes.add(c);
  });
  const temAnimal = [...presentes].some((c) => CAMPOS_DO_ANIMAL.has(c) && c !== "animal_observacoes" && c !== "situacao");
  const colunas: ColunaAba[] = titulos.map((titulo, j) => {
    const m = corrigido(j);
    if (m) return { indice: j, titulo, campo: m === "ignorar" ? null : m };
    const c = brutos[j] ?? null;
    let campo: CampoImportacao | null;
    if (c === "nome") {
      campo = temAnimal ? (presentes.has("animal_nome") ? (presentes.has("tutor_nome") ? null : "tutor_nome") : "animal_nome") : presentes.has("tutor_nome") ? null : "tutor_nome";
    } else if (c === "codigo") campo = temAnimal ? "animal_codigo" : presentes.has("tutor_codigo") ? null : "tutor_codigo";
    else if (c === "observacoes") campo = temAnimal ? "animal_observacoes" : "tutor_observacoes";
    else campo = c;
    return { indice: j, titulo, campo };
  });
  // Cada campo vale para uma coluna só (a primeira)
  const usados = new Set<string>();
  for (const col of colunas) {
    if (!col.campo) continue;
    if (usados.has(col.campo)) col.campo = null;
    else usados.add(col.campo);
  }
  const tem = (c: CampoImportacao) => usados.has(c);
  const dados = linhas.slice(cabecalho + 1).filter((l) => (l ?? []).some((c) => c != null && String(c).trim() !== "")).length;
  let tipo: AbaLida["tipo"];
  let motivo: string | undefined;
  if (tem("animal_nome")) tipo = "animais";
  else if (tem("tutor_nome")) tipo = "tutores";
  else {
    tipo = "ignorada";
    motivo = "falta a coluna com o nome do tutor ou do animal";
  }
  return { id, arquivo, aba, tipo, linhas: dados, colunas, inicio: cabecalho + 1, motivo };
}

// -----------------------------------------------------------------------------
// Análise
// -----------------------------------------------------------------------------

interface TutorInterno extends TutorImportacao {
  codigo: string | null;
  cnpj: string | null;
}

/** Lê as abas e monta os tutores com os animais, já comparando com o que está no portal. */
export function analisarTutores(abasBrutas: { arquivo: string; aba: string; linhas: Celula[][] }[], existentes: Existentes, opcoes: OpcoesAnalise): ResultadoAnalise {
  const ddd = opcoes.ddd && /^\d{2}$/.test(opcoes.ddd) ? opcoes.ddd : null;
  const abas = abasBrutas.map((a) => ({ ...lerAba(a.arquivo, a.aba, a.linhas, opcoes.mapa), brutas: a.linhas }));
  const tutores: TutorInterno[] = [];
  const porCodigo = new Map<string, TutorInterno>();
  const porCpf = new Map<string, TutorInterno>();
  const porNome = new Map<string, TutorInterno>();
  const linhasComErro: ResultadoAnalise["linhasComErro"] = [];

  const chaveNome = (nome: string, tel: string | null) => `${semAcento(nome).replace(/\s+/g, " ")}|${tel ?? ""}`;

  function tutorDaLinha(l: Celula[], cols: Map<CampoImportacao, number>, origem: string): { tutor: TutorInterno | null; erro?: string } {
    const pega = (c: CampoImportacao) => (cols.has(c) ? l[cols.get(c)!] : undefined);
    const avisos: string[] = [];
    const codigo = texto(pega("tutor_codigo"));
    let nome = texto(pega("tutor_nome"));
    // Na aba de animais, a coluna "Cliente" às vezes traz o código do tutor da outra aba
    let codigoRef = codigo;
    if (!codigoRef && nome && /^\d+$/.test(nome) && porCodigo.has(nome)) {
      codigoRef = nome;
      nome = null;
    }
    const cpfLido = lerCpf(texto(pega("cpf")));
    if (cpfLido.invalido) avisos.push("CPF inválido: o tutor entra sem o CPF");
    const tel1 = lerTelefones(texto(pega("telefone")), ddd);
    const tel2 = lerTelefones(texto(pega("telefone2")), ddd);
    const telefones = [...new Set([...tel1.telefones, ...tel2.telefones])];
    for (const t of [...tel1.invalidos, ...tel2.invalidos]) avisos.push(`telefone "${t}" sem DDD ou incompleto: ficou de fora`);
    const emailBruto = texto(pega("email"));
    const email = lerEmail(emailBruto);
    if (emailBruto && !email) avisos.push("e-mail inválido: ficou de fora");
    const cepBruto = texto(pega("cep"));
    let cep = cepBruto ? cepBruto.replace(/\D/g, "") : null;
    if (cep && cep.length === 7) cep = cep.padStart(8, "0");
    if (cep && cep.length !== 8) {
      avisos.push("CEP sem 8 números: ficou de fora");
      cep = null;
    }
    const ufBruta = texto(pega("uf"));
    const uf = lerUf(ufBruta);
    if (ufBruta && !uf) avisos.push(`UF "${ufBruta}" não reconhecida: ficou de fora`);

    // Já visto nesta planilha (mesmo código, CPF ou nome e telefone)?
    let t = (codigoRef && porCodigo.get(codigoRef)) || (cpfLido.cpf && porCpf.get(cpfLido.cpf)) || null;
    if (!t && nome) {
      for (const tel of telefones.length ? telefones : [null]) {
        t = porNome.get(chaveNome(nome, tel)) ?? null;
        if (t) break;
      }
    }
    if (!t) {
      if (!nome) return { tutor: null, erro: codigoRef ? `tutor de código ${codigoRef} não encontrado` : "linha sem o nome do tutor" };
      t = {
        origem, codigo: codigoRef, cnpj: null, nome: null, cpf: null, telefone: null, telefone2: null, email: null, cep: null, logradouro: null, numero: null,
        complemento: null, bairro: null, cidade: null, uf: null, observacoes: null, existente: false, animais: [], erros: [], avisos: [],
      };
      tutores.push(t);
    }
    // Completa o que estiver vazio (a primeira linha com o dado vale)
    t.nome ??= nome ? limitar(nome, 120, "nome do tutor", avisos) : null;
    t.cpf ??= cpfLido.cpf;
    t.cnpj ??= cpfLido.cnpj;
    for (const tel of telefones) {
      if (tel === t.telefone || tel === t.telefone2) continue;
      if (!t.telefone) t.telefone = tel;
      else if (!t.telefone2) t.telefone2 = tel;
    }
    t.email ??= email;
    t.cep ??= cep;
    t.logradouro ??= limitar(texto(pega("logradouro")), 150, "endereço", avisos);
    t.numero ??= limitar(texto(pega("numero")), 20, "número", avisos);
    t.complemento ??= limitar(texto(pega("complemento")), 80, "complemento", avisos);
    t.bairro ??= limitar(texto(pega("bairro")), 80, "bairro", avisos);
    t.cidade ??= limitar(texto(pega("cidade")), 80, "cidade", avisos);
    t.uf ??= uf;
    t.observacoes ??= limitar(texto(pega("tutor_observacoes")), 900, "observações do tutor", avisos);
    for (const a of avisos) if (!t.avisos.includes(a)) t.avisos.push(a);
    if (codigoRef && !t.codigo) t.codigo = codigoRef;
    if (t.codigo) porCodigo.set(t.codigo, t);
    if (t.cpf) porCpf.set(t.cpf, t);
    if (t.nome) {
      porNome.set(chaveNome(t.nome, null), porNome.get(chaveNome(t.nome, null)) ?? t);
      for (const tel of [t.telefone, t.telefone2]) if (tel) porNome.set(chaveNome(t.nome, tel), t);
    }
    return { tutor: t };
  }

  function animalDaLinha(l: Celula[], cols: Map<CampoImportacao, number>, origem: string, titulos: string[]): AnimalImportacao | null {
    const pega = (c: CampoImportacao) => (cols.has(c) ? l[cols.get(c)!] : undefined);
    const nome = texto(pega("animal_nome"));
    if (!nome) return null;
    const erros: string[] = [];
    const avisos: string[] = [];
    const { especie, outra } = lerEspecie(texto(pega("especie")));
    const sexo = lerSexo(texto(pega("sexo")));
    const castradoColuna = lerSimNao(texto(pega("castrado")));
    let nascimento: string | null = null;
    let estimado = false;
    const nascBruto = pega("nascimento");
    if (nascBruto != null && texto(nascBruto)) {
      const d = lerData(nascBruto);
      if (!d) avisos.push(`nascimento "${texto(nascBruto)}" não reconhecido: ficou de fora`);
      else if (d.data > opcoes.hoje) avisos.push("nascimento no futuro: ficou de fora");
      else if (d.data < "1950-01-01") avisos.push("nascimento antes de 1950: ficou de fora");
      else {
        nascimento = d.data;
        estimado = d.estimada;
      }
    }
    if (!nascimento) {
      const idade = texto(pega("idade"));
      const pelaIdade = nascimentoPelaIdade(idade, opcoes.hoje);
      if (pelaIdade) {
        nascimento = pelaIdade;
        estimado = true;
      } else if (idade) avisos.push(`idade "${idade}" não reconhecida: ficou de fora`);
    }
    const porteBruto = texto(pega("porte"));
    const porte = lerPorte(porteBruto);
    if (porteBruto && !porte) avisos.push(`porte "${porteBruto}" não reconhecido: ficou de fora`);
    const pesoBruto = pega("peso");
    const peso = lerPeso(pesoBruto);
    if (texto(pesoBruto) && !peso) avisos.push(`peso "${texto(pesoBruto)}" não reconhecido: ficou de fora`);
    const chipBruto = texto(pega("microchip"));
    let microchip = chipBruto ? chipBruto.replace(/[\s.\-/]/g, "").toUpperCase() : null;
    if (microchip && !/^[0-9A-Z]{6,23}$/.test(microchip)) {
      avisos.push("microchip fora do formato (6 a 23 letras ou números): ficou de fora");
      microchip = null;
    }
    const situacaoCol = cols.get("situacao");
    const ativo = !inativo(texto(pega("situacao")), situacaoCol === undefined ? "" : (titulos[situacaoCol] ?? ""));
    const nomeAnimal = limitar(nome, 80, "nome do animal", avisos)!;
    return {
      origem,
      nome: nomeAnimal,
      especie,
      especie_outra: outra,
      raca: limitar(texto(pega("raca")), 80, "raça", avisos),
      sexo: sexo.sexo,
      castrado: castradoColuna ?? sexo.castrado ?? false,
      nascimento,
      nascimento_estimado: estimado,
      pelagem: limitar(texto(pega("pelagem")), 80, "pelagem", avisos),
      porte,
      peso_kg: peso,
      microchip,
      alergias: limitar(texto(pega("alergias")), 500, "alergias", avisos),
      observacoes: limitar(texto(pega("animal_observacoes")), 1000, "observações do animal", avisos),
      ativo,
      existente: false,
      erros,
      avisos,
    };
  }

  // Abas de tutores primeiro (para o código do cliente da aba de animais achar o tutor)
  const ordem = [...abas].sort((a, b) => (a.tipo === "tutores" ? 0 : 1) - (b.tipo === "tutores" ? 0 : 1));
  for (const aba of ordem) {
    if (aba.tipo === "ignorada") continue;
    const cols = new Map<CampoImportacao, number>();
    for (const c of aba.colunas) if (c.campo) cols.set(c.campo, c.indice);
    const titulos = aba.colunas.map((c) => c.titulo);
    // CSV: a "aba" é o próprio arquivo
    const rotuloAba = aba.aba === aba.arquivo.replace(/\.[^.]+$/, "") || aba.aba === aba.arquivo ? aba.arquivo : `${aba.arquivo} › ${aba.aba}`;
    const colunasTutor = CAMPOS_TUTOR.map((c) => cols.get(c.chave)).filter((x): x is number => x !== undefined);
    let anterior: TutorInterno | null = null;
    for (let i = aba.inicio; i < aba.brutas.length; i++) {
      const l = aba.brutas[i] ?? [];
      if (!l.some((c) => c != null && String(c).trim() !== "")) continue;
      const origem = `${rotuloAba}, linha ${i + 1}`;
      // Relatório que só escreve o tutor na primeira linha dos animais dele: as linhas seguintes são do mesmo tutor
      const semTutor = aba.tipo === "animais" && colunasTutor.every((j) => texto(l[j]) === null);
      const achado: { tutor: TutorInterno | null; erro?: string } = semTutor && anterior !== null ? { tutor: anterior } : tutorDaLinha(l, cols, origem);
      const tutor: TutorInterno | null = achado.tutor;
      if (!tutor) {
        linhasComErro.push({ origem, erros: [achado.erro ?? "linha sem tutor"] });
        continue;
      }
      anterior = tutor;
      if (aba.tipo !== "animais") continue;
      const animal = animalDaLinha(l, cols, origem, titulos);
      if (!animal) continue;
      const repetido = tutor.animais.find((a) => semAcento(a.nome) === semAcento(animal.nome));
      if (repetido) {
        repetido.avisos.push(`também está na ${origem.replace(/^.*, /, "")}: entra uma vez só`);
        continue;
      }
      tutor.animais.push(animal);
    }
  }

  // Comparação com o que já está no portal
  const exCpf = new Map(existentes.tutores.filter((t) => t.cpf).map((t) => [t.cpf!, t]));
  const exNomeTel = new Map<string, string>();
  for (const t of existentes.tutores) for (const tel of [t.telefone, t.telefone2]) if (tel) exNomeTel.set(chaveNome(t.nome, tel), t.id);
  const exAnimais = new Map<string, Set<string>>();
  const exChips = new Set<string>();
  for (const a of existentes.animais) {
    if (!exAnimais.has(a.tutor_id)) exAnimais.set(a.tutor_id, new Set());
    exAnimais.get(a.tutor_id)!.add(semAcento(a.nome));
    if (a.microchip) exChips.add(a.microchip.toUpperCase());
  }
  const chipsNaPlanilha = new Map<string, string>();
  for (const t of tutores) {
    if (t.cnpj) {
      t.avisos.push("CNPJ não é guardado no cadastro do tutor: vai nas observações");
      t.observacoes = [t.observacoes, `CNPJ: ${t.cnpj}`].filter(Boolean).join(" — ").slice(0, 1000);
    }
    if (!t.nome || t.nome.length < 2) t.erros.push("nome do tutor com menos de 2 letras");
    let idExistente: string | null = null;
    if (t.cpf && exCpf.has(t.cpf)) idExistente = exCpf.get(t.cpf)!.id;
    if (!idExistente && t.nome) {
      for (const tel of [t.telefone, t.telefone2]) {
        if (tel && exNomeTel.has(chaveNome(t.nome, tel))) {
          idExistente = exNomeTel.get(chaveNome(t.nome, tel))!;
          break;
        }
      }
    }
    t.existente = idExistente !== null;
    const jaTem = idExistente ? (exAnimais.get(idExistente) ?? new Set<string>()) : new Set<string>();
    for (const a of t.animais) {
      if (jaTem.has(semAcento(a.nome)) || (a.microchip && exChips.has(a.microchip))) a.existente = true;
      else if (a.microchip) {
        const outro = chipsNaPlanilha.get(a.microchip);
        if (outro) {
          a.avisos.push(`microchip repetido (também em ${outro}): ficou de fora`);
          a.microchip = null;
        } else chipsNaPlanilha.set(a.microchip, `${a.nome} (${a.origem.replace(/^.*, /, "")})`);
      }
    }
  }

  return {
    abas: abas.map((a) => ({ id: a.id, arquivo: a.arquivo, aba: a.aba, tipo: a.tipo, linhas: a.linhas, colunas: a.colunas, motivo: a.motivo })),
    tutores: tutores.map((t) => {
      const r: TutorImportacao & Partial<Pick<TutorInterno, "codigo" | "cnpj">> = { ...t };
      delete r.codigo;
      delete r.cnpj;
      return r;
    }),
    linhasComErro,
  };
}

// -----------------------------------------------------------------------------
// Situação (com as escolhas de quem importa)
// -----------------------------------------------------------------------------

export interface EscolhasImportacao {
  /** Espécie para os animais sem espécie na planilha ("" = ficam de fora). */
  especiePadrao: string;
  /** Corrigir nomes em maiúsculas. */
  corrigirMaiusculas: boolean;
}

export function animalEntra(a: AnimalImportacao, escolhas: EscolhasImportacao) {
  return !a.existente && !a.erros.length && (a.especie !== null || escolhas.especiePadrao !== "");
}

/** O que vai para o banco: tutores sem erro, com os animais novos (e as escolhas aplicadas). */
export function paraImportar(tutores: TutorImportacao[], escolhas: EscolhasImportacao) {
  const nome = (n: string) => (escolhas.corrigirMaiusculas ? nomeProprio(n) : n);
  return tutores
    .filter((t) => !t.erros.length && t.nome && (!t.existente || t.animais.some((a) => animalEntra(a, escolhas))))
    .map((t) => ({
      origem: t.origem,
      nome: nome(t.nome!),
      cpf: t.cpf,
      telefone: t.telefone,
      telefone2: t.telefone2,
      email: t.email,
      cep: t.cep,
      logradouro: t.logradouro,
      numero: t.numero,
      complemento: t.complemento,
      bairro: t.bairro,
      cidade: t.cidade,
      uf: t.uf,
      observacoes: t.observacoes,
      animais: t.animais
        .filter((a) => animalEntra(a, escolhas))
        .map((a) => ({
          origem: a.origem,
          nome: nome(a.nome),
          especie: a.especie ?? escolhas.especiePadrao,
          especie_outra: a.especie ? a.especie_outra : escolhas.especiePadrao === "outra" ? "Não informada" : null,
          raca: a.raca,
          sexo: a.sexo,
          castrado: a.castrado,
          nascimento: a.nascimento,
          nascimento_estimado: a.nascimento_estimado,
          pelagem: a.pelagem,
          porte: a.porte,
          peso_kg: a.peso_kg,
          microchip: a.microchip,
          alergias: a.alergias,
          observacoes: a.observacoes,
          ativo: a.ativo,
        })),
    }));
}

export type TutorParaImportar = ReturnType<typeof paraImportar>[number];
