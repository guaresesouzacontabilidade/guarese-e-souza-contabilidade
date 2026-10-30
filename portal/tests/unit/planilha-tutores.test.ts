import { describe, expect, it } from "vitest";
import {
  analisarTutores,
  lerAba,
  lerCpf,
  lerData,
  lerEspecie,
  lerPeso,
  lerPorte,
  lerSexo,
  lerTelefones,
  lerUf,
  nascimentoPelaIdade,
  nomeProprio,
  paraImportar,
  type Existentes,
} from "@/lib/veterinaria/planilha-tutores";
import { lerAbasPlanilha } from "@/lib/gestao/planilha-produtos";

/** Planilhas fictícias nos formatos de exportação de outros sistemas. */
const HOJE = "2026-10-30";
const vazio: Existentes = { tutores: [], animais: [] };

describe("importação de tutores e animais: valores", () => {
  it("espécie, sexo, porte e peso como os sistemas antigos escrevem", () => {
    expect(lerEspecie("Cão").especie).toBe("canina");
    expect(lerEspecie("CACHORRO").especie).toBe("canina");
    expect(lerEspecie("Felino").especie).toBe("felina");
    expect(lerEspecie("Calopsita").especie).toBe("ave");
    expect(lerEspecie("Coelho").especie).toBe("lagomorfo");
    expect(lerEspecie("Jabuti").especie).toBe("reptil");
    expect(lerEspecie("Furão")).toEqual({ especie: "outra", outra: "Furão" });
    expect(lerEspecie(null).especie).toBeNull();
    expect(lerSexo("Macho castrado")).toEqual({ sexo: "macho", castrado: true });
    expect(lerSexo("F")).toEqual({ sexo: "femea", castrado: null });
    expect(lerSexo("FC")).toEqual({ sexo: "femea", castrado: true });
    expect(lerSexo("?")).toEqual({ sexo: "indefinido", castrado: null });
    expect([lerPorte("P"), lerPorte("Médio"), lerPorte("GG"), lerPorte("toy"), lerPorte("xyz")]).toEqual(["pequeno", "medio", "gigante", "mini", null]);
    expect([lerPeso("12,5 kg"), lerPeso("800 g"), lerPeso(4.25), lerPeso("muito"), lerPeso(0)]).toEqual(["12.5", "0.8", "4.25", null, null]);
  });

  it("datas do Excel, dd/mm/aaaa, mês e ano (estimada) e idade", () => {
    expect(lerData(43905)).toEqual({ data: "2020-03-15", estimada: false });
    expect(lerData("15/03/2020")).toEqual({ data: "2020-03-15", estimada: false });
    expect(lerData("2020-03-15")).toEqual({ data: "2020-03-15", estimada: false });
    expect(lerData("03/2020")).toEqual({ data: "2020-03-01", estimada: true });
    expect(lerData("31/02/2020")).toBeNull();
    expect(nascimentoPelaIdade("3 anos", HOJE)).toBe("2023-10-28");
    expect(nascimentoPelaIdade("2 anos e 6 meses", HOJE)).toBe("2024-04-28");
    expect(nascimentoPelaIdade("6 meses", HOJE)).toBe("2026-04-28");
    expect(nascimentoPelaIdade("filhote", HOJE)).toBeNull();
  });

  it("CPF sem o zero da frente, CNPJ, telefones com e sem DDD e UF por extenso", () => {
    expect(lerCpf("529.982.247-25").cpf).toBe("52998224725");
    expect(lerCpf("7239854051").cpf).toBe("07239854051");
    expect(lerCpf("111.111.111-11")).toEqual({ cpf: null, cnpj: null, invalido: true });
    expect(lerCpf("11.444.777/0001-61").cnpj).toBe("11444777000161");
    expect(lerTelefones("(63) 99999-1234 / 3363-1234", "63")).toEqual({ telefones: ["63999991234", "6333631234"], invalidos: [] });
    expect(lerTelefones("+55 63 98888-7777", null).telefones).toEqual(["63988887777"]);
    expect(lerTelefones("99999-1234", null)).toEqual({ telefones: [], invalidos: ["99999-1234"] });
    expect([lerUf("to"), lerUf("Tocantins"), lerUf("São Paulo"), lerUf("XX")]).toEqual(["TO", "TO", "SP", null]);
    expect(nomeProprio("MARIA DA SILVA")).toBe("Maria da Silva");
    expect(nomeProprio("Maria da Silva")).toBe("Maria da Silva");
  });
});

describe("importação de tutores e animais: planilhas", () => {
  it("uma linha por animal: o mesmo tutor vira um cadastro só, com os dois animais", () => {
    const linhas = [
      ["Relatório de clientes (sistema antigo)"],
      ["Cliente", "CPF", "Celular", "Animal", "Espécie", "Raça", "Sexo", "Nascimento", "Peso"],
      ["MARIA EXEMPLO", 7239854051, "99999-1234", "Rex", "Cão", "SRD", "Macho castrado", 43905, "18,5"],
      ["MARIA EXEMPLO", 7239854051, "99999-1234", "Mimi", "Gato", "Siamês", "F", "03/2021", null],
      ["João Teste", null, "(63) 98888-7777", "Bob", null, null, null, null, null],
      [null, null, null, "Sem tutor nenhum", "Cão", null, null, null, null],
    ];
    const r = analisarTutores([{ arquivo: "clientes.xlsx", aba: "Planilha1", linhas }], vazio, { ddd: "63", hoje: HOJE });
    expect(r.abas[0]).toMatchObject({ tipo: "animais", linhas: 4 });
    expect(r.abas[0].colunas.map((c) => c.campo)).toEqual(["tutor_nome", "cpf", "telefone", "animal_nome", "especie", "raca", "sexo", "nascimento", "peso"]);
    expect(r.tutores).toHaveLength(2);
    const maria = r.tutores[0];
    expect(maria).toMatchObject({ nome: "MARIA EXEMPLO", cpf: "07239854051", telefone: "63999991234", existente: false });
    expect(maria.animais.map((a) => [a.nome, a.especie, a.sexo, a.castrado, a.nascimento, a.nascimento_estimado, a.peso_kg])).toEqual([
      ["Rex", "canina", "macho", true, "2020-03-15", false, "18.5"],
      ["Mimi", "felina", "femea", false, "2021-03-01", true, null],
    ]);
    // A última linha não tem tutor, mas vem logo depois do João: é do João (relatório que só escreve o tutor na primeira linha)
    expect(r.tutores[1].animais.map((a) => a.nome)).toEqual(["Bob", "Sem tutor nenhum"]);
    // Bob sem espécie: só entra com a espécie escolhida para quem não tem
    expect(paraImportar(r.tutores, { especiePadrao: "", corrigirMaiusculas: true })[1].animais.map((a) => a.nome)).toEqual(["Sem tutor nenhum"]);
    const comPadrao = paraImportar(r.tutores, { especiePadrao: "canina", corrigirMaiusculas: true });
    expect(comPadrao[0].nome).toBe("Maria Exemplo");
    expect(comPadrao[1].animais.map((a) => `${a.nome}:${a.especie}`)).toEqual(["Bob:canina", "Sem tutor nenhum:canina"]);
  });

  it("tutores e animais em abas separadas, ligados pelo código do cliente", () => {
    const tutores = [
      ["Código", "Nome", "Telefone", "E-mail", "Cidade", "UF"],
      [101, "Ana Lima", "63 99111-2222", "ANA@EXEMPLO.TEST", "Porto Nacional", "Tocantins"],
      [102, "Beto Souza", "63 99333-4444", "email-errado", "Palmas", "TO"],
    ];
    const animais = [
      ["Código", "Nome", "Espécie", "Cód. Cliente", "Idade", "Situação"],
      [1, "Luna", "Felina", 101, "2 anos", "Ativo"],
      [2, "Thor", "Canina", 102, null, "Falecido"],
      [3, "Fantasma", "Canina", 999, null, null],
    ];
    const r = analisarTutores(
      [
        { arquivo: "exportacao.xlsx", aba: "Animais", linhas: animais },
        { arquivo: "exportacao.xlsx", aba: "Clientes", linhas: tutores },
      ],
      vazio,
      { hoje: HOJE },
    );
    expect(r.abas.map((a) => a.tipo)).toEqual(["animais", "tutores"]);
    expect(r.abas[0].colunas.map((c) => c.campo)).toEqual(["animal_codigo", "animal_nome", "especie", "tutor_codigo", "idade", "situacao"]);
    expect(r.abas[1].colunas.map((c) => c.campo)).toEqual(["tutor_codigo", "tutor_nome", "telefone", "email", "cidade", "uf"]);
    expect(r.tutores.map((t) => [t.nome, t.email, t.uf, t.animais.map((a) => `${a.nome}${a.ativo ? "" : " (inativo)"}`).join(",")])).toEqual([
      ["Ana Lima", "ana@exemplo.test", "TO", "Luna"],
      ["Beto Souza", null, "TO", "Thor (inativo)"],
    ]);
    expect(r.tutores[1].avisos).toContain("e-mail inválido: ficou de fora");
    expect(r.tutores[0].animais[0]).toMatchObject({ nascimento: "2024-10-28", nascimento_estimado: true });
    expect(r.linhasComErro).toEqual([{ origem: "exportacao.xlsx › Animais, linha 4", erros: ["tutor de código 999 não encontrado"] }]);
  });

  it("o que já está no portal fica como está: o tutor recebe só o animal novo", () => {
    const existentes: Existentes = {
      tutores: [{ id: "t1", nome: "Ana Lima", cpf: null, telefone: "63991112222", telefone2: null }],
      animais: [{ tutor_id: "t1", nome: "Luna", microchip: null }, { tutor_id: "outro", nome: "Zeus", microchip: "982000123456789" }],
    };
    const linhas = [
      ["Tutor", "Telefone", "Pet", "Espécie", "Microchip"],
      ["ana lima", "(63) 99111-2222", "LUNA", "Gato", null],
      ["ana lima", "(63) 99111-2222", "Nina", "Gato", null],
      ["Carlos", "63 97777-0000", "Zeus 2", "Cão", "982.000.123.456.789"],
    ];
    const r = analisarTutores([{ arquivo: "pets.csv", aba: "pets", linhas }], existentes, { hoje: HOJE });
    expect(r.tutores[0].existente).toBe(true);
    expect(r.tutores[0].animais.map((a) => [a.nome, a.existente])).toEqual([
      ["LUNA", true],
      ["Nina", false],
    ]);
    // Microchip já cadastrado em outro animal: considerado o mesmo animal
    expect(r.tutores[1].animais[0].existente).toBe(true);
    const envio = paraImportar(r.tutores, { especiePadrao: "", corrigirMaiusculas: false });
    expect(envio.map((t) => [t.nome, t.animais.map((a) => a.nome)])).toEqual([["ana lima", ["Nina"]], ["Carlos", []]]);
  });

  it("corrigir a coluna: o título desconhecido passa a ser o telefone", () => {
    const linhas = [
      ["Tutor", "Contato do dono", "Animal", "Espécie"],
      ["Rita", "63 98877-6655", "Pipoca", "Cão"],
    ];
    const sem = lerAba("a.xlsx", "Plan1", linhas);
    expect(sem.colunas[1].campo).toBeNull();
    const r = analisarTutores([{ arquivo: "a.xlsx", aba: "Plan1", linhas }], vazio, { hoje: HOJE, mapa: { "a.xlsx|Plan1|1": "telefone" } });
    expect(r.tutores[0].telefone).toBe("63988776655");
  });

  it("CSV com ponto e vírgula do Excel brasileiro", async () => {
    const csv = "Proprietário;Fone;Nome do animal;Espécie\nLia Campos;(63) 99222-1111;Fred;Cão\n";
    const abas = await lerAbasPlanilha(new TextEncoder().encode(csv), "clientes.csv");
    const r = analisarTutores(abas.map((a) => ({ arquivo: "clientes.csv", aba: a.nome, linhas: a.linhas })), vazio, { hoje: HOJE });
    expect(r.tutores.map((t) => [t.nome, t.telefone, t.animais[0]?.nome])).toEqual([["Lia Campos", "63992221111", "Fred"]]);
  });
});
