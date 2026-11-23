/**
 * Pix "copia e cola" (BR Code estático do Banco Central) com a chave do
 * escritório: valor certo e identificador da cobrança (txid). O pagamento
 * não é confirmado sozinho por este Pix: a baixa é feita pelo escritório
 * (ou, mais tarde, pela ligação com o banco).
 *
 * Formato EMV: cada campo é ID (2) + tamanho (2) + conteúdo; o fim é o CRC16
 * (CCITT-FALSE) do texto inteiro, incluindo "6304".
 */

export type TipoChavePix = "cnpj" | "cpf" | "email" | "telefone" | "aleatoria";

export const TIPOS_CHAVE_PIX: Record<TipoChavePix, string> = {
  cnpj: "CNPJ",
  cpf: "CPF",
  email: "E-mail",
  telefone: "Celular",
  aleatoria: "Chave aleatória",
};

function campo(id: string, valor: string) {
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(texto: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(texto)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Sem acentos e só com caracteres aceitos por todos os bancos, em maiúsculas. */
export function textoPix(texto: string, max: number) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-/&]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, max)
    .trim();
}

function digitos(v: string) {
  return v.replace(/\D/g, "");
}

function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + p * Number(c[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/** Confere e põe a chave no formato do Pix. Devolve null quando a chave não vale para o tipo. */
export function normalizarChavePix(tipo: TipoChavePix, chave: string): string | null {
  const v = chave.trim();
  switch (tipo) {
    case "cnpj": {
      const d = digitos(v);
      return cnpjValido(d) ? d : null;
    }
    case "cpf": {
      const d = digitos(v);
      return cpfValido(d) ? d : null;
    }
    case "email": {
      const e = v.toLowerCase();
      return e.length <= 77 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
    }
    case "telefone": {
      let d = digitos(v);
      if (d.length === 10 || d.length === 11) d = `55${d}`;
      return /^55\d{10,11}$/.test(d) ? `+${d}` : null;
    }
    case "aleatoria": {
      const a = v.toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a) ? a : null;
    }
  }
}

export interface DadosPix {
  chave: string;
  /** Nome de quem recebe (até 25 letras). */
  nome: string;
  /** Cidade de quem recebe (até 15 letras). */
  cidade: string;
  /** Valor com duas casas ("850.00"). Sem valor, quem paga digita. */
  valor?: string | null;
  /** Identificador da cobrança (até 25 letras e números). */
  txid?: string | null;
  /** Mensagem curta que aparece para quem paga (opcional). */
  mensagem?: string | null;
}

/** Monta o Pix "copia e cola" (o mesmo texto vai no QR code). */
export function montarPixCopiaECola(d: DadosPix) {
  const conta = [campo("00", "br.gov.bcb.pix"), campo("01", d.chave)];
  const mensagem = d.mensagem ? textoPix(d.mensagem, 99 - conta.join("").length - 4) : "";
  if (mensagem) conta.push(campo("02", mensagem));
  const txid = (d.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const valor = d.valor && Number(d.valor) > 0 ? Number(d.valor).toFixed(2) : null;
  const corpo = [
    campo("00", "01"),
    campo("26", conta.join("")),
    campo("52", "0000"),
    campo("53", "986"),
    ...(valor ? [campo("54", valor)] : []),
    campo("58", "BR"),
    campo("59", textoPix(d.nome, 25) || "RECEBEDOR"),
    campo("60", textoPix(d.cidade, 15) || "BRASIL"),
    campo("62", campo("05", txid)),
  ].join("");
  const semCrc = `${corpo}6304`;
  return `${semCrc}${crc16(semCrc)}`;
}

/** Lê os campos de um Pix copia e cola (para conferência nos testes e na tela). */
export function lerPixCopiaECola(texto: string) {
  const campos: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= texto.length) {
    const id = texto.slice(i, i + 2);
    const n = Number(texto.slice(i + 2, i + 4));
    if (!Number.isFinite(n)) break;
    campos[id] = texto.slice(i + 4, i + 4 + n);
    i += 4 + n;
  }
  const ok = texto.length > 8 && crc16(texto.slice(0, -4)) === texto.slice(-4);
  return { campos, crcValido: ok };
}
