import { describe, expect, it } from "vitest";
import { calcularEtapas, proximoPasso, proximoPrazo, situacaoDaEmpresa, type DadosMapa } from "@/lib/operacional/mapa";

const HOJE = "2026-11-13";
const ctx = { empresaId: "00000000-0000-0000-0000-000000000001", competencia: "2026-10-01", hoje: HOJE, competenciaAtual: "2026-11-01" };
const tarefas = (p: Partial<DadosMapa["impostos"]> = {}): DadosMapa["impostos"] => ({
  total: 0, ok: 0, cliente: 0, revisao: 0, andamento: 0, atrasadas: 0, prazo: null, prazo_nome: null, tarde: false, ...p,
});

function dados(p: Partial<DadosMapa> = {}): DadosMapa {
  return {
    documentos: { total: 3, ok: 3, cliente: 0, atrasados: 0, conferir: 0, prazo: null, faltam: [], tarde: false },
    notas: { docs: 12, sem_xml: 0, auto: "ativa", erro: null },
    extrato: { contas: 1, movimentos: 20, pendentes: 0, contas_sem_extrato: 0 },
    impostos: tarefas({ total: 2, ok: 2 }),
    obrigacoes: tarefas({ total: 3, ok: 3 }),
    fechamento: { status: "fechada", fechada_em: "2026-11-10T15:00:00Z", fechada_por: "Ana", etapa: null, pendencias: 0 },
    marcacoes: {},
    ...p,
  };
}
const status = (d: DadosMapa) => calcularEtapas(d, ctx).map((e) => `${e.status}:${e.texto}`);

describe("mapa da carteira: situação de cada etapa", () => {
  it("tudo pronto: mês fechado", () => {
    const e = calcularEtapas(dados(), ctx);
    expect(e.map((x) => x.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(situacaoDaEmpresa(e)).toBe("fechado");
    expect(e[5].detalhe).toContain("por Ana");
    expect(proximoPasso(e)).toBeNull();
  });

  it("documentos: atrasado, perto do prazo, com o cliente e para conferir", () => {
    const base = { total: 4, ok: 1, conferir: 0, tarde: false, faltam: ["Folha de ponto", "Extrato"] };
    expect(status(dados({ documentos: { ...base, cliente: 1, atrasados: 1, prazo: "2026-11-10" } }))[0]).toBe("atraso:Atrasou 3 dias");
    expect(status(dados({ documentos: { ...base, cliente: 2, atrasados: 0, prazo: "2026-11-15" } }))[0]).toBe("perto:Faltam 2 docs");
    expect(status(dados({ documentos: { ...base, cliente: 2, atrasados: 0, prazo: "2026-11-25" } }))[0]).toBe("cliente:Faltam 2 docs");
    expect(status(dados({ documentos: { ...base, cliente: 0, atrasados: 0, conferir: 3, prazo: null } }))[0]).toBe("andamento:3 p/ conferir");
    const atrasado = calcularEtapas(dados({ documentos: { ...base, cliente: 1, atrasados: 1, prazo: "2026-11-10" } }), ctx)[0];
    expect(atrasado.acao?.tipo).toBe("cobrar");
    expect(atrasado.detalhe).toContain("Folha de ponto");
  });

  it("notas: resumo sem XML, certificado vencido e mês que ainda não acabou", () => {
    expect(status(dados({ notas: { docs: 5, sem_xml: 3, auto: "ativa", erro: null } }))[1]).toBe("andamento:3 sem XML");
    expect(status(dados({ notas: { docs: 5, sem_xml: 0, auto: "certificado_vencido", erro: null } }))[1]).toBe("atraso:Certificado vencido");
    expect(status(dados({ notas: { docs: 0, sem_xml: 0, auto: "sem", erro: null } }))[1]).toBe("afazer:Sem notas");
    const nfse = calcularEtapas(dados({ notas: { docs: 3, sem_xml: 0, auto: "erro", erro: "Ambiente Nacional da NFS-e recusou a consulta (HTTP 400)." } }), ctx)[1];
    expect(`${nfse.status}:${nfse.texto}`).toBe("atraso:NFS-e com erro");
    expect(nfse.detalhe).toContain("nada se perde");
    expect(status(dados({ notas: { docs: 3, sem_xml: 0, auto: "erro", erro: "A SEFAZ respondeu sem o retorno esperado (HTTP 503)." } }))[1]).toBe("atraso:Busca com erro");
    const atual = calcularEtapas(dados(), { ...ctx, competencia: "2026-11-01" });
    expect(atual[1].status).toBe("andamento");
  });

  it("extrato: sem conta, sem extrato, pendentes e conciliado", () => {
    expect(status(dados({ extrato: { contas: 0, movimentos: 0, pendentes: 0, contas_sem_extrato: 0 } }))[2]).toBe("na:Sem conta");
    expect(status(dados({ extrato: { contas: 2, movimentos: 0, pendentes: 0, contas_sem_extrato: 2 } }))[2]).toBe("afazer:Sem extrato");
    expect(status(dados({ extrato: { contas: 1, movimentos: 20, pendentes: 14, contas_sem_extrato: 0 } }))[2]).toBe("andamento:Faltam 14");
  });

  it("impostos e obrigações: atraso, cliente, perto do prazo e andamento", () => {
    expect(status(dados({ impostos: tarefas({ total: 2, ok: 1, atrasadas: 1, prazo: "2026-11-12", prazo_nome: "DAS" }) }))[3]).toBe("atraso:Atrasou 1 dia");
    expect(status(dados({ obrigacoes: tarefas({ total: 2, ok: 0, cliente: 1, prazo: "2026-11-30" }) }))[4]).toBe("cliente:Com o cliente");
    expect(status(dados({ impostos: tarefas({ total: 2, ok: 1, prazo: "2026-11-15", prazo_nome: "DAS" }) }))[3]).toBe("perto:Vence 15/11");
    expect(status(dados({ impostos: tarefas({ total: 8, ok: 3, prazo: "2026-11-25" }) }))[3]).toBe("andamento:3 de 8 prontas");
    expect(status(dados({ obrigacoes: tarefas({ total: 3, ok: 0, prazo: "2026-11-25" }) }))[4]).toBe("afazer:Vence 25/11");
    expect(status(dados({ obrigacoes: tarefas() }))[4]).toBe("na:Sem tarefas");
  });

  it("marcações da equipe valem sobre os dados", () => {
    const d = dados({
      extrato: { contas: 1, movimentos: 20, pendentes: 14, contas_sem_extrato: 0 },
      notas: { docs: 0, sem_xml: 0, auto: "sem", erro: null },
      marcacoes: {
        extrato: { situacao: "concluida", todas: false, observacao: "Conferido no banco", por: "Ana", em: "2026-11-12T12:00:00Z" },
        notas: { situacao: "nao_se_aplica", todas: true, observacao: null, por: "Bruno", em: "2026-10-02T12:00:00Z" },
      },
    });
    const e = calcularEtapas(d, ctx);
    expect(e[2].status).toBe("ok");
    expect(e[2].detalhe).toContain("Conferido no banco");
    expect(e[2].detalhe).toContain("faltam 14");
    expect(e[1].status).toBe("na");
    expect(e[1].detalhe).toContain("todos os meses");
  });

  it("situação da empresa, próximo prazo e próximo passo", () => {
    const d = dados({
      documentos: { total: 3, ok: 2, cliente: 1, atrasados: 0, conferir: 0, prazo: "2026-11-20", faltam: ["Extrato"], tarde: false },
      impostos: tarefas({ total: 2, ok: 1, prazo: "2026-11-15", prazo_nome: "DAS" }),
      fechamento: { status: "aberta", fechada_em: null, fechada_por: null, etapa: null, pendencias: 0 },
    });
    const e = calcularEtapas(d, ctx);
    expect(situacaoDaEmpresa(e)).toBe("cliente");
    expect(proximoPrazo(d, e, HOJE)).toEqual({ data: "2026-11-15", oque: "DAS", tom: "perto" });
    expect(proximoPasso(e)?.chave).toBe("documentos");
    expect(e[5].acao?.rotulo).toBe("Abrir o fechamento");
  });
});
