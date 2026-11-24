/**
 * Clínica de fisioterapia de DEMONSTRAÇÃO (dados FICTÍCIOS): a Clínica
 * Movimento Fisioterapia, em Palmas, com a gestão na modalidade "fisioterapia":
 *  - a dona é fisioterapeuta e responsável técnica (usuária do portal); um
 *    segundo fisioterapeuta também tem usuário (neurofuncional) e uma terceira
 *    atende só pela agenda (pilates); a recepção agenda, cadastra e recebe, mas
 *    não lê o prontuário;
 *  - pacientes com casos comuns (coluna, joelho operado, AVC, ombro, gestante,
 *    idosa com risco de queda), pacotes particulares e de convênio (fictício);
 *  - prontuário das últimas semanas (avaliações, evoluções com a dor antes e
 *    depois, uma alta e um adendo), gravado direto (as funções só registram
 *    com a data e a hora de agora);
 *  - o dia de hoje pelas mesmas funções do portal: agenda com confirmados,
 *    quem chegou, uma primeira avaliação sem cadastro, sessões repetidas nas
 *    próximas semanas, recebimentos (que vão para o Financeiro) e uma
 *    declaração de comparecimento.
 * Só cria na primeira vez (o seed pode rodar de novo).
 */
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
  if (r.error) throw new Error(`Clínica de fisioterapia de demonstração (${nome}): ${r.error.message}`);
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
function diaSemana(data: string) {
  return new Date(`${data}T12:00:00Z`).getUTCDay();
}
function momento(data: string, hora: string) {
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}
/** Os N dias úteis anteriores a "ate" que caem nos dias da semana pedidos (1 = seg ... 5 = sex), do mais antigo ao mais novo. */
function diasAnteriores(ate: string, n: number, dias: number[]) {
  const r: string[] = [];
  let d = somarDias(ate, -1);
  while (r.length < n) {
    if (dias.includes(diaSemana(d))) r.unshift(d);
    d = somarDias(d, -1);
  }
  return r;
}

type Caso = {
  chave: string;
  nome: string;
  nascimento: string;
  genero: string;
  profissao: string;
  convenio?: string;
  carteirinha?: string;
  medico?: string;
  prof: "camila" | "rafael" | "juliana";
  hora: string;
  dias: number[];
  feitas: number;
  pacote?: { sessoes: number; valor: number; descricao: string; guia?: string };
  dorInicial: number;
  avaliacao: {
    queixa: string;
    historia: string;
    exame: string;
    adm?: string;
    forca?: string;
    testes?: string;
    exames?: string;
    diagnostico: string;
    cid?: string;
    prognostico: string;
    objetivos: string;
    condutas: string;
    frequencia: number;
    sessoes: number;
  };
  recursos: string[];
  alta?: boolean;
  faltas?: number;
};

const CASOS: Caso[] = [
  {
    chave: "maria",
    nome: "Maria Aparecida Souza (fictícia)",
    nascimento: "1971-04-18",
    genero: "feminino",
    profissao: "Professora",
    prof: "camila",
    hora: "08:00",
    dias: [1, 3, 5],
    feitas: 6,
    pacote: { sessoes: 10, valor: 800, descricao: "Pacote 10 sessões — coluna lombar" },
    dorInicial: 8,
    avaliacao: {
      queixa: "Dor lombar há 3 meses, pior ao final do dia e ao ficar muito tempo em pé dando aula.",
      historia: "Dor progressiva, sem irradiação para as pernas. Piora ao carregar peso. Fez anti-inflamatório com alívio parcial.",
      exame: "Retificação da lordose lombar, contratura da musculatura paravertebral bilateral, dor à palpação em L4-L5.",
      adm: "Flexão do tronco limitada (dedos a 25 cm do chão). Extensão com dor no final do movimento.",
      forca: "Abdominais e glúteos grau 4.",
      testes: "Lasègue negativo bilateral. Teste de Schober 3 cm.",
      exames: "Ressonância de coluna lombar (trazida pela paciente): protrusão discal L4-L5 sem compressão radicular.",
      diagnostico: "Disfunção cinético-funcional da coluna lombar por lombalgia mecânica crônica, com fraqueza de estabilizadores do tronco.",
      cid: "M54.5",
      prognostico: "Bom, com adesão aos exercícios domiciliares.",
      objetivos: "Reduzir a dor para 2/10 ou menos, recuperar a flexão do tronco e fortalecer o core para as atividades do trabalho.",
      condutas: "Terapia manual, TENS para analgesia, cinesioterapia com estabilização segmentar e alongamentos; orientação postural.",
      frequencia: 3,
      sessoes: 10,
    },
    recursos: ["Terapia manual", "TENS", "Cinesioterapia", "Alongamento"],
  },
  {
    chave: "joao",
    nome: "João Batista Lima (fictício)",
    nascimento: "1994-09-02",
    genero: "masculino",
    profissao: "Técnico de informática",
    convenio: "Plano Saúde Exemplo (fictício)",
    carteirinha: "0001234567",
    medico: "Dr. Marcos Teixeira, ortopedista (fictício)",
    prof: "camila",
    hora: "09:00",
    dias: [1, 3, 5],
    feitas: 12,
    pacote: { sessoes: 20, valor: 0, descricao: "Convênio — 20 sessões (pós-operatório de joelho)", guia: "G-2026-55871" },
    dorInicial: 6,
    avaliacao: {
      queixa: "Pós-operatório (5 semanas) de reconstrução do ligamento cruzado anterior do joelho direito.",
      historia: "Lesão jogando futebol. Cirurgia há 5 semanas. Usa muleta só para distâncias longas.",
      exame: "Edema leve no joelho direito, cicatrizes sem sinais de infecção, marcha com redução da fase de apoio à direita.",
      adm: "Flexão do joelho direito 95°, extensão -5°.",
      forca: "Quadríceps direito grau 3, isquiotibiais grau 4.",
      diagnostico: "Disfunção cinético-funcional do joelho direito no pós-operatório de LCA, com déficit de amplitude e de força do quadríceps.",
      cid: "S83.5",
      prognostico: "Bom; retorno ao esporte previsto em 6 a 9 meses.",
      objetivos: "Extensão completa, flexão de 130°, marcha sem muleta e quadríceps grau 5.",
      condutas: "Crioterapia, FES no quadríceps, mobilização patelar, cinesioterapia progressiva, treino de marcha e propriocepção.",
      frequencia: 3,
      sessoes: 20,
    },
    recursos: ["Crioterapia", "FES", "Mobilização articular", "Fortalecimento", "Treino de marcha", "Equilíbrio e propriocepção"],
  },
  {
    chave: "ana",
    nome: "Ana Beatriz Costa (fictícia)",
    nascimento: "1988-12-10",
    genero: "feminino",
    profissao: "Advogada",
    prof: "camila",
    hora: "10:00",
    dias: [2, 4],
    feitas: 8,
    pacote: { sessoes: 10, valor: 900, descricao: "Pacote 10 sessões — cervical" },
    dorInicial: 7,
    avaliacao: {
      queixa: "Dor no pescoço e nos ombros, com dor de cabeça no fim do expediente.",
      historia: "Trabalha 9 horas por dia no computador. Sintomas há 6 meses, piores em semanas de prazo.",
      exame: "Anteriorização da cabeça, pontos-gatilho em trapézio superior e elevador da escápula bilateral.",
      adm: "Rotação cervical 60° à direita e 55° à esquerda, com dor.",
      diagnostico: "Disfunção cinético-funcional da coluna cervical por cervicalgia tensional e postura sustentada.",
      cid: "M54.2",
      prognostico: "Muito bom com ajustes ergonômicos.",
      objetivos: "Eliminar a cefaleia, reduzir a dor para 1/10 e corrigir a postura no trabalho.",
      condutas: "Liberação miofascial, terapia manual, alongamento, fortalecimento de estabilizadores da escápula e orientação ergonômica.",
      frequencia: 2,
      sessoes: 10,
    },
    recursos: ["Liberação miofascial", "Terapia manual", "Alongamento", "Fortalecimento", "Orientações domiciliares"],
  },
  {
    chave: "carlos",
    nome: "Carlos Eduardo Mendes (fictício)",
    nascimento: "1956-06-25",
    genero: "masculino",
    profissao: "Aposentado (comerciante)",
    medico: "Dra. Paula Nogueira, neurologista (fictícia)",
    prof: "rafael",
    hora: "14:00",
    dias: [1, 3, 5],
    feitas: 9,
    pacote: { sessoes: 20, valor: 1800, descricao: "Pacote 20 sessões — reabilitação neurológica" },
    dorInicial: 3,
    avaliacao: {
      queixa: "Fraqueza do lado esquerdo do corpo depois de AVC há 4 meses; dificuldade para andar e usar a mão esquerda.",
      historia: "AVC isquêmico há 4 meses, internado por 10 dias. Hipertenso controlado. Mora com a esposa.",
      exame: "Hemiparesia à esquerda, espasticidade leve em flexores do cotovelo (Ashworth 1+), marcha com circundução.",
      forca: "Membro superior esquerdo grau 3, membro inferior esquerdo grau 3+.",
      testes: "Escala de Berg 38/56 (risco moderado de queda). Timed Up and Go 19 s.",
      diagnostico: "Disfunção neurofuncional por hemiparesia esquerda pós-AVC, com alteração de marcha e equilíbrio e risco moderado de queda.",
      cid: "I69.4",
      prognostico: "Regular a bom; ganho funcional esperado com terapia intensiva nos primeiros 6 meses.",
      objetivos: "Berg acima de 45, marcha independente com bengala, uso funcional da mão esquerda nas atividades diárias.",
      condutas: "Cinesioterapia neurofuncional, treino de marcha e de equilíbrio, FES no tibial anterior, alongamento e treino de atividades de vida diária.",
      frequencia: 3,
      sessoes: 30,
    },
    recursos: ["Cinesioterapia", "Treino de marcha", "Equilíbrio e propriocepção", "FES", "Alongamento"],
  },
  {
    chave: "fernanda",
    nome: "Fernanda Lima Rocha (fictícia)",
    nascimento: "1992-03-07",
    genero: "feminino",
    profissao: "Arquiteta",
    prof: "juliana",
    hora: "16:00",
    dias: [2, 4],
    feitas: 5,
    pacote: { sessoes: 8, valor: 560, descricao: "Pilates gestante — 8 aulas" },
    dorInicial: 4,
    avaliacao: {
      queixa: "Gestante de 24 semanas com dor lombar leve; quer manter-se ativa com segurança.",
      historia: "Gestação sem intercorrências, liberada pela obstetra para exercício.",
      exame: "Aumento da lordose lombar, sem sinais de alerta.",
      diagnostico: "Lombalgia gestacional leve por alterações posturais da gestação.",
      prognostico: "Bom.",
      objetivos: "Aliviar a dor lombar, fortalecer o assoalho pélvico e preparar para o parto.",
      condutas: "Pilates adaptado para gestantes, exercícios respiratórios e de assoalho pélvico.",
      frequencia: 2,
      sessoes: 8,
    },
    recursos: ["Pilates", "Fortalecimento", "Fisioterapia respiratória"],
  },
  {
    chave: "helena",
    nome: "Helena Martins Prado (fictícia)",
    nascimento: "1948-11-30",
    genero: "feminino",
    profissao: "Aposentada",
    prof: "rafael",
    hora: "15:00",
    dias: [2, 4],
    feitas: 4,
    pacote: { sessoes: 10, valor: 850, descricao: "Pacote 10 sessões — equilíbrio" },
    dorInicial: 2,
    avaliacao: {
      queixa: "Duas quedas em casa nos últimos 6 meses; medo de andar sozinha na rua.",
      historia: "Osteoporose em tratamento. Usa óculos. Sem fraturas nas quedas.",
      exame: "Base de apoio alargada, passos curtos, cifose torácica.",
      testes: "Escala de Berg 42/56. Timed Up and Go 15 s.",
      diagnostico: "Disfunção cinético-funcional do equilíbrio e da marcha em idosa, com risco de queda.",
      prognostico: "Bom com treino regular e adaptação da casa.",
      objetivos: "Berg acima de 50, nenhuma queda e retorno às caminhadas.",
      condutas: "Treino de equilíbrio e propriocepção, fortalecimento de membros inferiores, treino de marcha e orientação sobre a casa.",
      frequencia: 2,
      sessoes: 10,
    },
    recursos: ["Equilíbrio e propriocepção", "Fortalecimento", "Treino de marcha"],
    faltas: 1,
  },
  {
    chave: "pedro",
    nome: "Pedro Henrique Alves (fictício)",
    nascimento: "2003-01-15",
    genero: "masculino",
    profissao: "Estudante",
    prof: "camila",
    hora: "17:00",
    dias: [1, 3, 5],
    feitas: 8,
    pacote: { sessoes: 8, valor: 640, descricao: "Pacote 8 sessões — tornozelo" },
    dorInicial: 6,
    avaliacao: {
      queixa: "Entorse do tornozelo direito jogando basquete há 2 semanas.",
      historia: "Entorse em inversão, inchaço no primeiro dia. Raio-X sem fratura.",
      exame: "Edema leve em maléolo lateral, dor à palpação do ligamento talofibular anterior.",
      diagnostico: "Disfunção cinético-funcional do tornozelo direito por entorse em inversão grau II.",
      cid: "S93.4",
      prognostico: "Muito bom.",
      objetivos: "Sem dor, amplitude completa e retorno ao basquete.",
      condutas: "Crioterapia, mobilização, fortalecimento de fibulares, propriocepção e treino funcional.",
      frequencia: 3,
      sessoes: 8,
    },
    recursos: ["Crioterapia", "Mobilização articular", "Fortalecimento", "Equilíbrio e propriocepção"],
    alta: true,
  },
];

const RELATOS = [
  "Relata leve melhora desde a última sessão.",
  "Dormiu melhor nesta semana.",
  "Conseguiu fazer os exercícios em casa quase todos os dias.",
  "Sentiu um pouco de dor depois de um dia mais puxado.",
  "Refere que a dor está mais espaçada.",
  "Diz que está fazendo as atividades do dia a dia com mais facilidade.",
];

/** Cria a clínica de fisioterapia fictícia (só na primeira vez). */
export async function semearFisioterapia(
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
  const documento = cnpjValido("889900000002");
  const { data: existente } = await admin.from("empresas").select("id").eq("documento", documento).maybeSingle();
  if (existente) {
    const { count } = await admin.from("fisio_pacientes").select("id", { count: "exact", head: true }).eq("empresa_id", existente.id);
    if (count) return false;
  }
  const empresaId =
    (existente?.id as string | undefined) ??
    (ok(
      "empresa",
      await comoAdmin.rpc("criar_empresa", {
        p_dados: {
          razao_social: "CLINICA MOVIMENTO FISIOTERAPIA EXEMPLO LTDA (DEMONSTRAÇÃO)",
          nome_fantasia: "Clínica Movimento Fisioterapia (DEMO)",
          tipo_pessoa: "PJ",
          documento,
          regime_tributario: "simples_nacional",
          atividade_principal: "Clínica de fisioterapia e pilates",
          cnae: "8650-0/04",
          servicos: ["contabil", "fiscal", "folha", "financeiro"],
          logradouro: "Avenida JK (fictícia)",
          numero: "1020",
          bairro: "Plano Diretor Sul",
          cidade: "Palmas",
          uf: "TO",
          cep: "77015000",
          telefone: "63999994444",
          email: `fisioterapia@${opcoes.dominio}`,
          contador_responsavel_id: opcoes.contadorId,
          data_inicio_atendimento: opcoes.inicioAtendimento,
          demonstracao: true,
        },
      }),
    ) as string);

  const idDona = await opcoes.garantirUsuario(`fisioterapia@${opcoes.dominio}`, "Dra. Camila — Clínica Movimento (Demonstração)");
  const idRafael = await opcoes.garantirUsuario(`fisio2@${opcoes.dominio}`, "Dr. Rafael — Clínica Movimento (Demonstração)");
  const idRecepcao = await opcoes.garantirUsuario(`recepcao.fisio@${opcoes.dominio}`, "Recepção da Clínica Movimento (Demonstração)");
  ok("acesso da dona", await admin.from("empresa_membros").upsert({ empresa_id: empresaId, user_id: idDona, papel: "cliente_titular", permissoes: opcoes.permissoesTitular, ativo: true }, { onConflict: "empresa_id,user_id" }));
  ok(
    "acesso do fisioterapeuta",
    await admin.from("empresa_membros").upsert({ empresa_id: empresaId, user_id: idRafael, papel: "cliente_colaborador", permissoes: ["empresa.ver", "gestao.vender"], ativo: true }, { onConflict: "empresa_id,user_id" }),
  );
  ok(
    "acesso da recepção",
    await admin
      .from("empresa_membros")
      .upsert({ empresa_id: empresaId, user_id: idRecepcao, papel: "cliente_colaborador", permissoes: ["empresa.ver", "gestao.vender", "mensagens.usar"], ativo: true }, { onConflict: "empresa_id,user_id" }),
  );
  await admin.from("empresas").update({ ferramentas_desligadas: ["cte"], contribuinte_iss: true, tem_empregados: true }).eq("id", empresaId);

  // O escritório liga a gestão na modalidade clínica de fisioterapia (caixa da clínica e configuração)
  ok("ligar a clínica", await comoAdmin.rpc("gestao_configurar", { p_empresa_id: empresaId, p_dados: { ativa: true, modalidade: "fisioterapia", perfil_fiscal: "servicos" } }));

  const dona = await sessao(admin, conexao.url, conexao.publica, `fisioterapia@${opcoes.dominio}`);
  const recepcao = await sessao(admin, conexao.url, conexao.publica, `recepcao.fisio@${opcoes.dominio}`);
  const h = hoje();
  try {
    ok(
      "configurações da clínica",
      await dona.rpc("fisio_configurar", {
        p_empresa_id: empresaId,
        p_dados: {
          nome_clinica: "Clínica Movimento Fisioterapia",
          registro_crefito: "DEMO-PJ-0311",
          telefone: "63999994444",
          email: `fisioterapia@${opcoes.dominio}`,
          endereco: "Avenida JK (fictícia), 1020 — Plano Diretor Sul — Palmas/TO",
          cidade_documentos: "Palmas/TO",
          horario_inicio: "07:00",
          horario_fim: "19:00",
          duracao_padrao_min: "50",
          valor_sessao: "120",
          falta_desconta_sessao: false,
          mensagem_confirmacao:
            "Olá, {paciente}! Aqui é da {clinica}. Confirmando a sua sessão de fisioterapia em {data} às {hora} com {profissional}. Pode confirmar? (DEMONSTRAÇÃO)",
        },
      }),
    );

    const prof = {
      camila: ok(
        "fisioterapeuta responsável",
        await dona.rpc("fisio_profissional_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: {
            nome: "Camila Rocha Veloso (fictícia)",
            crefito: "DEMO-201-F",
            crefito_regiao: "11",
            especialidade: "Ortopedia e esportiva",
            perfil_id: idDona,
            cor: "#2563eb",
            repasse_percentual: "0",
            responsavel_tecnico: true,
          },
        }),
      ) as string,
      rafael: ok(
        "fisioterapeuta neuro",
        await dona.rpc("fisio_profissional_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: { nome: "Rafael Nunes Duarte (fictício)", crefito: "DEMO-202-F", crefito_regiao: "11", especialidade: "Neurofuncional", perfil_id: idRafael, cor: "#16a34a", repasse_percentual: "40" },
        }),
      ) as string,
      juliana: ok(
        "fisioterapeuta pilates",
        await dona.rpc("fisio_profissional_salvar", {
          p_empresa_id: empresaId,
          p_id: null,
          p_dados: { nome: "Juliana Prado Lins (fictícia)", crefito: "DEMO-203-F", crefito_regiao: "11", especialidade: "Pilates e RPG", cor: "#db2777", repasse_percentual: "35" },
        }),
      ) as string,
    };

    // Pacientes (pela recepção, com o consentimento LGPD)
    const pacientes = new Map<string, string>();
    for (const [i, c] of CASOS.entries()) {
      pacientes.set(
        c.chave,
        ok(
          `paciente ${c.nome}`,
          await recepcao.rpc("fisio_paciente_salvar", {
            p_empresa_id: empresaId,
            p_id: null,
            p_dados: {
              nome: c.nome,
              cpf: cpfValido(String(420000000 + i * 7013).slice(0, 9)),
              nascimento: c.nascimento,
              genero: c.genero,
              estado_civil: i % 2 ? "casado" : "solteiro",
              naturalidade: i % 3 ? "Palmas/TO" : "Goiânia/GO",
              profissao: c.profissao,
              telefone: `63999${String(510000 + i * 3119).slice(0, 6)}`,
              email: `paciente${i + 1}.fisio@exemplo.test`,
              cep: "77015000",
              logradouro: `Quadra ${100 + i * 4} Sul, Alameda ${i + 2} (fictícia)`,
              numero: String(10 + i),
              bairro: "Plano Diretor Sul",
              cidade: "Palmas",
              uf: "TO",
              convenio: c.convenio ?? "",
              carteirinha: c.carteirinha ?? "",
              medico_encaminhador: c.medico ?? "",
              contato_emergencia: `Familiar (fictício) — (63) 99999-${String(1000 + i * 111).slice(0, 4)}`,
              aceita_whatsapp: true,
              consentimento: true,
            },
          }),
        ) as string,
      );
    }
    const novo = ok(
      "paciente novo",
      await recepcao.rpc("fisio_paciente_salvar", {
        p_empresa_id: empresaId,
        p_id: null,
        p_dados: {
          nome: "Roberto Carlos Pires (fictício)",
          cpf: cpfValido("427777001"),
          nascimento: "1979-07-21",
          genero: "masculino",
          profissao: "Pedreiro",
          telefone: "63999527711",
          cidade: "Palmas",
          uf: "TO",
          medico_encaminhador: "Dr. Marcos Teixeira, ortopedista (fictício)",
          aceita_whatsapp: true,
          consentimento: true,
        },
      }),
    ) as string;

    // Pacotes (pela recepção)
    const pacotes = new Map<string, string>();
    for (const c of CASOS) {
      if (!c.pacote) continue;
      const inicio = diasAnteriores(h, c.feitas + (c.faltas ?? 0) + 1, c.dias)[0];
      pacotes.set(
        c.chave,
        ok(
          `pacote ${c.nome}`,
          await recepcao.rpc("fisio_pacote_salvar", {
            p_empresa_id: empresaId,
            p_id: null,
            p_dados: {
              paciente_id: pacientes.get(c.chave),
              descricao: c.pacote.descricao,
              sessoes: String(c.pacote.sessoes),
              valor_total: c.pacote.valor.toFixed(2),
              inicio,
              convenio: c.convenio ?? "",
              guia: c.pacote.guia ?? "",
              status: c.alta ? "encerrado" : "ativo",
            },
          }),
        ) as string,
      );
    }

    // ---------------------------------------------------------- prontuário das últimas semanas (gravado direto)
    let numero = 1;
    for (const c of CASOS) {
      const pacienteId = pacientes.get(c.chave)!;
      const profId = prof[c.prof];
      const datas = diasAnteriores(h, c.feitas + (c.faltas ?? 0) + 1, c.dias);
      const [diaAvaliacao, ...sessoes] = datas;
      const perfil = c.prof === "camila" ? idDona : c.prof === "rafael" ? idRafael : idDona;
      // Avaliação (agenda realizada + registro finalizado)
      const { data: agAv } = await admin
        .from("fisio_agenda")
        .insert({ empresa_id: empresaId, inicio: momento(diaAvaliacao, c.hora), duracao_min: 60, tipo: "avaliacao", paciente_id: pacienteId, profissional_id: profId, status: "realizado", criado_por: idRecepcao })
        .select("id")
        .single();
      const a = c.avaliacao;
      const { data: av } = await admin
        .from("fisio_avaliacoes")
        .insert({
          empresa_id: empresaId,
          numero: numero++,
          paciente_id: pacienteId,
          profissional_id: profId,
          agendamento_id: agAv!.id,
          tipo: "inicial",
          data_hora: momento(diaAvaliacao, c.hora),
          queixa_principal: a.queixa,
          historia_atual: a.historia,
          habitos: "Sedentário(a) antes do tratamento; sono regular. (DEMONSTRAÇÃO)",
          medicamentos: c.chave === "carlos" ? "Losartana 50 mg, AAS 100 mg, atorvastatina 20 mg (fictício)" : "Nenhum de uso contínuo.",
          dor_eva: c.dorInicial,
          exame_fisico: a.exame,
          amplitude_movimento: a.adm ?? null,
          forca_muscular: a.forca ?? null,
          testes_especiais: a.testes ?? null,
          exames_complementares: a.exames ?? null,
          diagnostico: a.diagnostico,
          cid: a.cid ?? null,
          prognostico: a.prognostico,
          objetivos: a.objetivos,
          condutas: a.condutas,
          frequencia_semanal: a.frequencia,
          sessoes_previstas: a.sessoes,
          status: "finalizada",
          finalizado_em: momento(diaAvaliacao, c.hora.replace(/:00$/, ":55")),
          finalizado_por: perfil,
          criado_por: perfil,
        })
        .select("id")
        .single();
      if (c.chave === "maria") {
        await admin.from("fisio_adendos").insert({
          empresa_id: empresaId,
          avaliacao_id: av!.id,
          profissional_id: profId,
          texto: "Paciente trouxe na segunda sessão o laudo da ressonância: protrusão discal L4-L5 sem compressão radicular. Conduta mantida. (DEMONSTRAÇÃO)",
          criado_por: perfil,
          created_at: momento(sessoes[0], "08:52"),
        });
      }
      // Sessões: dor caindo aos poucos; as faltas ficam no meio
      let falta = c.faltas ?? 0;
      for (const [i, d] of sessoes.entries()) {
        if (falta > 0 && i === Math.floor(sessoes.length / 2)) {
          falta--;
          await admin.from("fisio_agenda").insert({
            empresa_id: empresaId,
            inicio: momento(d, c.hora),
            duracao_min: 50,
            tipo: "sessao",
            paciente_id: pacienteId,
            profissional_id: profId,
            pacote_id: pacotes.get(c.chave) ?? null,
            status: "faltou",
            motivo: "Não avisou (DEMONSTRAÇÃO)",
            criado_por: idRecepcao,
          });
          continue;
        }
        const progresso = (i + 1) / Math.max(sessoes.length, 1);
        const antes = Math.max(Math.round(c.dorInicial * (1 - 0.65 * progresso)), 0);
        const depois = Math.max(antes - 2, 0);
        const { data: ag } = await admin
          .from("fisio_agenda")
          .insert({
            empresa_id: empresaId,
            inicio: momento(d, c.hora),
            duracao_min: c.prof === "juliana" ? 55 : 50,
            tipo: c.prof === "juliana" ? "grupo" : "sessao",
            paciente_id: pacienteId,
            profissional_id: profId,
            pacote_id: pacotes.get(c.chave) ?? null,
            sala: c.prof === "juliana" ? "Estúdio de pilates" : `Box ${(i % 3) + 1}`,
            status: "realizado",
            criado_por: idRecepcao,
          })
          .select("id")
          .single();
        // A Juliana atende só pela agenda (sem usuário): as aulas dela não têm evolução no portal
        if (c.prof === "juliana") continue;
        await admin.from("fisio_evolucoes").insert({
          empresa_id: empresaId,
          numero: numero++,
          paciente_id: pacienteId,
          profissional_id: profId,
          agendamento_id: ag!.id,
          tipo: "sessao",
          data_hora: momento(d, c.hora),
          subjetivo: RELATOS[i % RELATOS.length],
          objetivo: i % 2 ? "Melhora da amplitude em relação à sessão anterior." : "Exercícios realizados sem compensações.",
          analise: progresso > 0.6 ? "Evolução favorável, perto dos objetivos." : "Evolução gradual, dentro do esperado.",
          plano: progresso > 0.6 ? "Progredir a carga e iniciar treino funcional." : "Manter a conduta e progredir os exercícios.",
          condutas: c.recursos.slice(0, 3 + (i % 2)),
          dor_antes: antes,
          dor_depois: depois,
          orientacoes: i === 0 ? "Exercícios de casa: 2 séries de 10 repetições, uma vez por dia." : null,
          status: "finalizada",
          finalizado_em: momento(d, c.hora.replace(/:00$/, ":50")),
          finalizado_por: perfil,
          criado_por: perfil,
        });
      }
      if (c.alta) {
        const dAlta = sessoes[sessoes.length - 1];
        await admin.from("fisio_evolucoes").insert({
          empresa_id: empresaId,
          numero: numero++,
          paciente_id: pacienteId,
          profissional_id: profId,
          tipo: "alta",
          data_hora: momento(dAlta, c.hora.replace(/:00$/, ":52")),
          subjetivo: "Sem dor nas atividades e já voltou aos treinos leves.",
          objetivo: "Amplitude completa, força grau 5, teste de salto unipodal sem dor.",
          analise: "Objetivos alcançados.",
          plano: "Manter os exercícios de propriocepção 3 vezes por semana; retornar se houver nova entorse.",
          alta_motivo: "objetivos_alcancados",
          status: "finalizada",
          finalizado_em: momento(dAlta, c.hora.replace(/:00$/, ":58")),
          finalizado_por: perfil,
          criado_por: perfil,
        });
      }
    }
    await admin.from("fisio_config").update({ proximo_numero_registro: numero }).eq("empresa_id", empresaId);

    // ---------------------------------------------------------- hoje e as próximas semanas (pelas funções do portal)
    const agendar = async (nome: string, dados: Record<string, unknown>) =>
      ok(nome, await recepcao.rpc("fisio_agenda_salvar", { p_empresa_id: empresaId, p_id: null, p_dados: dados as never }));
    const proximoDiaUtil = (() => {
      let d = h;
      while ([0, 6].includes(diaSemana(d))) d = somarDias(d, 1);
      return d;
    })();
    const dia = proximoDiaUtil;
    // Sessão de hoje e, a partir de amanhã, a repetição nos dias de cada um por 2 semanas (seg/qua/sex ou ter/qui)
    for (const c of CASOS) {
      if (c.alta) continue;
      const base = {
        paciente_id: pacientes.get(c.chave),
        profissional_id: prof[c.prof],
        tipo: c.prof === "juliana" ? "grupo" : "sessao",
        duracao_min: c.prof === "juliana" ? 55 : 50,
        sala: c.prof === "juliana" ? "Estúdio de pilates" : "Box 1",
      };
      await agendar(`sessão de hoje ${c.nome}`, { ...base, inicio: momento(dia, c.hora) });
      await agendar(`sessões ${c.nome}`, { ...base, inicio: momento(somarDias(dia, 1), c.hora), dias_semana: c.dias, semanas: 2 });
    }
    // Primeira avaliação do paciente novo e uma pessoa ainda sem cadastro
    await agendar("avaliação do paciente novo", {
      paciente_id: novo,
      profissional_id: prof.camila,
      tipo: "avaliacao",
      inicio: momento(dia, "11:00"),
      duracao_min: 60,
      sala: "Box 2",
      observacoes: "Dor no ombro direito. Trazer o pedido médico e a ultrassonografia. (DEMONSTRAÇÃO)",
    });
    await agendar("avaliação sem cadastro", {
      nome_avulso: "Luciana Barros (fictícia) — primeira vez",
      telefone_avulso: "63999538899",
      profissional_id: prof.rafael,
      tipo: "avaliacao",
      inicio: momento(dia, "16:00"),
      duracao_min: 60,
      observacoes: "Formigamento nas mãos. Ligou pelo Instagram. (DEMONSTRAÇÃO)",
    });

    // Situação de hoje: confirmados e quem já chegou
    const { data: deHoje } = await admin
      .from("fisio_agenda")
      .select("id, paciente_id, inicio")
      .eq("empresa_id", empresaId)
      .gte("inicio", momento(dia, "00:00"))
      .lte("inicio", momento(dia, "23:59"))
      .order("inicio");
    for (const a of deHoje ?? []) {
      const chave = [...pacientes.entries()].find(([, id]) => id === a.paciente_id)?.[0];
      if (chave === "maria") {
        ok("chegou", await recepcao.rpc("fisio_agenda_status", { p_agenda_id: a.id, p_status: "chegou" }));
      } else if (chave === "joao" || chave === "carlos" || chave === "fernanda") {
        ok("confirmado", await recepcao.rpc("fisio_agenda_status", { p_agenda_id: a.id, p_status: "confirmado" }));
      }
    }

    // Recebimentos de hoje (vão para o Financeiro)
    for (const [chave, valor, forma] of [
      ["maria", "400.00", "pix"],
      ["ana", "900.00", "cartao_credito"],
      ["carlos", "900.00", "pix"],
      ["helena", "850.00", "cartao_debito"],
    ] as [string, string, string][]) {
      ok(
        `recebimento ${chave}`,
        await recepcao.rpc("fisio_recebimento_registrar", {
          p_empresa_id: empresaId,
          p_dados: { paciente_id: pacientes.get(chave), pacote_id: pacotes.get(chave), forma, valor },
        }),
      );
    }
    ok(
      "recebimento a receber",
      await recepcao.rpc("fisio_recebimento_registrar", {
        p_empresa_id: empresaId,
        p_dados: { paciente_id: pacientes.get("fernanda"), pacote_id: pacotes.get("fernanda"), forma: "a_receber", valor: "280.00", vencimento: somarDias(h, 10) },
      }),
    );

    // Declaração de comparecimento para o João (convênio), emitida pela fisioterapeuta
    ok(
      "declaração",
      await dona.rpc("fisio_documento_emitir", {
        p_empresa_id: empresaId,
        p_dados: {
          paciente_id: pacientes.get("joao"),
          tipo: "comparecimento",
          texto: `Declaro, para os devidos fins, que João Batista Lima (fictício) compareceu a esta clínica em ${somarDias(h, -1).split("-").reverse().join("/")}, das 09:00 às 09:50, para sessão de fisioterapia (reabilitação pós-operatória do joelho). (DEMONSTRAÇÃO)`,
        },
      }),
    );
  } finally {
    await dona.auth.signOut();
    await recepcao.auth.signOut();
  }
  return true;
}
