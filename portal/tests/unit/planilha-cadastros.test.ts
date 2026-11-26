import { describe, expect, it } from "vitest";
import { analisarCadastros, campoDoTituloCadastro, lerDocumento, paraImportarCadastros, separarNumero } from "@/lib/gestao/planilha-cadastros";

const municipio = (cidade: string, uf: string | null) => (cidade.toLowerCase().startsWith("palmas") && (!uf || uf === "TO") ? "1721000" : null);
const vazio = { documentos: new Map<string, string>(), nomes: new Set<string>() };

describe("planilha de clientes e fornecedores", () => {
  it("reconhece os títulos usados por outros sistemas", () => {
    expect(campoDoTituloCadastro("Razão Social")).toBe("nome");
    expect(campoDoTituloCadastro("Nome fantasia")).toBe("fantasia");
    expect(campoDoTituloCadastro("CPF/CNPJ")).toBe("documento");
    expect(campoDoTituloCadastro("Inscrição")).toBe("documento");
    expect(campoDoTituloCadastro("Inscrição Estadual")).toBe("inscricao_estadual");
    expect(campoDoTituloCadastro("E-mail")).toBe("email");
    expect(campoDoTituloCadastro("Celular")).toBe("celular");
    expect(campoDoTituloCadastro("Nº")).toBe("numero");
    expect(campoDoTituloCadastro("Estado")).toBe("uf");
    expect(campoDoTituloCadastro("Rua")).toBe("logradouro");
    expect(campoDoTituloCadastro("Código")).toBeNull();
  });

  it("CPF/CNPJ com zero apagado pelo Excel e inválido", () => {
    expect(lerDocumento("529.982.247-25")).toEqual({ documento: "52998224725", invalido: false });
    expect(lerDocumento("11222333000181")).toEqual({ documento: "11222333000181", invalido: false });
    expect(lerDocumento("123.456.789-00")).toEqual({ documento: null, invalido: true });
  });

  it("separa o número do endereço", () => {
    expect(separarNumero("Rua das Flores, 120")).toEqual({ logradouro: "Rua das Flores", numero: "120" });
    expect(separarNumero("Av. JK nº 45 - sala 2")).toEqual({ logradouro: "Av. JK", numero: "45" });
    expect(separarNumero("Quadra 104 Norte")).toEqual({ logradouro: "Quadra 104 Norte", numero: null });
  });

  it("planilha no formato do GestãoClick: prévia com novo, existente, repetido e erro", () => {
    const linhas = [
      ["Relatório de clientes"],
      ["Código", "Tipo", "Nome", "Nome fantasia", "CPF/CNPJ", "Inscrição Estadual", "Telefone", "Celular", "E-mail", "CEP", "Endereço", "Bairro", "Cidade", "Estado", "Situação"],
      [1, "PJ", "SERRARIA EXEMPLO LTDA", "Serraria do Zé", "11.222.333/0001-81", "ISENTO", "", "(63) 99999-0000", "contato@serraria.test", "77000-000", "Rua 1, 100", "Centro", "Palmas", "TO", "Ativo"],
      [2, "PF", "Maria Cliente", "", "529.982.247-25", "", "3215-0000", "", "email-invalido", "", "", "", "Cidade Inexistente", "TO", "Inativo"],
      [3, "PF", "Maria Cliente Repetida", "", "52998224725", "", "", "", "", "", "", "", "", "", ""],
      [4, "PF", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      [5, "PF", "", "", "111.444.777-35", "", "", "", "", "", "", "", "", "", ""],
      [6, "PF", "João Já Cadastrado", "", "111.444.777-35", "", "", "", "", "", "", "", "", "", ""],
    ];
    const existentes = { documentos: new Map([["11144477735", "João"]]), nomes: new Set<string>() };
    const r = analisarCadastros([{ nome: "Clientes", linhas }], existentes, { papel: "cliente", ddd: "63", municipio })!;
    expect(r.linhaTitulos).toBe(2);
    expect(r.totais).toEqual({ novo: 2, existente: 1, repetido: 1, erro: 1 });
    const [serraria, maria, repetida, semNome, joao] = r.linhas;
    expect(serraria).toMatchObject({
      nome: "SERRARIA EXEMPLO LTDA", documento: "11222333000181", inscricao_estadual: null, telefone: "63999990000", email: "contato@serraria.test",
      cep: "77000000", logradouro: "Rua 1", numero: "100", municipio_ibge: "1721000", ativo: true, observacoes: "Nome fantasia: Serraria do Zé", situacao: "novo",
    });
    expect(maria).toMatchObject({ telefone: "6332150000", email: null, municipio_ibge: null, ativo: false, situacao: "novo" });
    expect(maria.avisos.join(" ")).toMatch(/E-mail inválido.*Cidade "Cidade Inexistente \/ TO"/);
    expect(repetida.situacao).toBe("repetido");
    expect(semNome).toMatchObject({ situacao: "erro", motivo: "Sem nome" });
    expect(joao.situacao).toBe("existente");
    expect(paraImportarCadastros(r.linhas).map((l) => l.linha)).toEqual([3, 4, 8]);
  });

  it("colunas do Omie G.Click (Inscrição, Apelido, Rua) e correção manual de coluna", () => {
    const linhas = [
      ["Tipo de Inscrição", "Inscrição", "Nome", "Apelido", "Rua", "Complemento", "Bairro", "Cidade", "Estado", "CEP", "Código antigo"],
      ["CNPJ", "11.222.333/0001-81", "Fornecedor X LTDA", "X", "Av. Teotônio Segurado nº 500", "", "Plano Diretor", "Palmas", "Tocantins", "77001-000", "28 dias"],
    ];
    const r = analisarCadastros([{ nome: "Planilha1", linhas }], vazio, { papel: "fornecedor", municipio, mapa: { "Código antigo": "prazo" } })!;
    expect(r.linhas[0]).toMatchObject({ documento: "11222333000181", logradouro: "Av. Teotônio Segurado", numero: "500", municipio_ibge: "1721000", prazo_pagamento_dias: 28, observacoes: "Nome fantasia: X" });
    expect(r.colunas.find((c) => c.titulo === "Código antigo")?.campo).toBe("prazo");
  });

  it("sem coluna de nome não reconhece a planilha", () => {
    expect(analisarCadastros([{ nome: "x", linhas: [["Produto", "Preço"], ["A", 1]] }], vazio, { papel: "cliente", municipio })).toBeNull();
  });
});
