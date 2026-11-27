import type { DadosPedido, FormaPagamento } from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGAMENTOS: FormaPagamento[] = ["pix", "cartao_credito", "cartao_debito", "dinheiro"];

const texto = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);

export type Validacao = { ok: true; dados: DadosPedido } | { ok: false; mensagem: string; robo?: boolean };

/** Confere o formato do pedido antes de mandar ao portal (que confere preço, estoque e entrega de novo). */
export function validarPedido(corpo: unknown): Validacao {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  if (texto(c.site, 200)) return { ok: false, mensagem: "Pedido recusado.", robo: true };
  const nome = texto(c.nome, 120).replace(/\s+/g, " ");
  const telefone = texto(c.telefone, 30).replace(/\D/g, "");
  const entrega = texto(c.entrega, 40);
  const endereco = texto(c.endereco, 200).replace(/\s+/g, " ");
  const pagamento = texto(c.pagamento, 20) as FormaPagamento;
  const observacao = texto(c.observacao, 500);
  const troco = c.troco_para == null || c.troco_para === "" ? null : Number(c.troco_para);
  const total = Number(c.total_visto);
  if (nome.length < 2) return { ok: false, mensagem: "Informe o seu nome." };
  if (!/^(55)?[1-9]\d{9,10}$/.test(telefone)) return { ok: false, mensagem: "Informe o seu WhatsApp com DDD." };
  if (!entrega) return { ok: false, mensagem: "Escolha a forma de entrega." };
  if (!PAGAMENTOS.includes(pagamento)) return { ok: false, mensagem: "Escolha a forma de pagamento." };
  if (c.aceite !== true) return { ok: false, mensagem: "É preciso concordar com o uso dos dados para a loja atender o pedido." };
  if (!Array.isArray(c.itens) || !c.itens.length) return { ok: false, mensagem: "A sacola está vazia." };
  if (c.itens.length > 60) return { ok: false, mensagem: "No máximo 60 itens por pedido." };
  const itens = [];
  for (const i of c.itens as Record<string, unknown>[]) {
    const quantidade = Number(i?.quantidade);
    if (!UUID.test(String(i?.produto_id ?? "")) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 99) {
      return { ok: false, mensagem: "Confira os itens da sacola." };
    }
    const variacao = i.variacao == null ? null : texto(i.variacao, 60) || null;
    itens.push({ produto_id: String(i.produto_id), quantidade, variacao });
  }
  if (!Number.isFinite(total) || total < 0) return { ok: false, mensagem: "Confira o total do pedido." };
  if (troco !== null && (!Number.isFinite(troco) || troco <= 0 || troco > 100000)) return { ok: false, mensagem: "Confira o valor do troco." };
  return {
    ok: true,
    dados: {
      nome,
      telefone,
      entrega,
      endereco: endereco || undefined,
      pagamento,
      troco_para: pagamento === "dinheiro" ? troco : null,
      observacao: observacao || undefined,
      itens,
      total_visto: Math.round(total * 100) / 100,
    },
  };
}

/** Limite simples por endereço de internet (por instância do servidor). */
export function criarLimitador(maximo: number, janelaMs: number) {
  const registros = new Map<string, number[]>();
  return (chave: string, agora = Date.now()) => {
    const recentes = (registros.get(chave) ?? []).filter((t) => agora - t < janelaMs);
    if (recentes.length >= maximo) {
      registros.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    registros.set(chave, recentes);
    if (registros.size > 5000) registros.delete(registros.keys().next().value as string);
    return true;
  };
}
