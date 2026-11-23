import { valorPorExtenso } from "@/lib/declaracoes/extenso";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento, nomeMes } from "@/lib/formatos";
import { INDICES_REAJUSTE, SERVICOS_HONORARIOS, type ServicoHonorario } from "./comum";

/**
 * Texto do contrato de prestação de serviços contábeis montado pela ficha do
 * cliente, com as cláusulas mínimas da Resolução CFC nº 1.590/2020 (art. 2º):
 * partes, serviços, o que cabe ao cliente, duração, honorários, prazo de
 * pagamento, reajuste, responsabilidades, aditamento, Carta de
 * Responsabilidade da Administração, ciência da Lei nº 9.613/1998, rescisão
 * com prévio aviso e foro. Também o aditivo (o que mudou) e o distrato
 * (arts. 6º a 10).
 *
 * O texto é um modelo: vale a revisão do escritório (e do advogado dele).
 */

export interface Clausula {
  titulo: string;
  paragrafos: string[];
}

export interface PartesContrato {
  escritorio: {
    razao_social: string;
    nome_fantasia: string | null;
    cnpj: string;
    endereco: string | null;
    cidade: string | null;
    uf: string | null;
    contador_nome: string | null;
    contador_crc: string | null;
  };
  cliente: { razao_social: string; documento: string; endereco: string | null };
}

export interface CondicoesContrato {
  valor_mensal: number;
  dia_vencimento: number;
  inicio: string;
  servicos: string[];
  funcionarios_inclusos: number | null;
  valor_funcionario_extra: number | null;
  notas_inclusas: number | null;
  valor_nota_extra: number | null;
  decimo_terceiro: boolean;
  decimo_terceiro_mes: number;
  reajuste_indice: string;
  reajuste_mes: number | null;
  /** "mes_anterior": a cobrança do mês paga o mês já trabalhado. */
  competencia_referencia: string;
  cobrar_encargos: boolean;
  multa_percentual: number;
  juros_mes_percentual: number;
}

export interface OpcoesContrato {
  /** Dias de aviso prévio para encerrar (30, 60 ou 90). */
  aviso_previo_dias: number;
  /** Até que dia do mês seguinte o cliente manda os documentos. */
  dia_documentos: number;
  /** Cidade/UF do foro. */
  foro: string;
  /** Texto livre do escritório (cláusula adicional), opcional. */
  adicional: string | null;
}

export interface ConteudoContrato {
  partes: PartesContrato;
  condicoes: CondicoesContrato;
  opcoes: OpcoesContrato;
}

const ORDINAIS = [
  "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA",
  "DÉCIMA PRIMEIRA", "DÉCIMA SEGUNDA", "DÉCIMA TERCEIRA", "DÉCIMA QUARTA", "DÉCIMA QUINTA", "DÉCIMA SEXTA",
];
export function rotuloClausula(i: number, titulo: string) {
  return `CLÁUSULA ${ORDINAIS[i] ?? String(i + 1)} — ${titulo.toUpperCase()}`;
}

const moeda = (v: number) => `${formatarMoeda(v)} (${valorPorExtenso(v)})`;
const mesAno = (comp: string) => `${nomeMes(Number(comp.slice(5, 7))).toLowerCase()} de ${comp.slice(0, 4)}`;

/** O que cada serviço marcado na ficha inclui (serviços habituais e permanentes). */
export const DESCRICAO_SERVICOS: Record<ServicoHonorario, string> = {
  contabil:
    "Contabilidade: escrituração contábil conforme as Normas Brasileiras de Contabilidade, com balancetes, Balanço Patrimonial e Demonstração do Resultado do Exercício anuais, livros Diário e Razão e, quando obrigatórias, a ECD e a ECF.",
  fiscal:
    "Fiscal: escrituração fiscal, apuração dos tributos devidos no regime da CONTRATANTE (federais, estaduais e municipais), emissão das guias de recolhimento e entrega das obrigações acessórias exigidas para esse regime.",
  folha:
    "Folha de pagamento: folha mensal e pró-labore, admissões, férias, 13º salário e rescisões, guias de INSS, FGTS e IRRF, eSocial, DCTFWeb e FGTS Digital, e informes de rendimentos.",
  societario:
    "Societário: alterações contratuais e atos de rotina perante a Junta Comercial, a Receita Federal, o Estado e o Município, e a manutenção das inscrições cadastrais.",
  irpf: "Imposto de renda dos sócios: declaração anual do Imposto de Renda Pessoa Física dos sócios da CONTRATANTE.",
  bpo_financeiro:
    "Rotinas financeiras (BPO): organização das contas a pagar e a receber, conciliação bancária e relatórios gerenciais, a partir dos documentos e extratos enviados pela CONTRATANTE.",
  consultoria: "Consultoria: orientação contábil e tributária sobre as atividades da CONTRATANTE, incluindo a análise anual do regime tributário.",
  outros: "Outros serviços habituais acordados entre as partes e descritos em cláusula adicional ou aditivo.",
};

/** Serviços eventuais (fora da mensalidade): só os que não foram marcados como incluídos. */
function servicosEventuais(servicos: string[]) {
  const lista = [
    "abertura, transformação ou baixa de empresas",
    ...(servicos.includes("societario") ? [] : ["alterações contratuais e atos societários"]),
    ...(servicos.includes("irpf") ? [] : ["declarações de imposto de renda de pessoas físicas"]),
    "certidões, parcelamentos e regularizações de débitos",
    "retificações causadas por informações ou documentos entregues fora do prazo ou com erro",
    "atendimento a fiscalizações e perícias",
    "laudos, declarações e demonstrações extraordinárias",
  ];
  return lista.join("; ");
}

export function identificacaoPartes(p: PartesContrato) {
  const e = p.escritorio;
  const resp = e.contador_nome ? `, neste ato por seu responsável técnico ${e.contador_nome}${e.contador_crc ? `, ${e.contador_crc.replace(/^CRC\s*/i, "CRC ")}` : ""}` : "";
  return [
    `CONTRATADA: ${e.razao_social}${e.nome_fantasia ? ` (${e.nome_fantasia})` : ""}, inscrita no CNPJ sob o nº ${formatarDocumento(e.cnpj)}${e.endereco ? `, com sede em ${e.endereco}` : ""}${resp}.`,
    `CONTRATANTE: ${p.cliente.razao_social}, inscrita no ${p.cliente.documento.replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ"} sob o nº ${formatarDocumento(p.cliente.documento)}${p.cliente.endereco ? `, com sede em ${p.cliente.endereco}` : ""}, neste ato representada por quem assina este instrumento.`,
  ];
}

function clausulaHonorarios(c: CondicoesContrato): Clausula {
  const venc =
    c.competencia_referencia === "mes_anterior"
      ? `até o dia ${c.dia_vencimento} do mês seguinte ao da prestação dos serviços`
      : `até o dia ${c.dia_vencimento} do próprio mês da prestação dos serviços`;
  const paragrafos = [
    `Pelos serviços habituais da Cláusula Primeira, a CONTRATANTE pagará à CONTRATADA honorários mensais de ${moeda(c.valor_mensal)}, com vencimento ${venc}.`,
    "O pagamento será feito por Pix, pelos dados da cobrança enviada pela CONTRATADA por meio do portal, e-mail ou WhatsApp, ou por outro meio que a CONTRATADA indicar por escrito. O recibo de cada pagamento fica disponível no portal.",
  ];
  if (c.funcionarios_inclusos !== null && c.valor_funcionario_extra) {
    paragrafos.push(
      `Os honorários mensais incluem até ${c.funcionarios_inclusos} empregado(s) na folha de pagamento. Cada empregado acima desse número, no mês, acrescenta ${moeda(c.valor_funcionario_extra)} aos honorários do mês.`,
    );
  }
  if (c.notas_inclusas !== null && c.valor_nota_extra) {
    paragrafos.push(
      `Os honorários mensais incluem até ${c.notas_inclusas} nota(s) fiscal(is) por mês, de entrada e de saída. Cada nota acima desse número acrescenta ${moeda(c.valor_nota_extra)} aos honorários do mês.`,
    );
  }
  if (c.decimo_terceiro) {
    paragrafos.push(
      `Em ${nomeMes(c.decimo_terceiro_mes).toLowerCase()} de cada ano será devido o 13º honorário, de valor igual ao dos honorários mensais, pelos serviços adicionais de encerramento do exercício (como informes, declarações anuais e o fechamento do balanço).`,
    );
  }
  paragrafos.push(
    `Os serviços eventuais (${servicosEventuais(c.servicos)}) não estão incluídos nos honorários mensais e serão cobrados à parte, conforme orçamento aprovado previamente pela CONTRATANTE.`,
  );
  if (c.cobrar_encargos) {
    paragrafos.push(
      `O atraso no pagamento sujeita a CONTRATANTE à multa de ${String(c.multa_percentual).replace(".", ",")}% e a juros de ${String(c.juros_mes_percentual).replace(".", ",")}% ao mês, proporcionais aos dias de atraso, sobre o valor em aberto.`,
    );
  }
  paragrafos.push(
    "Com honorários em atraso há mais de 60 (sessenta) dias, a CONTRATADA poderá, depois de notificar a CONTRATANTE com 10 (dez) dias de antecedência, suspender os serviços até a regularização, sem prejuízo das obrigações cujo prazo já estiver em curso.",
  );
  return { titulo: "Dos honorários e do prazo de pagamento", paragrafos };
}

function clausulaReajuste(c: CondicoesContrato): Clausula {
  const mes = c.reajuste_mes ? nomeMes(c.reajuste_mes).toLowerCase() : "do aniversário deste contrato";
  const indice = c.reajuste_indice !== "nenhum" ? INDICES_REAJUSTE[c.reajuste_indice as keyof typeof INDICES_REAJUSTE] : null;
  return {
    titulo: "Do reajuste",
    paragrafos: [
      indice
        ? `Os honorários serão reajustados a cada 12 (doze) meses, no mês de ${mes}, pela variação acumulada do ${indice} nos 12 meses anteriores, ou pelo índice que o substituir.`
        : `Os honorários serão reajustados a cada 12 (doze) meses, no mês ${c.reajuste_mes ? `de ${mes}` : mes}, no percentual acordado entre as partes ou, na falta de acordo, pela variação acumulada do IPCA nos 12 meses anteriores.`,
      "Os honorários também poderão ser revistos, por aditivo, quando houver aumento relevante do volume ou da complexidade dos serviços, como mudança de regime tributário, abertura de filiais ou novas atividades.",
    ],
  };
}

/** Contrato completo (cláusulas mínimas da Resolução CFC nº 1.590/2020). */
export function clausulasContrato(d: ConteudoContrato): Clausula[] {
  const { condicoes: c, opcoes: o } = d;
  const servicos = c.servicos.filter((s): s is ServicoHonorario => s in SERVICOS_HONORARIOS);
  const clausulas: Clausula[] = [
    {
      titulo: "Do objeto e dos serviços",
      paragrafos: [
        "O objeto deste contrato é a prestação, pela CONTRATADA, dos seguintes serviços profissionais contábeis habituais e permanentes à CONTRATANTE:",
        ...servicos.map((s, i) => `${String.fromCharCode(97 + i)}) ${DESCRICAO_SERVICOS[s]}`),
        "Os serviços são executados com base nos documentos e informações entregues pela CONTRATANTE, e a troca de documentos, guias, relatórios e mensagens acontece pelo portal da CONTRATADA.",
        "Serviços não listados acima são eventuais e dependem de orçamento aprovado pela CONTRATANTE (Cláusula Quarta).",
      ],
    },
    {
      titulo: "Das obrigações da contratante",
      paragrafos: [
        `Entregar à CONTRATADA, pelo portal, até o dia ${o.dia_documentos} do mês seguinte, todos os documentos do mês: notas fiscais de entrada e de saída, extratos bancários, comprovantes de despesas e receitas e as informações da folha de pagamento (admissões, férias, faltas, horas extras e desligamentos).`,
        "Comunicar com pelo menos 5 (cinco) dias úteis de antecedência as admissões e, logo que decididos, os desligamentos de empregados, além de qualquer mudança de endereço, atividade, sócios ou capital.",
        "Responder pela veracidade, integridade e licitude dos documentos e informações entregues, e guardar os originais pelos prazos legais.",
        "Pagar nos vencimentos os tributos, contribuições e guias apurados, que são de sua responsabilidade, e os honorários deste contrato.",
        "Entregar anualmente à CONTRATADA a Carta de Responsabilidade da Administração, nos termos da ITG 1000 e da Resolução CFC nº 1.590/2020, para o encerramento do exercício.",
        "Não exigir da CONTRATADA a prática de atos contrários à lei, às Normas Brasileiras de Contabilidade ou ao Código de Ética Profissional do Contador.",
      ],
    },
    {
      titulo: "Das obrigações da contratada",
      paragrafos: [
        "Executar os serviços com zelo, diligência e competência técnica, conforme as Normas Brasileiras de Contabilidade e o Código de Ética Profissional do Contador, cumprindo os prazos legais das obrigações quando os documentos forem entregues no prazo da cláusula anterior.",
        "Manter sigilo sobre as informações da CONTRATANTE, salvo quando a lei obrigar a informá-las às autoridades.",
        "Guardar com segurança os documentos e arquivos recebidos enquanto durar este contrato e orientar a CONTRATANTE sobre a legislação aplicável aos serviços contratados.",
        "A responsabilidade da CONTRATADA limita-se aos serviços contratados e se apoia na veracidade dos documentos e informações recebidos. Multas e encargos causados por atraso ou erro nas informações da CONTRATANTE são de responsabilidade desta.",
      ],
    },
    clausulaHonorarios(c),
    clausulaReajuste(c),
    {
      titulo: "Da duração",
      paragrafos: [`Este contrato vale por prazo indeterminado, a partir da competência de ${mesAno(c.inicio)}.`],
    },
    {
      titulo: "Do aditamento",
      paragrafos: [
        "Qualquer mudança nos serviços, nos honorários ou nas condições deste contrato será feita por termo aditivo assinado pelas partes, inclusive de forma eletrônica pelo portal.",
      ],
    },
    {
      titulo: "Da rescisão",
      paragrafos: [
        `Qualquer das partes pode encerrar este contrato, sem multa, mediante aviso prévio por escrito de ${o.aviso_previo_dias} (${valorPorExtensoInteiro(o.aviso_previo_dias)}) dias, enviado pelo portal ou por e-mail. Durante o aviso prévio, os serviços e os honorários continuam normalmente.`,
        "O encerramento será formalizado por distrato, que tratará da cessação das responsabilidades, da devolução dos livros, documentos e arquivos e das obrigações acessórias das competências em que este contrato esteve em vigor, conforme os arts. 6º a 10 da Resolução CFC nº 1.590/2020.",
        "O descumprimento das obrigações deste contrato permite à parte prejudicada encerrá-lo imediatamente, por notificação escrita, sem prejuízo dos honorários devidos até a data.",
      ],
    },
    {
      titulo: "Da Lei nº 9.613/1998 (prevenção à lavagem de dinheiro)",
      paragrafos: [
        "A CONTRATANTE declara estar ciente de que a CONTRATADA, nos termos da Lei nº 9.613/1998 e das normas do Conselho Federal de Contabilidade, é obrigada a comunicar ao Conselho de Controle de Atividades Financeiras (COAF) as operações e propostas de operações que se enquadrem nas hipóteses previstas, sem dar ciência à CONTRATANTE, e que essa comunicação não caracteriza quebra de sigilo nem gera responsabilidade para a CONTRATADA.",
      ],
    },
    {
      titulo: "Da proteção de dados pessoais",
      paragrafos: [
        "As partes cumprirão a Lei nº 13.709/2018 (LGPD). A CONTRATADA tratará os dados pessoais da CONTRATANTE, de seus sócios e empregados somente para executar este contrato e cumprir obrigações legais e regulatórias, com medidas de segurança adequadas, e não os usará para outros fins, inclusive para treinamento de inteligência artificial.",
        "Os dados serão compartilhados apenas com órgãos públicos, quando a lei exigir, e com os serviços necessários à execução do contrato (hospedagem do portal, e-mail e mensagens), e serão guardados pelos prazos legais.",
      ],
    },
    {
      titulo: "Das comunicações e da assinatura eletrônica",
      paragrafos: [
        "O portal da CONTRATADA é o meio oficial de troca de documentos e comunicações entre as partes, sem prejuízo do e-mail e do WhatsApp cadastrados.",
        "As partes reconhecem como válida a assinatura deste contrato e de seus aditivos por meio eletrônico, pelo portal, com identificação de quem assina, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001 e da Lei nº 14.063/2020.",
      ],
    },
  ];
  if (o.adicional?.trim()) clausulas.push({ titulo: "Disposições adicionais", paragrafos: o.adicional.trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) });
  clausulas.push({
    titulo: "Do foro",
    paragrafos: [`Fica eleito o foro da comarca de ${o.foro} para resolver as questões deste contrato, com renúncia de qualquer outro.`],
  });
  return clausulas;
}

function valorPorExtensoInteiro(n: number) {
  return valorPorExtenso(n).replace(/\s*reais?$/i, "").replace(/^um real$/i, "um");
}

/** O que mudou entre o contrato assinado e a ficha atual (para o aditivo). */
export function mudancasDaFicha(antes: CondicoesContrato, depois: CondicoesContrato): string[] {
  const m: string[] = [];
  if (Number(antes.valor_mensal) !== Number(depois.valor_mensal)) m.push(`Os honorários mensais passam de ${moeda(antes.valor_mensal)} para ${moeda(depois.valor_mensal)}.`);
  if (antes.dia_vencimento !== depois.dia_vencimento) m.push(`O vencimento passa do dia ${antes.dia_vencimento} para o dia ${depois.dia_vencimento}.`);
  const nome = (s: string) => SERVICOS_HONORARIOS[s as ServicoHonorario] ?? s;
  const incluidos = depois.servicos.filter((s) => !antes.servicos.includes(s));
  const retirados = antes.servicos.filter((s) => !depois.servicos.includes(s));
  for (const s of incluidos) m.push(`Passa a fazer parte dos serviços habituais: ${DESCRICAO_SERVICOS[s as ServicoHonorario] ?? nome(s)}`);
  for (const s of retirados) m.push(`Deixa de fazer parte dos serviços habituais: ${nome(s)}.`);
  const func = (c: CondicoesContrato) => (c.funcionarios_inclusos !== null && c.valor_funcionario_extra ? `${c.funcionarios_inclusos}|${c.valor_funcionario_extra}` : "");
  if (func(antes) !== func(depois)) {
    m.push(
      depois.funcionarios_inclusos !== null && depois.valor_funcionario_extra
        ? `Os honorários incluem até ${depois.funcionarios_inclusos} empregado(s); cada um a mais acrescenta ${moeda(depois.valor_funcionario_extra)} no mês.`
        : "Deixa de haver cobrança por empregado acima do limite.",
    );
  }
  const notas = (c: CondicoesContrato) => (c.notas_inclusas !== null && c.valor_nota_extra ? `${c.notas_inclusas}|${c.valor_nota_extra}` : "");
  if (notas(antes) !== notas(depois)) {
    m.push(
      depois.notas_inclusas !== null && depois.valor_nota_extra
        ? `Os honorários incluem até ${depois.notas_inclusas} nota(s) por mês; cada uma a mais acrescenta ${moeda(depois.valor_nota_extra)}.`
        : "Deixa de haver cobrança por nota acima do limite.",
    );
  }
  if (antes.decimo_terceiro !== depois.decimo_terceiro || (depois.decimo_terceiro && antes.decimo_terceiro_mes !== depois.decimo_terceiro_mes)) {
    m.push(depois.decimo_terceiro ? `Passa a ser devido o 13º honorário em ${nomeMes(depois.decimo_terceiro_mes).toLowerCase()} de cada ano.` : "Deixa de ser devido o 13º honorário.");
  }
  if (antes.reajuste_indice !== depois.reajuste_indice || antes.reajuste_mes !== depois.reajuste_mes) m.push(clausulaReajuste(depois).paragrafos[0]);
  return m;
}

export function clausulasAditivo(numeroContrato: string, mudancas: string[], vigencia: string, foro: string): Clausula[] {
  return [
    { titulo: "Do objeto", paragrafos: [`Este termo aditivo altera o contrato de prestação de serviços contábeis nº ${numeroContrato}, nos seguintes pontos:`, ...mudancas.map((t, i) => `${i + 1}. ${t}`)] },
    { titulo: "Da vigência", paragrafos: [`As alterações valem a partir da competência de ${mesAno(vigencia)}.`] },
    { titulo: "Da ratificação", paragrafos: ["Ficam mantidas todas as demais cláusulas do contrato que não conflitem com este aditivo."] },
    { titulo: "Do foro", paragrafos: [`Fica mantido o foro da comarca de ${foro}.`] },
  ];
}

export interface OpcoesDistrato {
  /** Data em que o contrato termina (AAAA-MM-DD). */
  data_fim: string;
  /** Última competência sob responsabilidade da contratada (AAAA-MM-01). */
  ultima_competencia: string;
  /** Prazo para a devolução de livros, documentos e arquivos. */
  prazo_devolucao_dias: number;
  foro: string;
}

/** Distrato conforme os arts. 6º a 10 da Resolução CFC nº 1.590/2020. */
export function clausulasDistrato(numeroContrato: string, o: OpcoesDistrato): Clausula[] {
  const fim = o.data_fim.split("-").reverse().join("/");
  return [
    {
      titulo: "Do encerramento",
      paragrafos: [
        `As partes encerram, em ${fim}, o contrato de prestação de serviços contábeis nº ${numeroContrato}. A partir dessa data cessam as responsabilidades da CONTRATADA pelos serviços contratados, ressalvado o disposto neste distrato.`,
      ],
    },
    {
      titulo: "Das obrigações das competências do contrato",
      paragrafos: [
        `A CONTRATADA cumprirá as obrigações acessórias das competências em que o contrato esteve em vigor, até a competência de ${mesAno(o.ultima_competencia)}, ainda que vençam depois desta data, e elaborará as demonstrações contábeis do período sob sua responsabilidade.`,
      ],
    },
    {
      titulo: "Da devolução dos documentos",
      paragrafos: [
        `A CONTRATADA devolverá à CONTRATANTE, em até ${o.prazo_devolucao_dias} dias, os livros, documentos e arquivos (inclusive os eletrônicos entregues ao Fisco) que estiverem sob sua guarda, pelo portal e, quando físicos, mediante protocolo. A CONTRATANTE se responsabiliza por recebê-los, diretamente ou por representante indicado por escrito.`,
        "Os arquivos continuarão disponíveis para download no portal pelo prazo acima.",
      ],
    },
    {
      titulo: "Da transição",
      paragrafos: [
        "A CONTRATADA comunicará ao novo responsável técnico indicado pela CONTRATANTE os fatos de que ele deva tomar conhecimento para a continuidade dos serviços.",
      ],
    },
    {
      titulo: "Dos honorários",
      paragrafos: ["Os honorários vencidos e os proporcionais até o encerramento continuam devidos, nas condições do contrato."],
    },
    { titulo: "Do foro", paragrafos: [`Fica mantido o foro da comarca de ${o.foro}.`] },
  ];
}
