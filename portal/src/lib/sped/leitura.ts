import Decimal from "decimal.js";

/**
 * Leitura do arquivo da EFD ICMS/IPI (SPED Fiscal), conforme o Guia Prático
 * da EFD ICMS/IPI (versão 3.2.2, de 11/02/2026):
 *   0000  abertura (período, CNPJ, UF, IE, perfil, finalidade)
 *   0150  participantes (nome e CNPJ/CPF de clientes e fornecedores)
 *   C100  notas fiscais (modelos 01, 1B, 04, 55 e 65) e C190 (resumo por CST/CFOP)
 *   E110  apuração do ICMS das operações próprias
 * A EFD-Contribuições é reconhecida pelo registro 0000, mas ainda não é lida.
 * O arquivo é lido até o registro 9999 (a assinatura digital que vem depois é ignorada).
 */

export type TipoSped = "efd_icms_ipi" | "efd_contribuicoes";

export interface DocumentoSped {
  linha: number;
  ind_oper: "0" | "1";
  ind_emit: "0" | "1";
  cod_part: string | null;
  participante_nome: string | null;
  participante_documento: string | null;
  cod_mod: string;
  cod_sit: string;
  serie: string | null;
  numero: string | null;
  chave: string | null;
  dt_doc: string | null;
  dt_e_s: string | null;
  vl_doc: string | null;
  vl_icms: string | null;
  vl_icms_st: string | null;
  vl_ipi: string | null;
  cfops: string[];
}

export interface AnaliticoSped {
  cfop: string;
  valor_operacao: string;
  base_icms: string;
  icms: string;
  icms_st: string;
  ipi: string;
}

export interface ApuracaoIcms {
  debitos: string;
  ajustes_debito: string;
  estornos_credito: string;
  creditos: string;
  ajustes_credito: string;
  estornos_debito: string;
  saldo_credor_anterior: string;
  saldo_devedor: string;
  deducoes: string;
  a_recolher: string;
  saldo_credor_transportar: string;
  extra_apuracao: string;
}

export interface CabecalhoSped {
  tipo: TipoSped;
  versao_leiaute: string | null;
  finalidade: "original" | "substituto" | null;
  inicio: string;
  fim: string;
  nome: string | null;
  cnpj: string | null;
  cpf: string | null;
  uf: string | null;
  ie: string | null;
  perfil: string | null;
}

export interface SpedLido extends CabecalhoSped {
  documentos: DocumentoSped[];
  analitico: AnaliticoSped[];
  apuracao: ApuracaoIcms | null;
  registros: number;
  avisos: string[];
}

export type ResultadoSped = { ok: true; dados: SpedLido } | { ok: false; motivo: "nao_e_sped" | "nao_suportado"; mensagem: string; cabecalho?: CabecalhoSped };

const SITUACOES_CANCELADAS = new Set(["02", "03", "04", "05"]);

/** "ddmmaaaa" → "aaaa-mm-dd". */
export function dataSped(v: string | undefined): string | null {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec((v ?? "").trim());
  if (!m) return null;
  const [, d, mes, a] = m;
  const dt = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (dt.getUTCMonth() !== Number(mes) - 1) return null;
  return `${a}-${mes}-${d}`;
}

/** "1234,56" → "1234.56" (vazio → null). */
export function valorSped(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (!/^-?\d+(,\d+)?$/.test(t)) return null;
  return new Decimal(t.replace(",", ".")).toFixed(2);
}

const digitos = (v: string | undefined) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d || null;
};

/** Identifica o tipo do arquivo pelo registro 0000 (sem ler o resto). */
export function lerCabecalhoSped(primeiraLinha: string): CabecalhoSped | null {
  const f = primeiraLinha.replace(/^﻿/, "").trim().split("|");
  if (f[1] !== "0000") return null;
  // EFD ICMS/IPI: |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV|
  if (/^\d{8}$/.test(f[4] ?? "") && /^\d{8}$/.test(f[5] ?? "")) {
    const inicio = dataSped(f[4]);
    const fim = dataSped(f[5]);
    if (!inicio || !fim) return null;
    return {
      tipo: "efd_icms_ipi",
      versao_leiaute: f[2] || null,
      finalidade: f[3] === "1" ? "substituto" : f[3] === "0" ? "original" : null,
      inicio,
      fim,
      nome: f[6]?.trim() || null,
      cnpj: digitos(f[7]),
      cpf: digitos(f[8]),
      uf: f[9]?.trim() || null,
      ie: f[10]?.trim() || null,
      perfil: f[14]?.trim() || null,
    };
  }
  // EFD-Contribuições: |0000|COD_VER|TIPO_ESCRIT|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|UF|...
  if (/^\d{8}$/.test(f[6] ?? "") && /^\d{8}$/.test(f[7] ?? "")) {
    const inicio = dataSped(f[6]);
    const fim = dataSped(f[7]);
    if (!inicio || !fim) return null;
    return {
      tipo: "efd_contribuicoes",
      versao_leiaute: f[2] || null,
      finalidade: f[3] === "1" ? "substituto" : f[3] === "0" ? "original" : null,
      inicio,
      fim,
      nome: f[8]?.trim() || null,
      cnpj: digitos(f[9]),
      cpf: null,
      uf: f[10]?.trim() || null,
      ie: null,
      perfil: null,
    };
  }
  return null;
}

export function ehSped(texto: string) {
  return /^﻿?\|0000\|/.test(texto.slice(0, 20));
}

/** Lê a EFD ICMS/IPI. */
export function lerSped(texto: string): ResultadoSped {
  const linhas = texto.split(/\r?\n/);
  const cabecalho = lerCabecalhoSped(linhas[0] ?? "");
  if (!cabecalho) return { ok: false, motivo: "nao_e_sped", mensagem: "O arquivo não começa com o registro 0000 da EFD (SPED Fiscal)." };
  if (cabecalho.tipo !== "efd_icms_ipi") {
    return {
      ok: false,
      motivo: "nao_suportado",
      mensagem: "Arquivo da EFD-Contribuições (PIS/Cofins): reconhecido e guardado, mas a conferência com os XML ainda não lê este arquivo.",
      cabecalho,
    };
  }

  const participantes = new Map<string, { nome: string | null; documento: string | null }>();
  const documentos: DocumentoSped[] = [];
  const analitico = new Map<string, { valor_operacao: Decimal; base_icms: Decimal; icms: Decimal; icms_st: Decimal; ipi: Decimal }>();
  const avisos: string[] = [];
  let apuracao: ApuracaoIcms | null = null;
  let atual: DocumentoSped | null = null;
  let registros = 0;
  let encerrado = false;
  const zero = (v: string | null) => new Decimal(v ?? "0");

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;
    if (!linha.startsWith("|")) continue;
    const f = linha.split("|");
    const reg = f[1];
    registros++;
    if (reg === "9999") {
      encerrado = true;
      break;
    }
    if (reg === "0150") {
      // |0150|COD_PART|NOME|COD_PAIS|CNPJ|CPF|IE|COD_MUN|SUFRAMA|END|NUM|COMPL|BAIRRO|
      participantes.set(f[2] ?? "", { nome: f[3]?.trim() || null, documento: digitos(f[5]) ?? digitos(f[6]) });
    } else if (reg === "C100") {
      // |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|IND_PGTO|VL_DESC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|VL_PIS|VL_COFINS|VL_PIS_ST|VL_COFINS_ST|
      const part = participantes.get(f[4] ?? "");
      const chave = digitos(f[9]);
      atual = {
        linha: i + 1,
        ind_oper: f[2] === "1" ? "1" : "0",
        ind_emit: f[3] === "1" ? "1" : "0",
        cod_part: f[4]?.trim() || null,
        participante_nome: part?.nome ?? null,
        participante_documento: part?.documento ?? null,
        cod_mod: (f[5] ?? "").trim(),
        cod_sit: (f[6] ?? "").trim(),
        serie: f[7]?.trim() || null,
        numero: f[8]?.trim().replace(/^0+(?=\d)/, "") || null,
        chave: chave && chave.length === 44 ? chave : null,
        dt_doc: dataSped(f[10]),
        dt_e_s: dataSped(f[11]),
        vl_doc: valorSped(f[12]),
        vl_icms: valorSped(f[22]),
        vl_icms_st: valorSped(f[24]),
        vl_ipi: valorSped(f[25]),
        cfops: [],
      };
      if (chave && chave.length !== 44) avisos.push(`Linha ${i + 1}: chave da NF-e com ${chave.length} dígitos.`);
      documentos.push(atual);
    } else if (reg === "C190" && atual) {
      // |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_RED_BC|VL_IPI|COD_OBS|
      const cfop = (f[3] ?? "").trim();
      if (/^\d{4}$/.test(cfop)) {
        if (!atual.cfops.includes(cfop)) atual.cfops.push(cfop);
        if (!SITUACOES_CANCELADAS.has(atual.cod_sit)) {
          const a = analitico.get(cfop) ?? { valor_operacao: new Decimal(0), base_icms: new Decimal(0), icms: new Decimal(0), icms_st: new Decimal(0), ipi: new Decimal(0) };
          a.valor_operacao = a.valor_operacao.plus(zero(valorSped(f[5])));
          a.base_icms = a.base_icms.plus(zero(valorSped(f[6])));
          a.icms = a.icms.plus(zero(valorSped(f[7])));
          a.icms_st = a.icms_st.plus(zero(valorSped(f[9])));
          a.ipi = a.ipi.plus(zero(valorSped(f[11])));
          analitico.set(cfop, a);
        }
      }
    } else if (reg === "E110" && !apuracao) {
      // |E110|VL_TOT_DEBITOS|VL_AJ_DEBITOS|VL_TOT_AJ_DEBITOS|VL_ESTORNOS_CRED|VL_TOT_CREDITOS|VL_AJ_CREDITOS|VL_TOT_AJ_CREDITOS|
      //  VL_ESTORNOS_DEB|VL_SLD_CREDOR_ANT|VL_SLD_APURADO|VL_TOT_DED|VL_ICMS_RECOLHER|VL_SLD_CREDOR_TRANSPORTAR|DEB_ESP|
      const v = (n: number) => valorSped(f[n]) ?? "0.00";
      apuracao = {
        debitos: v(2),
        // ajustes do documento fiscal (03) + ajustes da apuração (04)
        ajustes_debito: new Decimal(v(3)).plus(v(4)).toFixed(2),
        estornos_credito: v(5),
        creditos: v(6),
        ajustes_credito: new Decimal(v(7)).plus(v(8)).toFixed(2),
        estornos_debito: v(9),
        saldo_credor_anterior: v(10),
        saldo_devedor: v(11),
        deducoes: v(12),
        a_recolher: v(13),
        saldo_credor_transportar: v(14),
        extra_apuracao: v(15),
      };
    } else if (/^[D-K1-9]/.test(reg ?? "") || reg === "C001" || reg === "C990") {
      // Outros blocos/registros: fora da nota atual
      if (reg !== "C001") atual = null;
    }
  }
  if (!encerrado) avisos.push("O arquivo não tem o registro 9999 (encerramento): pode estar incompleto.");

  return {
    ok: true,
    dados: {
      ...cabecalho,
      documentos,
      analitico: [...analitico.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([cfop, a]) => ({
          cfop,
          valor_operacao: a.valor_operacao.toFixed(2),
          base_icms: a.base_icms.toFixed(2),
          icms: a.icms.toFixed(2),
          icms_st: a.icms_st.toFixed(2),
          ipi: a.ipi.toFixed(2),
        })),
      apuracao,
      registros,
      avisos: avisos.slice(0, 50),
    },
  };
}

export const ROTULO_SITUACAO_SPED: Record<string, string> = {
  "00": "Regular",
  "01": "Regular (extemporânea)",
  "02": "Cancelada",
  "03": "Cancelada (extemporânea)",
  "04": "Denegada",
  "05": "Numeração inutilizada",
  "06": "Complementar",
  "07": "Complementar (extemporânea)",
  "08": "Regime especial ou norma específica",
};
