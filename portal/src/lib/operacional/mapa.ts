/**
 * Mapa da carteira: transforma os números de cada etapa (função
 * operacional_mapa do banco) em situação, texto curto, explicação e o botão do
 * que fazer agora. Sem acesso ao banco: usado no servidor e no navegador.
 */
import { diasEntre } from "@/lib/competencia";
import { FUSO } from "@/lib/formatos";
import { ETAPAS_FECHAMENTO, REGIMES } from "@/lib/rotulos";

export type ChaveEtapa = "documentos" | "notas" | "extrato" | "impostos" | "obrigacoes" | "fechamento";
export type StatusEtapa = "ok" | "andamento" | "afazer" | "perto" | "atraso" | "cliente" | "na";
export type SituacaoEmpresa = "atraso" | "cliente" | "perto" | "emdia" | "fechado";

export const ETAPAS_MAPA: { chave: ChaveEtapa; nome: string; curto: string }[] = [
  { chave: "documentos", nome: "Documentos do cliente", curto: "Documentos" },
  { chave: "notas", nome: "Notas da SEFAZ", curto: "Notas" },
  { chave: "extrato", nome: "Extrato e conciliação", curto: "Extrato" },
  { chave: "impostos", nome: "Impostos e guias", curto: "Impostos" },
  { chave: "obrigacoes", nome: "Obrigações entregues", curto: "Obrigações" },
  { chave: "fechamento", nome: "Fechamento", curto: "Fechamento" },
];

export const STATUS_MAPA: Record<StatusEtapa, string> = {
  ok: "Concluído",
  andamento: "Em andamento",
  afazer: "A fazer",
  perto: "Perto do prazo",
  atraso: "Atrasado ou com erro",
  cliente: "Esperando o cliente",
  na: "Não se aplica",
};

export const SITUACOES_MAPA: Record<SituacaoEmpresa, string> = {
  atraso: "Com atraso",
  cliente: "Esperando o cliente",
  perto: "Perto do prazo",
  emdia: "Em dia",
  fechado: "Mês fechado",
};

/** Ordem de urgência (menor = mais urgente). */
export const PESO_SITUACAO: Record<SituacaoEmpresa, number> = { atraso: 0, cliente: 1, perto: 2, emdia: 3, fechado: 4 };
export const PESO_STATUS: Partial<Record<StatusEtapa, number>> = { atraso: 0, cliente: 1, perto: 2 };

/** Faltando até esta quantidade de dias, o prazo fica "perto". */
export const DIAS_PERTO = 3;

// ---------------------------------------------------------------- dados do banco
interface DadosTarefas {
  total: number;
  ok: number;
  cliente: number;
  revisao: number;
  andamento: number;
  atrasadas: number;
  prazo: string | null;
  prazo_nome: string | null;
  tarde: boolean;
}
export interface Marcacao {
  situacao: "concluida" | "nao_se_aplica";
  todas: boolean;
  observacao: string | null;
  por: string | null;
  em: string;
}
export interface DadosMapa {
  documentos: { total: number; ok: number; cliente: number; atrasados: number; conferir: number; prazo: string | null; faltam: string[]; tarde: boolean };
  notas: { docs: number; sem_xml: number; auto: "sem" | "ativa" | "pausada" | "erro" | "certificado_vencido"; erro: string | null };
  extrato: { contas: number; movimentos: number; pendentes: number; contas_sem_extrato: number };
  impostos: DadosTarefas;
  obrigacoes: DadosTarefas;
  fechamento: { status: "aberta" | "em_fechamento" | "fechada"; fechada_em: string | null; fechada_por: string | null; etapa: string | null; pendencias: number };
  marcacoes: Partial<Record<ChaveEtapa, Marcacao>>;
}

export interface AcaoEtapa {
  rotulo: string;
  href?: string;
  /** "cobrar": manda o lembrete das pendências ao cliente (portal, e-mail e WhatsApp, se ligado). */
  tipo?: "cobrar";
}

export interface EtapaCalculada {
  chave: ChaveEtapa;
  nome: string;
  curto: string;
  status: StatusEtapa;
  texto: string;
  detalhe: string;
  prazo: string | null;
  /** Feita (ou ainda pendente) depois do prazo: usado no histórico dos meses. */
  tarde: boolean;
  marcacao: Marcacao | null;
  acao: AcaoEtapa | null;
  acaoSecundaria: AcaoEtapa | null;
}

export interface ContextoMapa {
  empresaId: string;
  competencia: string;
  hoje: string;
  competenciaAtual: string;
}

// ---------------------------------------------------------------- textos
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** "20/11" */
export function diaMes(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(new Date(iso));
}
function quando(dias: number): string {
  if (dias < 0) return dias === -1 ? "ontem" : `há ${-dias} dias`;
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}
const atrasou = (dias: number) => `Atrasou ${plural(Math.max(1, dias), "dia", "dias")}`;

interface Parcial {
  status: StatusEtapa;
  texto: string;
  detalhe: string;
  prazo?: string | null;
  acao?: AcaoEtapa | null;
  acaoSecundaria?: AcaoEtapa | null;
}

function links(ctx: ContextoMapa) {
  const comp = ctx.competencia.slice(0, 7);
  const e = ctx.empresaId;
  return {
    pendencias: `/e/${e}/pendencias?competencia=${comp}`,
    conferir: `/e/${e}/documentos?competencia=${comp}&conferir=1`,
    notas: `/e/${e}/notas-automaticas`,
    conciliacao: `/e/${e}/conciliacao`,
    importarExtrato: `/e/${e}/financeiro/importar`,
    tarefas: `/escritorio/obrigacoes/tarefas?empresa=${e}&competencia=${comp}`,
    entregas: `/escritorio/obrigacoes/tarefas?empresa=${e}&competencia=${comp}&etapa=entrega`,
    fechamento: `/e/${e}/fechamento?competencia=${comp}`,
  };
}

function documentos(d: DadosMapa["documentos"], ctx: ContextoMapa): Parcial {
  const l = links(ctx);
  const ver = { rotulo: "Ver as pendências do mês", href: l.pendencias };
  if (d.total === 0) {
    return { status: "afazer", texto: "Sem checklist", detalhe: "O checklist de documentos do mês ainda não foi gerado para esta empresa.", acao: ver };
  }
  const pendentes = d.cliente + d.atrasados;
  const faltam = d.faltam.join(", ") + (pendentes > d.faltam.length ? " e outros" : "");
  const cobrar: AcaoEtapa = { rotulo: "Cobrar o cliente agora", tipo: "cobrar" };
  if (d.atrasados > 0 && d.prazo) {
    return {
      status: "atraso",
      texto: atrasou(diasEntre(d.prazo, ctx.hoje)),
      detalhe: `Faltam: ${faltam}. O prazo era ${diaMes(d.prazo)}.`,
      prazo: d.prazo,
      acao: cobrar,
      acaoSecundaria: ver,
    };
  }
  if (d.cliente > 0 && d.prazo) {
    const dias = diasEntre(ctx.hoje, d.prazo);
    return {
      status: dias <= DIAS_PERTO ? "perto" : "cliente",
      texto: `Faltam ${plural(pendentes, "doc", "docs")}`,
      detalhe: `Esperando o cliente mandar: ${faltam}. Prazo: ${diaMes(d.prazo)} (${quando(dias)}).`,
      prazo: d.prazo,
      acao: cobrar,
      acaoSecundaria: ver,
    };
  }
  if (d.conferir > 0) {
    return {
      status: "andamento",
      texto: `${d.conferir} p/ conferir`,
      detalhe: `O cliente mandou ${plural(d.conferir, "documento", "documentos")}; falta a equipe conferir.`,
      acao: { rotulo: "Conferir os documentos", href: l.conferir },
      acaoSecundaria: ver,
    };
  }
  return { status: "ok", texto: "Recebidos", detalhe: `Os ${plural(d.total, "documento obrigatório", "documentos obrigatórios")} do mês foram conferidos.`, acao: ver };
}

function notas(n: DadosMapa["notas"], ctx: ContextoMapa): Parcial {
  const abrir = { rotulo: "Abrir as notas automáticas", href: links(ctx).notas };
  const mesAtual = ctx.competencia === ctx.competenciaAtual;
  if (n.auto === "certificado_vencido") {
    return { status: "atraso", texto: "Certificado vencido", detalhe: "O certificado digital venceu e a busca automática de notas parou. Cadastre o certificado novo.", acao: abrir };
  }
  if (n.auto === "erro") {
    return { status: "atraso", texto: "Busca com erro", detalhe: `A busca automática de notas está falhando${n.erro ? `: ${n.erro}` : "."}`, acao: abrir };
  }
  if (n.sem_xml > 0) {
    return {
      status: "andamento",
      texto: `${n.sem_xml} sem XML`,
      detalhe: `${plural(n.sem_xml, "nota de compra chegou", "notas de compra chegaram")} só como resumo da SEFAZ. Peça o XML completo (ciência da operação) em Notas automáticas.`,
      acao: { rotulo: "Pedir os XML que faltam", href: abrir.href },
    };
  }
  if (n.docs > 0) {
    const texto = plural(n.docs, "nota", "notas");
    return mesAtual
      ? { status: "andamento", texto, detalhe: "O mês ainda não acabou; as notas continuam chegando.", acao: abrir }
      : { status: "ok", texto, detalhe: `${texto} do mês no portal (entrada, saída, serviço e transporte).`, acao: abrir };
  }
  if (n.auto === "pausada") {
    return { status: "afazer", texto: "Busca pausada", detalhe: "A busca automática está pausada e não há notas do mês no portal.", acao: abrir };
  }
  if (n.auto === "ativa") {
    return mesAtual
      ? { status: "andamento", texto: "Sem notas ainda", detalhe: "A busca automática está ligada; as notas do mês ainda não chegaram.", acao: abrir }
      : { status: "ok", texto: "Sem notas", detalhe: "A busca automática está ligada e não encontrou notas neste mês.", acao: abrir };
  }
  return {
    status: "afazer",
    texto: "Sem notas",
    detalhe: "Nenhuma nota do mês no portal e a busca automática não está ligada. Peça os XML ao cliente ou ligue a busca automática.",
    acao: abrir,
  };
}

function extrato(x: DadosMapa["extrato"], ctx: ContextoMapa): Parcial {
  const l = links(ctx);
  const abrir = { rotulo: "Abrir a conciliação", href: l.conciliacao };
  const importar = { rotulo: "Importar o extrato", href: l.importarExtrato };
  if (x.contas === 0 && x.movimentos === 0) {
    return { status: "na", texto: "Sem conta", detalhe: "A empresa não tem conta bancária cadastrada no Financeiro.", acao: null };
  }
  if (x.movimentos === 0) {
    return {
      status: "afazer",
      texto: "Sem extrato",
      detalhe: `Nenhum extrato do mês foi importado (${plural(x.contas, "conta bancária", "contas bancárias")}).`,
      acao: importar,
    };
  }
  const semExtrato = x.contas_sem_extrato > 0 ? ` Falta o extrato de ${plural(x.contas_sem_extrato, "conta", "contas")}.` : "";
  if (x.pendentes > 0) {
    return {
      status: "andamento",
      texto: `Faltam ${x.pendentes}`,
      detalhe: `${plural(x.pendentes, "lançamento", "lançamentos")} do extrato ainda sem conciliar.${semExtrato}`,
      acao: abrir,
      acaoSecundaria: x.contas_sem_extrato > 0 ? importar : null,
    };
  }
  if (x.contas_sem_extrato > 0) {
    return { status: "andamento", texto: "Falta extrato", detalhe: semExtrato.trim(), acao: importar, acaoSecundaria: abrir };
  }
  return { status: "ok", texto: "Conciliado", detalhe: `Os ${plural(x.movimentos, "lançamento", "lançamentos")} do mês estão conciliados.`, acao: abrir };
}

function tarefas(t: DadosTarefas, tipo: "impostos" | "obrigacoes", ctx: ContextoMapa): Parcial {
  const l = links(ctx);
  const acao = tipo === "impostos" ? { rotulo: "Abrir as tarefas de impostos", href: l.tarefas } : { rotulo: "Abrir as obrigações", href: l.entregas };
  if (t.total === 0) {
    return {
      status: "na",
      texto: "Sem tarefas",
      detalhe:
        tipo === "impostos"
          ? "Nenhuma tarefa de impostos neste mês no módulo de Obrigações."
          : "Nenhuma obrigação para entregar neste mês no módulo de Obrigações.",
      acao,
    };
  }
  const falta = t.total - t.ok;
  if (falta <= 0) {
    return tipo === "impostos"
      ? { status: "ok", texto: "Guias enviadas", detalhe: `Impostos apurados e guias enviadas (${plural(t.total, "tarefa", "tarefas")}).`, acao }
      : { status: "ok", texto: `Entregues ${t.total}/${t.total}`, detalhe: `${t.total === 1 ? "A obrigação do mês foi entregue" : `As ${t.total} obrigações do mês foram entregues`}.`, acao };
  }
  const proximo = t.prazo ? `${t.prazo_nome ? `${t.prazo_nome}, ` : ""}${diaMes(t.prazo)}` : "";
  if (t.atrasadas > 0 && t.prazo) {
    return {
      status: "atraso",
      texto: atrasou(diasEntre(t.prazo, ctx.hoje)),
      detalhe: `${plural(t.atrasadas, "tarefa passou", "tarefas passaram")} do prazo (${proximo}). Faltam ${falta} de ${t.total}.`,
      prazo: t.prazo,
      acao,
    };
  }
  if (t.cliente > 0) {
    return {
      status: "cliente",
      texto: "Com o cliente",
      detalhe: `${plural(t.cliente, "tarefa esperando", "tarefas esperando")} o cliente.${proximo ? ` Próximo prazo: ${proximo}.` : ""}`,
      prazo: t.prazo,
      acao,
    };
  }
  const dias = t.prazo ? diasEntre(ctx.hoje, t.prazo) : null;
  if (t.prazo && dias !== null && dias <= DIAS_PERTO) {
    return {
      status: "perto",
      texto: `Vence ${diaMes(t.prazo)}`,
      detalhe: `${t.prazo_nome ?? "O próximo prazo"} vence ${quando(dias)} (${diaMes(t.prazo)}). Faltam ${falta} de ${t.total}.`,
      prazo: t.prazo,
      acao,
    };
  }
  if (t.revisao > 0 && t.revisao === falta) {
    return { status: "andamento", texto: "Em revisão", detalhe: `${plural(t.revisao, "tarefa esperando", "tarefas esperando")} a revisão.`, prazo: t.prazo, acao };
  }
  const resto = `Faltam ${falta} de ${t.total}.${proximo ? ` Próximo prazo: ${proximo}.` : ""}`;
  if (t.ok > 0 || t.andamento > 0 || t.revisao > 0) {
    return { status: "andamento", texto: tipo === "impostos" ? `${t.ok} de ${t.total} prontas` : `Entregues ${t.ok}/${t.total}`, detalhe: resto, prazo: t.prazo, acao };
  }
  return { status: "afazer", texto: t.prazo ? `Vence ${diaMes(t.prazo)}` : "A fazer", detalhe: `Nenhuma tarefa começou. ${resto}`, prazo: t.prazo, acao };
}

function fechamento(f: DadosMapa["fechamento"], outrasProntas: boolean, ctx: ContextoMapa): Parcial {
  const href = links(ctx).fechamento;
  if (f.status === "fechada") {
    return {
      status: "ok",
      texto: "Fechado",
      detalhe: `Mês fechado${f.fechada_em ? ` em ${diaMes(f.fechada_em)}` : ""}${f.fechada_por ? ` por ${f.fechada_por}` : ""}.`,
      acao: { rotulo: "Ver o fechamento", href },
    };
  }
  if (f.status === "em_fechamento") {
    const etapa = f.etapa ? (ETAPAS_FECHAMENTO[f.etapa] ?? f.etapa) : null;
    return {
      status: "andamento",
      texto: etapa ? (etapa.length > 14 ? etapa.split(" ")[0] : etapa) : "Em andamento",
      detalhe: `Fechamento em andamento${etapa ? `, na etapa "${etapa}"` : ""}.${f.pendencias > 0 ? ` ${plural(f.pendencias, "pendência impede", "pendências impedem")} o fechamento.` : ""}`,
      acao: { rotulo: "Continuar o fechamento", href },
    };
  }
  return {
    status: "afazer",
    texto: "A fazer",
    detalhe: outrasProntas ? "As outras etapas estão prontas: dá para fechar o mês." : "O fechamento ainda não começou. O ideal é fechar depois das outras etapas.",
    acao: { rotulo: outrasProntas ? "Fechar o mês" : "Abrir o fechamento", href },
  };
}

function aplicarMarcacao(p: Parcial, m: Marcacao | undefined): Parcial {
  if (!m) return p;
  const porEm = `${m.por ? ` por ${m.por}` : ""} em ${diaMes(m.em)}`;
  const obs = m.observacao ? ` Observação: ${m.observacao}` : "";
  if (m.situacao === "nao_se_aplica") {
    return {
      ...p,
      status: "na",
      texto: "Não se aplica",
      detalhe: `Marcada como "não se aplica"${m.todas ? " em todos os meses" : " neste mês"}${porEm}.${obs}`,
      prazo: null,
    };
  }
  return {
    ...p,
    status: "ok",
    texto: "Concluído",
    detalhe: `Marcada como concluída${porEm}.${obs} (Pelos dados do portal: ${p.texto.toLowerCase()}.)`,
    prazo: null,
  };
}

/** As 6 etapas de uma empresa no mês, na ordem em que a equipe trabalha. */
export function calcularEtapas(dados: DadosMapa, ctx: ContextoMapa): EtapaCalculada[] {
  const marc = dados.marcacoes ?? {};
  const parciais: Record<ChaveEtapa, Parcial> = {
    documentos: aplicarMarcacao(documentos(dados.documentos, ctx), marc.documentos),
    notas: aplicarMarcacao(notas(dados.notas, ctx), marc.notas),
    extrato: aplicarMarcacao(extrato(dados.extrato, ctx), marc.extrato),
    impostos: aplicarMarcacao(tarefas(dados.impostos, "impostos", ctx), marc.impostos),
    obrigacoes: aplicarMarcacao(tarefas(dados.obrigacoes, "obrigacoes", ctx), marc.obrigacoes),
    fechamento: { status: "afazer", texto: "", detalhe: "" },
  };
  const outrasProntas = (["documentos", "notas", "extrato", "impostos", "obrigacoes"] as const).every((k) => parciais[k].status === "ok" || parciais[k].status === "na");
  parciais.fechamento = aplicarMarcacao(fechamento(dados.fechamento, outrasProntas, ctx), marc.fechamento);
  const tarde: Record<ChaveEtapa, boolean> = {
    documentos: dados.documentos.tarde,
    notas: false,
    extrato: false,
    impostos: dados.impostos.tarde,
    obrigacoes: dados.obrigacoes.tarde,
    fechamento: false,
  };
  return ETAPAS_MAPA.map(({ chave, nome, curto }) => {
    const p = parciais[chave];
    return {
      chave,
      nome,
      curto,
      status: p.status,
      texto: p.texto,
      detalhe: p.detalhe,
      prazo: p.prazo ?? null,
      tarde: tarde[chave],
      marcacao: marc[chave] ?? null,
      acao: p.acao ?? null,
      acaoSecundaria: p.acaoSecundaria ?? null,
    };
  });
}

export function situacaoDaEmpresa(etapas: Pick<EtapaCalculada, "status">[]): SituacaoEmpresa {
  const s = etapas.map((e) => e.status);
  if (s.includes("atraso")) return "atraso";
  if (s.includes("cliente")) return "cliente";
  if (s.includes("perto")) return "perto";
  if (s.every((x) => x === "ok" || x === "na")) return "fechado";
  return "emdia";
}

/** O prazo mais próximo (ou o mais atrasado) entre documentos, impostos e obrigações. */
export function proximoPrazo(dados: DadosMapa, etapas: EtapaCalculada[], hoje: string): { data: string; oque: string; tom: "atraso" | "perto" | "normal" } | null {
  const aberta = (k: ChaveEtapa) => {
    const e = etapas.find((x) => x.chave === k);
    return !!e && e.status !== "ok" && e.status !== "na";
  };
  const candidatos: { data: string; oque: string }[] = [];
  if (aberta("documentos") && dados.documentos.prazo) candidatos.push({ data: dados.documentos.prazo, oque: "Documentos do cliente" });
  if (aberta("impostos") && dados.impostos.prazo) candidatos.push({ data: dados.impostos.prazo, oque: dados.impostos.prazo_nome ?? "Impostos" });
  if (aberta("obrigacoes") && dados.obrigacoes.prazo) candidatos.push({ data: dados.obrigacoes.prazo, oque: dados.obrigacoes.prazo_nome ?? "Obrigação" });
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const c = candidatos[0];
  const dias = diasEntre(hoje, c.data);
  return { ...c, tom: dias < 0 ? "atraso" : dias <= DIAS_PERTO ? "perto" : "normal" };
}

/** O primeiro passo que falta, na ordem das etapas. */
export function proximoPasso(etapas: EtapaCalculada[]): EtapaCalculada | null {
  const urgente = etapas
    .filter((e) => PESO_STATUS[e.status] !== undefined)
    .sort((a, b) => (PESO_STATUS[a.status] ?? 9) - (PESO_STATUS[b.status] ?? 9))[0];
  return urgente ?? etapas.find((e) => e.status !== "ok" && e.status !== "na") ?? null;
}

/** Linha do mapa já calculada (o que a tela recebe). */
export interface EmpresaMapa {
  id: string;
  nome: string;
  razaoSocial: string;
  documento: string;
  regime: string;
  cidade: string | null;
  uf: string | null;
  responsavelId: string | null;
  responsavel: string | null;
  etapas: EtapaCalculada[];
  situacao: SituacaoEmpresa;
  feitas: number;
  total: number;
  prazo: { data: string; oque: string; tom: "atraso" | "perto" | "normal" } | null;
}

export interface LinhaMapaBanco {
  empresa_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  documento: string;
  regime: string | null;
  cidade: string | null;
  uf: string | null;
  responsavel_id: string | null;
  responsavel: string | null;
  dados: unknown;
}

export function montarEmpresaMapa(l: LinhaMapaBanco, competencia: string, hoje: string, competenciaAtual: string): EmpresaMapa {
  const dados = l.dados as DadosMapa;
  const etapas = calcularEtapas(dados, { empresaId: l.empresa_id, competencia, hoje, competenciaAtual });
  return {
    id: l.empresa_id,
    nome: l.nome_fantasia || l.razao_social,
    razaoSocial: l.razao_social,
    documento: l.documento,
    regime: l.regime ? (REGIMES[l.regime] ?? l.regime) : "",
    cidade: l.cidade,
    uf: l.uf,
    responsavelId: l.responsavel_id,
    responsavel: l.responsavel,
    etapas,
    situacao: situacaoDaEmpresa(etapas),
    feitas: etapas.filter((e) => e.status === "ok").length,
    total: etapas.filter((e) => e.status !== "na").length,
    prazo: proximoPrazo(dados, etapas, hoje),
  };
}
