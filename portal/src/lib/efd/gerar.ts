import Decimal from "decimal.js";
import { centavos, dec, formatarMoeda } from "@/lib/dinheiro";
import { chaveValida } from "@/lib/fiscal/chave";
import { formatarCompetencia } from "@/lib/formatos";
import type { ComplementoNota, ParticipanteNota } from "@/lib/fiscal/xml";
import type { DadosIcms, Destinacao, ItemCalculado, ResultadoIcms, TipoLancamentoIcms } from "@/lib/calculos/icms";

/**
 * Gerador do arquivo da EFD ICMS/IPI (SPED Fiscal) do mês, conforme o Guia
 * Prático da EFD ICMS/IPI versão 3.2.2 (atualização de 11/02/2026):
 *
 *  - Bloco 0: abertura (0000), dados da empresa (0005), contador (0100),
 *    participantes (0150), unidades (0190), itens (0200) e conversões (0220).
 *  - Bloco C: NF-e e NFC-e. Notas de terceiros com os itens (C100, C170, C190);
 *    notas emitidas pela empresa só com o resumo por CST, CFOP e alíquota
 *    (C100 e C190, exceção 2 do registro C100); canceladas com os campos mínimos.
 *  - Bloco D: CT-e tomados e emitidos (D100 e D190).
 *  - Bloco E: apuração do ICMS próprio (E100, E110, E111 e E116), calculada a
 *    partir dos registros analíticos, como o PVA confere.
 *  - Blocos B, G, H e K sem informações; bloco 1 só com o 1010; bloco 9 com a
 *    contagem dos registros.
 *
 * Nas entradas, o crédito, a destinação (revenda, uso e consumo, ativo) e o
 * ICMS-ST vêm da apuração do ICMS do portal (src/lib/calculos/icms.ts): o CST e
 * o CFOP saem do "enfoque do declarante" e o ICMS só aparece quando há direito
 * ao crédito. PIS e Cofins ficam vazios (as empresas do regime normal entregam
 * a EFD-Contribuições). O que o portal ainda não gera (ICMS-ST como
 * substituto, DIFAL das vendas a consumidor final, IPI, inventário, Bloco K,
 * ajustes por documento) aparece nas pendências antes de gerar.
 *
 * O arquivo é texto ISO-8859-1, campos separados por "|", linhas com CR+LF.
 * Ele não é assinado nem transmitido: o escritório valida e assina no PVA.
 */

type Num = number | string | null | undefined;

// -----------------------------------------------------------------------------
// Dados recebidos do banco (public.dados_efd_icms_ipi)
// -----------------------------------------------------------------------------
export interface ProdutoVinculado {
  codigo: string;
  descricao: string;
  unidade: string;
  ncm: string | null;
  gtin: string | null;
  cest: string | null;
  /** Quantas unidades da empresa vêm em uma unidade do fornecedor. */
  fator: Num;
}

export interface ItemEfdDados {
  n: number;
  codigo: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: Num;
  valor: Num;
  desconto: Num;
  tributos: Record<string, string> | null;
  gtin: string | null;
  cest: string | null;
  ex_tipi: string | null;
  produto: ProdutoVinculado | null;
}

export interface NotaEfdDados {
  id: string;
  modelo: string;
  chave: string | null;
  numero: string | null;
  serie: string | null;
  data_emissao: string | null;
  operacao: "entrada" | "saida";
  tp_nf: string | null;
  finalidade: string | null;
  natureza: string | null;
  emitente_documento: string | null;
  emitente_nome: string | null;
  emitente_uf: string | null;
  emitente_ie: string | null;
  destinatario_documento: string | null;
  destinatario_nome: string | null;
  destinatario_uf: string | null;
  valor_total: Num;
  valor_produtos: Num;
  valor_desconto: Num;
  valor_frete: Num;
  valor_outros: Num;
  tributos: Record<string, string> | null;
  cfops: string[] | null;
  cancelada: boolean;
  duplicatas: number;
  pagamentos: { forma: string | null; valor: string | null }[];
  complemento: ComplementoNota | null;
  leitura: number;
  itens: ItemEfdDados[];
}

export interface DadosEfd {
  competencia: string;
  empresa: {
    razao_social: string;
    nome_fantasia: string | null;
    tipo_pessoa: "PJ" | "PF";
    documento: string;
    inscricao_estadual: string | null;
    inscricao_municipal: string | null;
    uf: string | null;
    municipio_ibge: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cep: string | null;
    telefone: string | null;
    email: string | null;
    cnae: string | null;
    regime: string | null;
    contribuinte_icms: boolean;
    demonstracao: boolean;
  };
  contador: {
    nome: string | null;
    crc: string | null;
    cpf: string | null;
    email: string | null;
    telefone: string | null;
    cnpj: string | null;
    cep: string | null;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    municipio_ibge: string | null;
  };
  config: { perfil: "A" | "B" | "C"; codigo_receita: string | null } | null;
  notas: NotaEfdDados[];
  sem_xml: { chave: string; emitente: string | null; emitente_documento: string | null; data: string | null; valor: Num }[];
  icms_por_operacao: boolean;
  /** Código de ajuste (tabela 5.1.1) de cada lançamento do ICMS do mês. */
  lancamentos_codigos: Record<string, string>;
  /** UF de cada município (IBGE) citado nas notas do mês. */
  municipios: Record<string, string>;
  geracoes: {
    id: string;
    nome: string;
    finalidade: number;
    linhas: number;
    tamanho: number;
    resumo: ResumoEfd | Record<string, never>;
    criado_em: string;
    gerado_por: string | null;
  }[];
  releitura_pendente: boolean;
}

export interface OpcoesEfd {
  /** 0: original; 1: substituto (retificadora). */
  finalidade: 0 | 1;
  /** Vencimento do ICMS a recolher (AAAA-MM-DD), para o registro E116. */
  vencimento: string | null;
  /** Pendências que a equipe confirmou para gerar mesmo assim. */
  confirmadas?: string[];
}

// -----------------------------------------------------------------------------
// Resultado
// -----------------------------------------------------------------------------
export type NivelPendencia = "bloqueio" | "confirmar" | "aviso";

export interface PendenciaEfd {
  id: string;
  nivel: NivelPendencia;
  titulo: string;
  detalhe?: string;
  /** Onde resolver (rota do portal). */
  link?: { rotulo: string; href: string };
  /** Ação na própria tela (releitura das notas, vencimento, código de receita...). */
  acao?: "reler" | "vencimento" | "codigo_receita" | "codigos_ajuste";
}

export interface ApuracaoE110 {
  debitos: string;
  ajustes_debito_documentos: string;
  ajustes_debito: string;
  estornos_credito: string;
  creditos: string;
  ajustes_credito_documentos: string;
  ajustes_credito: string;
  estornos_debito: string;
  saldo_credor_anterior: string;
  saldo_devedor: string;
  deducoes: string;
  a_recolher: string;
  saldo_credor_transportar: string;
  extra_apuracao: string;
}

export interface ResumoEfd {
  periodo: { inicio: string; fim: string };
  linhas: number;
  registros: Record<string, number>;
  notas: { entradas: number; saidas: number; canceladas: number; cte: number; fora: number };
  participantes: number;
  itens: number;
  apuracao: ApuracaoE110;
  vencimento: string | null;
}

export interface ResultadoEfd {
  pendencias: PendenciaEfd[];
  /** Vazio enquanto houver bloqueio ou pendência sem confirmação. */
  conteudo: string | null;
  nomeArquivo: string;
  /** Totais do arquivo; sem o arquivo, a prévia (sem linhas nem registros). */
  resumo: ResumoEfd;
  /** Notas que ficaram de fora do arquivo e o motivo. */
  foraDoArquivo: { nota: string; motivo: string }[];
}

// -----------------------------------------------------------------------------
// Utilidades de formatação (campos do leiaute)
// -----------------------------------------------------------------------------
const ZERO = new Decimal(0);
const CEM = new Decimal(100);
const moeda = (v: Decimal) => formatarMoeda(v);

/** Texto sem o separador "|" nem quebras de linha, com até `max` caracteres. */
export function textoCampo(t: string | null | undefined, max = 255): string {
  return (t ?? "")
    .replace(/[|\r\n\t\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Número com vírgula decimal e sem separador de milhar (ex.: 1234,56). */
export function numeroCampo(v: Decimal | Num, casas = 2): string {
  return dec(v as Decimal).toDecimalPlaces(casas, Decimal.ROUND_HALF_UP).toFixed(casas).replace(".", ",");
}

/** AAAA-MM-DD → ddmmaaaa. */
export function dataCampo(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
  return `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
}

const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Telefone com DDD (até 11 dígitos), sem o 55 do país. */
function telefoneCampo(v: string | null | undefined): string {
  let d = soDigitos(v);
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 && d.length <= 11 ? d : "";
}

/**
 * Converte para o que cabe no ISO-8859-1: acentos do português ficam; travessões,
 * aspas curvas e outros símbolos viram o equivalente simples.
 */
export function paraLatin1(texto: string): string {
  let saida = "";
  for (const c of texto) {
    const cod = c.codePointAt(0)!;
    if (cod <= 0xff) {
      saida += c;
      continue;
    }
    const simples: Record<string, string> = { "–": "-", "—": "-", "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...", "•": "-", "€": "EUR", "º": "o", "ª": "a" };
    if (simples[c]) {
      saida += simples[c];
      continue;
    }
    const base = c.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    saida += [...base].every((x) => x.codePointAt(0)! <= 0xff) ? base : "?";
  }
  return saida;
}

/** Versão do leiaute (COD_VER) pela data final do arquivo (tabela 3.1.1 da Nota Técnica). */
export function versaoLeiaute(ano: number): string | null {
  const tabela: Record<number, string> = { 2023: "017", 2024: "018", 2025: "019", 2026: "020" };
  return tabela[ano] ?? null;
}

function ultimoDia(comp: string): string {
  const [a, m] = comp.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${comp.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

function dataLocalDaNota(n: NotaEfdDados): string | null {
  if (n.complemento?.data_local) return n.complemento.data_local;
  if (!n.data_emissao) return null;
  // Sem o complemento (leitura antiga): data em Brasília
  const d = new Date(n.data_emissao);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

const t = (v: Record<string, string> | null | undefined, k: string) => dec(v?.[k] ?? null);

// -----------------------------------------------------------------------------
// CST e CFOP sob o enfoque do declarante (entradas de terceiros)
// -----------------------------------------------------------------------------
/** CSOSN do fornecedor do Simples convertido para o CST da tabela B (Convênio s/nº de 1970). */
export function cstDoCsosn(csosn: string | null | undefined): string | null {
  switch (csosn) {
    case "101":
    case "102":
    case "900":
      return "90";
    case "103":
      return "40";
    case "300":
    case "400":
      return "41";
    case "201":
    case "202":
    case "203":
    case "500":
      return "60";
    default:
      return null;
  }
}

/** Troca o primeiro dígito do CFOP de saída (5/6/7) pelo de entrada (1/2/3). */
function espelhar(cfop: string): string {
  const mapa: Record<string, string> = { "5": "1", "6": "2", "7": "3" };
  return (mapa[cfop[0]] ?? cfop[0]) + cfop.slice(1);
}

/**
 * CFOP de entrada do item pela destinação escolhida no portal. Compras viram
 * 1.102/2.102 (revenda), 1.556/2.556 (uso e consumo) ou 1.551/2.551 (ativo) —
 * com ST, 1.403, 1.407 e 1.406; devoluções, transferências e as demais
 * operações espelham o CFOP do fornecedor (5.202 → 1.202, 5.910 → 1.910).
 */
export function cfopEntrada(cfopFornecedor: string | null | undefined, destinacao: Destinacao, st: boolean, tipo: ItemCalculado["tipo"]): string | null {
  const c = (cfopFornecedor ?? "").trim();
  if (!/^\d{4}$/.test(c)) return null;
  if (/^[123]/.test(c)) return c;
  const grupo = espelhar(c)[0];
  const compra = tipo === "compra" && !/^[56]11[67]$/.test(c) && !/^[56]92\d$/.test(c);
  if (!compra) return espelhar(c);
  if (/^[56]65\d$/.test(c)) return `${grupo}${destinacao === "revenda" ? "652" : "653"}`;
  switch (destinacao) {
    case "revenda":
      return `${grupo}${st ? "403" : "102"}`;
    case "uso_consumo":
      return `${grupo}${st ? "407" : "556"}`;
    case "ativo":
      return `${grupo}${st ? "406" : "551"}`;
    default:
      return `${grupo}949`;
  }
}

/** CST (2 dígitos, sem a origem) do item de entrada sob o enfoque do declarante. */
export function cstEntrada(cstFornecedor: string | null | undefined, csosn: string | null | undefined, st: boolean, comCredito: boolean): string {
  if (st) return "60";
  const base = cstFornecedor ?? cstDoCsosn(csosn) ?? "90";
  if (comCredito) return ["00", "20"].includes(base) ? base : "90";
  // Sem direito ao crédito: tributadas viram "90" (outras); isentas e não tributadas ficam como vieram
  return ["40", "41", "50", "51", "60"].includes(base) ? base : "90";
}

// -----------------------------------------------------------------------------
// Montagem do arquivo
// -----------------------------------------------------------------------------
class Arquivo {
  readonly linhas: string[] = [];
  readonly contagem = new Map<string, number>();
  registrar(reg: string, ...campos: (string | null | undefined)[]) {
    this.linhas.push(`|${reg}|${campos.map((c) => c ?? "").join("|")}|`);
    this.contagem.set(reg, (this.contagem.get(reg) ?? 0) + 1);
  }
  /** Linhas do bloco (registros que começam pela letra/dígito do bloco). */
  linhasDoBloco(bloco: string) {
    let n = 0;
    for (const [reg, q] of this.contagem) if (reg[0] === bloco) n += q;
    return n;
  }
}

interface Analitico {
  cst: string;
  cfop: string;
  aliq: Decimal;
  opr: Decimal;
  bc: Decimal;
  icms: Decimal;
  bcSt: Decimal;
  icmsSt: Decimal;
  redBc: Decimal;
  ipi: Decimal;
}

function somarAnalitico(mapa: Map<string, Analitico>, a: Omit<Analitico, "opr" | "bc" | "icms" | "bcSt" | "icmsSt" | "redBc" | "ipi"> & Partial<Analitico>) {
  const chave = `${a.cst}|${a.cfop}|${a.aliq.toFixed(2)}`;
  const atual = mapa.get(chave) ?? { cst: a.cst, cfop: a.cfop, aliq: a.aliq, opr: ZERO, bc: ZERO, icms: ZERO, bcSt: ZERO, icmsSt: ZERO, redBc: ZERO, ipi: ZERO };
  atual.opr = atual.opr.plus(a.opr ?? ZERO);
  atual.bc = atual.bc.plus(a.bc ?? ZERO);
  atual.icms = atual.icms.plus(a.icms ?? ZERO);
  atual.bcSt = atual.bcSt.plus(a.bcSt ?? ZERO);
  atual.icmsSt = atual.icmsSt.plus(a.icmsSt ?? ZERO);
  atual.redBc = atual.redBc.plus(a.redBc ?? ZERO);
  atual.ipi = atual.ipi.plus(a.ipi ?? ZERO);
  mapa.set(chave, atual);
}

/** Unidades mais comuns (descrição do registro 0190). */
const UNIDADES: Record<string, string> = {
  UN: "Unidade", UND: "Unidade", UNID: "Unidade", PC: "Peca", PCT: "Pacote", CX: "Caixa", KG: "Quilograma", G: "Grama", T: "Tonelada",
  TON: "Tonelada", TN: "Tonelada", SC: "Saca", SC60: "Saca de 60 kg", L: "Litro", LT: "Litro", ML: "Mililitro", M: "Metro", M2: "Metro quadrado",
  M3: "Metro cubico", MT: "Metro", DZ: "Duzia", FD: "Fardo", GL: "Galao", PAR: "Par", RL: "Rolo", SV: "Servico", KIT: "Kit", BD: "Balde", SAC: "Saco",
};

function unidadeCampo(u: string | null | undefined): string {
  const x = textoCampo(u, 6).toUpperCase();
  return x || "UN";
}

interface ItemRegistro {
  codigo: string;
  descricao: string;
  gtin: string | null;
  unidade: string;
  tipo: string;
  ncm: string | null;
  exTipi: string | null;
  cest: string | null;
  conversoes: Map<string, Decimal>;
}

export function gerarEfd(d: DadosEfd, icms: { dados: DadosIcms; resultado: ResultadoIcms }, op: OpcoesEfd): ResultadoEfd {
  const comp = `${String(d.competencia).slice(0, 7)}-01`;
  const fim = ultimoDia(comp);
  const emp = d.empresa;
  const docEmpresa = soDigitos(emp.documento);
  const ufEmpresa = (emp.uf ?? "").toUpperCase();
  const pendencias: PendenciaEfd[] = [];
  const foraDoArquivo: ResultadoEfd["foraDoArquivo"] = [];
  const add = (p: PendenciaEfd) => pendencias.push(p);
  const confirmadas = new Set(op.confirmadas ?? []);
  const nomeArquivo = `EFD-ICMS-IPI_${docEmpresa}_${comp.slice(0, 4)}${comp.slice(5, 7)}${op.finalidade === 1 ? "_substituto" : ""}.txt`;
  const mes = formatarCompetencia(comp, true);

  // ---------------------------------------------------------------------------
  // Pré-requisitos
  // ---------------------------------------------------------------------------
  const res = icms.resultado;
  if (res.modo === "simples") {
    add({ id: "regime", nivel: "bloqueio", titulo: "Empresa do Simples Nacional", detalhe: "Empresas do Simples Nacional são dispensadas da EFD ICMS/IPI (salvo exigência específica do estado). Confira o regime em Obrigações e prazos → Empresas." });
  } else if (res.modo === "nao_contribuinte") {
    add({
      id: "regime",
      nivel: "bloqueio",
      titulo: "Empresa marcada como não contribuinte do ICMS",
      detalhe: soDigitos(emp.inscricao_estadual)
        ? "A empresa tem inscrição estadual, mas a caixinha “Contribuinte do ICMS” está desmarcada no perfil dela. Marque a caixinha e clique em “Salvar e atualizar tarefas”."
        : "A EFD ICMS/IPI é das empresas contribuintes do ICMS (com inscrição estadual). Se a empresa é contribuinte, informe a inscrição estadual no cadastro e marque “Contribuinte do ICMS” no perfil dela.",
    });
  } else if (res.modo !== "normal") {
    add({
      id: "regime",
      nivel: "bloqueio",
      titulo: "Regime da empresa não informado",
      detalhe: "A EFD ICMS/IPI é gerada para empresas do regime normal (Lucro Presumido ou Real). Informe o regime no perfil da empresa e clique em “Salvar e atualizar tarefas”.",
    });
  }
  const versao = versaoLeiaute(Number(fim.slice(0, 4)));
  if (!versao) add({ id: "versao", nivel: "bloqueio", titulo: `Versão do leiaute de ${fim.slice(0, 4)} ainda não cadastrada no portal`, detalhe: "Confira a tabela de versões da Nota Técnica (Ato COTEPE/ICMS nº 44/2018) e peça a atualização do portal." });
  const ie = soDigitos(emp.inscricao_estadual);
  const faltaEmpresa = [
    !ie && "inscrição estadual",
    !/^\d{7}$/.test(emp.municipio_ibge ?? "") && "município (código do IBGE)",
    !textoCampo(emp.logradouro) && "endereço",
    soDigitos(emp.cep).length !== 8 && "CEP",
  ].filter(Boolean) as string[];
  if (faltaEmpresa.length) add({ id: "empresa", nivel: "bloqueio", titulo: `Cadastro da empresa sem ${faltaEmpresa.join(", ")}`, detalhe: "Os registros 0000 e 0005 exigem esses dados. Complete o cadastro da empresa." });
  const c = d.contador;
  const faltaContador = [
    !textoCampo(c.nome) && "nome",
    soDigitos(c.cpf).length !== 11 && "CPF",
    !textoCampo(c.crc) && "CRC",
    !textoCampo(c.email) && "e-mail",
    !/^\d{7}$/.test(c.municipio_ibge ?? "") && "cidade e UF do escritório (município do IBGE)",
  ].filter(Boolean) as string[];
  if (faltaContador.length) {
    add({ id: "contador", nivel: "bloqueio", titulo: `Contador responsável sem ${faltaContador.join(", ")}`, detalhe: "O registro 0100 exige o contador. Complete em Escritório → Configurações → Dados do escritório.", link: { rotulo: "Abrir configurações do escritório", href: "/escritorio/configuracoes" } });
  }
  if (fim >= new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)) {
    add({ id: "mes_aberto", nivel: "confirmar", titulo: `${mes} ainda não terminou`, detalhe: "Notas emitidas até o fim do mês ainda podem entrar. Gere a EFD depois do último dia do mês." });
  }
  if (emp.demonstracao) add({ id: "demo", nivel: "aviso", titulo: "Empresa de demonstração", detalhe: "Os dados são fictícios: o arquivo serve só para conhecer o gerador e não deve ser transmitido." });

  // Notas lidas antes do complemento da EFD
  const antigas = d.notas.filter((n) => !n.complemento || n.leitura < 5);
  if (antigas.length) {
    add(
      d.releitura_pendente
        ? { id: "releitura", nivel: "bloqueio", titulo: `Atualizando a leitura de ${antigas.length} ${antigas.length === 1 ? "nota" : "notas"}`, detalhe: "A releitura dos XML está em andamento. Atualize a página em alguns minutos." }
        : {
            id: "releitura",
            nivel: "bloqueio",
            titulo: `${antigas.length} ${antigas.length === 1 ? "nota foi lida" : "notas foram lidas"} antes da leitura da EFD`,
            detalhe: "Faltam endereço, município, frete e os dados do CT-e dessas notas. Atualize a leitura (o portal relê os XML guardados).",
            acao: "reler",
          },
    );
  }
  if (d.sem_xml.length) {
    const total = d.sem_xml.reduce((s, n) => s.plus(dec(n.valor)), ZERO);
    add({
      id: "sem_xml",
      nivel: "confirmar",
      titulo: `${d.sem_xml.length} NF-e de entrada só em resumo, sem o XML completo (${moeda(centavos(total))})`,
      detalhe: "Sem o XML elas ficam fora do arquivo. Confirme a operação em Notas automáticas ou envie os XML em Documentos; se a operação não aconteceu, registre o desconhecimento.",
    });
  }
  if (!d.notas.some((n) => n.operacao === "saida")) {
    add({
      id: "sem_saidas",
      nivel: "confirmar",
      titulo: "Nenhuma nota de saída (venda) no mês",
      detalhe: "O portal não tem XML de notas emitidas pela empresa neste mês. Se houve vendas, envie os XML em Documentos (ou ligue as notas automáticas) antes de gerar.",
    });
  }
  if (!d.notas.length) add({ id: "sem_notas", nivel: "aviso", titulo: "Mês sem notas no portal", detalhe: "O arquivo sai sem movimento (blocos C e D vazios), só com a apuração." });

  const regimeNormal = res.modo === "normal" && res.propria;
  if (regimeNormal && !icms.dados.apuracao?.conferida_em) {
    add({ id: "apuracao", nivel: "aviso", titulo: "Apuração do ICMS do mês não conferida", detalhe: "Confira a destinação das entradas e os lançamentos na Apuração do ICMS: o arquivo usa as mesmas escolhas." });
  }
  if (regimeNormal && res.propria!.origemSaldo === "sem_informacao") {
    add({ id: "saldo_anterior", nivel: "aviso", titulo: "Saldo credor do mês anterior considerado zero", detalhe: "O mês anterior não foi conferido no portal e nenhum saldo foi informado. Se havia saldo credor na EFD anterior, informe-o na Apuração do ICMS." });
  }

  // Lançamentos: cada um precisa do código de ajuste (E111)
  const lancamentos = icms.dados.lancamentos.filter((l) => l.tipo !== "guia_extra");
  const semCodigo = lancamentos.filter((l) => !d.lancamentos_codigos[l.id]);
  if (regimeNormal && semCodigo.length) {
    add({
      id: "codigos_ajuste",
      nivel: "bloqueio",
      titulo: `${semCodigo.length} ${semCodigo.length === 1 ? "lançamento da apuração está" : "lançamentos da apuração estão"} sem o código de ajuste`,
      detalhe: `Cada valor lançado vira um registro E111 com o código da tabela 5.1.1 de ${ufEmpresa || "seu estado"} (ex.: ${ufEmpresa || "UF"}020001 para outros créditos). Informe o código de: ${semCodigo.map((l) => l.descricao).join("; ")}.`,
      acao: "codigos_ajuste",
    });
  }
  if (icms.dados.lancamentos.some((l) => l.tipo === "guia_extra")) {
    add({ id: "guia_extra", nivel: "aviso", titulo: "Guias de ICMS à parte não entram no arquivo", detalhe: "Os valores lançados como “Outra guia de ICMS” (ex.: ICMS-ST na entrada, antecipação) não fazem parte da apuração própria (E110)." });
  }
  if (d.icms_por_operacao) {
    add({
      id: "icms_operacao",
      nivel: "aviso",
      titulo: "Empresa com ICMS pago a cada nota (DAR por operação)",
      detalhe: "Quando o estado exige o recolhimento por operação, o débito pode precisar de ajustes por documento (C197) e débito especial. Confira com a orientação da SEFAZ: o portal ainda não gera esses ajustes.",
    });
  }
  const cnae = soDigitos(emp.cnae);
  if (/^(1\d|2\d|3[0-3])/.test(cnae)) {
    add({ id: "industria", nivel: "aviso", titulo: "Atividade industrial", detalhe: "Indústrias podem precisar do Bloco K (produção e estoque), do registro 0002 e da apuração do IPI (E500): o portal ainda não gera. O arquivo sai como “outras atividades” (IND_ATIV 1)." });
  } else if (/^46/.test(cnae)) {
    add({ id: "atacadista", nivel: "aviso", titulo: "Comércio atacadista: confira o Bloco K", detalhe: "Atacadistas (CNAE 46) podem ser obrigados a informar o estoque escriturado (registro K200), conforme o estado. O portal gera o Bloco K sem informações." });
  }
  if (comp.slice(5, 7) === "02") {
    add({ id: "inventario", nivel: "confirmar", titulo: "Fevereiro: inventário de 31 de dezembro", detalhe: "A EFD de fevereiro deve trazer o inventário (registros H005 e H010). O portal gera o Bloco H sem informações: inclua o inventário no PVA antes de transmitir." });
  }
  if (ufEmpresa === "MT") {
    add({ id: "mt", nivel: "aviso", titulo: "Mato Grosso: registros 1400 e 1601", detalhe: "Confira se a SEFAZ-MT exige da empresa o registro 1400 (valores por município, como compras de produtor rural) e o 1601 (vendas recebidas por cartão ou PIX de instituições de pagamento): o portal ainda não gera." });
  }

  // ---------------------------------------------------------------------------
  // Notas: o que entra no arquivo
  // ---------------------------------------------------------------------------
  const calculadas = new Map(res.notas.map((n) => [n.id, n]));
  const propria = (n: NotaEfdDados) => soDigitos(n.emitente_documento) === docEmpresa;
  const descr = (n: NotaEfdDados) => `${n.modelo === "57" ? "CT-e" : n.modelo === "65" ? "NFC-e" : "NF-e"} ${n.numero ?? "s/n"}${n.emitente_nome && !propria(n) ? ` — ${n.emitente_nome}` : ""}`;
  const nfe: NotaEfdDados[] = [];
  const cte: NotaEfdDados[] = [];
  for (const n of d.notas) {
    const p = propria(n);
    if (n.cancelada && !p) continue; // nota de terceiro cancelada: não se escritura
    if (n.modelo === "65" && (n.operacao !== "saida" || !p)) {
      foraDoArquivo.push({ nota: descr(n), motivo: "NFC-e não se escritura nas entradas." });
      continue;
    }
    if (n.operacao === "saida" && !p) {
      foraDoArquivo.push({ nota: descr(n), motivo: "Saída emitida por outro estabelecimento (CNPJ diferente): escriture na EFD dele." });
      continue;
    }
    if (n.modelo === "55" && n.operacao === "entrada" && !p && n.tp_nf === "0") {
      foraDoArquivo.push({ nota: descr(n), motivo: "Nota de entrada emitida pelo próprio destinatário (terceiro): confira e escriture à parte, se for o caso." });
      continue;
    }
    if (n.modelo === "55" && n.operacao === "entrada" && !p && soDigitos(n.destinatario_documento) !== docEmpresa) {
      foraDoArquivo.push({ nota: descr(n), motivo: "A empresa não é a destinatária desta nota." });
      continue;
    }
    if (n.modelo !== "57" && !n.cancelada && !n.itens.length) {
      foraDoArquivo.push({ nota: descr(n), motivo: "Nota sem itens no XML guardado." });
      continue;
    }
    if (!n.cancelada && n.modelo === "55" && n.operacao === "entrada" && !p && !calculadas.has(n.id)) {
      foraDoArquivo.push({ nota: descr(n), motivo: "Nota fora da apuração do ICMS do mês." });
      continue;
    }
    (n.modelo === "57" ? cte : nfe).push(n);
  }
  if (foraDoArquivo.length) {
    add({ id: "fora", nivel: "aviso", titulo: `${foraDoArquivo.length} ${foraDoArquivo.length === 1 ? "nota ficou" : "notas ficaram"} fora do arquivo`, detalhe: foraDoArquivo.slice(0, 8).map((f) => `${f.nota}: ${f.motivo}`).join(" · ") });
  }

  // Operações que o portal ainda não escritura
  const saidasProprias = nfe.filter((n) => n.operacao === "saida" && !n.cancelada);
  const comSt = saidasProprias.filter((n) => t(n.tributos, "icms_st").gt(0));
  if (comSt.length) {
    add({ id: "st_substituto", nivel: "bloqueio", titulo: `${comSt.length} ${comSt.length === 1 ? "venda" : "vendas"} com ICMS-ST retido (empresa substituta)`, detalhe: "A apuração do ICMS-ST (E200 e E210) ainda não é gerada pelo portal." });
  }
  const comDifal = saidasProprias.filter((n) => t(n.tributos, "difal_destino").gt(0) || t(n.tributos, "fcp_destino").gt(0));
  if (comDifal.length) {
    add({ id: "difal", nivel: "bloqueio", titulo: `${comDifal.length} ${comDifal.length === 1 ? "venda" : "vendas"} a consumidor final de outro estado (DIFAL)`, detalhe: "A apuração do DIFAL por estado (E300 e C101) ainda não é gerada pelo portal." });
  }
  const comIpi = saidasProprias.filter((n) => t(n.tributos, "ipi").gt(0));
  if (comIpi.length) add({ id: "ipi", nivel: "bloqueio", titulo: `${comIpi.length} ${comIpi.length === 1 ? "venda" : "vendas"} com IPI destacado`, detalhe: "A apuração do IPI (E500) ainda não é gerada pelo portal." });

  // E116: vencimento e código de receita
  const codigoInformado = textoCampo(d.config?.codigo_receita, 20) || null;
  // Código de receita é numérico (código da guia do estado); "E116" e afins não servem
  const codigoReceita = codigoInformado && /^\d[\d.\-]*$/.test(codigoInformado) ? codigoInformado : null;

  // ---------------------------------------------------------------------------
  // Registros
  // ---------------------------------------------------------------------------
  const participantes = new Map<string, string[]>();
  const itens = new Map<string, ItemRegistro>();
  const unidades = new Set<string>();
  const regC: string[][] = [];
  const regD: string[][] = [];
  // Crédito presumido do transportador (ajuste por documento: D195/D197, tabela 5.3 do estado)
  const presumido = icms.dados.credito_presumido_cte ?? null;
  const pctPresumido = presumido ? dec(presumido.percentual) : ZERO;
  const codigoPresumido = presumido && /^[A-Z]{2}\d{8}$/.test(presumido.codigo) ? presumido.codigo : null;
  const OBS_PRESUMIDO = "000001";
  let ajCredDoc = ZERO;
  let ctesPresumido = 0;
  let ctesInterestaduais = 0;
  const debitos = { notas: ZERO };
  const creditos = { notas: ZERO };
  const somaOprDoc: { nota: string; doc: Decimal; opr: Decimal }[] = [];
  const contagem = { entradas: 0, saidas: 0, canceladas: 0, cte: 0 };
  let semEndereco = 0;
  let semMunicipio = 0;
  let chavesInvalidas = 0;

  const codPart = (doc: string | null | undefined, participante: ParticipanteNota | null, nomeReserva: string | null, ieReserva: string | null): string => {
    const documento = soDigitos(participante?.documento ?? doc);
    const exterior = participante?.pais && participante.pais !== "1058" && participante.pais !== "01058";
    const codigo = documento ? documento : `EX${textoCampo(participante?.nome ?? nomeReserva, 40).toUpperCase().replace(/[^A-Z0-9]/g, "")}`.slice(0, 60);
    if (participantes.has(codigo)) return codigo;
    const cmun = participante?.cmun ?? null;
    if (!exterior && !cmun) semMunicipio++;
    const endereco = textoCampo(participante?.logradouro, 60);
    if (!endereco) semEndereco++;
    const ieP = soDigitos(participante?.ie ?? ieReserva);
    participantes.set(codigo, [
      codigo,
      textoCampo(participante?.nome ?? nomeReserva, 100) || "NAO INFORMADO",
      exterior ? String(participante!.pais).padStart(5, "0") : "01058",
      !exterior && documento.length === 14 ? documento : "",
      !exterior && documento.length === 11 ? documento : "",
      !exterior && ieP && !/^0+$/.test(ieP) ? ieP : "",
      exterior ? "" : (cmun ?? ""),
      soDigitos(participante?.suframa).length === 9 ? soDigitos(participante?.suframa) : "",
      endereco || "NAO INFORMADO",
      textoCampo(participante?.numero, 10),
      textoCampo(participante?.complemento, 60),
      textoCampo(participante?.bairro, 60),
    ]);
    return codigo;
  };

  const serieCampo = (s: string | null | undefined) => {
    const x = soDigitos(s);
    return x ? x.padStart(3, "0").slice(-3) : "000";
  };
  const numeroDoc = (n: NotaEfdDados) => String(Number(soDigitos(n.numero) || "0"));

  const registrarItem = (n: NotaEfdDados, it: ItemEfdDados, calc: ItemCalculado | undefined): { codigo: string; unidade: string } => {
    const unidadeDoc = unidadeCampo(it.unidade);
    const destinacao = calc?.destinacao ?? "revenda";
    const tipo = destinacao === "uso_consumo" ? "07" : destinacao === "ativo" ? "08" : destinacao === "nao_se_aplica" ? "99" : "00";
    if (it.produto) {
      const p = it.produto;
      const codigo = textoCampo(p.codigo, 60);
      const unidadeInv = unidadeCampo(p.unidade);
      const reg = itens.get(codigo) ?? {
        codigo,
        descricao: textoCampo(p.descricao, 255) || textoCampo(it.descricao, 255),
        gtin: p.gtin,
        unidade: unidadeInv,
        tipo,
        ncm: p.ncm ?? it.ncm,
        exTipi: it.ex_tipi,
        cest: p.cest ?? it.cest,
        conversoes: new Map(),
      };
      if (unidadeDoc !== reg.unidade && !reg.conversoes.has(unidadeDoc)) {
        const fator = dec(p.fator);
        reg.conversoes.set(unidadeDoc, fator.gt(0) ? fator : new Decimal(1));
      }
      itens.set(codigo, reg);
      unidades.add(reg.unidade);
      unidades.add(unidadeDoc);
      return { codigo, unidade: unidadeDoc };
    }
    // Sem vínculo com um produto da empresa: código formado pelo CNPJ do fornecedor e o código dele
    const fornecedor = soDigitos(n.emitente_documento) || "SEMDOC";
    const codFornecedor = textoCampo(it.codigo, 40).replace(/\s+/g, "") || `ITEM${it.n}`;
    let codigo = `${fornecedor}-${codFornecedor}`.slice(0, 60);
    const existente = itens.get(codigo);
    if (existente && existente.unidade !== unidadeDoc) codigo = `${codigo.slice(0, 53)}-${unidadeDoc}`.slice(0, 60);
    if (!itens.has(codigo)) {
      itens.set(codigo, {
        codigo,
        descricao: textoCampo(it.descricao, 255) || `Item ${codFornecedor}`,
        gtin: it.gtin,
        unidade: unidadeDoc,
        tipo,
        ncm: it.ncm,
        exTipi: it.ex_tipi,
        cest: it.cest,
        conversoes: new Map(),
      });
    }
    unidades.add(unidadeDoc);
    return { codigo, unidade: unidadeDoc };
  };

  // --- Bloco C -----------------------------------------------------------------
  for (const n of nfe) {
    const p = propria(n);
    const indOper = p ? (n.tp_nf === "0" ? "0" : "1") : "0";
    const indEmit = p ? "0" : "1";
    const chave = soDigitos(n.chave);
    if (chave && !chaveValida(chave)) chavesInvalidas++;
    if (n.cancelada) {
      contagem.canceladas++;
      regC.push(["C100", indOper, indEmit, "", n.modelo, "02", serieCampo(n.serie), numeroDoc(n), chave, ...Array(20).fill("")]);
      continue;
    }
    const dtDoc = dataLocalDaNota(n);
    const nfce = n.modelo === "65";
    const x929 = p && indOper === "1" && n.itens.some((i) => /^[56]929$/.test(i.cfop ?? ""));
    const codSit = n.finalidade === "2" ? "06" : x929 ? "08" : "00";
    const calc = calculadas.get(n.id);
    const calcItem = new Map((calc?.itens ?? []).map((i) => [i.n, i]));
    const analiticos = new Map<string, Analitico>();
    const linhasC170: string[][] = [];
    let somaItens = ZERO;

    for (const it of n.itens) {
      const tr = it.tributos ?? {};
      const orig = /^[0-8]$/.test(tr.orig ?? "") ? tr.orig : "0";
      const valor = dec(it.valor);
      const desconto = dec(it.desconto);
      const despesas = t(tr, "frete").plus(t(tr, "seguro")).plus(t(tr, "outros"));
      const st = t(tr, "icms_st").plus(t(tr, "fcp_st"));
      const ipi = t(tr, "ipi");
      if (indEmit === "0") {
        // Nota da própria empresa: resumo por CST, CFOP e alíquota (sem C170)
        const cfop = soDigitos(it.cfop);
        const cst2 = tr.cst_icms ?? cstDoCsosn(tr.csosn) ?? "90";
        const ci = calcItem.get(it.n);
        const comIcms = indOper === "1" ? !x929 : Boolean(ci && ci.credito.gt(0));
        const bc = comIcms ? t(tr, "bc_icms") : ZERO;
        const vIcms = comIcms ? (indOper === "1" ? t(tr, "icms").plus(t(tr, "fcp")) : ci!.credito) : ZERO;
        const aliq = comIcms && vIcms.gt(0) ? t(tr, "p_icms") : ZERO;
        const opr = valor.minus(desconto).plus(despesas).plus(st).plus(ipi);
        let cst = cst2;
        let redBc = ZERO;
        if (["20", "70"].includes(cst2)) {
          redBc = Decimal.max(0, opr.minus(st).minus(ipi).minus(t(tr, "bc_icms")));
          if (redBc.isZero()) cst = "90";
        }
        somarAnalitico(analiticos, {
          cst: `${orig}${cst}`,
          cfop,
          aliq,
          opr,
          bc,
          icms: vIcms,
          bcSt: indOper === "1" ? t(tr, "bc_icms_st") : ZERO,
          icmsSt: indOper === "1" ? st : ZERO,
          redBc,
          ipi: indOper === "1" ? ipi : ZERO,
        });
        continue;
      }
      // Nota de terceiro: itens (C170) sob o enfoque do declarante
      const ci = calcItem.get(it.n);
      const credito = ci?.credito ?? ZERO;
      const comCredito = credito.gt(0);
      const stItem = Boolean(ci?.st);
      const cst = cstEntrada(tr.cst_icms, tr.csosn, stItem, comCredito);
      const cfop = cfopEntrada(it.cfop, ci?.destinacao ?? "revenda", stItem, ci?.tipo ?? "compra") ?? "1949";
      // ICMS-ST e IPI sem crédito entram no valor do item (custo da mercadoria)
      const vlItem = valor.plus(ipi).plus(st);
      somaItens = somaItens.plus(vlItem);
      let bc = ZERO;
      let aliq = ZERO;
      if (comCredito) {
        const doSimples = t(tr, "icms").isZero() && t(tr, "cred_icms_sn").gt(0);
        bc = doSimples ? (ci?.valorOperacao ?? vlItem.minus(desconto).plus(despesas)) : t(tr, "bc_icms");
        aliq = doSimples ? t(tr, "p_cred_sn") : t(tr, "p_icms");
        if (bc.isZero()) bc = ci?.valorOperacao ?? vlItem.minus(desconto).plus(despesas);
        if (aliq.isZero() && bc.gt(0)) aliq = credito.times(CEM).div(bc).toDecimalPlaces(2);
      }
      const opr = vlItem.minus(desconto).plus(despesas);
      let cstFinal = cst;
      let redBc = ZERO;
      if (["20", "70"].includes(cst)) {
        redBc = Decimal.max(0, opr.minus(bc));
        if (redBc.isZero()) cstFinal = "90";
      }
      const { codigo, unidade } = registrarItem(n, it, ci);
      const qtd = dec(it.quantidade).gt(0) ? dec(it.quantidade) : new Decimal(1);
      linhasC170.push([
        "C170",
        String(it.n),
        codigo,
        "",
        numeroCampo(qtd, 5),
        unidade,
        numeroCampo(vlItem),
        numeroCampo(desconto),
        "0",
        `${orig}${cstFinal}`,
        cfop,
        "",
        numeroCampo(bc),
        numeroCampo(aliq),
        numeroCampo(comCredito ? credito : ZERO),
        numeroCampo(0),
        numeroCampo(0),
        numeroCampo(0),
        // IPI (só contribuintes do IPI) e PIS/Cofins (dispensados com a EFD-Contribuições)
        ...Array(18).fill(""),
        "",
        "",
      ]);
      somarAnalitico(analiticos, { cst: `${orig}${cstFinal}`, cfop, aliq, opr, bc, icms: comCredito ? credito : ZERO, redBc });
    }

    const lista = [...analiticos.values()].sort((a, b) => a.cfop.localeCompare(b.cfop) || a.cst.localeCompare(b.cst) || a.aliq.cmp(b.aliq));
    const tot = lista.reduce(
      (s, a) => ({ opr: s.opr.plus(centavos(a.opr)), bc: s.bc.plus(centavos(a.bc)), icms: s.icms.plus(centavos(a.icms)), bcSt: s.bcSt.plus(centavos(a.bcSt)), st: s.st.plus(centavos(a.icmsSt)), ipi: s.ipi.plus(centavos(a.ipi)) }),
      { opr: ZERO, bc: ZERO, icms: ZERO, bcSt: ZERO, st: ZERO, ipi: ZERO },
    );
    if (indOper === "1") debitos.notas = debitos.notas.plus(tot.icms);
    else creditos.notas = creditos.notas.plus(tot.icms);
    somaOprDoc.push({ nota: descr(n), doc: centavos(n.valor_total), opr: tot.opr });
    if (indOper === "1") contagem.saidas++;
    else contagem.entradas++;

    const participante = nfce
      ? ""
      : indEmit === "1"
        ? codPart(n.emitente_documento, n.complemento?.emitente ?? null, n.emitente_nome, n.emitente_ie)
        : codPart(n.destinatario_documento, n.complemento?.destinatario ?? null, n.destinatario_nome, null);
    const dataSaida = n.complemento?.data_saida;
    const dtES = indOper === "0" ? dtDoc : dataSaida && dtDoc && dataSaida >= dtDoc && dataSaida <= fim ? dataSaida : null;
    const indPgto = nfce ? "0" : n.duplicatas > 0 || n.complemento?.ind_pag === "1" ? "1" : n.pagamentos.length && n.pagamentos.every((x) => x.forma === "90") ? "2" : "0";
    const modFrete = n.complemento?.mod_frete;
    const indFrt = modFrete && /^[012349]$/.test(modFrete) ? modFrete : "9";
    const vlMerc = indEmit === "1" ? somaItens : dec(n.valor_produtos);
    regC.push([
      "C100",
      indOper,
      indEmit,
      participante,
      n.modelo,
      codSit,
      serieCampo(n.serie),
      numeroDoc(n),
      chave,
      dataCampo(dtDoc),
      dataCampo(dtES),
      numeroCampo(n.valor_total),
      indPgto,
      numeroCampo(n.valor_desconto),
      numeroCampo(0),
      numeroCampo(vlMerc),
      indFrt,
      numeroCampo(n.valor_frete),
      numeroCampo(t(n.tributos, "seguro")),
      numeroCampo(n.valor_outros),
      numeroCampo(tot.bc),
      numeroCampo(tot.icms),
      nfce ? "" : numeroCampo(tot.bcSt),
      nfce ? "" : numeroCampo(tot.st),
      nfce ? "" : numeroCampo(tot.ipi),
      "",
      "",
      "",
      "",
    ]);
    regC.push(...linhasC170);
    for (const a of lista) {
      regC.push(["C190", a.cst, a.cfop, numeroCampo(a.aliq), numeroCampo(a.opr), numeroCampo(a.bc), numeroCampo(a.icms), numeroCampo(a.bcSt), numeroCampo(a.icmsSt), numeroCampo(a.redBc), numeroCampo(a.ipi), ""]);
    }
  }

  // --- Bloco D -----------------------------------------------------------------
  for (const n of cte) {
    const p = propria(n);
    const indOper = p ? "1" : "0";
    const indEmit = p ? "0" : "1";
    const chave = soDigitos(n.chave);
    if (chave && !chaveValida(chave)) chavesInvalidas++;
    if (n.cancelada) {
      contagem.canceladas++;
      regD.push(["D100", indOper, indEmit, "", "57", "02", serieCampo(n.serie), "", numeroDoc(n), chave, ...Array(15).fill("")]);
      continue;
    }
    const k = n.complemento?.cte;
    const dtDoc = dataLocalDaNota(n);
    const valor = dec(k?.valor_prestacao ?? n.valor_total);
    const cstCte = k?.cst ?? "90";
    let bc = ZERO;
    let vIcms = ZERO;
    let aliq = ZERO;
    let cst = cstCte;
    let cfop: string;
    if (p) {
      bc = dec(k?.bc_icms);
      vIcms = dec(k?.icms);
      aliq = vIcms.gt(0) ? dec(k?.p_icms) : ZERO;
      cfop = soDigitos(n.cfops?.[0]) || "5353";
      debitos.notas = debitos.notas.plus(centavos(vIcms));
      contagem.saidas++;
    } else {
      const ci = calculadas.get(n.id)?.itens[0];
      const credito = ci?.credito ?? ZERO;
      if (credito.gt(0)) {
        vIcms = credito;
        bc = dec(k?.bc_icms).gt(0) ? dec(k?.bc_icms) : valor;
        aliq = dec(k?.p_icms).gt(0) ? dec(k?.p_icms) : credito.times(CEM).div(bc).toDecimalPlaces(2);
      } else if (["00", "20"].includes(cstCte)) cst = "90";
      const cfopCte = soDigitos(n.cfops?.[0]);
      cfop = `${{ "5": "1", "6": "2", "7": "3" }[cfopCte[0] as "5"] ?? "1"}353`;
      creditos.notas = creditos.notas.plus(centavos(vIcms));
      contagem.entradas++;
    }
    contagem.cte++;
    let redBc = ZERO;
    if (["20", "70"].includes(cst)) {
      redBc = Decimal.max(0, valor.minus(bc));
      if (redBc.isZero()) cst = "90";
    }
    const naoTributado = ["40", "41", "51"].includes(cst) ? valor : ZERO;
    const tomador = k?.toma;
    const indFrt = tomador === "0" ? "0" : tomador === "3" ? "1" : "2";
    const participante = p
      ? codPart(n.destinatario_documento, n.complemento?.destinatario ?? null, n.destinatario_nome, null)
      : codPart(n.emitente_documento, n.complemento?.emitente ?? null, n.emitente_nome, n.emitente_ie);
    const tp = k?.tp_cte && /^\d$/.test(k.tp_cte) ? k.tp_cte : "0";
    const munOrig = k?.cmun_ini && /^\d{7}$/.test(k.cmun_ini) ? k.cmun_ini : "";
    const munDest = k?.cmun_fim && /^\d{7}$/.test(k.cmun_fim) ? k.cmun_fim : "";
    if (!munOrig || !munDest) semMunicipio++;
    regD.push([
      "D100",
      indOper,
      indEmit,
      participante,
      "57",
      tp === "1" ? "06" : "00",
      serieCampo(n.serie),
      "",
      numeroDoc(n),
      chave,
      dataCampo(dtDoc),
      dataCampo(dtDoc),
      tp,
      tp === "3" ? soDigitos(k?.chave_substituida) : "",
      numeroCampo(valor),
      numeroCampo(0),
      indFrt,
      numeroCampo(valor),
      numeroCampo(bc),
      numeroCampo(vIcms),
      numeroCampo(naoTributado),
      "",
      "",
      munOrig,
      munDest,
    ]);
    regD.push(["D190", `0${cst}`, cfop, numeroCampo(aliq), numeroCampo(valor), numeroCampo(bc), numeroCampo(vIcms), numeroCampo(redBc), ""]);
    // CT-e próprio interestadual com ICMS: crédito presumido calculado no documento
    const interestadual = k?.uf_ini && k?.uf_fim ? k.uf_ini !== k.uf_fim : cfop.startsWith("6");
    if (p && vIcms.gt(0) && interestadual) ctesInterestaduais++;
    if (p && codigoPresumido && pctPresumido.gt(0) && vIcms.gt(0) && interestadual) {
      const credito = centavos(vIcms.times(pctPresumido).div(CEM));
      ajCredDoc = ajCredDoc.plus(credito);
      ctesPresumido++;
      regD.push(["D195", OBS_PRESUMIDO, ""]);
      regD.push([
        "D197",
        codigoPresumido,
        textoCampo(`Crédito presumido de ${numeroCampo(pctPresumido).replace(/,00$/, "")}% do ICMS devido na prestação interestadual`, 255),
        "",
        numeroCampo(vIcms),
        numeroCampo(pctPresumido),
        numeroCampo(credito),
        "",
      ]);
    }
  }

  if (ufEmpresa === "MT" && ctesInterestaduais && !codigoPresumido) {
    add({
      id: "credito_presumido",
      nivel: "aviso",
      titulo: "Transportadora de Mato Grosso: crédito presumido de 20% não configurado",
      detalhe: `Há ${ctesInterestaduais} CT-e interestaduais com ICMS. Se a empresa usa o crédito presumido de 20% do ICMS devido (RICMS/MT, Anexo VI, art. 18), configure ao lado (20% e código MT10001003): o portal lança o ajuste em cada CT-e (registros D195/D197).`,
    });
  }
  if (semMunicipio) {
    add({
      id: "municipios",
      nivel: antigas.length ? "aviso" : "confirmar",
      titulo: `${semMunicipio} ${semMunicipio === 1 ? "participante ou CT-e está" : "participantes ou CT-e estão"} sem o município (IBGE)`,
      detalhe: "O PVA recusa o registro 0150 sem município e o D100 sem os municípios de origem e destino. Confira os XML dessas notas (e atualize a leitura).",
    });
  }
  if (semEndereco) add({ id: "enderecos", nivel: "aviso", titulo: `${semEndereco} ${semEndereco === 1 ? "participante sem endereço" : "participantes sem endereço"} no XML`, detalhe: "Saem com “NAO INFORMADO” no endereço do registro 0150: confira no PVA." });
  if (chavesInvalidas) add({ id: "chaves", nivel: "aviso", titulo: `${chavesInvalidas} ${chavesInvalidas === 1 ? "chave de acesso" : "chaves de acesso"} com dígito verificador inválido`, detalhe: "O PVA confere o dígito da chave: confira os XML dessas notas." });
  const divergentes = somaOprDoc.filter((x) => x.doc.minus(x.opr).abs().gt(new Decimal("0.01")));
  if (divergentes.length) {
    add({
      id: "vl_opr",
      nivel: "aviso",
      titulo: `${divergentes.length} ${divergentes.length === 1 ? "nota com" : "notas com"} valor total diferente da soma dos registros analíticos`,
      detalhe: `O PVA mostra advertência quando o total da nota (VL_DOC) difere da soma do C190 (ex.: ICMS desonerado, IBS/CBS). ${divergentes
        .slice(0, 5)
        .map((x) => `${x.nota}: ${moeda(x.doc)} × ${moeda(x.opr)}`)
        .join("; ")}`,
    });
  }

  // --- Bloco E: apuração (como o PVA confere) -----------------------------------
  const porTipo = (tipo: TipoLancamentoIcms) => lancamentos.filter((l) => l.tipo === tipo).reduce((s, l) => s.plus(centavos(l.valor)), ZERO);
  const ajDeb = porTipo("outro_debito");
  const estCred = porTipo("estorno_credito");
  const ajCred = porTipo("outro_credito");
  const estDeb = porTipo("estorno_debito");
  const deducoes = porTipo("deducao");
  const saldoAnterior = centavos(res.propria?.saldoAnterior ?? ZERO);
  const totDeb = centavos(debitos.notas);
  const totCred = centavos(creditos.notas);
  const ajCredDocumentos = centavos(ajCredDoc);
  const expressao = totDeb.plus(ajDeb).plus(estCred).minus(totCred.plus(ajCredDocumentos).plus(ajCred).plus(estDeb).plus(saldoAnterior));
  const saldoDevedor = Decimal.max(0, expressao);
  const aRecolher = Decimal.max(0, saldoDevedor.minus(deducoes));
  const credorTransportar = Decimal.max(0, expressao.minus(deducoes).neg());
  const apuracao: ApuracaoE110 = {
    debitos: totDeb.toFixed(2),
    ajustes_debito_documentos: "0.00",
    ajustes_debito: ajDeb.toFixed(2),
    estornos_credito: estCred.toFixed(2),
    creditos: totCred.toFixed(2),
    ajustes_credito_documentos: ajCredDocumentos.toFixed(2),
    ajustes_credito: ajCred.toFixed(2),
    estornos_debito: estDeb.toFixed(2),
    saldo_credor_anterior: saldoAnterior.toFixed(2),
    saldo_devedor: saldoDevedor.toFixed(2),
    deducoes: deducoes.toFixed(2),
    a_recolher: aRecolher.toFixed(2),
    saldo_credor_transportar: credorTransportar.toFixed(2),
    extra_apuracao: "0.00",
  };
  if (deducoes.gt(saldoDevedor)) {
    add({ id: "deducoes", nivel: "aviso", titulo: "Deduções maiores que o saldo devedor", detalhe: "Pela regra do PVA, a parte das deduções acima do saldo devedor vai para o saldo credor a transportar. Confira se a legislação do estado permite." });
  }
  // Comparação com a apuração do ICMS do portal
  if (regimeNormal) {
    const pr = res.propria!;
    const dif = (a: Decimal, b: Decimal) => a.minus(b).abs().gt(new Decimal("0.01"));
    const diferencas = [
      dif(totDeb, pr.debitos) && `débitos ${moeda(totDeb)} no arquivo × ${moeda(pr.debitos)} na apuração`,
      dif(totCred, pr.creditos) && `créditos ${moeda(totCred)} × ${moeda(pr.creditos)}`,
      dif(aRecolher, pr.aRecolher) && `ICMS a recolher ${moeda(aRecolher)} × ${moeda(pr.aRecolher)}`,
    ].filter(Boolean) as string[];
    if (diferencas.length) {
      add({
        id: "diferenca_apuracao",
        nivel: "aviso",
        titulo: "O arquivo difere da Apuração do ICMS do portal",
        detalhe: `${diferencas.join("; ")}. Pode ser FCP somado ao ICMS, NF-e de cupom (CFOP 5.929), nota fora do arquivo ou a apuração calculada antes de notas novas: confira antes de transmitir.`,
      });
    }
  }
  const vencimento = op.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(op.vencimento) ? op.vencimento : null;
  if (aRecolher.gt(0) && !vencimento) {
    add({ id: "vencimento", nivel: "bloqueio", titulo: "Informe o vencimento do ICMS a recolher", detalhe: `O registro E116 traz o ICMS de ${moeda(aRecolher)} com a data de vencimento.`, acao: "vencimento" });
  }
  if (aRecolher.gt(0) && !codigoReceita) {
    add({
      id: "codigo_receita",
      nivel: "bloqueio",
      titulo: codigoInformado ? `Código de receita do ICMS inválido (${codigoInformado})` : "Informe o código de receita do ICMS",
      detalhe: codigoInformado
        ? "O código de receita é o número da guia do ICMS no estado (ex.: Mato Grosso, ICMS normal: 1112), não o nome do registro. Corrija na configuração da EFD."
        : "O registro E116 exige o código de receita do estado (ex.: Mato Grosso, ICMS normal: 1112). Ele fica guardado para os próximos meses.",
      acao: "codigo_receita",
    });
  }

  // ---------------------------------------------------------------------------
  // Pendências que impedem a geração
  // ---------------------------------------------------------------------------
  const impede = pendencias.filter((p) => p.nivel === "bloqueio" || (p.nivel === "confirmar" && !confirmadas.has(p.id)));
  const ordem: Record<NivelPendencia, number> = { bloqueio: 0, confirmar: 1, aviso: 2 };
  pendencias.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  const notasResumo = { entradas: contagem.entradas, saidas: contagem.saidas, canceladas: contagem.canceladas, cte: contagem.cte, fora: foraDoArquivo.length };
  const vencimentoResumo = aRecolher.gt(0) ? vencimento : null;
  if (impede.length || !versao) {
    // Sem arquivo: só a prévia (notas e apuração) para a tela
    const previa: ResumoEfd = { periodo: { inicio: comp, fim }, linhas: 0, registros: {}, notas: notasResumo, participantes: participantes.size, itens: itens.size, apuracao, vencimento: vencimentoResumo };
    return { pendencias, conteudo: null, nomeArquivo, resumo: previa, foraDoArquivo };
  }

  // ---------------------------------------------------------------------------
  // Escrita, bloco a bloco
  // ---------------------------------------------------------------------------
  const a = new Arquivo();
  const dtIni = dataCampo(comp);
  const dtFim = dataCampo(fim);
  const pj = emp.tipo_pessoa !== "PF";

  // Bloco 0
  a.registrar(
    "0000",
    versao,
    String(op.finalidade),
    dtIni,
    dtFim,
    textoCampo(emp.razao_social, 100),
    pj ? docEmpresa : "",
    pj ? "" : docEmpresa,
    ufEmpresa,
    ie,
    emp.municipio_ibge,
    textoCampo(soDigitos(emp.inscricao_municipal) ? emp.inscricao_municipal : "", 20),
    "",
    d.config?.perfil ?? "A",
    "1",
  );
  a.registrar("0001", "0");
  a.registrar(
    "0005",
    textoCampo(emp.nome_fantasia || emp.razao_social, 60),
    soDigitos(emp.cep),
    textoCampo(emp.logradouro, 60),
    textoCampo(emp.numero, 10),
    textoCampo(emp.complemento, 60),
    textoCampo(emp.bairro, 60),
    telefoneCampo(emp.telefone),
    "",
    textoCampo(emp.email, 100),
  );
  a.registrar(
    "0100",
    textoCampo(c.nome, 100),
    soDigitos(c.cpf),
    textoCampo(c.crc, 15),
    soDigitos(c.cnpj).length === 14 ? soDigitos(c.cnpj) : "",
    soDigitos(c.cep).length === 8 ? soDigitos(c.cep) : "",
    textoCampo(c.logradouro, 60),
    textoCampo(c.numero, 10),
    textoCampo(c.complemento, 60),
    textoCampo(c.bairro, 60),
    telefoneCampo(c.telefone),
    "",
    textoCampo(c.email, 100),
    c.municipio_ibge,
  );
  for (const campos of [...participantes.values()].sort((x, y) => x[0].localeCompare(y[0]))) a.registrar("0150", ...campos);
  for (const u of [...unidades].sort()) a.registrar("0190", u, UNIDADES[u] ?? `Unidade ${u}`);
  const listaItens = [...itens.values()].sort((x, y) => x.codigo.localeCompare(y.codigo));
  for (const it of listaItens) {
    const ncm = soDigitos(it.ncm);
    const ncmValido = ncm.length === 8 && ncm !== "00000000" ? ncm : "";
    a.registrar(
      "0200",
      it.codigo,
      it.descricao,
      it.gtin && /^(\d{8}|\d{12,14})$/.test(it.gtin) ? it.gtin : "",
      "",
      it.unidade,
      it.tipo,
      ncmValido,
      textoCampo(it.exTipi, 3),
      ncmValido ? ncmValido.slice(0, 2) : "",
      "",
      "",
      it.cest && /^\d{7}$/.test(it.cest) ? it.cest : "",
    );
    for (const [unidade, fator] of it.conversoes) a.registrar("0220", unidade, numeroCampo(fator, 6), "");
  }
  if (ctesPresumido) a.registrar("0460", OBS_PRESUMIDO, "Crédito presumido do prestador de serviço de transporte nas prestações interestaduais");
  a.registrar("0990", String(a.linhasDoBloco("0") + 1));

  // Bloco B (somente o Distrito Federal tem informações de ISS)
  a.registrar("B001", "1");
  a.registrar("B990", "2");

  // Bloco C
  a.registrar("C001", regC.length ? "0" : "1");
  for (const [reg, ...campos] of regC) a.registrar(reg, ...campos);
  a.registrar("C990", String(a.linhasDoBloco("C") + 1));

  // Bloco D
  a.registrar("D001", regD.length ? "0" : "1");
  for (const [reg, ...campos] of regD) a.registrar(reg, ...campos);
  a.registrar("D990", String(a.linhasDoBloco("D") + 1));

  // Bloco E
  a.registrar("E001", "0");
  a.registrar("E100", dtIni, dtFim);
  a.registrar(
    "E110",
    numeroCampo(totDeb),
    numeroCampo(0),
    numeroCampo(ajDeb),
    numeroCampo(estCred),
    numeroCampo(totCred),
    numeroCampo(ajCredDocumentos),
    numeroCampo(ajCred),
    numeroCampo(estDeb),
    numeroCampo(saldoAnterior),
    numeroCampo(saldoDevedor),
    numeroCampo(deducoes),
    numeroCampo(aRecolher),
    numeroCampo(credorTransportar),
    numeroCampo(0),
  );
  for (const l of lancamentos) {
    a.registrar("E111", d.lancamentos_codigos[l.id], textoCampo([l.descricao, l.observacao].filter(Boolean).join(" — "), 255), numeroCampo(l.valor));
  }
  if (aRecolher.gt(0)) {
    a.registrar("E116", "000", numeroCampo(aRecolher), dataCampo(vencimento), codigoReceita, "", "", "", "", `${comp.slice(5, 7)}${comp.slice(0, 4)}`);
  }
  a.registrar("E990", String(a.linhasDoBloco("E") + 1));

  // Blocos G, H e K sem informações
  a.registrar("G001", "1");
  a.registrar("G990", "2");
  a.registrar("H001", "1");
  a.registrar("H990", "2");
  a.registrar("K001", "1");
  a.registrar("K990", "2");

  // Bloco 1: indicadores do 1010 (todos "N": sem exportação, combustíveis, usinas, energia, cartões...)
  a.registrar("1001", "0");
  a.registrar("1010", ...Array(13).fill("N"));
  a.registrar("1990", "3");

  // Bloco 9: contagem dos registros
  const contagemFinal = new Map(a.contagem);
  const tiposNoBloco9 = contagemFinal.size + 4; // 9001, 9900, 9990 e 9999
  contagemFinal.set("9001", 1);
  contagemFinal.set("9900", tiposNoBloco9);
  contagemFinal.set("9990", 1);
  contagemFinal.set("9999", 1);
  a.registrar("9001", "0");
  for (const [reg, q] of [...contagemFinal.entries()].sort(([x], [y]) => ordemRegistro(x) - ordemRegistro(y) || x.localeCompare(y))) a.registrar("9900", reg, String(q));
  const linhasBloco9 = 1 + tiposNoBloco9 + 2;
  a.registrar("9990", String(linhasBloco9));
  a.registrar("9999", String(a.linhas.length + 1));

  const conteudo = paraLatin1(a.linhas.join("\r\n") + "\r\n");
  const registros = Object.fromEntries([...a.contagem.entries()].sort(([x], [y]) => ordemRegistro(x) - ordemRegistro(y) || x.localeCompare(y)));
  return {
    pendencias,
    conteudo,
    nomeArquivo,
    foraDoArquivo,
    resumo: {
      periodo: { inicio: comp, fim },
      linhas: a.linhas.length,
      registros,
      notas: notasResumo,
      participantes: participantes.size,
      itens: itens.size,
      apuracao,
      vencimento: vencimentoResumo,
    },
  };
}

/** Ordem dos blocos no arquivo (0, B, C, D, E, G, H, K, 1, 9). */
function ordemRegistro(reg: string): number {
  return "0BCDEGHK19".indexOf(reg[0]);
}
