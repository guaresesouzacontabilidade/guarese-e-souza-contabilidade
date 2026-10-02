import { Decimal, dec } from "@/lib/dinheiro";
import { normalizarDescricao } from "@/lib/extratos/comum";

/**
 * Motor de correspondência para conciliação bancária. Gera SUGESTÕES (nunca
 * confirma sozinho) comparando valor, data, descrição, CPF/CNPJ e números de
 * documento entre movimentações do extrato e lançamentos, baixas e
 * movimentações de outras contas (transferências).
 */
export interface MovimentoC {
  id: string;
  conta_id: string;
  conta_tipo?: string;
  data: string;
  valor: string; // com sinal
  descricao: string;
  documento: string | null;
}

export interface LancamentoC {
  id: string;
  tipo: "receber" | "pagar";
  descricao: string;
  aberto: string; // saldo em aberto (positivo)
  vencimento: string;
  conta_id: string | null;
  contraparte_nome: string | null;
  contraparte_documento: string | null;
  numero_documento: string | null;
}

export interface BaixaC {
  id: string;
  tipo: "receber" | "pagar";
  total: string;
  data: string;
  conta_id: string;
  descricao: string;
  contraparte_documento: string | null;
}

export interface SugestaoC {
  conta_id: string;
  tipo: "lancamento" | "baixa" | "transferencia";
  pontuacao: number;
  criterios: Record<string, unknown>;
  observacao: string;
  itens: ({ movimento_id: string; valor: string } | { lancamento_id: string; valor: string } | { baixa_id: string; valor: string })[];
}

const PALAVRAS_IGNORADAS = new Set(["PIX", "TED", "DOC", "TRANSF", "TRANSFERENCIA", "PAGAMENTO", "PAGTO", "PGTO", "RECEBIDO", "RECEBIMENTO", "ENVIADO", "DE", "DA", "DO", "PARA", "LTDA", "ME", "SA", "EIRELI", "COMPRA", "CARTAO", "DEBITO", "CREDITO", "-", "NF", "NFE"]);

function tokens(t: string) {
  return new Set(
    normalizarDescricao(t)
      .split(/[^A-Z0-9]+/)
      .filter((x) => x.length >= 3 && !PALAVRAS_IGNORADAS.has(x)),
  );
}

export function similaridade(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let comum = 0;
  for (const x of ta) if (tb.has(x)) comum++;
  return comum / Math.min(ta.size, tb.size);
}

function dias(a: string, b: string) {
  return Math.abs(Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000));
}

function pontosData(d: number) {
  if (d === 0) return 20;
  if (d <= 3) return 15;
  if (d <= 7) return 10;
  if (d <= 30) return 4;
  if (d <= 60) return 0;
  return -15;
}

export function pontuarLancamento(m: MovimentoC, l: LancamentoC) {
  const valorMov = dec(m.valor).abs();
  const aberto = dec(l.aberto);
  if ((dec(m.valor).isPositive() ? "receber" : "pagar") !== l.tipo) return null;
  const diferenca = valorMov.minus(aberto);
  const tolerancia = Decimal.max(new Decimal("1.00"), aberto.times("0.02"));
  let pontos = 0;
  const criterios: Record<string, unknown> = {};
  if (diferenca.isZero()) {
    pontos += 50;
    criterios.valor = "exato";
  } else if (diferenca.abs().lessThanOrEqualTo(tolerancia)) {
    pontos += 25;
    criterios.valor = "aproximado";
    criterios.diferenca = diferenca.toFixed(2);
  } else return null;
  const d = dias(m.data, l.vencimento);
  pontos += pontosData(d);
  criterios.dias = d;
  if (m.documento && l.contraparte_documento && m.documento === l.contraparte_documento) {
    pontos += 25;
    criterios.documento = true;
  }
  const sim = similaridade(m.descricao, `${l.descricao} ${l.contraparte_nome ?? ""}`);
  if (sim > 0) {
    pontos += Math.round(sim * 15);
    criterios.descricao = Number(sim.toFixed(2));
  }
  if (l.numero_documento && l.numero_documento.length >= 3 && normalizarDescricao(m.descricao).includes(normalizarDescricao(l.numero_documento))) {
    pontos += 10;
    criterios.numero_documento = true;
  }
  if (l.conta_id && l.conta_id === m.conta_id) pontos += 5;
  return { pontos: Math.max(0, Math.min(100, pontos)), criterios };
}

export function calcularSugestoes(
  movimentos: MovimentoC[],
  lancamentos: LancamentoC[],
  baixas: BaixaC[],
  rejeicoes: Set<string> = new Set(),
  limiar = 55,
): SugestaoC[] {
  const sugestoes: SugestaoC[] = [];
  const movUsados = new Set<string>();
  const alvoUsado = new Set<string>();
  const rejeitado = (movId: string, alvoId: string) => rejeicoes.has(`${movId}:${alvoId}`);

  // 1) Baixas já registradas e ainda não conciliadas (valor exato, mesma conta)
  for (const m of movimentos) {
    let melhor: { b: BaixaC; pontos: number; criterios: Record<string, unknown> } | null = null;
    for (const b of baixas) {
      if (alvoUsado.has(b.id) || b.conta_id !== m.conta_id || rejeitado(m.id, b.id)) continue;
      const sinal = b.tipo === "receber" ? 1 : -1;
      if (!dec(b.total).times(sinal).equals(dec(m.valor))) continue;
      const d = dias(m.data, b.data);
      if (d > 10) continue;
      let pontos = 60 + pontosData(d);
      const criterios: Record<string, unknown> = { valor: "exato", dias: d };
      if (m.documento && m.documento === b.contraparte_documento) {
        pontos += 15;
        criterios.documento = true;
      }
      const sim = similaridade(m.descricao, b.descricao);
      pontos += Math.round(sim * 10);
      if (!melhor || pontos > melhor.pontos) melhor = { b, pontos: Math.min(100, pontos), criterios };
    }
    if (melhor && melhor.pontos >= limiar) {
      movUsados.add(m.id);
      alvoUsado.add(melhor.b.id);
      sugestoes.push({
        conta_id: m.conta_id,
        tipo: "baixa",
        pontuacao: melhor.pontos,
        criterios: melhor.criterios,
        observacao: "Pagamento/recebimento já registrado com o mesmo valor",
        itens: [
          { movimento_id: m.id, valor: dec(m.valor).toFixed(2) },
          { baixa_id: melhor.b.id, valor: dec(m.valor).toFixed(2) },
        ],
      });
    }
  }

  // 2) Transferências entre contas da empresa (saída e entrada de mesmo valor)
  const pendentes = movimentos.filter((m) => !movUsados.has(m.id));
  for (const saida of pendentes.filter((m) => dec(m.valor).isNegative())) {
    if (movUsados.has(saida.id)) continue;
    let melhor: { e: MovimentoC; pontos: number; d: number } | null = null;
    for (const entrada of pendentes) {
      if (movUsados.has(entrada.id) || entrada.conta_id === saida.conta_id || !dec(entrada.valor).isPositive()) continue;
      if (!dec(entrada.valor).equals(dec(saida.valor).abs()) || rejeitado(saida.id, entrada.id)) continue;
      const d = dias(saida.data, entrada.data);
      if (d > 3) continue;
      let pontos = 65 + (d === 0 ? 15 : 8);
      if (/TRANSF|TED|DOC|PIX|APLIC|RESGATE|FATURA|PAGAMENTO/.test(normalizarDescricao(saida.descricao + " " + entrada.descricao))) pontos += 10;
      if (!melhor || pontos > melhor.pontos) melhor = { e: entrada, pontos, d };
    }
    if (melhor) {
      movUsados.add(saida.id);
      movUsados.add(melhor.e.id);
      sugestoes.push({
        conta_id: saida.conta_id,
        tipo: "transferencia",
        pontuacao: Math.min(100, melhor.pontos),
        criterios: { valor: "exato", dias: melhor.d, transferencia: true, cartao: melhor.e.conta_tipo === "cartao_credito" },
        observacao: melhor.e.conta_tipo === "cartao_credito" ? "Pagamento de fatura de cartão (transferência entre contas)" : "Transferência entre contas da empresa",
        itens: [
          { movimento_id: saida.id, valor: dec(saida.valor).toFixed(2) },
          { movimento_id: melhor.e.id, valor: dec(melhor.e.valor).toFixed(2) },
        ],
      });
    }
  }

  // 3) Lançamentos em aberto 1:1 (melhores pares primeiro)
  const pares: { m: MovimentoC; l: LancamentoC; pontos: number; criterios: Record<string, unknown> }[] = [];
  for (const m of movimentos) {
    if (movUsados.has(m.id)) continue;
    for (const l of lancamentos) {
      if (rejeitado(m.id, l.id)) continue;
      const r = pontuarLancamento(m, l);
      if (r && r.pontos >= limiar) pares.push({ m, l, ...r });
    }
  }
  pares.sort((a, b) => b.pontos - a.pontos);
  for (const p of pares) {
    if (movUsados.has(p.m.id) || alvoUsado.has(p.l.id)) continue;
    movUsados.add(p.m.id);
    alvoUsado.add(p.l.id);
    sugestoes.push({
      conta_id: p.m.conta_id,
      tipo: "lancamento",
      pontuacao: p.pontos,
      criterios: p.criterios,
      observacao: p.criterios.valor === "exato" ? "Valor e dados compatíveis" : `Valor com diferença de R$ ${String(p.criterios.diferenca).replace(".", ",")} (juros, desconto ou taxa)`,
      itens: [
        { movimento_id: p.m.id, valor: dec(p.m.valor).toFixed(2) },
        { lancamento_id: p.l.id, valor: (p.l.tipo === "receber" ? dec(p.l.aberto) : dec(p.l.aberto).negated()).toFixed(2) },
      ],
    });
  }

  // 4) Uma movimentação = vários lançamentos da mesma contraparte (soma exata)
  for (const m of movimentos) {
    if (movUsados.has(m.id)) continue;
    const tipo = dec(m.valor).isPositive() ? "receber" : "pagar";
    const alvo = dec(m.valor).abs();
    const candidatos = lancamentos
      .filter((l) => l.tipo === tipo && !alvoUsado.has(l.id) && dec(l.aberto).lessThan(alvo) && !rejeitado(m.id, l.id))
      .filter((l) => (m.documento && l.contraparte_documento === m.documento) || similaridade(m.descricao, `${l.descricao} ${l.contraparte_nome ?? ""}`) >= 0.5)
      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
      .slice(0, 14);
    const combinacao = subconjuntoComSoma(candidatos, alvo, 4);
    if (combinacao) {
      movUsados.add(m.id);
      combinacao.forEach((l) => alvoUsado.add(l.id));
      const comDoc = Boolean(m.documento && combinacao.every((l) => l.contraparte_documento === m.documento));
      sugestoes.push({
        conta_id: m.conta_id,
        tipo: "lancamento",
        pontuacao: comDoc ? 80 : 60,
        criterios: { valor: "soma_exata", quantidade: combinacao.length, documento: comDoc },
        observacao: `Uma movimentação corresponde a ${combinacao.length} lançamentos (soma exata)`,
        itens: [
          { movimento_id: m.id, valor: dec(m.valor).toFixed(2) },
          ...combinacao.map((l) => ({ lancamento_id: l.id, valor: (tipo === "receber" ? dec(l.aberto) : dec(l.aberto).negated()).toFixed(2) })),
        ],
      });
    }
  }
  return sugestoes;
}

function subconjuntoComSoma(itens: LancamentoC[], alvo: Decimal, maximo: number): LancamentoC[] | null {
  const centavos = itens.map((i) => dec(i.aberto).times(100).toNumber());
  const meta = alvo.times(100).toNumber();
  let resposta: number[] | null = null;
  const buscar = (inicio: number, soma: number, escolhidos: number[]) => {
    if (resposta) return;
    if (soma === meta && escolhidos.length >= 2) {
      resposta = [...escolhidos];
      return;
    }
    if (escolhidos.length >= maximo || soma > meta) return;
    for (let i = inicio; i < itens.length; i++) {
      escolhidos.push(i);
      buscar(i + 1, soma + centavos[i], escolhidos);
      escolhidos.pop();
      if (resposta) return;
    }
  };
  buscar(0, 0, []);
  return resposta ? (resposta as number[]).map((i) => itens[i]) : null;
}
