/**
 * Gestão na modalidade "notas e transporte" na DEMONSTRAÇÃO (dados
 * fictícios): uma comercial atacadista de soja e milho de Mato Grosso, do
 * regime normal, com a gestão ligada só para as ordens de carregamento e a
 * NF-e. Cadastros da NF-e (armazém, soja e milho em sacas de 60 kg, duas
 * operações, compradores e transportadoras), uma ordem já pesada esperando a
 * nota, uma aguardando o caminhão e uma cancelada. A emissão de NF-e fica
 * DESLIGADA: a demonstração não tem certificado digital e nenhuma nota vai à
 * SEFAZ. As ordens são feitas pelas mesmas funções do portal, com a sessão da
 * pessoa fictícia.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

function hojeMais(dias: number) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Araguaina" }).format(new Date());
  const [a, m, d] = hoje.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

async function entrarComo(admin: SupabaseClient, conexao: { url: string; publica: string }, email: string) {
  const cliente = createClient(conexao.url, conexao.publica, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`Falha ao preparar o acesso de ${email}: ${error?.message ?? "sem token"}`);
  const { error: e2 } = await cliente.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2) throw new Error(`Falha ao entrar como ${email}: ${e2.message}`);
  return cliente;
}

function ok<T>(nome: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`Grãos de demonstração (${nome}): ${r.error.message}`);
  return r.data;
}

async function semearLogoGraos(admin: SupabaseClient, empresaId: string) {
  const { data: e } = await admin.from("empresas").select("logo_path").eq("id", empresaId).single();
  if (e?.logo_path) return;
  const bytes = readFileSync(join(__dirname, "arquivos-demo", "logo-graos.png"));
  const caminho = `${empresaId}/logo-${Date.now()}.png`;
  ok("logo: envio", await admin.storage.from("empresas-logos").upload(caminho, bytes, { contentType: "image/png", upsert: false }));
  ok("logo: cadastro", await admin.from("empresas").update({ logo_path: caminho, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId));
}

export async function semearGraos(
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
  const documento = cnpjValido("557770880001");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) {
    await semearLogoGraos(admin, existente.id);
    return false;
  }

  const empresaId = ok(
    "empresa",
    await comoAdmin.rpc("criar_empresa", {
      p_dados: {
        razao_social: "COMERCIAL DE GRAOS CERRADO EXEMPLO LTDA (DEMONSTRAÇÃO)",
        nome_fantasia: "Grãos Cerrado (DEMO)",
        tipo_pessoa: "PJ",
        documento,
        regime_tributario: "lucro_real",
        atividade_principal: "Comércio atacadista de soja e de milho",
        cnae: "4622-2/00",
        servicos: ["contabil", "fiscal"],
        controla_estoque: false,
        logradouro: "Rodovia Fictícia MT-000, km 12",
        numero: "S/N",
        bairro: "Zona Rural",
        cidade: "Sorriso",
        uf: "MT",
        cep: "78890000",
        telefone: "66999990000",
        email: `graos@${opcoes.dominio}`,
        contador_responsavel_id: opcoes.contadorId,
        data_inicio_atendimento: opcoes.inicioAtendimento,
        demonstracao: true,
      },
    }),
  ) as string;

  // Dono (titular) e o operador da balança (faz as ordens e a pesagem)
  const idDono = await opcoes.garantirUsuario(`graos@${opcoes.dominio}`, "Dono da Grãos Cerrado (Demonstração)");
  const idBalanca = await opcoes.garantirUsuario(`balanca@${opcoes.dominio}`, "Balança da Grãos Cerrado (Demonstração)");
  ok("acesso do dono", await admin.from("empresa_membros").upsert({ empresa_id: empresaId, user_id: idDono, papel: "cliente_titular", permissoes: opcoes.permissoesTitular, ativo: true }, { onConflict: "empresa_id,user_id" }));
  ok(
    "acesso da balança",
    await admin
      .from("empresa_membros")
      .upsert({ empresa_id: empresaId, user_id: idBalanca, papel: "cliente_colaborador", permissoes: ["empresa.ver", "nfe.emitir", "mensagens.usar"], ativo: true }, { onConflict: "empresa_id,user_id" }),
  );

  // Cadastros da NF-e (DESLIGADA: sem certificado, nenhuma nota vai à SEFAZ)
  ok("NF-e: configuração", await admin.from("nfe_config").insert({ empresa_id: empresaId, ativa: false, ambiente: "homologacao", crt: 3, presenca: 9, enviar_email_destinatario: false }));
  const emitente = ok(
    "NF-e: armazém",
    await admin
      .from("nfe_emitentes")
      .insert({
        empresa_id: empresaId,
        nome: "Armazém Sorriso (DEMO)",
        inscricao_estadual: "13777777770",
        logradouro: "Rodovia Fictícia MT-000, km 12",
        numero: "S/N",
        bairro: "Zona Rural",
        municipio_ibge: "5107925",
        cep: "78890000",
        serie: 1,
      })
      .select("id")
      .single(),
  ) as { id: string };
  const produtos = ok(
    "NF-e: produtos",
    await admin
      .from("nfe_produtos")
      .insert([
        { empresa_id: empresaId, codigo: "SOJA", descricao: "SOJA EM GRAOS", ncm: "12019000", unidade: "SC", peso_kg: 60, valor_unitario: 128 },
        { empresa_id: empresaId, codigo: "MILHO", descricao: "MILHO EM GRAOS", ncm: "10059010", unidade: "SC", peso_kg: 60, valor_unitario: 52 },
      ])
      .select("id, codigo"),
  ) as { id: string; codigo: string }[];
  const soja = produtos.find((p) => p.codigo === "SOJA")!.id;
  const milho = produtos.find((p) => p.codigo === "MILHO")!.id;
  const operacoes = ok(
    "NF-e: operações",
    await admin
      .from("nfe_operacoes")
      .insert([
        {
          empresa_id: empresaId,
          nome: "Venda de grãos dentro de MT (DEMO)",
          natureza: "VENDA DE MERCADORIA",
          destino: "interna",
          cfop: "5102",
          icms_cst: "00",
          icms_aliquota: 12,
          pis_cst: "08",
          cofins_cst: "08",
          ibscbs_cclass_trib: "200036",
          informacoes: "Operação de DEMONSTRAÇÃO: regras fictícias, sem valor fiscal.",
        },
        {
          empresa_id: empresaId,
          nome: "Venda de grãos para outro estado (DEMO)",
          natureza: "VENDA DE MERCADORIA",
          destino: "interestadual",
          cfop: "6102",
          icms_cst: "00",
          icms_aliquota: 12,
          pis_cst: "08",
          cofins_cst: "08",
          ibscbs_cclass_trib: "200036",
          informacoes: "Operação de DEMONSTRAÇÃO: regras fictícias, sem valor fiscal.",
        },
      ])
      .select("id, destino"),
  ) as { id: string; destino: string }[];
  const compradores = ok(
    "NF-e: compradores",
    await admin
      .from("nfe_destinatarios")
      .insert([
        {
          empresa_id: empresaId,
          tipo: "cnpj",
          documento: cnpjValido("889990000001"),
          nome: "TRADING EXEMPLO S.A. (DEMONSTRACAO)",
          indicador_ie: 1,
          inscricao_estadual: "109999990",
          logradouro: "Avenida Fictícia dos Armazéns",
          numero: "900",
          bairro: "Distrito Industrial",
          municipio_ibge: "5218805",
          cep: "75900000",
        },
        {
          empresa_id: empresaId,
          tipo: "cnpj",
          documento: cnpjValido("990001110001"),
          nome: "ESMAGADORA EXEMPLO LTDA (DEMONSTRACAO)",
          indicador_ie: 9,
          logradouro: "Rodovia Fictícia, km 3",
          numero: "S/N",
          bairro: "Distrito Industrial",
          municipio_ibge: "5107602",
          cep: "78700000",
        },
      ])
      .select("id, nome"),
  ) as { id: string; nome: string }[];
  const trading = compradores.find((c) => c.nome.startsWith("TRADING"))!.id;
  const esmagadora = compradores.find((c) => c.nome.startsWith("ESMAGADORA"))!.id;
  const transportadora = ok(
    "NF-e: transportadora",
    await admin
      .from("nfe_transportadores")
      .insert({
        empresa_id: empresaId,
        tipo: "cnpj",
        documento: cnpjValido("221113330001"),
        nome: "TRANSPORTES EXEMPLO LTDA (DEMONSTRACAO)",
        uf: "MT",
        municipio: "Sorriso",
        placa: "QBA1C23",
        placa_uf: "MT",
        rntc: "012345678",
      })
      .select("id")
      .single(),
  ) as { id: string };

  // O escritório liga a gestão na modalidade "notas e transporte"
  ok(
    "ligar a gestão",
    await comoAdmin.rpc("gestao_configurar", {
      p_empresa_id: empresaId,
      p_dados: {
        ativa: true,
        modalidade: "notas",
        perfil_fiscal: "comercio",
        nfe_emitente_id: emitente.id,
        nfe_operacao_id: operacoes.find((o) => o.destino === "interna")!.id,
        mensagem_comprovante: "Armazém: seg a sáb, 6h às 20h. Carregar somente com a carga enlonada. Balança: (66) 99999-0000. (DEMONSTRAÇÃO)",
      },
    }),
  );

  // Ordens feitas pela balança, com a própria sessão
  const balanca = await entrarComo(admin, conexao, `balanca@${opcoes.dominio}`);
  const salvar = async (nome: string, dados: Record<string, unknown>) =>
    (ok(nome, await balanca.rpc("carregamento_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados })) as { id: string }).id;

  // 1. Soja para a trading de Goiás: já pesada, esperando a NF-e
  const pesada = await salvar("ordem de soja", {
    produto_id: soja,
    quantidade: "600",
    preco_unitario: "128.50",
    destinatario_id: trading,
    operacao_id: operacoes.find((o) => o.destino === "interestadual")!.id,
    contrato: "CT-DEMO-0042",
    local_carregamento: "Armazém Sorriso (DEMO) — silo 2",
    local_descarga: "Armazém da trading em Rio Verde/GO (DEMO)",
    validade: hojeMais(3),
    frete_por_conta: "1",
    transportador_id: transportadora.id,
    motorista_nome: "MOTORISTA EXEMPLO UM (DEMONSTRACAO)",
    motorista_cpf: cpfValido("321321321"),
    placa: "QBA1C23",
    placa_uf: "MT",
    placas_reboque: ["QBA2D34", "QBA3E45"],
    observacoes: "Conferir a lona antes de liberar. (DEMONSTRAÇÃO)",
  });
  ok(
    "pesagem da soja",
    await balanca.rpc("carregamento_pesagem", {
      p_id: pesada,
      p_dados: { peso_bruto_kg: "51020", tara_kg: "15000", umidade: "13.2", impureza: "0.9", ticket_balanca: "1001" },
    }),
  );

  // 2. Milho para a esmagadora de MT: aguardando o caminhão (motorista autônomo)
  await salvar("ordem de milho", {
    produto_id: milho,
    quantidade: "650",
    preco_unitario: "52",
    destinatario_id: esmagadora,
    contrato: "PED-DEMO-0108",
    local_carregamento: "Armazém Sorriso (DEMO) — silo 1",
    local_descarga: "Esmagadora em Rondonópolis/MT (DEMO)",
    validade: hojeMais(2),
    frete_por_conta: "0",
    transportador_nome: "CAMINHONEIRO AUTONOMO EXEMPLO (DEMO)",
    rntrc: "098765432",
    motorista_nome: "CAMINHONEIRO AUTONOMO EXEMPLO (DEMO)",
    motorista_cpf: cpfValido("654654654"),
    placa: "RAB4F56",
    placa_uf: "MT",
    placas_reboque: ["RAB5G67"],
  });

  // 3. Soja cancelada: o comprador remarcou o caminhão
  const cancelada = await salvar("ordem cancelada", {
    produto_id: soja,
    quantidade: "300",
    destinatario_id: trading,
    contrato: "CT-DEMO-0042",
    frete_por_conta: "1",
    transportador_id: transportadora.id,
    placa: "QBA9Z99",
    placa_uf: "MT",
  });
  ok("cancelar a ordem", await balanca.rpc("carregamento_cancelar", { p_id: cancelada, p_motivo: "Comprador remarcou o caminhão para a semana que vem. (DEMONSTRAÇÃO)" }));

  await semearLogoGraos(admin, empresaId);
  return true;
}
