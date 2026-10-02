import { describe, expect, it } from "vitest";
import { calcularSugestoes, pontuarLancamento, similaridade, type BaixaC, type LancamentoC, type MovimentoC } from "@/lib/conciliacao/sugestoes";

const mov = (p: Partial<MovimentoC> & { id: string; valor: string }): MovimentoC => ({
  conta_id: "c1",
  data: "2026-09-10",
  descricao: "PIX RECEBIDO",
  documento: null,
  ...p,
});

const lanc = (p: Partial<LancamentoC> & { id: string; aberto: string }): LancamentoC => ({
  tipo: "receber",
  descricao: "Venda",
  vencimento: "2026-09-10",
  conta_id: null,
  contraparte_nome: null,
  contraparte_documento: null,
  numero_documento: null,
  ...p,
});

describe("similaridade", () => {
  it("ignora palavras genéricas de extrato", () => {
    expect(similaridade("PIX RECEBIDO MERCADO BOM PRECO", "Mercado Bom Preço Ltda")).toBe(1);
    expect(similaridade("PIX RECEBIDO", "PIX ENVIADO")).toBe(0);
  });
});

describe("pontuarLancamento", () => {
  it("valor exato, mesma data e CPF/CNPJ dão pontuação alta", () => {
    const r = pontuarLancamento(
      mov({ id: "m1", valor: "1500.00", documento: "12345678000199" }),
      lanc({ id: "l1", aberto: "1500.00", contraparte_documento: "12345678000199" }),
    );
    expect(r?.pontos).toBeGreaterThanOrEqual(90);
    expect(r?.criterios.valor).toBe("exato");
  });

  it("não sugere quando o sentido é oposto (saída x conta a receber)", () => {
    expect(pontuarLancamento(mov({ id: "m1", valor: "-100.00" }), lanc({ id: "l1", aberto: "100.00" }))).toBeNull();
  });

  it("aceita pequena diferença (juros/desconto) e informa o valor", () => {
    const r = pontuarLancamento(mov({ id: "m1", valor: "-101.50" }), lanc({ id: "l1", tipo: "pagar", aberto: "100.00" }));
    expect(r?.criterios.valor).toBe("aproximado");
    expect(r?.criterios.diferenca).toBe("1.50");
  });

  it("rejeita diferença grande", () => {
    expect(pontuarLancamento(mov({ id: "m1", valor: "150.00" }), lanc({ id: "l1", aberto: "100.00" }))).toBeNull();
  });
});

describe("calcularSugestoes", () => {
  it("sugere 1:1 com o melhor par e não reutiliza o lançamento", () => {
    const s = calcularSugestoes(
      [mov({ id: "m1", valor: "200.00", descricao: "PIX RECEBIDO JOAO SILVA" }), mov({ id: "m2", valor: "200.00", data: "2026-09-25" })],
      [lanc({ id: "l1", aberto: "200.00", contraparte_nome: "João Silva" })],
      [],
    );
    expect(s).toHaveLength(1);
    expect(s[0].itens).toEqual([
      { movimento_id: "m1", valor: "200.00" },
      { lancamento_id: "l1", valor: "200.00" },
    ]);
  });

  it("valores de contas a pagar ficam negativos nos itens", () => {
    const s = calcularSugestoes([mov({ id: "m1", valor: "-80.00" })], [lanc({ id: "l1", tipo: "pagar", aberto: "80.00" })], []);
    expect(s[0].itens[1]).toEqual({ lancamento_id: "l1", valor: "-80.00" });
  });

  it("identifica transferência entre contas (inclusive fatura de cartão) e não a trata como despesa", () => {
    const s = calcularSugestoes(
      [
        mov({ id: "saida", conta_id: "banco", valor: "-950.00", descricao: "PAGAMENTO FATURA CARTAO" }),
        mov({ id: "entrada", conta_id: "cartao", conta_tipo: "cartao_credito", valor: "950.00", descricao: "PAGAMENTO RECEBIDO" }),
      ],
      [lanc({ id: "l1", tipo: "pagar", aberto: "950.00" })],
      [],
    );
    expect(s).toHaveLength(1);
    expect(s[0].tipo).toBe("transferencia");
    expect(s[0].criterios.cartao).toBe(true);
  });

  it("prefere baixa já registrada (evita pagar duas vezes)", () => {
    const baixa: BaixaC = { id: "b1", tipo: "pagar", total: "300.00", data: "2026-09-09", conta_id: "c1", descricao: "Aluguel", contraparte_documento: null };
    const s = calcularSugestoes([mov({ id: "m1", valor: "-300.00", descricao: "TED ALUGUEL" })], [lanc({ id: "l9", tipo: "pagar", aberto: "300.00" })], [baixa]);
    expect(s).toHaveLength(1);
    expect(s[0].tipo).toBe("baixa");
  });

  it("um recebimento pode quitar várias parcelas do mesmo cliente (soma exata)", () => {
    const s = calcularSugestoes(
      [mov({ id: "m1", valor: "350.00", documento: "11122233344" })],
      [
        lanc({ id: "l1", aberto: "100.00", contraparte_documento: "11122233344" }),
        lanc({ id: "l2", aberto: "250.00", contraparte_documento: "11122233344", vencimento: "2026-10-10" }),
        lanc({ id: "l3", aberto: "999.00", contraparte_documento: "99999999999" }),
      ],
      [],
    );
    expect(s).toHaveLength(1);
    expect(s[0].itens.map((i) => Object.values(i)[0]).sort()).toEqual(["l1", "l2", "m1"]);
  });

  it("não volta a sugerir pares rejeitados", () => {
    const s = calcularSugestoes([mov({ id: "m1", valor: "200.00" })], [lanc({ id: "l1", aberto: "200.00" })], [], new Set(["m1:l1"]));
    expect(s).toHaveLength(0);
  });
});
