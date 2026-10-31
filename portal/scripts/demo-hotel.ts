/**
 * Hotel de DEMONSTRAÇÃO (dados FICTÍCIOS): o Hotel Rio Tocantins, em Porto
 * Nacional, com a gestão na modalidade "hotel":
 *  - 4 categorias e 14 quartos, tarifas de feriado, governança (quartos
 *    sujos e um em manutenção);
 *  - restaurante, bar e frigobar com produtos e estoque;
 *  - histórico de cerca de dois meses de hospedagens encerradas, com as
 *    diárias, o consumo e os pagamentos lançados no Financeiro (para os
 *    relatórios de ocupação, diária média e RevPAR);
 *  - hóspedes na casa (com consumo lançado pelas funções do portal), chegadas
 *    e saídas de hoje, reservas futuras, uma cancelada e um não comparecimento;
 *  - caixa da recepção aberto com vendas avulsas do restaurante.
 * As operações do dia usam as mesmas funções do portal, com a sessão das
 * pessoas fictícias; o histórico é gravado direto (as funções só lançam com a
 * data de hoje). Só cria na primeira vez (o seed pode rodar de novo).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessao } from "./demo-documentos";

function cnpjValido(base12: string) {
  const calc = (b: string, pesos: number[]) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])}`;
}

function cpfValido(base9: string) {
  const calc = (b: string) => {
    const s = b.split("").reduce((acc, c, i) => acc + Number(c) * (b.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base9);
  return `${base9}${d1}${calc(base9 + d1)}`;
}

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Hotel de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

function hoje() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
}
function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Data e hora (fuso de Brasília) em ISO, para check-in e check-out do histórico. */
function momento(data: string, hora: string) {
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}
const centavos = (v: number) => Math.round(v * 100) / 100;

/** Gerador de números previsível (os dados saem iguais a cada execução). */
function aleatorio(semente: number) {
  let a = semente;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIAS = [
  { chave: "solteiro", nome: "Standard solteiro", descricao: "Cama de solteiro, ar-condicionado, frigobar, TV e Wi-Fi", capacidade: 1, pessoas_incluidas: 1, diaria: 189, adicional_pessoa: 0 },
  { chave: "casal", nome: "Standard casal", descricao: "Cama de casal (ou duas de solteiro), ar-condicionado, frigobar, TV e Wi-Fi", capacidade: 3, pessoas_incluidas: 2, diaria: 249, adicional_pessoa: 60 },
  { chave: "luxo", nome: "Luxo vista rio", descricao: "Cama queen, varanda com vista para o rio Tocantins, frigobar e cofre", capacidade: 3, pessoas_incluidas: 2, diaria: 329, adicional_pessoa: 70 },
  { chave: "familia", nome: "Suíte família", descricao: "Cama de casal e duas de solteiro, sala, frigobar e banheira", capacidade: 5, pessoas_incluidas: 4, diaria: 449, adicional_pessoa: 60 },
];

const QUARTOS: [string, string, string, string][] = [
  ["101", "solteiro", "Térreo", "1 solteiro"],
  ["102", "solteiro", "Térreo", "1 solteiro"],
  ["103", "casal", "Térreo", "1 casal"],
  ["104", "casal", "Térreo", "2 solteiro"],
  ["105", "casal", "Térreo", "1 casal + 1 solteiro"],
  ["106", "casal", "Térreo", "1 casal"],
  ["107", "casal", "Térreo", "1 casal — acessível"],
  ["108", "casal", "Térreo", "2 solteiro"],
  ["201", "luxo", "1º andar", "1 queen"],
  ["202", "luxo", "1º andar", "1 queen"],
  ["203", "luxo", "1º andar", "1 queen + 1 solteiro"],
  ["204", "luxo", "1º andar", "1 queen"],
  ["205", "familia", "1º andar", "1 casal + 2 solteiro"],
  ["206", "familia", "1º andar", "1 casal + 2 solteiro"],
];

const PRODUTOS = [
  { codigo: "AGUA", descricao: "Água mineral 500 ml", ncm: "22011000", grupo: "Frigobar", valor: 5, custo: 1.6, estoque: 144 },
  { codigo: "REFRI", descricao: "Refrigerante lata 350 ml", ncm: "22021000", grupo: "Frigobar", valor: 7, custo: 2.9, estoque: 120 },
  { codigo: "CERV", descricao: "Cerveja long neck 330 ml", ncm: "22030000", grupo: "Bar", valor: 12, custo: 4.8, estoque: 96 },
  { codigo: "CHOC", descricao: "Chocolate 90 g", ncm: "18063220", grupo: "Frigobar", valor: 9, custo: 4.2, estoque: 48 },
  { codigo: "AMEND", descricao: "Amendoim japonês 100 g", ncm: "20081100", grupo: "Frigobar", valor: 7, custo: 2.5, estoque: 48 },
  { codigo: "SUCO", descricao: "Suco natural 400 ml", ncm: "22029900", grupo: "Restaurante", valor: 10, custo: null, estoque: null },
  { codigo: "PRATO", descricao: "Prato executivo (peixe ou carne)", ncm: "21069090", grupo: "Restaurante", valor: 42, custo: null, estoque: null },
  { codigo: "PORCAO", descricao: "Porção de tucunaré frito", ncm: "16041900", grupo: "Restaurante", valor: 68, custo: null, estoque: null },
  { codigo: "CAFE", descricao: "Café da manhã avulso", ncm: "21069090", grupo: "Restaurante", valor: 35, custo: null, estoque: null },
];

const NOMES = [
  "Mariana Costa Lima",
  "João Pedro Ferreira",
  "Ana Beatriz Souza",
  "Carlos Eduardo Rocha",
  "Fernanda Alves Martins",
  "Rafael Gomes Pereira",
  "Juliana Ribeiro Santos",
  "Bruno Henrique Dias",
  "Patrícia Nogueira",
  "Ricardo Almeida Barros",
  "Camila Teixeira",
  "Lucas Moreira Pinto",
  "Aline Cardoso Freitas",
  "Thiago Barbosa",
  "Renata Campos Oliveira",
  "Gustavo Henrique Melo",
  "Larissa Duarte",
  "Felipe Araújo Cunha",
  "Vanessa Prado",
  "Eduardo Siqueira",
  "Tatiane Lopes Brito",
  "Marcelo Fontes",
];
const CIDADES: [string, string][] = [
  ["Palmas", "TO"],
  ["Goiânia", "GO"],
  ["Brasília", "DF"],
  ["Gurupi", "TO"],
  ["Imperatriz", "MA"],
  ["Araguaína", "TO"],
  ["São Paulo", "SP"],
  ["Barreiras", "BA"],
  ["Paraíso do Tocantins", "TO"],
  ["Belém", "PA"],
];

const ORIGENS: [string, number][] = [
  ["booking", 0.3],
  ["whatsapp", 0.2],
  ["balcao", 0.15],
  ["telefone", 0.1],
  ["empresa", 0.1],
  ["site", 0.08],
  ["expedia", 0.07],
];

/** Cria o hotel fictício (só na primeira vez). */
export async function semearHotel(
  admin: SupabaseClient,
  comoAdmin: SupabaseClient,
  conexao: { url: string; publica: string },
  opcoes: {
    dominio: string;
    contadorId: string;
    inicioAtendimento: string;
    garantirUsuario: (email: string, nome: string) => Promise<string>;
    permissoesTitular: string[];
  },
): Promise<boolean> {
  const documento = cnpjValido("778899000001");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) {
    const { count } = await admin.from("hotel_quartos").select("id", { count: "exact", head: true }).eq("empresa_id", existente.id);
    if (count) {
      await anexarComprovanteDemo(admin, existente.id);
      await semearExtrasDemo(admin, conexao, opcoes.dominio, existente.id);
      await semearRecibosEmpresasDemo(admin, conexao, opcoes.dominio, existente.id);
      return false;
    }
  }
  const empresaId =
    (existente?.id as string | undefined) ??
    (ok(
      "empresa",
      await comoAdmin.rpc("criar_empresa", {
        p_dados: {
          razao_social: "HOTEL RIO TOCANTINS EXEMPLO LTDA (DEMONSTRAÇÃO)",
          nome_fantasia: "Hotel Rio Tocantins (DEMO)",
          tipo_pessoa: "PJ",
          documento,
          regime_tributario: "simples_nacional",
          atividade_principal: "Hotel com restaurante e bar",
          cnae: "5510-8/01",
          servicos: ["contabil", "fiscal", "folha", "financeiro"],
          logradouro: "Avenida Beira-Rio (fictícia)",
          numero: "500",
          bairro: "Centro",
          cidade: "Porto Nacional",
          uf: "TO",
          cep: "77500000",
          telefone: "63999992222",
          email: `hotel@${opcoes.dominio}`,
          contador_responsavel_id: opcoes.contadorId,
          data_inicio_atendimento: opcoes.inicioAtendimento,
          demonstracao: true,
        },
      }),
    ) as string);

  const idDono = await opcoes.garantirUsuario(`hotel@${opcoes.dominio}`, "Dono do Hotel (Demonstração)");
  const idRecepcao = await opcoes.garantirUsuario(`recepcao@${opcoes.dominio}`, "Recepção do Hotel (Demonstração)");
  ok("acesso do dono", await admin.from("empresa_membros").upsert({ empresa_id: empresaId, user_id: idDono, papel: "cliente_titular", permissoes: opcoes.permissoesTitular, ativo: true }, { onConflict: "empresa_id,user_id" }));
  ok(
    "acesso da recepção",
    await admin
      .from("empresa_membros")
      .upsert({ empresa_id: empresaId, user_id: idRecepcao, papel: "cliente_colaborador", permissoes: ["empresa.ver", "gestao.vender", "mensagens.usar"], ativo: true }, { onConflict: "empresa_id,user_id" }),
  );
  await admin.from("empresas").update({ ferramentas_desligadas: ["cte"], contribuinte_iss: true, contribuinte_icms: true, tem_empregados: true }).eq("id", empresaId);

  // O escritório liga a gestão na modalidade hotel (cria o caixa da recepção, o banco e a maquininha)
  ok("ligar o hotel", await comoAdmin.rpc("gestao_configurar", { p_empresa_id: empresaId, p_dados: { ativa: true, modalidade: "hotel", perfil_fiscal: "comercio" } }));

  const dono = await sessao(admin, conexao.url, conexao.publica, `hotel@${opcoes.dominio}`);
  const recepcao = await sessao(admin, conexao.url, conexao.publica, `recepcao@${opcoes.dominio}`);
  try {
    ok(
      "configurações do hotel",
      await dono.rpc("hotel_configurar", {
        p_empresa_id: empresaId,
        p_dados: {
          hora_checkin: "14:00",
          hora_checkout: "12:00",
          taxa_servico: "10",
          cafe_incluso: true,
          politica:
            "Cancelamento sem custo até 48 horas antes da chegada; depois disso, é cobrada a primeira diária. Para garantir a reserva em feriados, pedimos sinal de 30%. Animais de pequeno porte mediante consulta. (DEMONSTRAÇÃO)",
        },
      }),
    );

    // Categorias, quartos e tarifas de período
    const cat = new Map<string, string>();
    for (const c of CATEGORIAS) {
      const { chave, ...dados } = c;
      cat.set(chave, ok(`categoria ${c.nome}`, await dono.rpc("hotel_categoria_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados })) as string);
    }
    const quarto = new Map<string, { id: string; cat: string }>();
    for (const [numero, c, andar, camas] of QUARTOS) {
      const id = ok(`quarto ${numero}`, await dono.rpc("hotel_quarto_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: { numero, categoria_id: cat.get(c), andar, camas } })) as string;
      quarto.set(numero, { id, cat: c });
    }
    const ano = Number(hoje().slice(0, 4));
    for (const [nome, ini, fim, c, diaria] of [
      ["Feriado de Finados", `${ano}-10-31`, `${ano}-11-01`, "luxo", 389],
      ["Feriado de Finados", `${ano}-10-31`, `${ano}-11-01`, "casal", 289],
      ["Réveillon", `${ano}-12-30`, `${ano}-12-31`, "luxo", 459],
      ["Réveillon", `${ano}-12-30`, `${ano}-12-31`, "familia", 590],
    ] as [string, string, string, string, number][]) {
      if (fim < hoje()) continue;
      ok(`tarifa ${nome}`, await dono.rpc("hotel_tarifa_salvar", { p_empresa_id: empresaId, p_dados: { categoria_id: cat.get(c), nome, inicio: ini, fim, diaria } }));
    }

    // Produtos do restaurante, bar e frigobar (com estoque)
    const produto = new Map<string, { id: string; valor: number; descricao: string }>();
    for (const p of PRODUTOS) {
      const id = ok(
        `produto ${p.codigo}`,
        await dono.rpc("gestao_produto_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: {
            codigo: p.codigo,
            descricao: p.descricao,
            ncm: p.ncm,
            unidade: "UN",
            valor_unitario: p.valor,
            grupo: p.grupo,
            preco_custo: p.custo,
            controla_estoque: p.estoque !== null,
            estoque_minimo: p.estoque ? Math.round(p.estoque / 6) : null,
          },
        }),
      ) as string;
      if (p.estoque) {
        ok(
          `estoque ${p.codigo}`,
          await dono.rpc("gestao_estoque_lancar", { p_empresa_id: empresaId, p_dados: { tipo: "entrada_manual", produto_id: id, quantidade: p.estoque, custo_unitario: p.custo, observacao: "Estoque inicial (DEMONSTRAÇÃO)" } }),
        );
      }
      produto.set(p.codigo, { id, valor: p.valor, descricao: p.descricao });
    }

    // Hóspedes e empresas conveniadas
    const rnd = aleatorio(20261027);
    const hospedes: string[] = [];
    for (const [i, nome] of NOMES.entries()) {
      const [cidade, uf] = CIDADES[i % CIDADES.length];
      const id = ok(
        `hóspede ${nome}`,
        await recepcao.rpc("hotel_hospede_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: {
            nome: `${nome} (fictício)`,
            cpf: cpfValido(String(210000000 + i * 7919).slice(0, 9)),
            telefone: `63999${String(100000 + i * 3137).slice(0, 6)}`,
            email: `${nome.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.${i}@exemplo.test`,
            nascimento: `${1965 + ((i * 7) % 35)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(3 + ((i * 5) % 25)).padStart(2, "0")}`,
            cidade,
            uf,
            profissao: ["Engenheira agrônoma", "Representante comercial", "Professora", "Médico", "Servidora pública", "Técnico agrícola"][i % 6],
          },
        }),
      ) as string;
      hospedes.push(id);
    }
    const conveniadas = ok(
      "empresas conveniadas",
      await admin
        .from("contrapartes")
        .insert([
          { empresa_id: empresaId, nome: "AGROPECUÁRIA SERRA AZUL EXEMPLO LTDA (FICTÍCIA)", documento: cnpjValido("445566001001"), tipo_pessoa: "PJ", papeis: ["cliente"] },
          { empresa_id: empresaId, nome: "CONSTRUTORA PONTE NOVA EXEMPLO LTDA (FICTÍCIA)", documento: cnpjValido("556677001001"), tipo_pessoa: "PJ", papeis: ["cliente"] },
        ])
        .select("id"),
    ) as { id: string }[];

    // Contas e categoria do Financeiro (criadas ao ligar o hotel)
    const { data: cfgGestao } = await admin.from("gestao_config").select("conta_dinheiro_id, conta_pix_id, conta_cartao_id").eq("empresa_id", empresaId).single();
    const { data: catServ } = await admin.from("categorias_financeiras").select("id").eq("empresa_id", empresaId).eq("codigo_sistema", "SERVICOS").single();
    const contaDe = (forma: string) => (forma === "pix" ? cfgGestao!.conta_pix_id : forma.startsWith("cartao") ? cfgGestao!.conta_cartao_id : cfgGestao!.conta_dinheiro_id) as string;

    // ---------------------------------------------------------------- histórico (encerradas)
    const dia = hoje();
    const inicioHistorico = somarDias(dia, -70);
    const preco = (c: string, adultos: number) => {
      const k = CATEGORIAS.find((x) => x.chave === c)!;
      return k.diaria + Math.max(adultos - k.pessoas_incluidas, 0) * k.adicional_pessoa;
    };
    const escolherOrigem = () => {
      let x = rnd();
      for (const [o, p] of ORIGENS) {
        if ((x -= p) <= 0) return o;
      }
      return "balcao";
    };
    let numero = 0;
    // Hóspedes na casa: quarto, entrou há N dias, sai daqui a M dias (0 = hoje), hóspede
    const naCasa: [string, number, number, number][] = [
      ["103", 2, 1, 0],
      ["105", 1, 2, 3],
      ["107", 3, 0, 5],
      ["201", 2, 2, 7],
      ["203", 1, 0, 9],
      ["205", 1, 3, 11],
      ["101", 4, 1, 13],
    ];
    // O histórico de cada quarto termina antes de quem está hospedado nele
    const limite = new Map(QUARTOS.map(([num]) => [num, somarDias(dia, -1)]));
    for (const [num, antes] of naCasa) limite.set(num, somarDias(dia, -antes));
    type Nova = { quarto: string; entrada: string; saida: string };
    const planejadas: Nova[] = [];
    for (const [num] of QUARTOS) {
      const fim = limite.get(num)!;
      let d = somarDias(inicioHistorico, Math.floor(rnd() * 3));
      while (d < fim) {
        const fds = [5, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
        if (rnd() < (fds ? 0.78 : 0.6)) {
          const n = 1 + Math.floor(rnd() * (num.startsWith("2") ? 4 : 3));
          const saida = somarDias(d, n);
          if (saida > fim) break;
          planejadas.push({ quarto: num, entrada: d, saida });
          d = saida;
        } else d = somarDias(d, 1);
      }
    }
    planejadas.sort((a, b) => a.entrada.localeCompare(b.entrada) || a.quarto.localeCompare(b.quarto));
    const produtosConsumo = ["AGUA", "REFRI", "CERV", "CHOC", "AMEND", "SUCO", "PRATO", "PORCAO"];
    for (const p of planejadas) {
      numero += 1;
      const q = quarto.get(p.quarto)!;
      const capacidade = CATEGORIAS.find((x) => x.chave === q.cat)!.capacidade;
      const adultos = Math.min(capacidade, 1 + Math.floor(rnd() * 2));
      const origem = escolherOrigem();
      const hospede = hospedes[Math.floor(rnd() * hospedes.length)];
      const valorNoite = preco(q.cat, adultos);
      const n = Math.round((Date.parse(p.saida) - Date.parse(p.entrada)) / 86400000);
      const reserva = ok(
        `reserva ${numero}`,
        await admin
          .from("hotel_reservas")
          .insert({
            empresa_id: empresaId,
            numero,
            status: "encerrada",
            hospede_id: hospede,
            quarto_id: q.id,
            categoria_id: cat.get(q.cat),
            entrada: p.entrada,
            saida: p.saida,
            saida_prevista: p.saida,
            adultos,
            criancas: 0,
            origem,
            valor_previsto: centavos(valorNoite * n),
            empresa_faturar_id: origem === "empresa" ? conveniadas[numero % 2].id : null,
            motivo_viagem: origem === "empresa" ? "negocios" : rnd() < 0.5 ? "lazer" : "negocios",
            meio_transporte: rnd() < 0.7 ? "automovel" : "onibus",
            checkin_em: momento(p.entrada, "15:20"),
            checkout_em: momento(p.saida, "11:10"),
            criado_por: idRecepcao,
            checkin_por: idRecepcao,
            checkout_por: idRecepcao,
          })
          .select("id")
          .single(),
      ) as { id: string };
      const itens: Record<string, unknown>[] = [];
      for (let k = 0; k < n; k++) {
        const data = somarDias(p.entrada, k);
        itens.push({ empresa_id: empresaId, reserva_id: reserva.id, tipo: "diaria", data, descricao: `Diária de ${data.slice(8)}/${data.slice(5, 7)} — quarto ${p.quarto}`, quantidade: 1, valor_unitario: valorNoite, total: valorNoite, lancado_por: idRecepcao });
      }
      let consumo = 0;
      const nItens = Math.floor(rnd() * 4);
      for (let k = 0; k < nItens; k++) {
        const pr = produto.get(produtosConsumo[Math.floor(rnd() * produtosConsumo.length)])!;
        const qtd = 1 + Math.floor(rnd() * 3);
        const data = somarDias(p.entrada, Math.floor(rnd() * n));
        consumo = centavos(consumo + qtd * pr.valor);
        itens.push({ empresa_id: empresaId, reserva_id: reserva.id, tipo: "consumo", data, descricao: pr.descricao, setor: pr.valor > 30 ? "restaurante" : rnd() < 0.6 ? "frigobar" : "bar", produto_id: pr.id, quantidade: qtd, valor_unitario: pr.valor, total: centavos(qtd * pr.valor), lancado_por: idRecepcao });
      }
      const taxa = centavos(consumo * 0.1);
      if (taxa > 0) itens.push({ empresa_id: empresaId, reserva_id: reserva.id, tipo: "taxa_servico", data: p.saida, descricao: "Taxa de serviço (10% do consumo)", quantidade: 1, valor_unitario: taxa, total: taxa, lancado_por: idRecepcao });
      ok(`conta ${numero}`, await admin.from("hotel_conta_itens").insert(itens));
      const total = centavos(valorNoite * n + consumo + taxa);
      // Pagamentos: faturado para a empresa conveniada; os demais no check-out (alguns com sinal)
      const pagamentos: { forma: string; valor: number; data: string; adiantamento: boolean }[] = [];
      if (origem === "empresa") pagamentos.push({ forma: "faturado", valor: total, data: p.saida, adiantamento: false });
      else {
        const sinal = origem === "booking" || rnd() < 0.2 ? centavos(Math.round(valorNoite * 0.3)) : 0;
        if (sinal) pagamentos.push({ forma: "pix", valor: sinal, data: somarDias(p.entrada, -3), adiantamento: true });
        const forma = ["pix", "cartao_credito", "cartao_debito", "dinheiro"][Math.floor(rnd() * 4)];
        pagamentos.push({ forma, valor: centavos(total - sinal), data: p.saida, adiantamento: false });
      }
      for (const pg of pagamentos) {
        const desc = `Hospedagem — reserva nº ${numero} — quarto ${p.quarto}${pg.adiantamento ? " (sinal)" : ""}${pg.forma === "faturado" ? " (faturado)" : ""}`;
        const faturado = pg.forma === "faturado";
        const vencimento = faturado ? somarDias(pg.data, 15) : pg.data;
        const lanc = ok(
          `lançamento ${numero}`,
          await admin
            .from("lancamentos")
            .insert({
              empresa_id: empresaId,
              tipo: "receber",
              descricao: desc,
              categoria_id: catServ!.id,
              contraparte_id: faturado ? conveniadas[numero % 2].id : null,
              conta_financeira_id: faturado ? null : contaDe(pg.forma),
              data_competencia: pg.data,
              data_vencimento: vencimento,
              valor_previsto: pg.valor,
              origem: "hotel",
              origem_referencia: reserva.id,
              numero_documento: `RES ${numero}`,
            })
            .select("id")
            .single(),
        ) as { id: string };
        // Faturas vencidas já foram pagas pela empresa (no vencimento)
        if (!faturado || vencimento < dia) {
          ok(
            `baixa ${numero}`,
            await admin.from("baixas").insert({
              empresa_id: empresaId,
              lancamento_id: lanc.id,
              tipo: "receber",
              data_pagamento: vencimento,
              conta_financeira_id: faturado ? cfgGestao!.conta_pix_id : contaDe(pg.forma),
              valor_principal: pg.valor,
              forma_pagamento: faturado ? "transferencia" : pg.forma,
              origem: faturado ? "manual" : "hotel",
              observacao: desc,
            }),
          );
        }
        ok(
          `pagamento ${numero}`,
          await admin.from("hotel_pagamentos").insert({
            empresa_id: empresaId,
            reserva_id: reserva.id,
            data: pg.data,
            forma: pg.forma,
            valor: pg.valor,
            adiantamento: pg.adiantamento,
            contraparte_id: faturado ? conveniadas[numero % 2].id : null,
            vencimento: faturado ? vencimento : null,
            lancamento_id: lanc.id,
            recebido_por: idRecepcao,
          }),
        );
      }
    }

    // ---------------------------------------------------------------- hóspedes na casa (gravados como hospedados)
    const hospedados: { id: string; quarto: string }[] = [];
    for (const [num, antes, depois, h] of naCasa) {
      numero += 1;
      const q = quarto.get(num)!;
      const entrada = somarDias(dia, -antes);
      const saida = somarDias(dia, depois);
      const adultos = Math.min(CATEGORIAS.find((x) => x.chave === q.cat)!.capacidade, num === "205" ? 4 : 2);
      const r = ok(
        `hospedagem ${num}`,
        await admin
          .from("hotel_reservas")
          .insert({
            empresa_id: empresaId,
            numero,
            status: "hospedado",
            hospede_id: hospedes[h],
            quarto_id: q.id,
            categoria_id: cat.get(q.cat),
            entrada,
            saida,
            saida_prevista: saida,
            adultos,
            criancas: num === "205" ? 1 : 0,
            origem: ["booking", "whatsapp", "empresa", "balcao", "telefone", "site", "booking"][numero % 7],
            valor_previsto: centavos(preco(q.cat, adultos) * (antes + depois)),
            empresa_faturar_id: num === "107" ? conveniadas[0].id : null,
            motivo_viagem: num === "107" ? "negocios" : "lazer",
            meio_transporte: "automovel",
            placa_veiculo: ["QWA1B23", "RTB2C34", "SDC3E45", "PKA4F56", "QXR5G67", "MZT6H78", "OLA7J89"][numero % 7],
            procedencia: CIDADES[h % CIDADES.length].join("/"),
            checkin_em: momento(entrada, "14:40"),
            criado_por: idRecepcao,
            checkin_por: idRecepcao,
          })
          .select("id")
          .single(),
      ) as { id: string };
      hospedados.push({ id: r.id, quarto: num });
    }
    ok("contador de reservas", await admin.from("hotel_config").update({ proximo_numero_reserva: numero + 1 }).eq("empresa_id", empresaId));

    // A recepção abre o caixa: consumo, sinais e vendas do restaurante entram na conferência
    ok("abrir o caixa", await recepcao.rpc("gestao_caixa_abrir", { p_empresa_id: empresaId, p_caixa_nome: "Recepção", p_valor_abertura: 200 }));
    const { data: caixa } = await admin.from("caixa_sessoes").select("id").eq("empresa_id", empresaId).eq("status", "aberto").single();
    const consumos: [string, [string, number][], string][] = [
      ["103", [["AGUA", 2], ["REFRI", 1], ["PRATO", 2]], "restaurante"],
      ["201", [["CERV", 3], ["PORCAO", 1]], "bar"],
      ["205", [["SUCO", 4], ["PRATO", 3], ["CHOC", 2]], "restaurante"],
      ["107", [["AGUA", 3]], "frigobar"],
      ["101", [["AMEND", 1], ["CERV", 2]], "frigobar"],
    ];
    for (const [num, itens, setor] of consumos) {
      const r = hospedados.find((x) => x.quarto === num)!;
      ok(
        `consumo ${num}`,
        await recepcao.rpc("hotel_consumo_lancar", { p_reserva_id: r.id, p_dados: { setor, itens: itens.map(([c, q]) => ({ produto_id: produto.get(c)!.id, quantidade: q })) } }),
      );
    }
    ok("lavanderia", await recepcao.rpc("hotel_servico_lancar", { p_reserva_id: hospedados.find((x) => x.quarto === "201")!.id, p_dados: { tipo: "servico", descricao: "Lavanderia (4 peças)", valor: "48", setor: "lavanderia" } }));
    // Sinais pagos na reserva: o PIX do 205 com a foto do comprovante (fictício); o cartão do 201 fica sem, para a conferência do caixa mostrar o aviso
    ok("sinal 205", await recepcao.rpc("hotel_pagamento_registrar", { p_reserva_id: hospedados.find((x) => x.quarto === "205")!.id, p_dados: { forma: "pix", valor: "400" } }));
    ok("sinal 201", await recepcao.rpc("hotel_pagamento_registrar", { p_reserva_id: hospedados.find((x) => x.quarto === "201")!.id, p_dados: { forma: "cartao_credito", valor: "329" } }));

    // Venda avulsa no restaurante (quem não é hóspede)
    for (const [itens, forma] of [
      [[["PRATO", 2], ["SUCO", 2]], "dinheiro"],
      [[["CERV", 4], ["PORCAO", 1]], "pix"],
    ] as [[string, number][], string][]) {
      const total = itens.reduce((s, [c, q]) => s + produto.get(c)!.valor * q, 0);
      ok(
        "venda do restaurante",
        await recepcao.rpc("gestao_venda_finalizar", {
          p_empresa_id: empresaId,
          p_dados: {
            sessao_id: caixa!.id,
            itens: itens.map(([c, q]) => ({ produto_id: produto.get(c)!.id, quantidade: String(q) })),
            pagamentos: [{ forma, valor: String(total), valor_recebido: forma === "dinheiro" ? String(Math.ceil(total / 50) * 50) : undefined }],
          },
        }),
      );
    }

    // ---------------------------------------------------------------- chegadas de hoje e reservas futuras (pelas funções do portal)
    const reservar = async (num: string, h: number, entrada: string, noites: number, extra: Record<string, unknown> = {}) =>
      (
        ok(
          `reserva no ${num}`,
          await recepcao.rpc("hotel_reserva_salvar", {
            p_empresa_id: empresaId,
            p_id: null,
            p_dados: { hospede_id: hospedes[h], quarto_id: quarto.get(num)!.id, entrada, saida: somarDias(entrada, noites), adultos: 2, ...extra },
          }),
        ) as { id: string }
      ).id;
    await reservar("104", 15, dia, 2, { origem: "booking" });
    await reservar("202", 16, dia, 3, { origem: "whatsapp", observacoes: "Chegada prevista às 22h. Aniversário de casamento: deixar espumante no quarto. (DEMONSTRAÇÃO)" });
    await reservar("108", 17, dia, 1, { origem: "telefone", status: "pre_reserva" });
    const futura = await reservar("204", 18, somarDias(dia, 4), 3, { origem: "booking" });
    ok("sinal da futura", await recepcao.rpc("hotel_pagamento_registrar", { p_reserva_id: futura, p_dados: { forma: "pix", valor: "296.10" } }));
    await reservar("206", 19, somarDias(dia, 4), 2, { origem: "site", adultos: 4, criancas: 1 });
    await reservar("106", 20, somarDias(dia, 2), 2, { origem: "empresa", empresa_faturar_id: conveniadas[1].id });
    await reservar("102", 21, somarDias(dia, 1), 3, { origem: "balcao", adultos: 1 });
    await reservar("203", 0, somarDias(dia, 6), 2, { origem: "expedia" });
    await reservar("105", 2, somarDias(dia, 9), 4, { origem: "whatsapp" });
    const cancelar = await reservar("202", 4, somarDias(dia, 12), 2, { origem: "booking" });
    ok("cancelamento", await recepcao.rpc("hotel_reserva_cancelar", { p_reserva_id: cancelar, p_motivo: "Hóspede mudou a data da viagem. (DEMONSTRAÇÃO)", p_no_show: false }));
    const noShow = await reservar("106", 6, dia, 1, { origem: "booking" });
    ok("não comparecimento", await recepcao.rpc("hotel_reserva_cancelar", { p_reserva_id: noShow, p_motivo: "Não compareceu e não atendeu o telefone. (DEMONSTRAÇÃO)", p_no_show: true }));

    // Governança: quartos que saíram hoje cedo ficam sujos; um em manutenção
    ok("limpeza 206", await recepcao.rpc("hotel_quarto_limpeza", { p_quarto_id: quarto.get("206")!.id, p_limpeza: "sujo", p_motivo: null }));
    ok("limpeza 204", await recepcao.rpc("hotel_quarto_limpeza", { p_quarto_id: quarto.get("204")!.id, p_limpeza: "em_limpeza", p_motivo: null }));
    ok("manutenção 102", await recepcao.rpc("hotel_quarto_limpeza", { p_quarto_id: quarto.get("102")!.id, p_limpeza: "manutencao", p_motivo: "Troca do chuveiro elétrico (DEMONSTRAÇÃO)" }));
    // A reserva de amanhã do 102 vai para o 108 (o quarto ficou em manutenção)
    const { data: r102 } = await admin.from("hotel_reservas").select("id").eq("quarto_id", quarto.get("102")!.id).eq("status", "confirmada").maybeSingle();
    if (r102) ok("troca de quarto", await recepcao.rpc("hotel_trocar_quarto", { p_reserva_id: r102.id, p_quarto_id: quarto.get("108")!.id, p_motivo: "Quarto 102 em manutenção" }));

    // Receita informada dos últimos meses (painel e previsão do Simples)
    const receitas = [118400, 121900, 109300, 131200, 142600, 128800, 136400, 151900, 147300, 139800, 158600, 162100];
    ok(
      "receita informada",
      await admin.from("calculo_meses").upsert(
        receitas.map((v, i) => {
          const d = new Date(`${dia.slice(0, 7)}-01T12:00:00Z`);
          d.setUTCMonth(d.getUTCMonth() + i - receitas.length);
          return { empresa_id: empresaId, competencia: d.toISOString().slice(0, 10), receita_servicos: v, receita_mercadorias: Math.round(v * 0.14), observacao: "Valores fictícios de demonstração." };
        }),
        { onConflict: "empresa_id,competencia", ignoreDuplicates: true },
      ),
    );
    await admin.from("calculo_parametros").upsert({ empresa_id: empresaId, anexo_mercadorias: "I", anexo_servicos: "III", pro_labore: 6000, socios_pro_labore: 2 }, { onConflict: "empresa_id", ignoreDuplicates: true });
  } finally {
    await dono.auth.signOut({ scope: "local" });
    await recepcao.auth.signOut({ scope: "local" });
  }

  await anexarComprovanteDemo(admin, empresaId);
  await semearExtrasDemo(admin, conexao, opcoes.dominio, empresaId);
  await semearRecibosEmpresasDemo(admin, conexao, opcoes.dominio, empresaId);

  // Logo fictícia
  const { data: e } = await admin.from("empresas").select("logo_path").eq("id", empresaId).single();
  if (!e?.logo_path) {
    const caminho = `${empresaId}/logo-${Date.now()}.png`;
    ok("logo: envio", await admin.storage.from("empresas-logos").upload(caminho, readFileSync(join(__dirname, "arquivos-demo", "logo-hotel.png")), { contentType: "image/png", upsert: false }));
    ok("logo: cadastro", await admin.from("empresas").update({ logo_path: caminho, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId));
  }
  return true;
}

/**
 * Foto fictícia do comprovante do PIX do sinal do quarto 205 (marcada como
 * demonstração), para a conta do hóspede e a conferência do caixa. O cartão do
 * 201 fica sem comprovante, para o caixa mostrar o aviso. Só anexa uma vez.
 */
export async function anexarComprovanteDemo(admin: SupabaseClient, empresaId: string) {
  const { count } = await admin.from("hotel_pagamento_anexos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return;
  const { data: pagamentos } = await admin
    .from("hotel_pagamentos")
    .select("id, recebido_por, reserva:hotel_reservas!hotel_pagamentos_empresa_id_reserva_id_fkey(status, quarto:hotel_quartos!hotel_reservas_empresa_id_quarto_id_fkey(numero))")
    .eq("empresa_id", empresaId)
    .eq("forma", "pix")
    .is("cancelado_em", null)
    .order("created_at", { ascending: false });
  type Pag = { id: string; recebido_por: string | null; reserva: { status: string; quarto: { numero: string } | null } | null };
  const lista = (pagamentos ?? []) as unknown as Pag[];
  const pag = lista.find((p) => p.reserva?.quarto?.numero === "205" && p.reserva.status === "hospedado") ?? lista[0];
  if (!pag) return;
  const foto = readFileSync(join(__dirname, "arquivos-demo", "comprovante-pix-demo.png"));
  const caminho = `${empresaId}/${pag.id}/${crypto.randomUUID()}.png`;
  ok("comprovante: envio", await admin.storage.from("hotel-comprovantes").upload(caminho, foto, { contentType: "image/png", upsert: false }));
  ok(
    "comprovante: registro",
    await admin.from("hotel_pagamento_anexos").insert({
      empresa_id: empresaId,
      pagamento_id: pag.id,
      caminho,
      nome: "comprovante-pix-quarto-205.png",
      mime: "image/png",
      tamanho: foto.length,
      origem: "camera",
      enviado_por: pag.recebido_por,
      confirmado_em: new Date().toISOString(),
    }),
  );
}

/**
 * Serviços extras com preço fixo (marmita, refeição, lavanderia por peça e
 * aluguel de carro por dia), alguns já lançados na conta de quem está
 * hospedado, uma observação sobre um hóspede e a cor e os contatos dos
 * documentos do hotel. Só na primeira vez (o gerente pode mudar tudo depois).
 */
export async function semearExtrasDemo(admin: SupabaseClient, conexao: { url: string; publica: string }, dominio: string, empresaId: string) {
  const { count } = await admin.from("hotel_extras").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return;
  const dono = await sessao(admin, conexao.url, conexao.publica, `hotel@${dominio}`);
  const recepcao = await sessao(admin, conexao.url, conexao.publica, `recepcao@${dominio}`);
  try {
    const extra = new Map<string, string>();
    for (const [chave, dados] of [
      ["marmita", { nome: "Marmita", natureza: "alimentacao", unidade: "marmita", preco: "22" }],
      ["refeicao", { nome: "Refeição executiva", natureza: "alimentacao", unidade: "refeicao", preco: "35" }],
      ["lavanderia", { nome: "Lavanderia (por peça)", natureza: "lavanderia", unidade: "peca", preco: "12" }],
      ["carro", { nome: "Aluguel de carro", natureza: "locacao", unidade: "dia", preco: "180" }],
    ] as [string, Record<string, string>][]) {
      extra.set(chave, ok(`serviço extra ${chave}`, await dono.rpc("hotel_extra_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados })) as string);
    }
    ok(
      "documentos do hotel",
      await dono.rpc("hotel_documentos_configurar", {
        p_empresa_id: empresaId,
        p_dados: { modelo: "classico", cor: "#1f6f4a", whatsapp: "(63) 99999-2222", site: "@hotelriotocantins.demo", cadastur: "00.000000.00.0000-0 (DEMO)" },
      }),
    );
    const { data } = await admin
      .from("hotel_reservas")
      .select("id, hospede_id, quarto:hotel_quartos!hotel_reservas_empresa_id_quarto_id_fkey(numero)")
      .eq("empresa_id", empresaId)
      .eq("status", "hospedado");
    const hospedados = (data ?? []) as unknown as { id: string; hospede_id: string; quarto: { numero: string } | null }[];
    const no = (numero: string, k: number) => hospedados.find((h) => h.quarto?.numero === numero) ?? hospedados[k];
    const r205 = no("205", 0);
    const r201 = no("201", 1);
    if (r205) {
      ok(
        "extras 205",
        await recepcao.rpc("hotel_extras_lancar", {
          p_reserva_id: r205.id,
          p_dados: { itens: [{ extra_id: extra.get("marmita"), quantidade: "2" }, { extra_id: extra.get("carro"), quantidade: "2" }] },
        }),
      );
      ok("observação do hóspede", await recepcao.rpc("hotel_hospede_observacoes", { p_hospede_id: r205.hospede_id, p_texto: "Prefere quarto no térreo. Alergia a camarão. (DEMONSTRAÇÃO)" }));
    }
    if (r201 && r201.id !== r205?.id) {
      ok(
        "extras 201",
        await recepcao.rpc("hotel_extras_lancar", {
          p_reserva_id: r201.id,
          p_dados: { itens: [{ extra_id: extra.get("refeicao"), quantidade: "3" }, { extra_id: extra.get("lavanderia"), quantidade: "5" }] },
        }),
      );
    }
  } finally {
    await dono.auth.signOut({ scope: "local" });
    await recepcao.auth.signOut({ scope: "local" });
  }
}

/**
 * Serviços extras lançados para empresas (sem hóspede), com recibo: marmitas
 * para a obra da construtora fictícia, pagas na hora, e lavanderia da equipe
 * da agropecuária fictícia, a prazo. Só na primeira vez.
 */
export async function semearRecibosEmpresasDemo(admin: SupabaseClient, conexao: { url: string; publica: string }, dominio: string, empresaId: string) {
  const { count } = await admin.from("hotel_extras_recibos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return;
  const [{ data: extras }, { data: empresas }] = await Promise.all([
    admin.from("hotel_extras").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true),
    admin.from("contrapartes").select("id, nome").eq("empresa_id", empresaId).contains("papeis", ["cliente"]).ilike("nome", "%(FICTÍCIA)%"),
  ]);
  const extra = (trecho: string) => extras?.find((e) => e.nome.toLowerCase().includes(trecho))?.id;
  const empresa = (trecho: string) => empresas?.find((e) => e.nome.includes(trecho))?.id;
  if (!extra("marmita") || !extra("lavanderia") || !empresa("CONSTRUTORA") || !empresa("AGROPECUÁRIA")) return;
  const recepcao = await sessao(admin, conexao.url, conexao.publica, `recepcao@${dominio}`);
  try {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
    ok(
      "recibo da construtora",
      await recepcao.rpc("hotel_extras_recibo_lancar", {
        p_empresa_id: empresaId,
        p_dados: {
          contraparte_id: empresa("CONSTRUTORA"),
          solicitante: "Mestre de obras João (DEMONSTRAÇÃO)",
          pagamento: "na_hora",
          forma: "pix",
          itens: [{ extra_id: extra("marmita"), quantidade: "18" }],
        },
      }),
    );
    ok(
      "recibo da agropecuária",
      await recepcao.rpc("hotel_extras_recibo_lancar", {
        p_empresa_id: empresaId,
        p_dados: {
          contraparte_id: empresa("AGROPECUÁRIA"),
          solicitante: "Equipe de campo (DEMONSTRAÇÃO)",
          pagamento: "a_prazo",
          vencimento: somarDias(hoje, 15),
          itens: [{ extra_id: extra("lavanderia"), quantidade: "24" }],
        },
      }),
    );
  } finally {
    await recepcao.auth.signOut({ scope: "local" });
  }
}
