/**
 * Ordens de serviço de DEMONSTRAÇÃO (dados FICTÍCIOS): a Madeireira Reflorestar
 * (a mesma da loja de demonstração), em Porto Nacional, que corta chapas, cola fita de borda e fura peças para
 * marceneiros:
 *  - serviços com o tempo estimado por unidade e a equipe (3 pessoas);
 *  - as últimas 3 semanas de OS concluídas, gravadas direto (as funções só
 *    registram com a data e a hora de agora), com o corte levando mais tempo
 *    que o estimado — o relatório sugere ajustar;
 *  - a esteira de hoje pelas mesmas funções do portal: OS na fila (uma
 *    urgente), em execução (uma pausada por falta de material) e prontas.
 * Só cria na primeira vez (o seed pode rodar de novo).
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessao } from "./demo-documentos";

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Ordens de serviço de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

const codigo = () =>
  Array.from(randomBytes(12))
    .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36])
    .join("");
function hoje() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
}
function somarDias(data: string, dias: number) {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const momento = (data: string, hora: string) => new Date(`${data}T${hora}:00-03:00`);
const mais = (d: Date, minutos: number) => new Date(d.getTime() + minutos * 60_000);

const CLIENTES = [
  "Marcenaria Bom Corte (fictícia)",
  "José Ribeiro Móveis Planejados (fictício)",
  "Ateliê Casa Nova (fictício)",
  "Carlos Marceneiro (fictício)",
  "Planejados Rio Tocantins (fictício)",
  "Antônio Pereira (fictício)",
  "Construtora Ponte Alta (fictícia)",
  "Maria Helena Interiores (fictícia)",
];

export async function semearOs(
  admin: SupabaseClient,
  conexao: { url: string; publica: string },
  opcoes: { dominio: string },
): Promise<boolean> {
  // A madeireira de demonstração (a mesma da loja) passa a usar as ordens de serviço
  const { data: empresa } = await admin.from("empresas").select("id, ferramentas_desligadas").eq("razao_social", "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)").maybeSingle();
  if (!empresa) return false;
  const empresaId = empresa.id as string;
  const { count } = await admin.from("os_ordens").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;
  // O escritório liga as ordens de serviço na empresa
  ok(
    "ligar as OS",
    await admin
      .from("empresas")
      .update({ ferramentas_desligadas: ((empresa.ferramentas_desligadas as string[] | null) ?? []).filter((f) => f !== "os") })
      .eq("id", empresaId),
  );
  // Dono gerencia; o balcão também abre e move as OS
  for (const [email, extra] of [
    [`madeireira@${opcoes.dominio}`, ["os.operar", "os.gerenciar"]],
    [`balcao@${opcoes.dominio}`, ["os.operar"]],
  ] as const) {
    const { data: perfil } = await admin.from("perfis").select("id").eq("email", email).maybeSingle();
    if (!perfil) continue;
    const { data: m } = await admin.from("empresa_membros").select("permissoes").eq("empresa_id", empresaId).eq("user_id", perfil.id).maybeSingle();
    if (!m) continue;
    const permissoes = [...new Set([...((m.permissoes as string[]) ?? []), ...extra])];
    ok("acesso às OS", await admin.from("empresa_membros").update({ permissoes }).eq("empresa_id", empresaId).eq("user_id", perfil.id));
  }
  const { data: balcaoPerfil } = await admin.from("perfis").select("id").eq("email", `balcao@${opcoes.dominio}`).maybeSingle();
  const idBalcao = (balcaoPerfil?.id as string | undefined) ?? null;

  const dono = await sessao(admin, conexao.url, conexao.publica, `madeireira@${opcoes.dominio}`);
  const balcao = await sessao(admin, conexao.url, conexao.publica, `balcao@${opcoes.dominio}`);
  try {
    ok(
      "configuração",
      await dono.rpc("os_configurar", {
        p_empresa_id: empresaId,
        p_dados: {
          nome_exibicao: "Madeireira Reflorestar",
          telefone: "63999995555",
          hora_inicio: "07:30",
          hora_fim: "17:30",
          dias_semana: [1, 2, 3, 4, 5, 6],
          executores_simultaneos: 2,
          mensagem_pronta: "Olá, {cliente}! Aqui é da {loja}. Sua OS nº {numero} está pronta para retirada. Acompanhe: {link}",
          rodape_impressao: "Serviços prontos ficam guardados por até 15 dias. Confira as medidas na retirada.",
        },
      }),
    );
    const servico = async (dados: Record<string, string>) => ok(`serviço ${dados.nome}`, await dono.rpc("os_servico_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados })) as string;
    const corte = await servico({ nome: "Corte de chapa (MDF/compensado)", unidade: "chapa", minutos_por_unidade: "4", minutos_fixos: "5", valor_unitario: "6.00", setor: "Seccionadora" });
    const fita = await servico({ nome: "Fita de borda", unidade: "m", minutos_por_unidade: "1", minutos_fixos: "5", valor_unitario: "2.50", setor: "Coladeira de borda" });
    const furo = await servico({ nome: "Furação", unidade: "furo", minutos_por_unidade: "0.5", minutos_fixos: "5", valor_unitario: "1.00", setor: "Furadeira" });
    const rasgo = await servico({ nome: "Rasgo para fundo de gaveta", unidade: "m", minutos_por_unidade: "2", minutos_fixos: "5", valor_unitario: "4.00", setor: "Seccionadora" });
    const pessoa = async (nome: string, cor: string) => ok(`equipe ${nome}`, await dono.rpc("os_equipe_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: { nome, cor } })) as string;
    const joao = await pessoa("João (seccionadora)", "#2563eb");
    const pedro = await pessoa("Pedro (coladeira)", "#16a34a");
    const marcos = await pessoa("Marcos (furação)", "#d97706");

    // Histórico: OS concluídas nas últimas 3 semanas (o corte leva ~6 min/chapa, não 4)
    const h = hoje();
    const ordens: Record<string, unknown>[] = [];
    const itens: Record<string, unknown>[] = [];
    const eventos: Record<string, unknown>[] = [];
    let numero = 0;
    for (let dia = 21; dia >= 1; dia--) {
      const data = somarDias(h, -dia);
      const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
      if (semana === 0) continue;
      for (let k = 0; k < (semana === 6 ? 1 : 2); k++) {
        numero++;
        const id = crypto.randomUUID();
        const chapas = 3 + ((numero * 7) % 9);
        const metros = 10 + ((numero * 13) % 30);
        const furos = numero % 3 === 0 ? 16 + ((numero * 5) % 20) : 0;
        const lista = [
          { servico_id: corte, descricao: "Corte de chapa (MDF/compensado)", quantidade: chapas, unidade: "chapa", minutos_estimados: 5 + 4 * chapas, valor_unitario: 6 },
          { servico_id: fita, descricao: "Fita de borda", quantidade: metros, unidade: "m", minutos_estimados: 5 + metros, valor_unitario: 2.5 },
          ...(furos ? [{ servico_id: furo, descricao: "Furação", quantidade: furos, unidade: "furo", minutos_estimados: 5 + 0.5 * furos, valor_unitario: 1 }] : []),
        ];
        const estimado = lista.reduce((s, i) => s + i.minutos_estimados, 0);
        // Real: corte com 6 min/chapa; fita e furação perto do estimado
        const real = 5 + 6 * chapas + (5 + metros) * (0.9 + (numero % 3) * 0.1) + (furos ? 5 + 0.5 * furos : 0);
        const pausa = numero % 5 === 0 ? 25 : 0;
        const aberta = momento(data, k === 0 ? "08:10" : "13:20");
        const iniciada = mais(aberta, 20 + (numero % 4) * 15);
        const pronta = mais(iniciada, real + pausa);
        const prazo = mais(aberta, estimado + 60 + (numero % 2) * 90);
        const entregue = mais(pronta, 60 + (numero % 6) * 45);
        const resp = [joao, pedro, marcos][numero % 3];
        ordens.push({
          id,
          empresa_id: empresaId,
          numero,
          codigo_publico: codigo(),
          cliente_nome: CLIENTES[numero % CLIENTES.length],
          cliente_telefone: `6399990${String(1000 + numero).slice(-4)}`,
          prioridade: numero % 7 === 0 ? "urgente" : "normal",
          etapa: "entregue",
          responsavel_id: resp,
          ordem: numero,
          prazo: prazo.toISOString(),
          previsao: mais(aberta, estimado + 40).toISOString(),
          minutos_estimados: estimado,
          valor_total: lista.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0),
          minutos_execucao: Math.round(real * 100) / 100,
          minutos_pausa: pausa,
          aberta_em: aberta.toISOString(),
          iniciada_em: iniciada.toISOString(),
          pronta_em: pronta.toISOString(),
          entregue_em: entregue.toISOString(),
          retirado_por: "Cliente (fictício)",
          // Histórico já pago (menos duas, para o relatório mostrar o que ficou em aberto)
          valor_recebido: numero % 11 === 4 ? 0 : lista.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0),
          criado_por: idBalcao,
        });
        lista.forEach((i, n) => itens.push({ ...i, empresa_id: empresaId, ordem_id: id, posicao: n + 1 }));
        eventos.push(
          { empresa_id: empresaId, ordem_id: id, tipo: "criada", para_etapa: "fila", usuario: idBalcao, em: aberta.toISOString() },
          { empresa_id: empresaId, ordem_id: id, tipo: "etapa", de_etapa: "fila", para_etapa: "execucao", usuario: idBalcao, em: iniciada.toISOString() },
          ...(pausa
            ? [
                { empresa_id: empresaId, ordem_id: id, tipo: "pausa", detalhe: "Falta de material", usuario: idBalcao, em: mais(iniciada, 15).toISOString() },
                { empresa_id: empresaId, ordem_id: id, tipo: "retomada", detalhe: "Falta de material", usuario: idBalcao, em: mais(iniciada, 40).toISOString() },
              ]
            : []),
          { empresa_id: empresaId, ordem_id: id, tipo: "etapa", de_etapa: "execucao", para_etapa: "pronta", usuario: idBalcao, em: pronta.toISOString() },
          { empresa_id: empresaId, ordem_id: id, tipo: "etapa", de_etapa: "pronta", para_etapa: "entregue", detalhe: "Retirado por Cliente (fictício)", usuario: idBalcao, em: entregue.toISOString() },
        );
      }
    }
    ok("histórico", await admin.from("os_ordens").insert(ordens));
    ok("itens do histórico", await admin.from("os_itens").insert(itens));
    ok("eventos do histórico", await admin.from("os_eventos").insert(eventos));
    ok("numeração", await admin.from("os_config").update({ proximo_numero: numero + 1 }).eq("empresa_id", empresaId));

    // Hoje, pelas funções do portal (balcão abre, a equipe move)
    const abrir = async (dados: Record<string, unknown>) => ok("abrir OS", await balcao.rpc("os_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados })) as string;
    const item = (servico_id: string, quantidade: number) => ({ servico_id, quantidade });
    const a = await abrir({ cliente_nome: CLIENTES[0], cliente_telefone: "63999991001", responsavel_id: joao, itens: [item(corte, 8), item(fita, 24)], descricao: "Armário de cozinha: 8 chapas MDF branco 15 mm, fita branca nas bordas visíveis." });
    const b = await abrir({ cliente_nome: CLIENTES[3], cliente_telefone: "63999991004", responsavel_id: pedro, itens: [item(fita, 40)] });
    const c = await abrir({ cliente_nome: CLIENTES[4], cliente_telefone: "63999991005", itens: [item(corte, 5), item(rasgo, 6), item(furo, 24)] });
    const d = await abrir({ cliente_nome: CLIENTES[6], cliente_telefone: "63999991007", prioridade: "urgente", itens: [item(corte, 4)], descricao: "Obra parada esperando: 4 chapas de compensado 18 mm cortadas ao meio." });
    await abrir({ cliente_nome: CLIENTES[7], cliente_telefone: "63999991008", itens: [item(corte, 6), item(fita, 18), item(furo, 12)] });
    await abrir({ cliente_nome: CLIENTES[2], itens: [item(corte, 2), { descricao: "Montagem de prateleira simples", quantidade: 1, unidade: "un", minutos: 30, valor_unitario: "35.00" }] });
    const e = await abrir({ cliente_nome: CLIENTES[5], cliente_telefone: "63999991006", responsavel_id: marcos, itens: [item(furo, 30)] });

    // Em execução (um pausado), prontas
    for (const id of [a, b, c, e]) ok("iniciar", await balcao.rpc("os_mover", { p_id: id, p_etapa: "execucao" }));
    for (const id of [c, e]) ok("pronta", await balcao.rpc("os_mover", { p_id: id, p_etapa: "pronta" }));
    ok("pausar", await balcao.rpc("os_pausar", { p_id: b, p_motivo: "Falta de fita de borda carvalho" }));
    // Tempos de hoje mais realistas (a OS "a" começou há 50 min; as prontas ficaram prontas há pouco)
    const agora = new Date();
    await admin.from("os_ordens").update({ execucao_desde: mais(agora, -50).toISOString(), iniciada_em: mais(agora, -50).toISOString(), aberta_em: mais(agora, -110).toISOString() }).eq("id", a);
    await admin.from("os_ordens").update({ minutos_execucao: 18, pausada_em: mais(agora, -20).toISOString(), iniciada_em: mais(agora, -40).toISOString(), aberta_em: mais(agora, -95).toISOString() }).eq("id", b);
    await admin.from("os_ordens").update({ minutos_execucao: 58, iniciada_em: mais(agora, -120).toISOString(), pronta_em: mais(agora, -45).toISOString(), aberta_em: mais(agora, -180).toISOString() }).eq("id", c);
    await admin.from("os_ordens").update({ minutos_execucao: 21, iniciada_em: mais(agora, -70).toISOString(), pronta_em: mais(agora, -30).toISOString(), aberta_em: mais(agora, -150).toISOString() }).eq("id", e);
    void d;

  } finally {
    await dono.auth.signOut();
    await balcao.auth.signOut();
  }
  return true;
}

/**
 * Melhorias das OS na madeireira de demonstração (roda também numa demonstração
 * que já tinha OS): máquinas de cada setor, histórico pago e alguns
 * recebimentos de hoje pelo caixa do balcão. Só na primeira vez.
 */
export async function semearOsMelhorias(admin: SupabaseClient, conexao: { url: string; publica: string }, opcoes: { dominio: string }): Promise<boolean> {
  const { data: empresa } = await admin.from("empresas").select("id").eq("razao_social", "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)").maybeSingle();
  if (!empresa) return false;
  const empresaId = empresa.id as string;
  const { count: ordens } = await admin.from("os_ordens").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  const { count: pagos } = await admin.from("os_pagamentos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (!ordens || pagos) return false;
  const { data: balcaoPerfil } = await admin.from("perfis").select("id").eq("email", `balcao@${opcoes.dominio}`).maybeSingle();
  const idBalcao = (balcaoPerfil?.id as string | undefined) ?? null;
  const dono = await sessao(admin, conexao.url, conexao.publica, `madeireira@${opcoes.dominio}`);
  const balcao = await sessao(admin, conexao.url, conexao.publica, `balcao@${opcoes.dominio}`);
  try {
    // Máquinas de cada setor (a previsão espera a fila de cada uma)
    const { data: setores } = await admin.from("os_setores").select("id, nome").eq("empresa_id", empresaId);
    for (const [nome, maquinas] of [["Seccionadora", 1], ["Coladeira de borda", 2], ["Furadeira", 1]] as const) {
      const st = (setores ?? []).find((x) => x.nome === nome);
      if (st) ok(`setor ${nome}`, await dono.rpc("os_setor_salvar", { p_empresa_id: empresaId, p_id: st.id, p_dados: { nome, maquinas: String(maquinas) } }));
    }
    // Histórico já entregue: pago (menos algumas, para o relatório mostrar o que ficou em aberto)
    const { data: antigas } = await admin.from("os_ordens").select("id, numero, valor_total").eq("empresa_id", empresaId).eq("etapa", "entregue").eq("valor_recebido", 0);
    for (const o of antigas ?? []) {
      if (Number(o.numero) % 11 === 4) continue;
      await admin.from("os_ordens").update({ valor_recebido: o.valor_total }).eq("id", o.id);
    }
    // Recebimentos de hoje pelo caixa do balcão (Loja ligada na demonstração)
    const { data: gestao } = await admin.from("gestao_config").select("ativa").eq("empresa_id", empresaId).maybeSingle();
    if (gestao?.ativa && idBalcao) {
      const { data: aberto } = await admin.from("caixa_sessoes").select("id").eq("empresa_id", empresaId).eq("operador_id", idBalcao).eq("status", "aberto").maybeSingle();
      if (!aberto) ok("abrir o caixa do balcão", await balcao.rpc("gestao_caixa_abrir", { p_empresa_id: empresaId, p_caixa_nome: "Balcão", p_valor_abertura: 100 }));
      const { data: doDia } = await admin
        .from("os_ordens")
        .select("id, etapa, pausada, prioridade, valor_total")
        .eq("empresa_id", empresaId)
        .in("etapa", ["fila", "execucao", "pronta"])
        .order("numero");
      const lista = doDia ?? [];
      const pagar = async (id: string | undefined, forma: string, valor: number, vencimento = "") => {
        if (!id || valor <= 0) return;
        ok("recebimento da OS", await balcao.rpc("os_pagamento_registrar", { p_ordem_id: id, p_dados: { forma, valor: valor.toFixed(2), vencimento } }));
      };
      const urgente = lista.find((o) => o.etapa === "fila" && o.prioridade === "urgente");
      const fazendo = lista.find((o) => o.etapa === "execucao" && !o.pausada);
      const prontas = lista.filter((o) => o.etapa === "pronta");
      await pagar(urgente?.id, "dinheiro", Math.min(10, Number(urgente?.valor_total ?? 0)));
      await pagar(fazendo?.id, "pix", Math.min(50, Number(fazendo?.valor_total ?? 0)));
      await pagar(prontas[0]?.id, "pix", Math.min(30, Number(prontas[0]?.valor_total ?? 0)));
      await pagar(prontas[1]?.id, "a_receber", Number(prontas[1]?.valor_total ?? 0), somarDias(hoje(), 10));
    }
  } finally {
    await dono.auth.signOut();
    await balcao.auth.signOut();
  }
  return true;
}
