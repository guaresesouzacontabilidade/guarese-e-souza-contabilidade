/**
 * Clínica veterinária de DEMONSTRAÇÃO (dados FICTÍCIOS): a Clínica
 * Veterinária Amigo Fiel, em Porto Nacional, com a gestão na modalidade
 * "veterinaria":
 *  - a dona é a veterinária responsável técnica (usuária do portal) e há um
 *    segundo veterinário só na agenda; a recepção agenda, cadastra e cobra;
 *  - tutores e animais (cães, gatos e um coelho), vacinas de carteira
 *    anterior e serviços com preço;
 *  - pet shop e farmácia: medicamento fracionado em mL (com a conversão do
 *    frasco do fornecedor), vacinas por dose ligadas ao catálogo e ração;
 *  - prontuário de cerca de dois meses (atendimentos finalizados, adendo,
 *    vacinas aplicadas, receita comum, de antimicrobiano e de manipulado
 *    controlado, atestados), gravado direto (as funções só registram com a
 *    data e a hora de agora);
 *  - o dia de hoje pelas mesmas funções do portal: agenda, um atendimento
 *    finalizado com vacina, atestado e conta paga, outro em andamento com a
 *    conta aberta, e lembretes de vacina e retorno para os próximos dias.
 * O e-mail automático aos tutores fica desligado (os endereços são
 * fictícios). Só cria na primeira vez (o seed pode rodar de novo).
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
  if (r.error) throw new Error(`Clínica de demonstração (${nome}): ${r.error.message}`);
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
/** Data e hora (fuso de Brasília) em ISO. */
function momento(data: string, hora: string) {
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}
const ano2 = () => hoje().slice(2, 4);

const TUTORES = [
  { nome: "Mariana Lopes Carvalho (fictícia)", rua: "Rua das Mangueiras (fictícia)", numero: "120", bairro: "Centro", email: true },
  { nome: "José Ricardo Batista (fictício)", rua: "Avenida Tocantins (fictícia)", numero: "845", bairro: "Jardim Brasília", email: false },
  { nome: "Ana Clara Moura (fictícia)", rua: "Rua dos Ipês (fictícia)", numero: "33", bairro: "Setor Aeroporto", email: true },
  { nome: "Pedro Henrique Sales (fictício)", rua: "Rua Sete de Setembro (fictícia)", numero: "1502", bairro: "Centro", email: false },
  { nome: "Luciana Ferraz Rocha (fictícia)", rua: "Quadra 12, Rua B (fictícia)", numero: "7", bairro: "Vila Nova", email: true },
];

type Animal = {
  chave: string;
  tutor: number;
  nome: string;
  especie: string;
  raca?: string;
  sexo: string;
  castrado?: boolean;
  nascimento: string;
  estimado?: boolean;
  pelagem?: string;
  porte?: string;
  peso?: string;
  microchip?: string;
  alergias?: string;
};

function animais(h: string): Animal[] {
  const ano = Number(h.slice(0, 4));
  return [
    { chave: "thor", tutor: 0, nome: "Thor", especie: "canina", raca: "Labrador Retriever", sexo: "macho", castrado: true, nascimento: `${ano - 5}-03-10`, pelagem: "Amarela", porte: "grande", peso: "32,4", microchip: "900000000000101" },
    { chave: "mel", tutor: 0, nome: "Mel", especie: "canina", raca: "SRD", sexo: "femea", castrado: true, nascimento: `${ano - 7}-08-01`, estimado: true, pelagem: "Caramelo", porte: "medio", peso: "14,2", alergias: "Reação alérgica à dipirona (DEMONSTRAÇÃO)." },
    { chave: "nina", tutor: 1, nome: "Nina", especie: "felina", raca: "SRD", sexo: "femea", nascimento: somarDias(h, -150), pelagem: "Tricolor", porte: "pequeno", peso: "1,9" },
    { chave: "bob", tutor: 2, nome: "Bob", especie: "canina", raca: "Shih-tzu", sexo: "macho", nascimento: `${ano - 8}-02-14`, pelagem: "Branca e dourada", porte: "pequeno", peso: "6,8", microchip: "900000000000102" },
    { chave: "luna", tutor: 3, nome: "Luna", especie: "felina", raca: "Siamês", sexo: "femea", castrado: true, nascimento: `${ano - 6}-11-20`, pelagem: "Seal point", porte: "pequeno", peso: "4,1" },
    { chave: "pipoca", tutor: 3, nome: "Pipoca", especie: "lagomorfo", raca: "Mini Lop", sexo: "femea", nascimento: `${ano - 2}-01-05`, estimado: true, pelagem: "Branca", porte: "mini", peso: "1,6" },
    { chave: "zeca", tutor: 4, nome: "Zeca", especie: "canina", raca: "Border Collie", sexo: "macho", nascimento: somarDias(h, -120), pelagem: "Preta e branca", porte: "medio", peso: "8,3" },
  ];
}

/**
 * Pet shop e farmácia: medicamento fracionado em mL (o frasco de 50 mL entra
 * como 50 mL), vacinas por dose (ligadas ao catálogo: cada aplicação tira 1
 * dose) e produtos de balcão.
 */
const PRODUTOS: { chave: string; descricao: string; ncm: string; unidade: string; preco: number; custo: number; estoque: number; grupo: string }[] = [
  { chave: "dipirona", descricao: "Dipirona sódica 500 mg/mL injetável (frasco 50 mL)", ncm: "30049099", unidade: "MLT", preco: 1.2, custo: 0.36, estoque: 500, grupo: "Farmácia (uso na clínica)" },
  { chave: "soro", descricao: "Soro fisiológico 0,9% (bolsa 500 mL)", ncm: "30049099", unidade: "MLT", preco: 0.06, custo: 0.018, estoque: 5000, grupo: "Farmácia (uso na clínica)" },
  { chave: "v10", descricao: "Vacina polivalente canina V10 (dose)", ncm: "30024290", unidade: "DOSE", preco: 95, custo: 38, estoque: 30, grupo: "Vacinas" },
  { chave: "raiva", descricao: "Vacina antirrábica (dose)", ncm: "30024290", unidade: "DOSE", preco: 60, custo: 14, estoque: 20, grupo: "Vacinas" },
  { chave: "v4", descricao: "Vacina polivalente felina V4 (dose)", ncm: "30024290", unidade: "DOSE", preco: 110, custo: 45, estoque: 15, grupo: "Vacinas" },
  { chave: "racao", descricao: "Ração premium cães adultos 15 kg", ncm: "23091000", unidade: "UN", preco: 289, custo: 198, estoque: 12, grupo: "Pet shop" },
  { chave: "antipulgas", descricao: "Antipulgas e carrapatos cães 10 a 20 kg (comprimido)", ncm: "30049099", unidade: "CP", preco: 89, custo: 52, estoque: 24, grupo: "Pet shop" },
];

const SERVICOS: [string, string, number][] = [
  ["Vacina polivalente canina (V10)", "vacina", 95],
  ["Vacina antirrábica", "vacina", 60],
  ["Vacina polivalente felina (V4)", "vacina", 110],
  ["Hemograma completo", "exame", 70],
  ["Raspado de pele", "exame", 60],
  ["Castração de gata", "cirurgia", 450],
  ["Internação (diária)", "internacao", 180],
  ["Banho e tosa (porte pequeno)", "banho_tosa", 70],
];

/** Cria a clínica fictícia (só na primeira vez). */
export async function semearVeterinaria(
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
  const documento = cnpjValido("889900000001");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) {
    const { count } = await admin.from("vet_tutores").select("id", { count: "exact", head: true }).eq("empresa_id", existente.id);
    if (count) {
      await semearEstoqueClinica(admin, conexao, opcoes.dominio, existente.id as string);
      return false;
    }
  }
  const empresaId =
    (existente?.id as string | undefined) ??
    (ok(
      "empresa",
      await comoAdmin.rpc("criar_empresa", {
        p_dados: {
          razao_social: "CLINICA VETERINARIA AMIGO FIEL EXEMPLO LTDA (DEMONSTRAÇÃO)",
          nome_fantasia: "Clínica Veterinária Amigo Fiel (DEMO)",
          tipo_pessoa: "PJ",
          documento,
          regime_tributario: "simples_nacional",
          atividade_principal: "Clínica veterinária com pet shop",
          cnae: "7500-1/00",
          servicos: ["contabil", "fiscal", "folha", "financeiro"],
          logradouro: "Rua das Palmeiras (fictícia)",
          numero: "210",
          bairro: "Centro",
          cidade: "Porto Nacional",
          uf: "TO",
          cep: "77500000",
          telefone: "63999993333",
          email: `clinica@${opcoes.dominio}`,
          contador_responsavel_id: opcoes.contadorId,
          data_inicio_atendimento: opcoes.inicioAtendimento,
          demonstracao: true,
        },
      }),
    ) as string);

  const idDona = await opcoes.garantirUsuario(`veterinaria@${opcoes.dominio}`, "Dra. Helena — Clínica (Demonstração)");
  const idRecepcao = await opcoes.garantirUsuario(`atendimento@${opcoes.dominio}`, "Recepção da Clínica (Demonstração)");
  ok("acesso da dona", await admin.from("empresa_membros").upsert({ empresa_id: empresaId, user_id: idDona, papel: "cliente_titular", permissoes: opcoes.permissoesTitular, ativo: true }, { onConflict: "empresa_id,user_id" }));
  ok(
    "acesso da recepção",
    await admin
      .from("empresa_membros")
      .upsert({ empresa_id: empresaId, user_id: idRecepcao, papel: "cliente_colaborador", permissoes: ["empresa.ver", "gestao.vender", "mensagens.usar"], ativo: true }, { onConflict: "empresa_id,user_id" }),
  );
  await admin.from("empresas").update({ ferramentas_desligadas: ["cte"], contribuinte_iss: true, contribuinte_icms: true, tem_empregados: true }).eq("id", empresaId);

  // O escritório liga a gestão na modalidade clínica veterinária (caixa da clínica, vacinas e serviços iniciais)
  ok("ligar a clínica", await comoAdmin.rpc("gestao_configurar", { p_empresa_id: empresaId, p_dados: { ativa: true, modalidade: "veterinaria", perfil_fiscal: "comercio" } }));

  const dona = await sessao(admin, conexao.url, conexao.publica, `veterinaria@${opcoes.dominio}`);
  const recepcao = await sessao(admin, conexao.url, conexao.publica, `atendimento@${opcoes.dominio}`);
  const h = hoje();
  try {
    ok(
      "configurações da clínica",
      await dona.rpc("vet_configurar", {
        p_empresa_id: empresaId,
        p_dados: {
          nome_clinica: "Clínica Veterinária Amigo Fiel",
          registro_crmv: "PJ DEMO-0042/TO",
          telefone: "63999993333",
          email: `clinica@${opcoes.dominio}`,
          cidade_documentos: "Porto Nacional/TO",
          horario_inicio: "08:00",
          horario_fim: "18:00",
          duracao_padrao_min: "30",
          lembrete_dias_antes: "7",
          lembrete_email: false,
        },
      }),
    );

    // Veterinários: a dona (usuária do portal, responsável técnica) e um colega só na agenda
    const vetDona = ok(
      "veterinária responsável",
      await dona.rpc("vet_veterinario_salvar", {
        p_empresa_id: empresaId,
        p_id: null,
        p_dados: {
          nome: "Helena Duarte Viana (fictícia)",
          crmv: "DEMO-1001",
          crmv_uf: "TO",
          cadastro_mapa: "DEMO-1001",
          especialidade: "Clínica médica de cães e gatos",
          perfil_id: idDona,
          responsavel_tecnico: true,
        },
      }),
    ) as string;
    const vetPaulo = ok(
      "segundo veterinário",
      await dona.rpc("vet_veterinario_salvar", {
        p_empresa_id: empresaId,
        p_id: null,
        p_dados: { nome: "Paulo Mendes Rocha (fictício)", crmv: "DEMO-1002", crmv_uf: "TO", especialidade: "Cirurgia e anestesiologia" },
      }),
    ) as string;

    // Preços dos serviços iniciais e os demais serviços
    const { data: iniciais } = await admin.from("vet_servicos").select("id, nome, categoria").eq("empresa_id", empresaId);
    for (const [nome, preco] of [["Consulta", 150], ["Retorno", 60], ["Aplicação de vacina", 30]] as [string, number][]) {
      const s = (iniciais ?? []).find((x) => x.nome === nome);
      if (s) ok(`preço ${nome}`, await dona.rpc("vet_servico_salvar", { p_empresa_id: empresaId, p_id: s.id, p_dados: { nome, categoria: s.categoria, preco } }));
    }
    const servico = new Map<string, string>((iniciais ?? []).map((s) => [s.nome as string, s.id as string]));
    for (const [nome, categoria, preco] of SERVICOS) {
      servico.set(nome, ok(`serviço ${nome}`, await dona.rpc("vet_servico_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: { nome, categoria, preco } })) as string);
    }
    const { data: catalogo } = await admin.from("vet_vacinas").select("id, nome").eq("empresa_id", empresaId);
    const vacina = (prefixo: string) => (catalogo ?? []).find((v) => (v.nome as string).startsWith(prefixo))!.id as string;

    // Tutores e animais (pela recepção)
    const tutores: string[] = [];
    for (const [i, t] of TUTORES.entries()) {
      tutores.push(
        ok(
          `tutor ${t.nome}`,
          await recepcao.rpc("vet_tutor_salvar", {
            p_empresa_id: empresaId,
            p_id: null,
            p_dados: {
              nome: t.nome,
              cpf: cpfValido(String(310000000 + i * 6007).slice(0, 9)),
              telefone: `63999${String(400000 + i * 2711).slice(0, 6)}`,
              email: t.email ? `${t.nome.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.tutor${i}@exemplo.test` : null,
              cep: "77500000",
              logradouro: t.rua,
              numero: t.numero,
              bairro: t.bairro,
              cidade: "Porto Nacional",
              uf: "TO",
              aceita_whatsapp: true,
              aceita_email: t.email,
              autorizados: i === 0 ? "Rafael Carvalho (fictício), marido — pode buscar os animais (DEMONSTRAÇÃO)" : null,
            },
          }),
        ) as string,
      );
    }
    const pacientes = new Map<string, { id: string; tutor: string }>();
    for (const a of animais(h)) {
      const id = ok(
        `animal ${a.nome}`,
        await recepcao.rpc("vet_paciente_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: {
            tutor_id: tutores[a.tutor],
            nome: a.nome,
            especie: a.especie,
            raca: a.raca,
            sexo: a.sexo,
            castrado: a.castrado ?? false,
            nascimento: a.nascimento,
            nascimento_estimado: a.estimado ?? false,
            pelagem: a.pelagem,
            porte: a.porte,
            peso_kg: a.peso,
            microchip: a.microchip,
            alergias: a.alergias,
          },
        }),
      ) as string;
      pacientes.set(a.chave, { id, tutor: tutores[a.tutor] });
    }
    const P = (c: string) => pacientes.get(c)!;

    // Vacina de carteira anterior (outra clínica): antirrábica do Thor vence na semana que vem
    ok(
      "vacina de carteira anterior",
      await recepcao.rpc("vet_vacinacao_registrar", {
        p_empresa_id: empresaId,
        p_dados: {
          paciente_id: P("thor").id,
          vacina_id: vacina("Antirrábica"),
          origem: "externa",
          dose: "reforco",
          aplicada_em: somarDias(h, -358),
          proxima_dose_em: somarDias(h, 7),
          veterinario_externo: "Clínica anterior (fictícia), Palmas/TO",
        },
      }),
    );

    // ---------------------------------------------------------------- prontuário dos últimos dois meses
    let numAtend = 0;
    const atendimento = async (chave: string, dias: number, hora: string, dados: Record<string, unknown>, vet = vetDona) => {
      numAtend += 1;
      const quando = momento(somarDias(h, dias), hora);
      const r = ok(
        `atendimento ${numAtend}`,
        await admin
          .from("vet_atendimentos")
          .insert({
            empresa_id: empresaId,
            numero: numAtend,
            paciente_id: P(chave).id,
            tutor_id: P(chave).tutor,
            veterinario_id: vet,
            data_hora: quando,
            status: "finalizado",
            finalizado_em: new Date(new Date(quando).getTime() + 40 * 60_000).toISOString(),
            finalizado_por: vet === vetDona ? idDona : null,
            criado_por: idDona,
            ...dados,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return r.id;
    };
    const vacinou = async (chave: string, atendimentoId: string | null, dias: number, nome: string, dose: string, proxima: number | null, lote: string, fabricante: string) => {
      const r = ok(
        `vacina ${nome} de ${chave}`,
        await admin
          .from("vet_vacinacoes")
          .insert({
            empresa_id: empresaId,
            paciente_id: P(chave).id,
            vacina_id: vacina(nome),
            vacina_nome: (catalogo ?? []).find((v) => (v.nome as string).startsWith(nome))!.nome,
            fabricante,
            partida: lote,
            fabricacao: somarDias(h, dias - 150),
            validade: somarDias(h, dias + 400),
            dose,
            aplicada_em: somarDias(h, dias),
            origem: "clinica",
            veterinario_id: vetDona,
            atendimento_id: atendimentoId,
            proxima_dose_em: proxima === null ? null : somarDias(h, proxima),
            criado_por: idDona,
          })
          .select("id")
          .single(),
      ) as { id: string };
      return r.id;
    };

    const aThor = await atendimento("thor", -58, "09:10", {
      tipo: "consulta",
      relato: "Tutora relata que o Thor está mancando da pata traseira esquerda há 3 dias, depois de brincar no quintal.",
      anamnese: "Alimentação com ração super premium. Vacinas em dia (carteira anterior). Sem episódios anteriores de claudicação.",
      peso_kg: 32.1,
      temperatura: 38.7,
      frequencia_cardiaca: 96,
      frequencia_respiratoria: 24,
      tpc: 2,
      mucosas: "normocoradas",
      hidratacao: "normal",
      estado_geral: "Bom estado geral, alerta e responsivo.",
      exame_fisico: "Claudicação grau II no membro pélvico esquerdo, dor leve à flexão do joelho, sem instabilidade articular (teste de gaveta negativo).",
      diagnostico_presuntivo: "Entorse leve do joelho esquerdo.",
      tratamento: "Anti-inflamatório por 5 dias e repouso por 10 dias.",
      orientacoes: "Evitar escadas e brincadeiras com saltos. Passear só na guia, por pouco tempo.",
    });
    ok(
      "adendo",
      await admin.from("vet_adendos").insert({
        empresa_id: empresaId,
        atendimento_id: aThor,
        veterinario_id: vetDona,
        texto: "Contato telefônico com a tutora: o Thor voltou a apoiar a pata normalmente, sem dor. Tratamento concluído. (DEMONSTRAÇÃO)",
        criado_por: idDona,
        created_at: momento(somarDias(h, -50), "11:30"),
      }),
    );

    const aMel = await atendimento("mel", -45, "10:00", {
      tipo: "vacinacao",
      relato: "Vacinação anual.",
      peso_kg: 14.0,
      temperatura: 38.5,
      estado_geral: "Bom estado geral.",
      exame_fisico: "Sem alterações ao exame físico. Apta à vacinação.",
      orientacoes: "Pode apresentar leve sonolência e dor no local da aplicação por até 24 horas.",
    });
    const vMelV10 = await vacinou("mel", aMel, -45, "Polivalente canina", "reforco", 320, "V10-2611A", "Laboratório Exemplo Saúde Animal (fictício)");
    const vMelRaiva = await vacinou("mel", aMel, -45, "Antirrábica", "reforco", 320, "RAB-2608C", "Laboratório Exemplo Saúde Animal (fictício)");

    const aNina1 = await atendimento("nina", -39, "15:00", {
      tipo: "vacinacao",
      relato: "Primeira consulta da filhote, adotada há uma semana. Vermifugada pelo abrigo.",
      peso_kg: 1.2,
      temperatura: 38.6,
      estado_geral: "Bom estado geral, ativa.",
      exame_fisico: "Sem alterações. Sem pulgas.",
      orientacoes: "Esquema de 3 doses da vacina felina, a cada 21 dias. Não deixar sair de casa até completar o esquema.",
    });
    await vacinou("nina", aNina1, -39, "Polivalente felina", "1", -18, "V4F-2603B", "Laboratório Felino Exemplo (fictício)");
    const aNina2 = await atendimento("nina", -18, "15:20", { tipo: "vacinacao", relato: "2ª dose da vacina felina.", peso_kg: 1.6, temperatura: 38.4, estado_geral: "Bom estado geral." });
    await vacinou("nina", aNina2, -18, "Polivalente felina", "2", 3, "V4F-2603B", "Laboratório Felino Exemplo (fictício)");

    const aZeca = await atendimento("zeca", -35, "08:40", {
      tipo: "vacinacao",
      relato: "Filhote para início da vacinação.",
      peso_kg: 5.9,
      temperatura: 38.9,
      estado_geral: "Bom estado geral.",
      orientacoes: "Esquema de 3 doses da V10, a cada 21 dias, e antirrábica junto com a última dose.",
    });
    await vacinou("zeca", aZeca, -35, "Polivalente canina", "1", -14, "V10-2611A", "Laboratório Exemplo Saúde Animal (fictício)");

    const aLuna = await atendimento("luna", -30, "16:30", {
      tipo: "consulta",
      relato: "Tutor relata espirros, secreção nasal e menos apetite há 4 dias.",
      peso_kg: 4.0,
      temperatura: 39.4,
      frequencia_cardiaca: 180,
      mucosas: "normocoradas",
      hidratacao: "levemente desidratada",
      exame_fisico: "Secreção nasal mucopurulenta bilateral, linfonodos submandibulares reativos.",
      diagnostico_presuntivo: "Complexo respiratório felino com infecção bacteriana secundária.",
      tratamento: "Antibiótico por 10 dias, nebulização com soro fisiológico 2 vezes ao dia.",
      orientacoes: "Oferecer alimento úmido aquecido. Voltar se parar de comer.",
    });

    const aMel2 = await atendimento("mel", -20, "11:00", {
      tipo: "consulta",
      relato: "Tutora relata que a Mel fica muito agitada e destrói objetos quando fica sozinha; late por horas.",
      anamnese: "Começou após mudança de casa. Passeios curtos. Sem outras queixas.",
      peso_kg: 14.3,
      temperatura: 38.5,
      estado_geral: "Bom estado geral.",
      diagnostico_presuntivo: "Ansiedade de separação.",
      tratamento: "Medicação manipulada de uso contínuo, enriquecimento ambiental e treino de saídas curtas.",
      orientacoes: "Não fazer festa na saída nem na chegada. Brinquedos recheados quando ficar sozinha. Reavaliar em 30 dias.",
    });

    const aBob = await atendimento("bob", -12, "14:10", {
      tipo: "consulta",
      relato: "Tutora relata que o Bob coça e balança muito a cabeça, com mau cheiro no ouvido direito há uma semana.",
      peso_kg: 6.8,
      temperatura: 38.8,
      estado_geral: "Bom estado geral, incomodado ao manipular a orelha direita.",
      exame_fisico: "Conduto auditivo direito eritematoso, com secreção acastanhada e odor. Esquerdo sem alterações.",
      diagnostico_presuntivo: "Otite externa direita.",
      diagnostico_conclusivo: "Otite externa por Malassezia (citologia do cerúmen).",
      procedimentos: "Limpeza do conduto auditivo e citologia.",
      tratamento: "Solução otológica 2 vezes ao dia por 14 dias e anti-inflamatório por 5 dias.",
      orientacoes: "Não deixar entrar água no ouvido durante o tratamento.",
      retorno_em: somarDias(h, 2),
      retorno_motivo: "Reavaliar o ouvido direito",
    });

    // Receitas
    let numReceita = 0;
    const receita = async (chave: string, atendimentoId: string, dias: number, hora: string, r: Record<string, unknown>, itens: Record<string, unknown>[]) => {
      numReceita += 1;
      const rec = ok(
        `receita ${numReceita}`,
        await admin
          .from("vet_receitas")
          .insert({
            empresa_id: empresaId,
            numero: numReceita,
            paciente_id: P(chave).id,
            tutor_id: P(chave).tutor,
            veterinario_id: vetDona,
            atendimento_id: atendimentoId,
            emitida_em: momento(somarDias(h, dias), hora),
            criado_por: idDona,
            ...r,
          })
          .select("id")
          .single(),
      ) as { id: string };
      ok(
        `itens da receita ${numReceita}`,
        await admin.from("vet_receita_itens").insert(itens.map((it, i) => ({ empresa_id: empresaId, receita_id: rec.id, ordem: i + 1, via: "oral", uso: "veterinario", ...it }))),
      );
    };
    await receita("thor", aThor, -58, "09:45", { tipo: "simples" }, [
      {
        medicamento: "Meloxicam",
        concentracao: "2 mg",
        forma_farmaceutica: "Comprimido",
        quantidade: "1 caixa (10 comprimidos)",
        posologia: "Dar 1 comprimido e meio por via oral, a cada 24 horas, após a refeição.",
        duracao: "5 dias",
      },
    ]);
    await receita("luna", aLuna, -30, "17:05", { tipo: "antimicrobiano", validade: somarDias(h, -20), observacoes: "Manter a nebulização com soro fisiológico 2 vezes ao dia." }, [
      {
        medicamento: "Amoxicilina + clavulanato de potássio",
        concentracao: "250 mg/5 mL",
        forma_farmaceutica: "Suspensão oral",
        quantidade: "1 frasco de 75 mL",
        posologia: "Dar 1,6 mL por via oral, a cada 12 horas.",
        duracao: "10 dias",
        uso: "humano",
      },
    ]);
    await receita(
      "mel",
      aMel2,
      -20,
      "11:40",
      { tipo: "magistral_controlada", numero_controle: `DEMO-1001-0001-${ano2()}`, uso_continuo: true, validade: somarDias(h, 160) },
      [
        {
          medicamento: "Fluoxetina (cloridrato)",
          concentracao: "15 mg",
          forma_farmaceutica: "Cápsula manipulada",
          quantidade: "30 cápsulas",
          posologia: "Dar 1 cápsula por via oral, a cada 24 horas, pela manhã.",
          duracao: "uso contínuo",
          uso: "manipulado",
        },
      ],
    );
    await admin.from("vet_veterinarios").update({ proximo_numero_magistral: 2 }).eq("id", vetDona);
    await receita("bob", aBob, -12, "14:50", { tipo: "simples" }, [
      {
        medicamento: "Solução otológica com cetoconazol e hidrocortisona (uso veterinário)",
        forma_farmaceutica: "Solução otológica",
        quantidade: "1 frasco",
        via: "otologica",
        posologia: "Aplicar 5 gotas no ouvido direito, a cada 12 horas, após a limpeza.",
        duracao: "14 dias",
      },
      {
        medicamento: "Prednisolona",
        concentracao: "5 mg",
        forma_farmaceutica: "Comprimido",
        quantidade: "1 caixa (10 comprimidos)",
        posologia: "Dar 1 comprimido por via oral, a cada 24 horas, pela manhã.",
        duracao: "5 dias",
      },
    ]);

    // Atestados
    let numDocumento = 0;
    const documento = async (chave: string, atendimentoId: string | null, dias: number, hora: string, tipo: string, dados: Record<string, unknown>) => {
      numDocumento += 1;
      ok(
        `documento ${numDocumento}`,
        await admin.from("vet_documentos").insert({
          empresa_id: empresaId,
          numero: numDocumento,
          tipo,
          paciente_id: P(chave).id,
          tutor_id: P(chave).tutor,
          veterinario_id: vetDona,
          atendimento_id: atendimentoId,
          dados,
          emitido_em: momento(somarDias(h, dias), hora),
          criado_por: idDona,
        }),
      );
    };
    await documento("mel", aMel, -45, "10:30", "atestado_vacinacao", { vacinacoes: [vMelV10, vMelRaiva] });
    await documento("thor", null, -8, "16:00", "atestado_sanitario", {
      estado_saude: "bom estado geral de saúde, sem sinais clínicos de doenças infectocontagiosas ou parasitárias, apto a viajar.",
      finalidade: "Viagem interestadual de carro para Goiânia/GO (DEMONSTRAÇÃO).",
    });

    // Contadores (o portal continua a numeração daqui)
    await admin
      .from("vet_config")
      .update({ proximo_numero_atendimento: numAtend + 1, proximo_numero_receita: numReceita + 1, proximo_numero_documento: numDocumento + 1 })
      .eq("empresa_id", empresaId);

    // ---------------------------------------------------------------- o dia de hoje, pelas funções do portal
    const agenda = async (dados: Record<string, unknown>) => ok("agendamento", await recepcao.rpc("vet_agenda_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados })) as string;
    const gZeca = await agenda({ paciente_id: P("zeca").id, inicio: momento(h, "08:00"), tipo: "vacina", veterinario_id: vetDona, observacoes: "2ª dose da V10 (atrasada)" });
    const gThor = await agenda({ paciente_id: P("thor").id, inicio: momento(h, "09:30"), tipo: "consulta", veterinario_id: vetDona, observacoes: "Coceira nas patas" });
    const gLuna = await agenda({ paciente_id: P("luna").id, inicio: momento(h, "14:00"), tipo: "retorno", veterinario_id: vetDona });
    const gNovo = await agenda({ nome_avulso: "Carla Mendes (fictícia) — gato novo", telefone_avulso: "63999870011", inicio: momento(h, "16:30"), tipo: "consulta", observacoes: "Primeira consulta (DEMONSTRAÇÃO)" });
    await agenda({ paciente_id: P("mel").id, inicio: momento(somarDias(h, 1), "09:00"), tipo: "banho_tosa", duracao_min: 60 });
    await agenda({ paciente_id: P("nina").id, inicio: momento(somarDias(h, 3), "15:00"), tipo: "vacina", veterinario_id: vetDona, observacoes: "3ª dose da vacina felina" });
    await agenda({ paciente_id: P("bob").id, inicio: momento(somarDias(h, 2), "10:00"), tipo: "retorno", veterinario_id: vetPaulo, observacoes: "Reavaliar o ouvido direito" });
    ok("confirmar", await recepcao.rpc("vet_agenda_status", { p_agenda_id: gLuna, p_status: "confirmado" }));
    ok("confirmar", await recepcao.rpc("vet_agenda_status", { p_agenda_id: gNovo, p_status: "confirmado" }));
    ok("chegou", await recepcao.rpc("vet_agenda_status", { p_agenda_id: gZeca, p_status: "chegou" }));
    ok("chegou", await recepcao.rpc("vet_agenda_status", { p_agenda_id: gThor, p_status: "chegou" }));

    // Zeca: atendimento pelo agendamento, 2ª dose da V10, atestado de vacinação, finalizado
    const atZeca = ok("atender o Zeca", await dona.rpc("vet_atendimento_abrir", { p_empresa_id: empresaId, p_dados: { agendamento_id: gZeca, tipo: "vacinacao" } })) as string;
    ok(
      "prontuário do Zeca",
      await dona.rpc("vet_atendimento_salvar", {
        p_atendimento_id: atZeca,
        p_dados: {
          relato: "Atrasou a 2ª dose em duas semanas (viagem da família). Sem queixas.",
          peso_kg: "8,3",
          temperatura: "38,7",
          estado_geral: "Bom estado geral, ativo.",
          exame_fisico: "Sem alterações. Apto à vacinação.",
          orientacoes: "Reiniciar o intervalo: 3ª dose em 21 dias, junto com a antirrábica.",
        },
      }),
    );
    const vZeca = ok(
      "vacina do Zeca",
      await dona.rpc("vet_vacinacao_registrar", {
        p_empresa_id: empresaId,
        p_dados: {
          atendimento_id: atZeca,
          vacina_id: vacina("Polivalente canina"),
          dose: "2",
          fabricante: "Laboratório Exemplo Saúde Animal (fictício)",
          partida: "V10-2611A",
          fabricacao: somarDias(h, -180),
          validade: somarDias(h, 365),
        },
      }),
    ) as string;
    ok("finalizar o Zeca", await dona.rpc("vet_atendimento_finalizar", { p_atendimento_id: atZeca }));
    ok(
      "atestado do Zeca",
      await dona.rpc("vet_documento_emitir", { p_empresa_id: empresaId, p_dados: { tipo: "atestado_vacinacao", paciente_id: P("zeca").id, atendimento_id: atZeca, dados: { vacinacoes: [vZeca] } } }),
    );

    // Thor: em atendimento agora
    const atThor = ok("atender o Thor", await dona.rpc("vet_atendimento_abrir", { p_empresa_id: empresaId, p_dados: { agendamento_id: gThor } })) as string;
    ok(
      "prontuário do Thor",
      await dona.rpc("vet_atendimento_salvar", {
        p_atendimento_id: atThor,
        p_dados: { relato: "Tutora relata que o Thor lambe e morde as patas dianteiras há 10 dias, principalmente à noite.", peso_kg: "32,6", temperatura: "38,6" },
      }),
    );

    // Caixa da recepção e contas: Zeca paga no PIX; a conta do Thor fica aberta
    ok("abrir o caixa", await recepcao.rpc("gestao_caixa_abrir", { p_empresa_id: empresaId, p_caixa_nome: "Recepção", p_valor_abertura: 100 }));
    const cZeca = ok("conta do Zeca", await recepcao.rpc("vet_conta_abrir", { p_empresa_id: empresaId, p_dados: { atendimento_id: atZeca } })) as string;
    ok("vacina na conta", await recepcao.rpc("vet_conta_item_lancar", { p_conta_id: cZeca, p_dados: { servico_id: servico.get("Vacina polivalente canina (V10)") } }));
    ok("aplicação na conta", await recepcao.rpc("vet_conta_item_lancar", { p_conta_id: cZeca, p_dados: { servico_id: servico.get("Aplicação de vacina") } }));
    ok("pagamento do Zeca", await recepcao.rpc("vet_pagamento_registrar", { p_conta_id: cZeca, p_dados: { forma: "pix", valor: "125" } }));
    ok("fechar a conta do Zeca", await recepcao.rpc("vet_conta_fechar", { p_conta_id: cZeca }));
    const cThor = ok("conta do Thor", await recepcao.rpc("vet_conta_abrir", { p_empresa_id: empresaId, p_dados: { atendimento_id: atThor } })) as string;
    ok("consulta na conta", await recepcao.rpc("vet_conta_item_lancar", { p_conta_id: cThor, p_dados: { servico_id: servico.get("Consulta") } }));
    // Banho e tosa da Pipoca pago em dinheiro (entra na conferência do caixa)
    const cPipoca = ok("conta da Pipoca", await recepcao.rpc("vet_conta_abrir", { p_empresa_id: empresaId, p_dados: { paciente_id: P("pipoca").id } })) as string;
    ok("banho na conta", await recepcao.rpc("vet_conta_item_lancar", { p_conta_id: cPipoca, p_dados: { descricao: "Banho e corte de unhas (coelho)", valor_unitario: "45" } }));
    ok("pagamento da Pipoca", await recepcao.rpc("vet_pagamento_registrar", { p_conta_id: cPipoca, p_dados: { forma: "dinheiro", valor: "45" } }));
    ok("fechar a conta da Pipoca", await recepcao.rpc("vet_conta_fechar", { p_conta_id: cPipoca }));
  } finally {
    await dona.auth.signOut({ scope: "local" });
    await recepcao.auth.signOut({ scope: "local" });
  }

  // Logo fictícia
  const { data: e } = await admin.from("empresas").select("logo_path").eq("id", empresaId).single();
  if (!e?.logo_path) {
    const caminho = `${empresaId}/logo-${Date.now()}.png`;
    ok("logo: envio", await admin.storage.from("empresas-logos").upload(caminho, readFileSync(join(__dirname, "arquivos-demo", "logo-clinica.png")), { contentType: "image/png", upsert: false }));
    ok("logo: cadastro", await admin.from("empresas").update({ logo_path: caminho, logo_atualizado_em: new Date().toISOString() }).eq("id", empresaId));
  }
  await semearEstoqueClinica(admin, conexao, opcoes.dominio, empresaId);
  return true;
}

/**
 * Pet shop e farmácia da clínica fictícia: produtos com estoque, a conversão
 * do frasco do fornecedor (1 FR = 50 mL), as vacinas do catálogo ligadas aos
 * produtos e o medicamento usado no atendimento em andamento (cobrado na
 * conta). Só na primeira vez (a clínica pode mudar tudo depois).
 */
export async function semearEstoqueClinica(admin: SupabaseClient, conexao: { url: string; publica: string }, dominio: string, empresaId: string) {
  const { count } = await admin.from("nfe_produtos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId);
  if (count) return;
  const dona = await sessao(admin, conexao.url, conexao.publica, `veterinaria@${dominio}`);
  try {
    const produto = new Map<string, string>();
    for (const [i, x] of PRODUTOS.entries()) {
      const id = ok(
        `produto ${x.descricao}`,
        await dona.rpc("gestao_produto_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: { codigo: String(101 + i), descricao: x.descricao, ncm: x.ncm, unidade: x.unidade, valor_unitario: x.preco, preco_custo: x.custo, grupo: x.grupo, controla_estoque: true },
        }),
      ) as string;
      ok(
        `estoque ${x.descricao}`,
        await dona.rpc("gestao_estoque_lancar", {
          p_empresa_id: empresaId,
          p_dados: { tipo: "entrada_manual", produto_id: id, quantidade: x.estoque, custo_unitario: x.custo, observacao: "Estoque inicial (DEMONSTRAÇÃO)" },
        }),
      );
      produto.set(x.chave, id);
    }
    // Compra do fornecedor: 1 frasco (FR) da nota = 50 mL no estoque
    ok(
      "conversão do fornecedor",
      await admin.from("estoque_vinculos").insert({
        empresa_id: empresaId,
        fornecedor_documento: cnpjValido("990011000001"),
        codigo_fornecedor: "DIP50",
        produto_id: produto.get("dipirona"),
        fator: 50,
        descricao_fornecedor: "DIPIRONA SODICA 500MG/ML INJ FR 50ML (FICTICIO)",
        unidade_fornecedor: "FR",
      }),
    );
    // Vacinas do catálogo ligadas aos produtos (de agora em diante, cada aplicação tira 1 dose)
    const { data: catalogo } = await admin.from("vet_vacinas").select("id, nome").eq("empresa_id", empresaId);
    for (const [prefixo, chave] of [["Polivalente canina", "v10"], ["Antirrábica", "raiva"], ["Polivalente felina", "v4"]] as [string, string][]) {
      const v = (catalogo ?? []).find((x) => (x.nome as string).startsWith(prefixo));
      if (v) ok(`baixa da vacina ${prefixo}`, await dona.rpc("vet_vacina_produto_definir", { p_vacina_id: v.id, p_produto_id: produto.get(chave) }));
    }
    // Medicamento e soro usados no atendimento em andamento (o da dipirona é cobrado na conta)
    const { data: aberto } = await admin.from("vet_atendimentos").select("id").eq("empresa_id", empresaId).eq("status", "aberto").order("data_hora", { ascending: false }).limit(1).maybeSingle();
    if (aberto) {
      ok("uso no atendimento", await dona.rpc("vet_uso_registrar", { p_atendimento_id: aberto.id, p_dados: { produto_id: produto.get("dipirona"), quantidade: "1,5", cobrar: true } }));
      ok("soro no atendimento", await dona.rpc("vet_uso_registrar", { p_atendimento_id: aberto.id, p_dados: { produto_id: produto.get("soro"), quantidade: "100" } }));
    }
  } finally {
    await dona.auth.signOut({ scope: "local" });
  }
}
