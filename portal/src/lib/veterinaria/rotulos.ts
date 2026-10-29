/**
 * Rótulos e regras simples da clínica veterinária (usados nas telas e nos
 * documentos). As regras que valem de verdade ficam no banco.
 */

type Tom = "neutro" | "primario" | "sucesso" | "alerta" | "perigo" | "info" | "contorno";

export const ESPECIES: Record<string, string> = {
  canina: "Cão",
  felina: "Gato",
  ave: "Ave",
  roedor: "Roedor",
  lagomorfo: "Coelho",
  reptil: "Réptil",
  equina: "Equino",
  bovina: "Bovino",
  ovina: "Ovino",
  caprina: "Caprino",
  suina: "Suíno",
  peixe: "Peixe",
  outra: "Outra",
};

/** Nome da espécie como sai no documento ("canina" → "Canina"). */
export const ESPECIES_DOCUMENTO: Record<string, string> = {
  canina: "Canina",
  felina: "Felina",
  ave: "Ave",
  roedor: "Roedor",
  lagomorfo: "Lagomorfa (coelho)",
  reptil: "Réptil",
  equina: "Equina",
  bovina: "Bovina",
  ovina: "Ovina",
  caprina: "Caprina",
  suina: "Suína",
  peixe: "Peixe",
  outra: "Outra",
};

export const SEXOS: Record<string, string> = { macho: "Macho", femea: "Fêmea", indefinido: "Não informado" };

export const PORTES: Record<string, string> = { mini: "Mini", pequeno: "Pequeno", medio: "Médio", grande: "Grande", gigante: "Gigante" };

export const TIPOS_ATENDIMENTO: Record<string, string> = {
  consulta: "Consulta",
  retorno: "Retorno",
  vacinacao: "Vacinação",
  emergencia: "Emergência",
  cirurgia: "Cirurgia",
  internacao: "Internação",
  exame: "Exame",
  procedimento: "Procedimento",
  outro: "Outro",
};

export const STATUS_ATENDIMENTO: Record<string, { rotulo: string; tom: Tom }> = {
  aberto: { rotulo: "Em atendimento", tom: "alerta" },
  finalizado: { rotulo: "Finalizado", tom: "sucesso" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

export const TIPOS_AGENDA: Record<string, string> = {
  consulta: "Consulta",
  retorno: "Retorno",
  vacina: "Vacina",
  cirurgia: "Cirurgia",
  exame: "Exame",
  banho_tosa: "Banho e tosa",
  outro: "Outro",
};

export const STATUS_AGENDA: Record<string, { rotulo: string; tom: Tom }> = {
  agendado: { rotulo: "Agendado", tom: "info" },
  confirmado: { rotulo: "Confirmado", tom: "primario" },
  chegou: { rotulo: "Chegou", tom: "alerta" },
  em_atendimento: { rotulo: "Em atendimento", tom: "alerta" },
  concluido: { rotulo: "Atendido", tom: "sucesso" },
  faltou: { rotulo: "Faltou", tom: "perigo" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

export const TIPOS_RECEITA: Record<string, { rotulo: string; descricao: string }> = {
  simples: {
    rotulo: "Receita comum",
    descricao: "Medicamentos de uso veterinário ou humano sem controle especial. Sai em 2 vias: uma para o tutor e outra fica arquivada no portal.",
  },
  antimicrobiano: {
    rotulo: "Antimicrobiano de uso humano",
    descricao: "Antibiótico de farmácia humana (RDC Anvisa nº 471/2021): 2 vias, a farmácia retém a 2ª. Vale 10 dias (90 dias em uso contínuo).",
  },
  magistral_controlada: {
    rotulo: "Manipulado sujeito a controle especial",
    descricao:
      "Fórmula manipulada com substância controlada (Portaria MAPA nº 837/2025): 3 vias (tutor, farmácia de manipulação e arquivo), numeração com o seu cadastro no MAPA. Vale 30 dias (180 em uso contínuo).",
  },
};

export const VIAS: Record<string, string> = {
  oral: "Oral",
  topica: "Tópica (pele)",
  oftalmica: "Oftálmica (olhos)",
  otologica: "Otológica (ouvidos)",
  nasal: "Nasal",
  subcutanea: "Subcutânea",
  intramuscular: "Intramuscular",
  intravenosa: "Intravenosa",
  retal: "Retal",
  transdermica: "Transdérmica",
  outra: "Outra",
};

export const USOS_RECEITA: Record<string, string> = {
  veterinario: "Farmácia veterinária",
  humano: "Farmácia humana",
  manipulado: "Farmácia de manipulação",
};

export const DOSES: Record<string, string> = {
  "1": "1ª dose",
  "2": "2ª dose",
  "3": "3ª dose",
  "4": "4ª dose",
  "5": "5ª dose",
  "6": "6ª dose",
  reforco: "Reforço",
  unica: "Dose única",
};

export const ESPECIES_VACINA: Record<string, string> = { canina: "Cães", felina: "Gatos", todas: "Cães e gatos", outra: "Outras espécies" };

export const CATEGORIAS_SERVICO: Record<string, string> = {
  consulta: "Consulta",
  vacina: "Vacina",
  exame: "Exame",
  cirurgia: "Cirurgia",
  procedimento: "Procedimento",
  internacao: "Internação",
  banho_tosa: "Banho e tosa",
  outro: "Outro",
};

export const FORMAS_PAGAMENTO_CLINICA: Record<string, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  transferencia: "Transferência",
  a_receber: "A receber (fiado)",
  outro: "Outro",
};

export const STATUS_CONTA: Record<string, { rotulo: string; tom: Tom }> = {
  aberta: { rotulo: "Em aberto", tom: "alerta" },
  fechada: { rotulo: "Paga", tom: "sucesso" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

/**
 * Atestados e termos da Res. CFMV nº 1.321/2020: o que cada um pede e o texto
 * de abertura. Os campos são os do banco (vet_documento_emitir).
 */
export interface CampoDocumento {
  nome: string;
  rotulo: string;
  tipo: "texto" | "area" | "datahora";
  obrigatorio?: boolean;
  ajuda?: string;
}

export const TIPOS_DOCUMENTO: Record<string, { rotulo: string; grupo: "Atestados" | "Termos de consentimento"; campos: CampoDocumento[]; descricao: string }> = {
  atestado_sanitario: {
    rotulo: "Atestado sanitário (de saúde)",
    grupo: "Atestados",
    descricao: "Declara o estado de saúde do animal examinado e as imunizações (viagem, hospedagem, exposição).",
    campos: [
      { nome: "estado_saude", rotulo: "Estado de saúde", tipo: "area", obrigatorio: true, ajuda: "Ex.: bom estado geral de saúde, sem sinais de doença infectocontagiosa." },
      { nome: "finalidade", rotulo: "Finalidade", tipo: "texto", ajuda: "Ex.: viagem interestadual, hospedagem em hotel para animais." },
    ],
  },
  atestado_vacinacao: {
    rotulo: "Atestado de vacinação",
    grupo: "Atestados",
    descricao: "Declara as vacinas aplicadas na clínica, com nome, partida, fabricante, dose, fabricação e validade.",
    campos: [],
  },
  atestado_obito: {
    rotulo: "Atestado de óbito",
    grupo: "Atestados",
    descricao: "Declara o óbito, o local, a hora e a provável causa, e orienta a destinação do corpo. Registra o óbito na ficha do animal.",
    campos: [
      { nome: "data_hora", rotulo: "Dia e hora do óbito", tipo: "datahora", obrigatorio: true },
      { nome: "local", rotulo: "Local", tipo: "texto", obrigatorio: true, ajuda: "Ex.: clínica, residência, fazenda." },
      { nome: "cidade_uf", rotulo: "Cidade/UF", tipo: "texto", obrigatorio: true },
      { nome: "causa", rotulo: "Provável causa mortis", tipo: "area", obrigatorio: true },
      { nome: "complementares", rotulo: "Informações complementares", tipo: "area", ajuda: "Inclusive se foi feita notificação obrigatória." },
      { nome: "destinacao", rotulo: "Orientação para a destinação do corpo", tipo: "area", obrigatorio: true, ajuda: "Aspectos sanitários e ambientais (cremação, aterro sanitário licenciado...)." },
    ],
  },
  termo_exames: {
    rotulo: "Termo de consentimento para exames",
    grupo: "Termos de consentimento",
    descricao: "O responsável autoriza os exames e declara ter sido informado dos riscos.",
    campos: [
      { nome: "procedimento", rotulo: "Exame(s)", tipo: "area", obrigatorio: true },
      { nome: "riscos", rotulo: "Riscos explicados ao responsável", tipo: "area" },
    ],
  },
  termo_procedimento_risco: {
    rotulo: "Termo para procedimento terapêutico de risco",
    grupo: "Termos de consentimento",
    descricao: "Procedimento que pode causar perda de função, deformidade ou óbito.",
    campos: [
      { nome: "procedimento", rotulo: "Procedimento", tipo: "area", obrigatorio: true },
      { nome: "riscos", rotulo: "Riscos explicados ao responsável", tipo: "area" },
    ],
  },
  termo_cirurgia: {
    rotulo: "Termo de consentimento para cirurgia",
    grupo: "Termos de consentimento",
    descricao: "O responsável autoriza o procedimento cirúrgico.",
    campos: [
      { nome: "procedimento", rotulo: "Cirurgia", tipo: "area", obrigatorio: true },
      { nome: "riscos", rotulo: "Riscos explicados ao responsável", tipo: "area" },
      { nome: "valor_estimado", rotulo: "Valor estimado", tipo: "texto", ajuda: "Opcional. Ex.: R$ 900,00 (sem complicações)." },
    ],
  },
  termo_anestesia: {
    rotulo: "Termo de consentimento para anestesia",
    grupo: "Termos de consentimento",
    descricao: "O responsável autoriza a anestesia ou sedação.",
    campos: [
      { nome: "procedimento", rotulo: "Anestesia ou sedação", tipo: "area", obrigatorio: true },
      { nome: "riscos", rotulo: "Riscos explicados ao responsável", tipo: "area" },
    ],
  },
  termo_internacao: {
    rotulo: "Termo para internação e tratamento",
    grupo: "Termos de consentimento",
    descricao: "Internação e tratamento clínico ou pós-cirúrgico.",
    campos: [
      { nome: "procedimento", rotulo: "Internação e tratamento", tipo: "area", obrigatorio: true },
      { nome: "riscos", rotulo: "Riscos explicados ao responsável", tipo: "area" },
      { nome: "valor_estimado", rotulo: "Valor estimado (diária)", tipo: "texto" },
    ],
  },
  termo_eutanasia: {
    rotulo: "Termo de consentimento para eutanásia",
    grupo: "Termos de consentimento",
    descricao: "O responsável autoriza a eutanásia do animal.",
    campos: [
      { nome: "procedimento", rotulo: "Motivo e método", tipo: "area", obrigatorio: true },
      { nome: "riscos", rotulo: "Esclarecimentos ao responsável", tipo: "area" },
    ],
  },
  termo_retirada_corpo: {
    rotulo: "Termo para retirada do corpo do animal",
    grupo: "Termos de consentimento",
    descricao: "O responsável assume a posse e a destinação ambientalmente adequada do corpo.",
    campos: [{ nome: "destinacao", rotulo: "Destinação informada pelo responsável", tipo: "area" }],
  },
  termo_retirada_sem_alta: {
    rotulo: "Termo de retirada sem alta médica",
    grupo: "Termos de consentimento",
    descricao: "O responsável retira o animal sem alta e assume os riscos sanitários e de morte.",
    campos: [{ nome: "quadro", rotulo: "Quadro do animal e riscos da retirada", tipo: "area", obrigatorio: true }],
  },
  termo_doacao_corpo: {
    rotulo: "Termo de doação do corpo para ensino e pesquisa",
    grupo: "Termos de consentimento",
    descricao: "Doação do corpo para instituição de ensino e pesquisa.",
    campos: [{ nome: "instituicao", rotulo: "Instituição de ensino e pesquisa", tipo: "texto", obrigatorio: true }],
  },
};

/** Idade a partir do nascimento ("3 anos e 2 meses", "5 meses", "12 dias"), na data de referência. */
export function idadeAnimal(nascimento: string | null | undefined, referencia: Date = new Date()): string | null {
  if (!nascimento) return null;
  const [a, m, d] = nascimento.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return null;
  let anos = referencia.getFullYear() - a;
  let meses = referencia.getMonth() + 1 - m;
  if (referencia.getDate() < d) meses -= 1;
  if (meses < 0) {
    anos -= 1;
    meses += 12;
  }
  if (anos < 0) return null;
  if (anos === 0 && meses === 0) {
    const dias = Math.max(0, Math.floor((referencia.getTime() - new Date(a, m - 1, d).getTime()) / 86_400_000));
    return `${dias} ${dias === 1 ? "dia" : "dias"}`;
  }
  const pa = anos ? `${anos} ${anos === 1 ? "ano" : "anos"}` : "";
  const pm = meses ? `${meses} ${meses === 1 ? "mês" : "meses"}` : "";
  return [pa, pm].filter(Boolean).join(" e ");
}

/** Mensagem do lembrete com os campos {tutor}, {animal}, {vacina}, {data} e {clinica} (igual ao banco). */
export function mensagemLembrete(modelo: string, v: { clinica: string; tutor: string; animal: string; vacina: string; data: string }) {
  const [a, m, d] = v.data.slice(0, 10).split("-");
  return modelo
    .replaceAll("{clinica}", v.clinica)
    .replaceAll("{tutor}", v.tutor.split(" ")[0] ?? v.tutor)
    .replaceAll("{animal}", v.animal)
    .replaceAll("{vacina}", v.vacina)
    .replaceAll("{data}", `${d}/${m}/${a}`);
}

/** Link do WhatsApp (abre a conversa no aparelho da clínica com o texto pronto). Só números do Brasil. */
export function linkWhatsapp(telefone: string | null | undefined, texto: string): string | null {
  const n = (telefone ?? "").replace(/\D/g, "");
  if (n.length < 10 || n.length > 13) return null;
  const comPais = n.length <= 11 ? `55${n}` : n;
  return `https://wa.me/${comPais}?text=${encodeURIComponent(texto)}`;
}

/** Próxima dose sugerida pelo catálogo (esquema inicial ou reforço), em AAAA-MM-DD. */
export function proximaDose(
  aplicada: string,
  dose: string,
  vacina: { doses_iniciais: number; intervalo_doses_dias: number; reforco_dias: number | null } | null,
): string | null {
  if (!vacina || !/^\d{4}-\d{2}-\d{2}$/.test(aplicada)) return null;
  const n = /^\d$/.test(dose) ? Number(dose) : null;
  const dias = n !== null && n < vacina.doses_iniciais ? vacina.intervalo_doses_dias : vacina.reforco_dias;
  if (!dias) return null;
  const [a, m, d] = aplicada.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1, d + dias));
  return r.toISOString().slice(0, 10);
}

const FUSO_CLINICA = "America/Araguaina";

/** Hora local (HH:MM) de um instante. */
export function horaLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_CLINICA, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Dia local (AAAA-MM-DD) de um instante. */
export function diaLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_CLINICA }).format(new Date(iso));
}

/** Início e fim (instantes) de um dia local, para filtrar a agenda. */
export function limitesDoDia(dia: string): { inicio: string; fim: string } {
  return { inicio: `${dia}T00:00:00-03:00`, fim: `${dia}T23:59:59.999-03:00` };
}

/** O que falta no cadastro do tutor para os documentos (nome, CPF e endereço completo). */
export function pendenciasTutor(t: { cpf: string | null; logradouro: string | null; cidade: string | null } | null): string[] {
  if (!t) return [];
  return [!t.cpf ? "CPF" : null, !t.logradouro || !t.cidade ? "endereço" : null].filter((x): x is string => Boolean(x));
}
