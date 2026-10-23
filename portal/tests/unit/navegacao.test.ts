import { describe, expect, it } from "vitest";
import { grupoAtivo, gruposEmpresa, gruposEscritorio, menuEmpresa, type EmpresaMenu } from "@/components/layout/navegacao";
import { diasDaSemana } from "@/components/painel/blocos";
import type { Permissao } from "@/lib/permissoes";

const ID = "11111111-1111-4111-8111-111111111111";

function empresa(permissoes: string[], extra: Partial<EmpresaMenu> = {}): EmpresaMenu {
  return { id: ID, nome: "Teste", documento: "11444777000161", papel: "cliente_titular", permissoes: permissoes as Permissao[], demonstracao: false, loja: false, modalidade: null, ...extra };
}

describe("menu agrupado", () => {
  it("escritório: 8 grupos e as telas de administrador só para o administrador", () => {
    expect(gruposEscritorio(false).map((g) => g.id)).toEqual(["visao", "empresas", "atendimento", "prazos", "notas", "fiscal", "financeiro", "escritorio"]);
    expect(gruposEscritorio(false).find((g) => g.id === "escritorio")!.itens.map((i) => i.rotulo)).toEqual(["Equipe e permissões"]);
    expect(gruposEscritorio(true).find((g) => g.id === "escritorio")!.itens.map((i) => i.rotulo)).toEqual(["Equipe e permissões", "Configurações", "Auditoria"]);
  });

  it("empresa: grupo sem permissão não aparece; transporte junta as ordens às notas", () => {
    const so = gruposEmpresa(empresa(["documentos.ver", "documentos.enviar"]), false);
    expect(so.map((g) => g.id)).toEqual(["inicio", "notas", "documentos", "pagamentos", "configuracoes"]);
    expect(so.find((g) => g.id === "documentos")!.itens.map((i) => i.rotulo)).toEqual(["Enviar documentos", "Meus documentos", "Pendências"]);

    const graos = gruposEmpresa(empresa(["nfe.emitir", "cte.emitir", "documentos.ver"], { loja: true, modalidade: "notas", cte: true }), false);
    const notas = graos.find((g) => g.id === "notas")!;
    expect(notas.rotulo).toBe("Notas e transporte");
    expect(notas.itens.map((i) => i.rotulo)).toEqual(["Ordens de carregamento", "Emitir nota de produto", "Emitir CT-e (frete)", "Notas automáticas"]);
    expect(graos.some((g) => g.id === "loja")).toBe(false);
  });

  it("a equipe vê o cadastro da empresa em Configurações", () => {
    const g = gruposEmpresa(empresa(["documentos.ver"]), true).find((x) => x.id === "configuracoes")!;
    expect(g.itens.map((i) => i.href)).toEqual([`/e/${ID}/configuracoes`, `/escritorio/empresas/${ID}`]);
  });

  it("grupo da página: o item mais específico vence e o início é exato", () => {
    const grupos = gruposEmpresa(empresa(["gestao.vender", "documentos.ver"], { loja: true, modalidade: "loja" }), false);
    expect(grupoAtivo(`/e/${ID}/loja/vender`, grupos)?.id).toBe("loja");
    expect(grupoAtivo(`/e/${ID}/documentos/abc`, grupos)?.id).toBe("documentos");
    expect(grupoAtivo(`/e/${ID}`, grupos)?.id).toBe("inicio");
    expect(grupoAtivo(`/e/${ID}/nada`, grupos)).toBeNull();
    // A lista completa continua com todos os itens, na ordem dos grupos
    expect(menuEmpresa(empresa(["mensagens.usar"]), false).map((i) => i.rotulo)).toEqual(["Início", "Mensagens", "Solicitações", "Configurações"]);
  });
});

describe("semana do painel", () => {
  it("de segunda a domingo, com o dia de hoje marcado", () => {
    const dias = diasDaSemana("2026-10-23");
    expect(dias.map((d) => d.data)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(dias.map((d) => d.dia)).toEqual(["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]);
    expect(dias.filter((d) => d.hoje).map((d) => d.numero)).toEqual([23]);
    // Domingo pertence à semana que começou na segunda anterior
    expect(diasDaSemana("2026-10-25")[0].data).toBe("2026-10-19");
  });
});
