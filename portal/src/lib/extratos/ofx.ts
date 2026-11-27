import { Decimal, lerValorBR } from "@/lib/dinheiro";
import { decodificarTexto, extrairDocumento, numerarOcorrencias, type LinhaInvalida, type TransacaoExtrato } from "./comum";

/** Leitor de extratos OFX (SGML 1.x e XML 2.x), inclusive cartões de crédito. */

export interface ExtratoOfx {
  tipoConta: "banco" | "cartao";
  bancoId: string | null;
  agencia: string | null;
  conta: string | null;
  moeda: string | null;
  inicio: string | null;
  fim: string | null;
  saldo: { valor: string; data: string | null } | null;
  transacoes: TransacaoExtrato[];
  invalidas: LinhaInvalida[];
  avisos: string[];
}

function campo(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, "i").exec(bloco);
  const v = m?.[1]?.trim();
  return v ? v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;
}

function dataOfx(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function ehOfx(texto: string) {
  return /OFXHEADER|<OFX>/i.test(texto.slice(0, 4000));
}

export function lerOfx(entrada: Uint8Array | string): ExtratoOfx {
  let texto: string;
  if (typeof entrada === "string") texto = entrada;
  else {
    const inicio = new TextDecoder("latin1").decode(entrada.slice(0, 600));
    const charset = /CHARSET:\s*([^\r\n]+)/i.exec(inicio)?.[1] ?? /encoding="([^"]+)"/i.exec(inicio)?.[1] ?? null;
    texto = decodificarTexto(entrada, charset);
  }
  if (!ehOfx(texto)) throw new Error("O arquivo não parece ser um OFX válido.");
  const avisos: string[] = [];
  const cartao = /<CCSTMTRS>/i.test(texto);
  const contaBloco = /<(?:BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/(?:BANKACCTFROM|CCACCTFROM)>/i.exec(texto)?.[1] ?? "";
  const lista = /<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i.exec(texto)?.[1] ?? texto;
  const blocos = [...lista.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map((m) => m[1]);
  const transacoes: TransacaoExtrato[] = [];
  const invalidas: LinhaInvalida[] = [];

  blocos.forEach((b, i) => {
    const data = dataOfx(campo(b, "DTPOSTED") ?? campo(b, "DTUSER"));
    const valorTxt = campo(b, "TRNAMT");
    const valor = valorTxt ? (/^-?\d+(\.\d+)?$/.test(valorTxt) ? valorTxt : lerValorBR(valorTxt)?.toFixed(2) ?? null) : null;
    const nome = campo(b, "NAME");
    const memo = campo(b, "MEMO");
    let descricao = [nome, memo].filter(Boolean).join(" - ");
    if (nome && memo && (memo.includes(nome) || nome.includes(memo))) descricao = memo.length >= nome.length ? memo : nome;
    descricao = descricao.replace(/\s+/g, " ").trim() || campo(b, "TRNTYPE") || "Sem descrição";
    if (!data || !valor) {
      invalidas.push({ linha: i + 1, motivo: !data ? "Data inválida" : "Valor inválido", conteudo: b.slice(0, 200) });
      return;
    }
    if (Number(valor) === 0) {
      invalidas.push({ linha: i + 1, motivo: "Valor zero (ignorado)", conteudo: descricao });
      return;
    }
    transacoes.push({
      data,
      valor: formatarDecimal(valor),
      descricao,
      documento: extrairDocumento(descricao),
      fitid: campo(b, "FITID"),
      tipo: campo(b, "TRNTYPE"),
      numero: campo(b, "CHECKNUM") ?? campo(b, "REFNUM"),
      ocorrencia: 1,
      linha: i + 1,
    });
  });

  const saldoBloco = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i.exec(texto)?.[1] ?? "";
  const saldoValorTxt = campo(saldoBloco, "BALAMT");
  const saldoValor = saldoValorTxt ? (/^-?\d+(\.\d+)?$/.test(saldoValorTxt) ? saldoValorTxt : lerValorBR(saldoValorTxt)?.toFixed(2) ?? null) : null;
  if (!blocos.length) avisos.push("Nenhuma transação encontrada no OFX.");
  const inicio = dataOfx(campo(lista, "DTSTART"));
  const fim = dataOfx(campo(lista, "DTEND"));

  return {
    tipoConta: cartao ? "cartao" : "banco",
    bancoId: campo(contaBloco, "BANKID"),
    agencia: campo(contaBloco, "BRANCHID"),
    conta: campo(contaBloco, "ACCTID"),
    moeda: campo(texto, "CURDEF"),
    inicio,
    fim,
    saldo: saldoValor ? { valor: formatarDecimal(saldoValor), data: dataOfx(campo(saldoBloco, "DTASOF")) ?? fim } : null,
    transacoes: numerarOcorrencias(transacoes),
    invalidas,
    avisos,
  };
}

function formatarDecimal(v: string) {
  if (/^-?\d+(\.\d+)?$/.test(v)) return new Decimal(v).toFixed(2);
  const n = lerValorBR(v);
  return n ? n.toFixed(2) : v;
}
