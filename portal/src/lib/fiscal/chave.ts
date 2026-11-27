/** Chave de acesso de documentos fiscais eletrônicos (44 dígitos). */

export function dvChave(base43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function chaveValida(chave: string | null | undefined): boolean {
  if (!chave || !/^\d{44}$/.test(chave)) return false;
  return dvChave(chave.slice(0, 43)) === Number(chave[43]);
}

export interface PartesChave {
  uf: string;
  anoMes: string; // AAMM
  documentoEmitente: string; // CNPJ (ou CPF com zeros)
  modelo: string;
  serie: string;
  numero: string;
  tipoEmissao: string;
  codigo: string;
  dv: string;
}

/** Código IBGE da UF (dois primeiros dígitos da chave) → sigla. */
export const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export function partesChave(chave: string): PartesChave | null {
  if (!/^\d{44}$/.test(chave)) return null;
  return {
    uf: chave.slice(0, 2),
    anoMes: chave.slice(2, 6),
    documentoEmitente: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34))),
    tipoEmissao: chave.slice(34, 35),
    codigo: chave.slice(35, 43),
    dv: chave.slice(43),
  };
}

export const MODELOS: Record<string, string> = {
  "55": "NF-e",
  "65": "NFC-e",
  "57": "CT-e",
  "67": "CT-e OS",
  "58": "MDF-e",
  "59": "CF-e SAT",
};
