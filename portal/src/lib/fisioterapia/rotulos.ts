type Tom = "neutro" | "primario" | "sucesso" | "alerta" | "perigo" | "info";

export const TIPOS_AGENDA: Record<string, string> = {
  avaliacao: "Avaliação",
  sessao: "Sessão",
  reavaliacao: "Reavaliação",
  grupo: "Grupo (pilates, hidro...)",
  domiciliar: "Atendimento domiciliar",
  outro: "Outro",
};

export const STATUS_AGENDA: Record<string, { rotulo: string; tom: Tom }> = {
  agendado: { rotulo: "Agendado", tom: "info" },
  confirmado: { rotulo: "Confirmado", tom: "primario" },
  chegou: { rotulo: "Chegou", tom: "alerta" },
  realizado: { rotulo: "Realizado", tom: "sucesso" },
  faltou: { rotulo: "Faltou", tom: "perigo" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

/** Recursos mais usados nas sessões (o fisioterapeuta marca os da sessão e pode escrever outros). */
export const CONDUTAS = [
  "Cinesioterapia",
  "Alongamento",
  "Fortalecimento",
  "Terapia manual",
  "Mobilização articular",
  "Liberação miofascial",
  "TENS",
  "FES",
  "Ultrassom",
  "Laser",
  "Ondas curtas",
  "Crioterapia",
  "Termoterapia",
  "Treino de marcha",
  "Equilíbrio e propriocepção",
  "RPG",
  "Pilates",
  "Kinesio taping",
  "Drenagem linfática",
  "Fisioterapia respiratória",
  "Orientações domiciliares",
];

export const MOTIVOS_ALTA: Record<string, string> = {
  objetivos_alcancados: "Objetivos alcançados",
  melhora_parcial: "Melhora parcial (paciente orientado)",
  abandono: "Abandono do tratamento",
  encaminhamento: "Encaminhado a outro profissional",
  pedido_paciente: "A pedido do paciente",
  outro: "Outro",
};

export const TIPOS_DOCUMENTO: Record<string, { rotulo: string; modelo: (p: { paciente: string; data: string; hora?: string }) => string }> = {
  comparecimento: {
    rotulo: "Declaração de comparecimento",
    modelo: ({ paciente, data, hora }) =>
      `Declaro, para os devidos fins, que ${paciente} compareceu a esta clínica em ${data}${hora ? `, às ${hora}` : ""}, para atendimento de fisioterapia.`,
  },
  relatorio: {
    rotulo: "Relatório fisioterapêutico",
    modelo: ({ paciente }) =>
      `Paciente: ${paciente}.\n\nDiagnóstico fisioterapêutico: \n\nTratamento realizado (recursos e número de sessões): \n\nEvolução: \n\nConduta e recomendações: `,
  },
  encaminhamento: {
    rotulo: "Encaminhamento",
    modelo: ({ paciente }) => `Encaminho ${paciente} para avaliação de (especialidade), por (motivo).\n\nResumo do caso: `,
  },
  orientacoes: {
    rotulo: "Orientações para casa",
    modelo: ({ paciente }) => `Orientações para ${paciente}:\n\n1. \n2. \n3. \n\nFaça os exercícios sem dor. Em caso de piora, entre em contato com a clínica.`,
  },
  declaracao: {
    rotulo: "Declaração",
    modelo: ({ paciente }) => `Declaro, para os devidos fins, que ${paciente} `,
  },
};

export const FORMAS_RECEBIMENTO: Record<string, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_debito: "Cartão de débito",
  cartao_credito: "Cartão de crédito",
  transferencia: "Transferência",
  a_receber: "A receber (fiado)",
  outro: "Outro",
};

export const GENEROS: Record<string, string> = { feminino: "Feminino", masculino: "Masculino", outro: "Outro", nao_informado: "Prefere não informar" };

export const ESTADOS_CIVIS: Record<string, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  uniao_estavel: "União estável",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  outro: "Outro",
};

export const DIAS_SEMANA = [
  { v: 1, curto: "seg" },
  { v: 2, curto: "ter" },
  { v: 3, curto: "qua" },
  { v: 4, curto: "qui" },
  { v: 5, curto: "sex" },
  { v: 6, curto: "sáb" },
];

/** Idade em anos (na data de hoje). */
export function idade(nascimento: string | null | undefined, hoje: string): number | null {
  if (!nascimento) return null;
  const [a, m, d] = nascimento.split("-").map(Number);
  const [ha, hm, hd] = hoje.split("-").map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

/** Mensagem de confirmação (WhatsApp da clínica, aberto pela recepção) com os dados do horário. */
export function mensagemConfirmacao(modelo: string, dados: { paciente: string; clinica: string; data: string; hora: string; profissional: string }) {
  return modelo
    .replaceAll("{paciente}", dados.paciente.split(" ")[0] ?? dados.paciente)
    .replaceAll("{clinica}", dados.clinica)
    .replaceAll("{data}", dados.data)
    .replaceAll("{hora}", dados.hora)
    .replaceAll("{profissional}", dados.profissional);
}

/** Link do WhatsApp (wa.me) para o telefone com DDD (Brasil). */
export function linkWhatsapp(telefone: string | null | undefined, texto: string): string | null {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/55${d}?text=${encodeURIComponent(texto)}`;
}

export function crefitoTexto(p: { crefito: string; crefito_regiao: number } | null | undefined) {
  return p ? `CREFITO-${p.crefito_regiao} nº ${p.crefito}` : "";
}
