import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  atividadeDeComercio,
  buscarServicos,
  cnaesDaEmpresa,
  formatarCodigoServico,
  indexarServicos,
  sugerirServicos,
  type ServicoNacional,
} from "@/lib/nfse-emissao/lista-servicos";

// Mesma lista da migração 20261021005700 (Anexo B do leiaute v1.01, de 22/01/2026)
const lista = JSON.parse(readFileSync("tests/fixtures/nfse-lista-servicos-1.01.json", "utf8")) as ServicoNacional[];
const indice = indexarServicos(lista);
const sugestoes = (codigo: string, descricao: string) => sugerirServicos(indice, { codigo, descricao, principal: true }).map((s) => s.codigo);

describe("lista nacional de serviços da NFS-e", () => {
  it("tem os 338 códigos oficiais", () => {
    expect(lista).toHaveLength(338);
    expect(new Set(lista.map((s) => s.codigo)).size).toBe(338);
    expect(lista.find((s) => s.codigo === "171901")?.descricao).toMatch(/^Contabilidade/);
    const migracao = readFileSync("supabase/migrations/20261021005700_nfse_lista_servicos.sql", "utf8");
    const codigos = [...migracao.matchAll(/^ {2}\('(\d{6})', /gm)].map((m) => m[1]);
    expect(codigos).toEqual(lista.map((s) => s.codigo));
  });

  it("formata o código como item.subitem.desdobro", () => {
    expect(formatarCodigoServico("140101")).toBe("14.01.01");
  });

  it("sugere o serviço pela descrição da atividade (CNAE)", () => {
    expect(sugestoes("6920-6/01", "Atividades de contabilidade")[0]).toBe("171901");
    expect(sugestoes("4520-0/01", "Serviços de manutenção e reparação mecânica de veículos automotores")[0]).toBe("140101");
    expect(sugestoes("4520-0/02", "Serviços de lanternagem ou funilaria e pintura de veículos automotores")[0]).toBe("141201");
    expect(sugestoes("4520-0/05", "Serviços de lavagem, lubrificação e polimento de veículos automotores")).toEqual(expect.arrayContaining(["140101", "140501"]));
    expect(sugestoes("5510-8/01", "Hotéis")[0]).toBe("090101");
    expect(sugestoes("7500-1/00", "Atividades veterinárias")[0]).toBe("050101");
    expect(sugestoes("9601-7/01", "Lavanderias")).toEqual(["141001"]);
    expect(sugestoes("9602-5/01", "Cabeleireiros, manicure e pedicure")).toEqual(["060101"]);
    expect(sugestoes("6911-7/01", "Serviços advocatícios")).toEqual(["171401"]);
    expect(sugestoes("7111-1/00", "Serviços de arquitetura")[0]).toBe("070104");
    expect(sugestoes("8650-0/04", "Atividades de fisioterapia")[0]).toBe("040802");
  });

  it("não sugere serviço para comércio, indústria e atividades fora da lista", () => {
    expect(atividadeDeComercio("4723-7/00")).toBe(true);
    expect(atividadeDeComercio("4520-0/01")).toBe(false);
    expect(atividadeDeComercio("4543-9/00")).toBe(false);
    expect(sugestoes("4723-7/00", "Comércio varejista de bebidas")).toEqual([]);
    expect(sugestoes("1091-1/02", "Fabricação de produtos de padaria e confeitaria com predominância de produção própria")).toEqual([]);
    expect(sugestoes("5611-2/03", "Lanchonetes, casas de chá, de sucos e similares")).toEqual([]);
    expect(sugestoes("8112-5/00", "Condomínios prediais")).toEqual([]);
  });

  it("busca por palavras ou pelo código", () => {
    expect(buscarServicos(indice, "contabilidade")[0].codigo).toBe("171901");
    expect(buscarServicos(indice, "funilaria")[0].codigo).toBe("141201");
    expect(buscarServicos(indice, "14.01.01").map((s) => s.codigo)).toEqual(["140101"]);
    expect(buscarServicos(indice, "17.19").map((s) => s.codigo)).toEqual(["171901"]);
    expect(buscarServicos(indice, "7.01").map((s) => s.codigo)).toContain("070104");
    expect(buscarServicos(indice, "de e")).toEqual([]);
  });

  it("monta as atividades da empresa pela Receita ou, sem ela, pelo CNAE do cadastro", () => {
    const receita = {
      cnaePrincipal: { codigo: "4520-0/01", descricao: "Serviços de manutenção e reparação mecânica de veículos automotores" },
      cnaesSecundarios: [
        { codigo: "4520-0/02", descricao: "Serviços de lanternagem ou funilaria e pintura de veículos automotores" },
        { codigo: "4520-0/01", descricao: "repetida" },
      ],
    };
    expect(cnaesDaEmpresa(receita, null, null).map((c) => [c.codigo, c.principal])).toEqual([
      ["4520-0/01", true],
      ["4520-0/02", false],
    ]);
    expect(cnaesDaEmpresa(null, "6920-6/01", "Atividades de contabilidade")).toEqual([{ codigo: "6920-6/01", descricao: "Atividades de contabilidade", principal: true }]);
    expect(cnaesDaEmpresa(null, "69206", null)).toEqual([]);
  });
});
