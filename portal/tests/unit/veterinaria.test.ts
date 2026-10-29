import { describe, expect, it } from "vitest";
import { gruposEmpresa, type EmpresaMenu } from "@/components/layout/navegacao";
import type { Permissao } from "@/lib/permissoes";
import { idadeAnimal, linkWhatsapp, mensagemLembrete, pendenciasTutor, proximaDose } from "@/lib/veterinaria/rotulos";
import { VIAS_RECEITA, dataPorExtenso } from "@/lib/veterinaria/pdf";

const ID = "11111111-1111-4111-8111-111111111111";

describe("clínica veterinária: regras simples", () => {
  it("idade do animal em anos e meses (ou dias, para filhote)", () => {
    const ref = new Date(2026, 9, 29);
    expect(idadeAnimal("2021-03-10", ref)).toBe("5 anos e 7 meses");
    expect(idadeAnimal("2025-10-29", ref)).toBe("1 ano");
    expect(idadeAnimal("2026-06-01", ref)).toBe("4 meses");
    expect(idadeAnimal("2026-10-17", ref)).toBe("12 dias");
    expect(idadeAnimal("2026-10-28", ref)).toBe("1 dia");
    expect(idadeAnimal(null, ref)).toBeNull();
    expect(idadeAnimal("2027-01-01", ref)).toBeNull();
  });

  it("próxima dose: intervalo do esquema inicial e reforço anual", () => {
    const v10 = { doses_iniciais: 3, intervalo_doses_dias: 21, reforco_dias: 365 };
    expect(proximaDose("2026-10-29", "1", v10)).toBe("2026-11-19");
    expect(proximaDose("2026-10-29", "2", v10)).toBe("2026-11-19");
    // Última dose do esquema e reforço: reforço anual
    expect(proximaDose("2026-10-29", "3", v10)).toBe("2027-10-29");
    expect(proximaDose("2026-10-29", "reforco", v10)).toBe("2027-10-29");
    expect(proximaDose("2026-10-29", "unica", { doses_iniciais: 1, intervalo_doses_dias: 21, reforco_dias: null })).toBeNull();
    expect(proximaDose("29/10/2026", "1", v10)).toBeNull();
    expect(proximaDose("2026-10-29", "1", null)).toBeNull();
  });

  it("mensagem do lembrete com o primeiro nome do tutor e a data no padrão brasileiro", () => {
    const texto = mensagemLembrete("Olá, {tutor}! A vacina {vacina} do(a) {animal} vence em {data}. {clinica}", {
      clinica: "Clínica Amigo Fiel",
      tutor: "Mariana Lopes Carvalho",
      animal: "Mel",
      vacina: "Antirrábica",
      data: "2026-11-05",
    });
    expect(texto).toBe("Olá, Mariana! A vacina Antirrábica do(a) Mel vence em 05/11/2026. Clínica Amigo Fiel");
  });

  it("link do WhatsApp com o código do Brasil e o texto pronto (nada é enviado pelo portal)", () => {
    expect(linkWhatsapp("(63) 99999-1234", "Olá & até")).toBe("https://wa.me/5563999991234?text=Ol%C3%A1%20%26%20at%C3%A9");
    expect(linkWhatsapp("5563999991234", "x")).toBe("https://wa.me/5563999991234?text=x");
    expect(linkWhatsapp("1234", "x")).toBeNull();
    expect(linkWhatsapp(null, "x")).toBeNull();
  });

  it("o que falta no cadastro do tutor para os documentos (CPF e endereço completo)", () => {
    expect(pendenciasTutor({ cpf: null, logradouro: "Rua A", cidade: null })).toEqual(["CPF", "endereço"]);
    expect(pendenciasTutor({ cpf: "52998224725", logradouro: "Rua A", cidade: "Palmas" })).toEqual([]);
  });
});

describe("clínica veterinária: documentos", () => {
  it("vias de cada receita: comum e antimicrobiano em 2, manipulado controlado em 3", () => {
    expect(VIAS_RECEITA.simples).toHaveLength(2);
    expect(VIAS_RECEITA.antimicrobiano).toHaveLength(2);
    // RDC Anvisa nº 471/2021: a 1ª via fica retida na farmácia
    expect(VIAS_RECEITA.antimicrobiano[0]).toMatch(/farmácia/);
    expect(VIAS_RECEITA.magistral_controlada).toHaveLength(3);
    expect(VIAS_RECEITA.magistral_controlada.join(" ")).toMatch(/manipulação/);
  });

  it("data por extenso no fuso da clínica", () => {
    expect(dataPorExtenso("2026-10-09")).toBe("9 de outubro de 2026");
    // 01:30 UTC do dia 1º ainda é dia 31 em Porto Nacional (UTC-3)
    expect(dataPorExtenso("2026-11-01T01:30:00Z")).toBe("31 de outubro de 2026");
  });
});

describe("clínica veterinária: menu", () => {
  const empresa = (permissoes: string[]): EmpresaMenu => ({
    id: ID,
    nome: "Clínica",
    documento: "11444777000161",
    papel: "cliente_titular",
    permissoes: permissoes as Permissao[],
    demonstracao: false,
    loja: true,
    modalidade: "veterinaria",
  });

  it("recepção vê a clínica e o pet shop; configurações só o responsável", () => {
    const recepcao = gruposEmpresa(empresa(["gestao.vender"]), false);
    expect(recepcao.find((g) => g.id === "veterinaria")!.itens.map((i) => i.rotulo)).toEqual([
      "Painel da clínica",
      "Agenda",
      "Tutores e animais",
      "Vacinas e retornos",
      "Contas da clínica",
    ]);
    expect(recepcao.find((g) => g.id === "loja")!.rotulo).toBe("Pet shop e farmácia");
    expect(recepcao.find((g) => g.id === "configuracoes")?.itens.some((i) => i.rotulo === "Configurações da clínica") ?? false).toBe(false);
    const dona = gruposEmpresa(empresa(["gestao.vender", "gestao.gerenciar"]), false);
    expect(dona.find((g) => g.id === "configuracoes")!.itens.some((i) => i.href === `/e/${ID}/veterinaria/configuracoes`)).toBe(true);
  });

  it("sem permissão de vender, a clínica não aparece", () => {
    expect(gruposEmpresa(empresa(["documentos.ver"]), false).some((g) => g.id === "veterinaria")).toBe(false);
  });
});
