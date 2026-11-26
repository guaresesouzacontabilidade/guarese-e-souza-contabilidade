/**
 * Gestão de RH de DEMONSTRAÇÃO (dados fictícios) na madeireira: cargos, os
 * funcionários (o balconista ligado ao acesso de demonstração dele) e as
 * rotinas iniciais no quadro de tarefas, já atribuídas.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MADEIREIRA = "MADEIREIRA REFLORESTAR EXEMPLO LTDA (DEMONSTRAÇÃO)";

async function entrarComo(admin: SupabaseClient, conexao: { url: string; publica: string }, email: string) {
  const cliente = createClient(conexao.url, conexao.publica, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`Falha ao preparar o acesso de ${email}: ${error?.message ?? "sem token"}`);
  const { error: e2 } = await cliente.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2) throw new Error(`Falha ao entrar como ${email}: ${e2.message}`);
  return cliente;
}

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Gestão de RH de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

export async function semearRh(admin: SupabaseClient, conexao: { url: string; publica: string }, dominio: string): Promise<boolean> {
  const { data: emp } = await admin.from("empresas").select("id").eq("razao_social", MADEIREIRA).maybeSingle();
  if (!emp) return false;
  const empresaId = emp.id as string;
  const { count } = await admin.from("rh_tarefa_modelos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return false;

  // O balconista faz as próprias tarefas (cadastro ligado ao acesso dele)
  const { data: balcao } = await admin.from("perfis").select("id").eq("email", `balcao@${dominio}`).maybeSingle();
  if (!balcao) return false;
  const { data: membro } = await admin.from("empresa_membros").select("id, permissoes").eq("empresa_id", empresaId).eq("user_id", balcao.id).maybeSingle();
  if (membro && !(membro.permissoes as string[]).includes("rh.tarefas")) {
    ok("permissão do balconista", await admin.from("empresa_membros").update({ permissoes: [...(membro.permissoes as string[]), "rh.tarefas"] }).eq("id", membro.id));
  }

  const dono = await entrarComo(admin, conexao, `madeireira@${dominio}`);
  const cargoLoja = ok(
    "cargo da loja",
    await dono.rpc("rh_cargo_salvar", {
      p_empresa_id: empresaId,
      p_id: null,
      p_dados: { nome: "Auxiliar de loja (DEMO)", descricao: "Atende no balcão, fecha o caixa, confere o estoque e envia o extrato da semana à contabilidade." },
    }),
  ) as string;
  const cargoPatio = ok(
    "cargo do pátio",
    await dono.rpc("rh_cargo_salvar", {
      p_empresa_id: empresaId,
      p_id: null,
      p_dados: { nome: "Auxiliar de pátio (DEMO)", descricao: "Recebe as cargas, separa os pedidos e mantém o pátio organizado." },
    }),
  ) as string;
  const funcionarios = ok(
    "funcionários",
    await admin
      .from("escala_funcionarios")
      .insert([
        { empresa_id: empresaId, nome: "Balconista da Madeireira (DEMO)", cargo_id: cargoLoja, usuario_id: balcao.id, jornada_semanal: 44 },
        { empresa_id: empresaId, nome: "Pedro do Pátio (DEMO)", cargo_id: cargoPatio, jornada_semanal: 44 },
      ])
      .select("id, nome"),
  ) as { id: string; nome: string }[];
  const idBalconista = funcionarios.find((f) => f.nome.startsWith("Balconista"))!.id;
  const idPatio = funcionarios.find((f) => f.nome.startsWith("Pedro"))!.id;

  ok(
    "rotinas iniciais",
    await dono.rpc("rh_criar_rotinas_iniciais", {
      p_empresa_id: empresaId,
      p_chaves: ["conferencia_estoque", "envio_extrato", "conciliacao_semanal", "organizacao_patio", "fechamento_caixa"],
    }),
  );
  const modelos = ok("modelos", await admin.from("rh_tarefa_modelos").select("id, chave_rotina").eq("empresa_id", empresaId)) as { id: string; chave_rotina: string }[];
  const id = (chave: string) => modelos.find((m) => m.chave_rotina === chave)!.id;
  ok(
    "tarefas do cargo da loja",
    await dono.rpc("rh_cargo_salvar", {
      p_empresa_id: empresaId,
      p_id: cargoLoja,
      p_dados: {
        nome: "Auxiliar de loja (DEMO)",
        descricao: "Atende no balcão, fecha o caixa, confere o estoque e envia o extrato da semana à contabilidade.",
        modelos: [id("conferencia_estoque"), id("fechamento_caixa"), id("envio_extrato"), id("conciliacao_semanal")],
      },
    }),
  );
  ok(
    "tarefas do cargo do pátio",
    await dono.rpc("rh_cargo_salvar", {
      p_empresa_id: empresaId,
      p_id: cargoPatio,
      p_dados: { nome: "Auxiliar de pátio (DEMO)", descricao: "Recebe as cargas, separa os pedidos e mantém o pátio organizado.", modelos: [id("organizacao_patio")] },
    }),
  );
  // As tarefas do período atual já criadas: atribui (as próximas vão sozinhas para a pessoa do cargo)
  const { data: abertas } = await admin.from("rh_tarefas").select("id, modelo_id").eq("empresa_id", empresaId).neq("status", "concluida");
  for (const t of abertas ?? []) {
    ok(
      "atribuir",
      await dono.rpc("rh_tarefa_atribuir", { p_tarefa_id: t.id, p_funcionario_id: t.modelo_id === id("organizacao_patio") ? idPatio : idBalconista }),
    );
  }
  return true;
}
