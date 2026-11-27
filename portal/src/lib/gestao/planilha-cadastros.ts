import { validarCnpj, validarCpf } from "@/lib/formatos";
import { normalizarTitulo, type Celula } from "@/lib/gestao/planilha-produtos";
import { lerEmail, lerTelefones, lerUf, semAcento } from "@/lib/veterinaria/planilha-tutores";

/**
 * Planilha de clientes ou fornecedores vinda de outro sistema (GestãoClick,
 * Omie, Bling, Tiny, Conta Azul, planilha própria...) em Excel ou CSV.
 * As colunas são reconhecidas pelo título (com os nomes que esses sistemas
 * usam) e quem importa corrige o que cada coluna é. Nada aqui grava: só
 * monta a prévia; o banco confere tudo de novo ao importar.
 */

export const CAMPOS_CADASTRO = [
  { chave: "nome", titulo: "Nome", ajuda: "Nome do cliente ou razão social da empresa. Obrigatório." },
  { chave: "fantasia", titulo: "Nome fantasia", ajuda: "Usado quando a coluna Nome estiver vazia; senão vai para as observações." },
  { chave: "documento", titulo: "CPF/CNPJ", ajuda: "CPF (11 números) ou CNPJ (14). Com ou sem pontos. Inválido: o cadastro entra sem ele." },
  { chave: "cpf", titulo: "CPF", ajuda: "Quando o sistema separa CPF e CNPJ em colunas diferentes." },
  { chave: "cnpj", titulo: "CNPJ", ajuda: "Quando o sistema separa CPF e CNPJ em colunas diferentes." },
  { chave: "inscricao_estadual", titulo: "Inscrição estadual", ajuda: "Só números. \"Isento\" fica em branco." },
  { chave: "telefone", titulo: "Telefone", ajuda: "Com DDD. Sem DDD, usa o DDD padrão informado na tela." },
  { chave: "celular", titulo: "Celular", ajuda: "Usado quando o telefone estiver vazio." },
  { chave: "email", titulo: "E-mail", ajuda: "E-mail principal." },
  { chave: "cep", titulo: "CEP", ajuda: "8 números." },
  { chave: "logradouro", titulo: "Endereço", ajuda: "Rua, avenida. Se o número vier junto (\"Rua A, 100\"), é separado sozinho." },
  { chave: "numero", titulo: "Número", ajuda: "Número do endereço." },
  { chave: "complemento", titulo: "Complemento", ajuda: "Quadra, lote, sala." },
  { chave: "bairro", titulo: "Bairro", ajuda: "Bairro ou setor." },
  { chave: "cidade", titulo: "Cidade", ajuda: "Nome da cidade (ligada à tabela do IBGE com o estado)." },
  { chave: "uf", titulo: "UF", ajuda: "Sigla (TO) ou nome do estado (Tocantins)." },
  { chave: "contato", titulo: "Contato", ajuda: "Pessoa de contato ou vendedor (fornecedores)." },
  { chave: "prazo", titulo: "Prazo de pagamento", ajuda: "Dias (ex.: 28). Só para fornecedores." },
  { chave: "observacoes", titulo: "Observações", ajuda: "Anotações." },
  { chave: "situacao", titulo: "Situação", ajuda: "\"Inativo\", \"bloqueado\" ou \"excluído\" importa o cadastro como inativo." },
] as const;

export type CampoCadastro = (typeof CAMPOS_CADASTRO)[number]["chave"];
export const ROTULO_CAMPO_CADASTRO = Object.fromEntries(CAMPOS_CADASTRO.map((c) => [c.chave, c.titulo])) as Record<CampoCadastro, string>;

// Títulos já normalizados (minúsculas, sem acento, só letras e números)
const ALIASES: [CampoCadastro, RegExp][] = [
  ["fantasia", /^(nome )?fantasia$|^apelido$|^nome comercial$/],
  ["nome", /^(nome|nome completo|razao social|razao|nome razao social|nome ou razao social|cliente|fornecedor|nome do cliente|nome do fornecedor|nome cliente|nome fornecedor|razao social nome)$/],
  ["documento", /^(cpf cnpj|cnpj cpf|cpf ou cnpj|cnpj ou cpf|documento|doc|inscricao|n inscricao|numero inscricao|cpf cnpj cliente|cpf cnpj fornecedor|registro)$/],
  ["cpf", /^cpf$/],
  ["cnpj", /^cnpj$/],
  ["inscricao_estadual", /^(inscricao estadual|ie|insc estadual|i e|rg ie|ie rg)$/],
  ["celular", /^(celular|cel|whatsapp|whats|telefone celular|fone celular|contato 1 telefone|telefone 2)$/],
  ["telefone", /^(telefone|fone|tel|telefone 1|telefone principal|fone 1|telefones|telefone fixo|fone comercial|telefone comercial)$/],
  ["email", /^(e ?mail|email principal|e mail principal|contato 1 email|correio eletronico)$/],
  ["cep", /^cep/],
  ["logradouro", /^(endereco|logradouro|rua|end|endereco completo|endereco principal|rua avenida)$/],
  ["numero", /^(numero|n|no|num|nro|numero endereco)$/],
  ["complemento", /^(complemento|compl)$/],
  ["bairro", /^(bairro|setor)$/],
  ["cidade", /^(cidade|municipio|nome cidade|cidade nome|localidade)$/],
  ["uf", /^(uf|estado|sigla uf|estado uf)$/],
  ["contato", /^(contato|pessoa de contato|nome do contato|contato 1 nome|vendedor|representante|responsavel)$/],
  ["prazo", /^(prazo|prazo de pagamento|prazo pagamento|condicao de pagamento|dias de prazo)$/],
  ["observacoes", /^(observacoes|observacao|obs|anotacoes|informacoes adicionais)$/],
  ["situacao", /^(situacao|status|ativo|status do cliente|status do fornecedor)$/],
];

export function campoDoTituloCadastro(titulo: string): CampoCadastro | null {
  const t = normalizarTitulo(titulo);
  if (!t) return null;
  for (const [campo, re] of ALIASES) if (re.test(t)) return campo;
  return null;
}

export type MapaColunas = Record<string, CampoCadastro | "ignorar">;

export interface ColunaLida {
  titulo: string;
  campo: CampoCadastro | null;
}

export interface CadastroImportacao {
  linha: number;
  nome: string;
  documento: string | null;
  inscricao_estadual: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  municipio_ibge: string | null;
  contato: string | null;
  prazo_pagamento_dias: number | null;
  observacoes: string | null;
  ativo: boolean;
  situacao: "novo" | "existente" | "repetido" | "erro";
  motivo: string | null;
  avisos: string[];
}

export interface AnaliseCadastros {
  colunas: ColunaLida[];
  linhaTitulos: number;
  aba: string;
  linhas: CadastroImportacao[];
  totais: { novo: number; existente: number; repetido: number; erro: number };
}

export interface ExistentesCadastro {
  /** CPF/CNPJ já cadastrados na empresa → nome */
  documentos: Map<string, string>;
  /** Nomes (sem acento, minúsculos) já cadastrados sem CPF/CNPJ */
  nomes: Set<string>;
}

function texto(c: Celula | undefined): string | null {
  if (c == null) return null;
  const t = (typeof c === "number" ? (Number.isInteger(c) ? c.toFixed(0) : String(c)) : String(c)).replace(/\s+/g, " ").trim();
  return t === "" || t === "-" || t === "--" ? null : t;
}

function cortar(t: string | null, max: number, rotulo: string, avisos: string[]) {
  if (!t) return null;
  if (t.length <= max) return t;
  avisos.push(`${rotulo} cortado em ${max} letras`);
  return t.slice(0, max);
}

/** CPF/CNPJ de uma célula: só números; inválido devolve null com aviso. */
export function lerDocumento(v: string | null): { documento: string | null; invalido: boolean } {
  if (!v) return { documento: null, invalido: false };
  const d = v.replace(/\D/g, "");
  if (!d) return { documento: null, invalido: false };
  // Excel apaga o zero à esquerda: completa pelo tamanho mais provável
  const candidatos = d.length <= 11 ? [d.padStart(11, "0"), d.padStart(14, "0")] : [d.padStart(14, "0")];
  for (const c of candidatos) {
    if (c.length === 11 && validarCpf(c)) return { documento: c, invalido: false };
    if (c.length === 14 && validarCnpj(c)) return { documento: c, invalido: false };
  }
  return { documento: null, invalido: true };
}

/** "Rua A, 100" ou "Rua A nº 100" → rua e número separados (quando não há coluna de número). */
export function separarNumero(endereco: string | null): { logradouro: string | null; numero: string | null } {
  if (!endereco) return { logradouro: null, numero: null };
  const m = /^(.*?)(?:,\s*|\s+n[º°o.]?\s*)(\d+[a-z]?|s\/?n)\s*(?:[-,].*)?$/i.exec(endereco);
  if (m && m[1].trim().length >= 2) return { logradouro: m[1].trim(), numero: m[2].toUpperCase() === "SN" ? "S/N" : m[2] };
  return { logradouro: endereco, numero: null };
}

/** Acha a linha dos títulos (até a 15ª) e o que cada coluna é. */
export function lerTitulos(linhas: Celula[][], mapa: MapaColunas = {}): { indice: number; colunas: ColunaLida[] } | null {
  let melhor: { indice: number; colunas: ColunaLida[]; pontos: number } | null = null;
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const titulos = (linhas[i] ?? []).map((c) => texto(c) ?? "");
    const colunas = titulos.map((t) => {
      const corrigido = mapa[t];
      return { titulo: t, campo: corrigido === "ignorar" ? null : (corrigido ?? campoDoTituloCadastro(t)) };
    });
    const campos = new Set(colunas.map((c) => c.campo).filter(Boolean));
    const pontos = campos.size + (campos.has("nome") ? 2 : 0);
    if (campos.has("nome") && campos.size >= 2 && (!melhor || pontos > melhor.pontos)) melhor = { indice: i, colunas, pontos };
  }
  return melhor ? { indice: melhor.indice, colunas: melhor.colunas } : null;
}

/**
 * Monta a prévia: uma linha da planilha = um cadastro. Mesmo CPF/CNPJ duas vezes
 * na planilha: vale a primeira. Já cadastrado na empresa (mesmo CPF/CNPJ, ou mesmo
 * nome sem documento): só completa o que estiver vazio.
 */
export function analisarCadastros(
  abas: { nome: string; linhas: Celula[][] }[],
  existentes: ExistentesCadastro,
  opcoes: { papel: "cliente" | "fornecedor"; mapa?: MapaColunas; ddd?: string | null; municipio: (cidade: string, uf: string | null) => string | null },
): AnaliseCadastros | null {
  let escolhida: { aba: { nome: string; linhas: Celula[][] }; titulos: { indice: number; colunas: ColunaLida[] } } | null = null;
  for (const aba of abas) {
    const t = lerTitulos(aba.linhas, opcoes.mapa);
    if (t) {
      escolhida = { aba, titulos: t };
      break;
    }
  }
  if (!escolhida) return null;
  const { aba, titulos } = escolhida;
  const idx = (campo: CampoCadastro) => titulos.colunas.findIndex((c) => c.campo === campo);
  const pos = Object.fromEntries(CAMPOS_CADASTRO.map((c) => [c.chave, idx(c.chave)])) as Record<CampoCadastro, number>;
  const vistos = new Set<string>();
  const linhas: CadastroImportacao[] = [];

  for (let i = titulos.indice + 1; i < aba.linhas.length; i++) {
    const bruta = aba.linhas[i] ?? [];
    const v = (campo: CampoCadastro) => (pos[campo] >= 0 ? texto(bruta[pos[campo]]) : null);
    if (CAMPOS_CADASTRO.every((c) => !v(c.chave))) continue;
    const avisos: string[] = [];
    const fantasia = v("fantasia");
    const nomeBruto = v("nome") ?? fantasia;
    const nome = cortar(nomeBruto, 120, "Nome", avisos);

    const doc = lerDocumento(v("documento") ?? v("cnpj") ?? v("cpf"));
    if (doc.invalido) avisos.push("CPF/CNPJ inválido: entra sem ele");
    const ieBruta = v("inscricao_estadual");
    const ie = ieBruta && !/isent/i.test(ieBruta) ? ieBruta.replace(/\D/g, "") : "";
    if (ie && (ie.length < 2 || ie.length > 14)) avisos.push("Inscrição estadual inválida: fica em branco");
    const tel = lerTelefones(v("telefone"), opcoes.ddd ?? null);
    const cel = lerTelefones(v("celular"), opcoes.ddd ?? null);
    const telefone = tel.telefones[0] ?? cel.telefones[0] ?? null;
    if (!telefone && (tel.invalidos.length || cel.invalidos.length)) avisos.push("Telefone sem DDD ou inválido: fica em branco");
    const emailBruto = v("email");
    const email = lerEmail(emailBruto);
    if (emailBruto && !email) avisos.push("E-mail inválido: fica em branco");
    const cepD = (v("cep") ?? "").replace(/\D/g, "");
    const cep = cepD.length === 8 ? cepD : cepD.length === 7 ? `0${cepD}` : null;
    if (cepD && !cep) avisos.push("CEP inválido: fica em branco");
    let logradouro = v("logradouro");
    let numero = v("numero");
    if (logradouro && !numero) ({ logradouro, numero } = separarNumero(logradouro));
    const uf = lerUf(v("uf"));
    const cidade = v("cidade");
    const municipio = cidade ? opcoes.municipio(cidade, uf) : null;
    if (cidade && !municipio) avisos.push(`Cidade "${cidade}${uf ? ` / ${uf}` : ""}" não encontrada na tabela do IBGE: fica sem cidade`);
    let prazo: number | null = null;
    const prazoBruto = v("prazo");
    if (opcoes.papel === "fornecedor" && prazoBruto) {
      const n = Number(/(\d{1,3})/.exec(prazoBruto)?.[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 365) prazo = n;
    }
    const obs = [v("observacoes"), fantasia && v("nome") && semAcento(fantasia) !== semAcento(v("nome")!) ? `Nome fantasia: ${fantasia}` : null]
      .filter(Boolean)
      .join(" · ");
    const situacaoBruta = semAcento(v("situacao") ?? "");
    const ativo = !/inativ|bloque|exclu|desativ|^nao$|^n$|^false$|^0$/.test(situacaoBruta);

    const item: CadastroImportacao = {
      linha: i + 1,
      nome: nome ?? "",
      documento: doc.documento,
      inscricao_estadual: ie && ie.length >= 2 && ie.length <= 14 ? ie : null,
      telefone,
      email,
      cep,
      logradouro: cortar(logradouro, 60, "Endereço", avisos),
      numero: cortar(numero, 60, "Número", avisos),
      complemento: cortar(v("complemento"), 60, "Complemento", avisos),
      bairro: cortar(v("bairro"), 60, "Bairro", avisos),
      cidade,
      uf,
      municipio_ibge: municipio,
      contato: cortar(v("contato"), 80, "Contato", avisos),
      prazo_pagamento_dias: prazo,
      observacoes: cortar(obs || null, 1000, "Observações", avisos),
      ativo,
      situacao: "novo",
      motivo: null,
      avisos,
    };
    if (!nome || nome.length < 2) {
      item.situacao = "erro";
      item.motivo = "Sem nome";
    } else {
      const chave = item.documento ?? `nome:${semAcento(nome)}`;
      if (vistos.has(chave)) {
        item.situacao = "repetido";
        item.motivo = item.documento ? "Mesmo CPF/CNPJ de uma linha acima" : "Mesmo nome de uma linha acima (sem CPF/CNPJ)";
      } else {
        vistos.add(chave);
        if (item.documento && existentes.documentos.has(item.documento)) {
          item.situacao = "existente";
          item.motivo = `Já cadastrado como ${existentes.documentos.get(item.documento)}: completa só o que estiver vazio`;
        } else if (!item.documento && existentes.nomes.has(semAcento(nome))) {
          item.situacao = "existente";
          item.motivo = "Já existe um cadastro com este nome (sem CPF/CNPJ): completa só o que estiver vazio";
        }
      }
    }
    linhas.push(item);
  }
  const totais = { novo: 0, existente: 0, repetido: 0, erro: 0 };
  for (const l of linhas) totais[l.situacao]++;
  return { colunas: titulos.colunas, linhaTitulos: titulos.indice + 1, aba: aba.nome, linhas, totais };
}

/** O que vai para o banco (só as linhas novas e as que completam um cadastro existente). */
export function paraImportarCadastros(linhas: CadastroImportacao[]) {
  return linhas
    .filter((l) => l.situacao === "novo" || l.situacao === "existente")
    .map((l) => ({
      linha: l.linha,
      nome: l.nome,
      documento: l.documento,
      inscricao_estadual: l.inscricao_estadual,
      telefone: l.telefone,
      email: l.email,
      cep: l.cep,
      logradouro: l.logradouro,
      numero: l.numero,
      complemento: l.complemento,
      bairro: l.bairro,
      municipio_ibge: l.municipio_ibge,
      contato: l.contato,
      prazo_pagamento_dias: l.prazo_pagamento_dias,
      observacoes: l.observacoes,
      ativo: l.ativo,
    }));
}

export type CadastroParaImportar = ReturnType<typeof paraImportarCadastros>[number];
