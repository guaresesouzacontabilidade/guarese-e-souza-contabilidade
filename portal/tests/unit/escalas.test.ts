import { describe, expect, it } from "vitest";
import { feriadosNacionais, datasFacultativas, pascoa } from "@/lib/escalas/feriados";
import { duracaoTrabalho, minutosNoturnos, formatarHoras } from "@/lib/escalas/horas";
import { gerarGrade, distribuirDeslocamentos, historicoDaGrade } from "@/lib/escalas/gerador";
import { conferirEscala } from "@/lib/escalas/conferencia";
import { MODELOS, MODELO_POR_CHAVE } from "@/lib/escalas/modelos";
import { CHAVES_MODELO, configPadrao, configSchema, diasDoMes, type ConfigEscala, type Pessoa } from "@/lib/escalas/tipos";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);

function pessoa(id: string, extra: Partial<Pessoa> = {}): Pessoa {
  return {
    id,
    nome: `Pessoa ${id.slice(-2)}`,
    cargo: null,
    jornadaSemanal: 44,
    naoTrabalha: [],
    domingoQuinzenal: false,
    menorIdade: false,
    modelo: "6x1",
    turnos: ["T1"],
    diasTrabalho: [],
    folgasPreferidas: [],
    deslocamento: 0,
    ...extra,
  };
}

function config(extra: Partial<ConfigEscala> = {}): ConfigEscala {
  const base = configPadrao();
  return {
    ...base,
    turnos: [{ id: "T1", nome: "Dia", inicio: "08:00", fim: "16:20", intervaloMin: 60 }],
    funcionamento: Array.from({ length: 7 }, () => ({ aberto: true, inicio: "08:00", fim: "20:00" })),
    cobertura: [{ turno: "T1", minimo: [1, 2, 2, 2, 2, 2, 2] }],
    ...extra,
  };
}

const erros = (r: ReturnType<typeof conferirEscala>, regra?: string) => r.achados.filter((a) => a.gravidade === "erro" && (!regra || a.regra === regra));

describe("feriados", () => {
  it("Páscoa, Paixão, Carnaval e Corpus Christi de 2026", () => {
    expect(pascoa(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(feriadosNacionais("2026-04-01")).toEqual([
      { data: "2026-04-03", nome: "Sexta-feira da Paixão" },
      { data: "2026-04-21", nome: "Tiradentes" },
    ]);
    expect(datasFacultativas("2026-02-01").map((f) => f.data)).toEqual(["2026-02-16", "2026-02-17"]);
    expect(datasFacultativas("2026-06-01").map((f) => f.data)).toEqual(["2026-06-04"]);
  });
  it("novembro tem Finados, República e Consciência Negra (Lei 14.759/2023)", () => {
    expect(feriadosNacionais("2026-11-01").map((f) => f.data)).toEqual(["2026-11-02", "2026-11-15", "2026-11-20"]);
  });
});

describe("horas", () => {
  it("duração, intervalo e horário noturno", () => {
    expect(duracaoTrabalho({ id: "T1", nome: "x", inicio: "08:00", fim: "16:20", intervaloMin: 60 })).toBe(440);
    expect(duracaoTrabalho({ id: "T1", nome: "x", inicio: "19:00", fim: "07:00", intervaloMin: 60 })).toBe(660);
    expect(minutosNoturnos({ id: "T1", nome: "x", inicio: "08:00", fim: "17:00", intervaloMin: 60 })).toBe(0);
    // 22h às 6h: 7 horas noturnas (22h–5h) descontado o intervalo na proporção
    expect(minutosNoturnos({ id: "T1", nome: "x", inicio: "22:00", fim: "06:00", intervaloMin: 60 })).toBe(368);
    expect(formatarHoras(440)).toBe("7h20");
    expect(formatarHoras(480)).toBe("8h");
  });
});

describe("catálogo de modelos", () => {
  it("tem todos os modelos do mercado, com base legal", () => {
    expect(MODELOS.map((m) => m.chave)).toEqual([...CHAVES_MODELO]);
    for (const m of MODELOS) expect(m.base.length).toBeGreaterThan(0);
    expect(MODELO_POR_CHAVE["24x48"].risco).toBe("alto");
    expect(MODELO_POR_CHAVE["12x36"].exige.join(" ")).toContain("59-A");
  });
});

describe("gerador", () => {
  it("6x1 no comércio aberto todo dia: nunca 7 dias seguidos, domingo a cada 3 semanas, 1+ folga por semana", () => {
    const pessoas = distribuirDeslocamentos(ids(5).map((id) => pessoa(id)));
    const c = config({ pessoas });
    for (const comp of ["2026-11-01", "2026-12-01", "2027-02-01"]) {
      const g = gerarGrade(c, comp);
      const r = conferirEscala(c, comp, g);
      expect(erros(r, "repouso")).toEqual([]);
      expect(erros(r, "domingo")).toEqual([]);
      expect(erros(r, "jornada_semanal")).toEqual([]);
      for (const p of pessoas) expect(g[p.id]).toHaveLength(diasDoMes(comp).length);
    }
  });

  it("continua de um mês para o outro sem passar de 6 dias seguidos nem de 3 domingos", () => {
    const pessoas = distribuirDeslocamentos(ids(4).map((id) => pessoa(id)));
    const c = config({ pessoas });
    let historico = {};
    for (const comp of ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]) {
      const g = gerarGrade(c, comp, { historico });
      const r = conferirEscala(c, comp, g, historico);
      expect(erros(r, "repouso")).toEqual([]);
      expect(erros(r, "domingo")).toEqual([]);
      historico = historicoDaGrade(g);
    }
  });

  it("empregada com domingo quinzenal (art. 386) folga um domingo sim, outro não", () => {
    const c = config({ pessoas: [pessoa(ids(1)[0], { domingoQuinzenal: true })] });
    const g = gerarGrade(c, "2026-12-01");
    const r = conferirEscala(c, "2026-12-01", g);
    expect(erros(r, "domingo")).toEqual([]);
    const domingos = diasDoMes("2026-12-01")
      .map((d, i) => (d.getUTCDay() === 0 ? g[ids(1)[0]][i] : null))
      .filter((x) => x !== null);
    for (let i = 1; i < domingos.length; i++) expect(domingos[i] === "F" || domingos[i - 1] === "F").toBe(true);
  });

  it("5x2 com a empresa fechada no fim de semana: folga sábado e domingo", () => {
    const funcionamento = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ aberto: d >= 1 && d <= 5, inicio: "08:00", fim: "18:00" }));
    const c = config({
      funcionamento,
      turnos: [{ id: "T1", nome: "Comercial", inicio: "08:00", fim: "17:48", intervaloMin: 60 }],
      pessoas: [pessoa(ids(1)[0], { modelo: "5x2" })],
    });
    const g = gerarGrade(c, "2026-12-01");
    diasDoMes("2026-12-01").forEach((d, i) => {
      const fimDeSemana = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      expect(g[ids(1)[0]][i] === "F").toBe(fimDeSemana);
    });
    const r = conferirEscala(c, "2026-12-01", g);
    // 8h48 por dia pede acordo de compensação (alerta), sem erros
    expect(erros(r)).toEqual([]);
    expect(r.achados.some((a) => a.regra === "jornada_diaria" && a.gravidade === "alerta")).toBe(true);
  });

  it("12x36 com duas pessoas: uma em cada dia, alternando, e o mês seguinte continua o ciclo", () => {
    const [a, b] = ids(2);
    const c = config({
      turnos: [{ id: "T1", nome: "Plantão", inicio: "07:00", fim: "19:00", intervaloMin: 60 }],
      cobertura: [{ turno: "T1", minimo: [1, 1, 1, 1, 1, 1, 1] }],
      pessoas: distribuirDeslocamentos([pessoa(a, { modelo: "12x36" }), pessoa(b, { modelo: "12x36" })]),
    });
    const nov = gerarGrade(c, "2026-11-01");
    const dez = gerarGrade(c, "2026-12-01");
    for (const g of [nov, dez]) g[a].forEach((x, i) => expect([x, g[b][i]].sort()).toEqual(["F", "T1"]));
    // 30/11 e 01/12 se alternam para a mesma pessoa
    expect(nov[a][29]).not.toBe(dez[a][0]);
    const r = conferirEscala(c, "2026-12-01", dez);
    expect(erros(r)).toEqual([]);
    expect(r.achados.some((x) => x.regra === "modelo" && x.detalhe.includes("59-A"))).toBe(true);
  });

  it("jornada parcial nos dias escolhidos e personalizada", () => {
    const [a, b] = ids(2);
    const c = config({
      turnos: [
        { id: "T1", nome: "Dia", inicio: "08:00", fim: "16:20", intervaloMin: 60 },
        { id: "T2", nome: "Meio período", inicio: "14:00", fim: "20:15", intervaloMin: 15 },
      ],
      pessoas: [
        pessoa(a, { modelo: "parcial", turnos: ["T2"], diasTrabalho: [1, 2, 3, 4, 5], jornadaSemanal: 30 }),
        pessoa(b, { modelo: "personalizada", diasTrabalho: [2, 4, 6] }),
      ],
    });
    const g = gerarGrade(c, "2026-12-01");
    diasDoMes("2026-12-01").forEach((d, i) => {
      expect(g[a][i] === "T2").toBe(d.getUTCDay() >= 1 && d.getUTCDay() <= 5);
      expect(g[b][i] === "T1").toBe([2, 4, 6].includes(d.getUTCDay()));
    });
    const r = conferirEscala(c, "2026-12-01", g);
    expect(erros(r)).toEqual([]);
  });

  it("mantém férias lançadas e respeita os dias que a pessoa não trabalha", () => {
    const [a] = ids(1);
    const c = config({ pessoas: [pessoa(a, { naoTrabalha: [3] })] });
    const manter = { [a]: Array.from({ length: 31 }, (_, i) => (i >= 9 && i < 19 ? "FE" : "F")) };
    const g = gerarGrade(c, "2026-12-01", { manter });
    expect(g[a].slice(9, 19).every((x) => x === "FE")).toBe(true);
    diasDoMes("2026-12-01").forEach((d, i) => {
      if (d.getUTCDay() === 3) expect(g[a][i]).not.toMatch(/^T/);
    });
  });

  it("revezamento troca de turno depois da folga e respeita as 11 horas", () => {
    const pessoas = distribuirDeslocamentos(ids(4).map((id) => pessoa(id, { modelo: "revezamento", turnos: ["T1", "T2", "T3"], jornadaSemanal: 36 })));
    const c = config({
      turnos: [
        { id: "T1", nome: "Manhã", inicio: "06:00", fim: "12:15", intervaloMin: 15 },
        { id: "T2", nome: "Tarde", inicio: "12:00", fim: "18:15", intervaloMin: 15 },
        { id: "T3", nome: "Noite", inicio: "18:00", fim: "00:15", intervaloMin: 15 },
      ],
      cobertura: [],
      pessoas,
    });
    const g = gerarGrade(c, "2026-12-01");
    const r = conferirEscala(c, "2026-12-01", g);
    expect(erros(r)).toEqual([]);
    const usados = new Set(Object.values(g).flat().filter((x) => x.startsWith("T")));
    expect(usados.size).toBe(3);
  });
});

describe("gerador em muitas combinações", () => {
  it("modelos semanais e 5x1/6x2 nunca geram 7 dias seguidos nem domingos demais", () => {
    let semente = 7;
    const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
    const semanais = ["5x2", "6x1", "4x3", "5x1", "6x2"] as const;
    for (let caso = 0; caso < 60; caso++) {
      const n = 1 + Math.floor(aleatorio() * 8);
      const funcionamento = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ aberto: d === 0 ? aleatorio() > 0.3 : d === 6 ? aleatorio() > 0.1 : true, inicio: "08:00", fim: "20:00" }));
      const pessoas = distribuirDeslocamentos(
        ids(n).map((id) =>
          pessoa(id, {
            modelo: semanais[Math.floor(aleatorio() * semanais.length)],
            domingoQuinzenal: aleatorio() > 0.6,
            naoTrabalha: aleatorio() > 0.8 ? [Math.floor(aleatorio() * 7)] : [],
            folgasPreferidas: aleatorio() > 0.5 ? [1 + Math.floor(aleatorio() * 6)] : [],
          }),
        ),
      );
      const c = config({
        funcionamento,
        pessoas,
        cobertura: [{ turno: "T1", minimo: [0, 1, 2, 3, 4, 5, 6].map(() => Math.floor(aleatorio() * 3)) }],
        regras: { ...configPadrao().regras, domingoACadaSemanas: aleatorio() > 0.8 ? 7 : 3 },
      });
      let historico = {};
      for (const comp of ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]) {
        const g = gerarGrade(c, comp, { historico });
        const r = conferirEscala(c, comp, g, historico);
        expect(erros(r, "repouso"), `caso ${caso} ${comp}`).toEqual([]);
        expect(erros(r, "domingo"), `caso ${caso} ${comp}`).toEqual([]);
        expect(erros(r, "jornada_semanal"), `caso ${caso} ${comp}`).toEqual([]);
        historico = historicoDaGrade(g);
      }
    }
  });
});

describe("conferência", () => {
  const [a, b] = ids(2);
  const dez = diasDoMes("2026-12-01");

  it("aponta intervalo curto, 7 dias seguidos, mais de 44h, 11 horas e domingos seguidos", () => {
    const c = config({
      turnos: [
        { id: "T1", nome: "Longo", inicio: "08:00", fim: "17:30", intervaloMin: 30 },
        { id: "T2", nome: "Noite", inicio: "22:00", fim: "06:00", intervaloMin: 60 },
      ],
      pessoas: [pessoa(a), pessoa(b, { menorIdade: true, turnos: ["T2"] })],
    });
    const grade = { [a]: dez.map(() => "T1"), [b]: dez.map((d, i) => (i === 0 ? "T2" : i === 1 ? "T1" : "F")) };
    const r = conferirEscala(c, "2026-12-01", grade);
    const regras = new Set<string>(erros(r).map((x) => x.regra));
    for (const regra of ["intervalo", "repouso", "jornada_semanal", "domingo", "interjornada", "noturno"]) expect(regras.has(regra)).toBe(true);
    // 22h às 6h e depois 08h: só 2 horas de descanso
    expect(erros(r, "interjornada").some((x) => x.pessoaId === b && x.titulo.includes("2h"))).toBe(true);
  });

  it("feriado no comércio é alerta (convenção coletiva) e falta de gente no turno também", () => {
    const c = config({ feriados: [{ data: "2026-12-25", nome: "Natal" }], pessoas: [pessoa(a)] });
    c.regras = { ...c.regras, trabalhaFeriados: true };
    const grade = { [a]: dez.map((d) => (d.getUTCDay() === 1 ? "F" : "T1")) };
    const r = conferirEscala(c, "2026-12-01", grade);
    expect(r.achados.some((x) => x.regra === "feriado" && x.gravidade === "alerta" && x.base?.includes("6º-A"))).toBe(true);
    expect(r.achados.some((x) => x.regra === "cobertura")).toBe(true);
  });

  it("acima do contrato de 36h vira alerta de hora extra; semanas e totais no resumo", () => {
    const c = config({ pessoas: [pessoa(a, { jornadaSemanal: 36 })] });
    const g = gerarGrade(c, "2026-12-01");
    const r = conferirEscala(c, "2026-12-01", g);
    expect(r.achados.some((x) => x.regra === "jornada_semanal" && x.gravidade === "alerta" && x.detalhe.includes("36h"))).toBe(true);
    const res = r.resumo[0];
    expect(res.diasTrabalhados + res.folgas).toBe(31);
    expect(res.minutosMes).toBe(res.diasTrabalhados * 440);
  });

  it("24x48 vem com alerta de risco alto", () => {
    const c = config({
      turnos: [{ id: "T1", nome: "Plantão 24h", inicio: "07:00", fim: "07:00", intervaloMin: 120 }],
      cobertura: [],
      pessoas: distribuirDeslocamentos([pessoa(a, { modelo: "24x48" }), pessoa(b, { modelo: "24x48" })]),
    });
    const r = conferirEscala(c, "2026-12-01", gerarGrade(c, "2026-12-01"));
    expect(erros(r)).toEqual([]);
    expect(r.achados.filter((x) => x.regra === "modelo" && x.gravidade === "alerta").length).toBeGreaterThan(0);
  });

  it("grade de outro tamanho ou com turno inexistente é recusada", () => {
    const c = config({ pessoas: [pessoa(a)] });
    expect(erros(conferirEscala(c, "2026-12-01", { [a]: ["T1"] }), "grade")).toHaveLength(1);
    expect(erros(conferirEscala(c, "2026-12-01", { [a]: dez.map(() => "T9") }), "grade")).toHaveLength(1);
  });
});

describe("validação da configuração", () => {
  it("recusa turno inexistente e pessoa repetida", () => {
    const [a] = ids(1);
    expect(configSchema.safeParse(config({ pessoas: [pessoa(a, { turnos: ["T5"] })] })).success).toBe(false);
    expect(configSchema.safeParse(config({ pessoas: [pessoa(a), pessoa(a)] })).success).toBe(false);
    expect(configSchema.safeParse(config({ pessoas: [pessoa(a)] })).success).toBe(true);
  });
});
