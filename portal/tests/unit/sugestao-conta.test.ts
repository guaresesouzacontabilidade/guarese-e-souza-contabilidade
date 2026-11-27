import { describe, expect, it } from "vitest";
import { contasMaisUsadas, palavras, sugerirConta, type LancamentoHistorico } from "@/lib/financeiro/sugestao-conta";

// Do mais recente para o mais antigo
const historico: LancamentoHistorico[] = [
  { tipo: "pagar", descricao: "Aluguel da loja - dezembro", categoria_id: "aluguel", contraparte_id: "imobiliaria" },
  { tipo: "pagar", descricao: "Conta de energia elétrica", categoria_id: "energia", contraparte_id: "celtins" },
  { tipo: "receber", descricao: "Venda balcão", categoria_id: "vendas", contraparte_id: null },
  { tipo: "pagar", descricao: "Aluguel da loja - novembro", categoria_id: "aluguel", contraparte_id: "imobiliaria" },
  { tipo: "pagar", descricao: "Combustível Hilux", categoria_id: "combustivel", contraparte_id: "posto" },
  { tipo: "pagar", descricao: "Gasolina caminhonete", categoria_id: "combustivel", contraparte_id: "posto" },
  { tipo: "pagar", descricao: "Material de limpeza", categoria_id: "consumo", contraparte_id: null },
  { tipo: "pagar", descricao: "Aluguel da loja - outubro", categoria_id: "aluguel", contraparte_id: "imobiliaria" },
];

describe("sugestão de conta pelo histórico da empresa", () => {
  it("mesmo fornecedor: a conta da última vez", () => {
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "qualquer coisa", contraparteId: "posto" })).toMatchObject({ categoriaId: "combustivel", motivo: "fornecedor" });
  });

  it("descrição parecida (sem acento, maiúsculas e números não atrapalham)", () => {
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "ALUGUEL janeiro 2027" })).toMatchObject({ categoriaId: "aluguel", motivo: "descricao" });
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "energia eletrica" })?.categoriaId).toBe("energia");
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "combustivel" })?.categoriaId).toBe("combustivel");
  });

  it("sem parecido, não sugere nada; não mistura receita com despesa", () => {
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "honorários advocatícios" })).toBeNull();
    expect(sugerirConta(historico, { tipo: "receber", descricao: "aluguel" })).toBeNull();
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "" })).toBeNull();
  });

  it("ignora contas que não estão mais disponíveis", () => {
    expect(sugerirConta(historico, { tipo: "pagar", descricao: "aluguel" }, new Set(["energia"]))).toBeNull();
  });

  it("mais usadas por tipo, da mais usada para a menos", () => {
    expect(contasMaisUsadas(historico, "pagar")).toEqual(["aluguel", "combustivel", "energia", "consumo"]);
    expect(contasMaisUsadas(historico, "receber")).toEqual(["vendas"]);
    expect(contasMaisUsadas(historico, "pagar", 2)).toEqual(["aluguel", "combustivel"]);
  });

  it("palavras: sem palavras vazias nem repetidas", () => {
    expect(palavras("Pagamento da conta de Luz - Luz")).toEqual(["luz"]);
  });
});
