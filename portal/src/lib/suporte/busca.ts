/**
 * Busca do suporte 24h (sem serviço externo): encontra os trechos do Guia de
 * uso e as telas do menu que respondem à pergunta, do jeito que o cliente
 * escreve ("boleto", "nf", "como pago o imposto").
 *  - texto sem acento, sem palavras vazias e com plural simplificado;
 *  - sinônimos do dia a dia levados para os nomes do portal;
 *  - pontuação BM25, com o título pesando mais que o texto.
 */
import type { EntradaGuia, Publico } from "./guia";

const VAZIAS = new Set(
  "a o e as os um uma uns umas de da do das dos em no na nos nas por pelo pela para pra pro com sem que se ao aos como onde quando qual quais quem eu meu minha meus minhas voce voces ele ela isso isto esse essa este esta aqui la ja nao sim mais menos muito pouco tem ter fazer faco faz posso pode consigo quero queria preciso precisa gostaria saber ver ou the e entao tambem so ate sobre ser estar esta estou estao foi vai vou".split(" "),
);

/** Palavras do cliente → palavras do portal. */
const SINONIMOS: Record<string, string[]> = {
  boleto: ["guia", "pagamento", "agenda"],
  darf: ["guia", "pagamento"],
  das: ["guia", "simples"],
  dae: ["guia"],
  dare: ["dare", "guia"],
  gnre: ["guia"],
  imposto: ["imposto", "guia", "calculo", "previsao"],
  impostos: ["imposto", "guia", "calculo", "previsao"],
  pagar: ["pagamento", "agenda", "guia"],
  pago: ["pagamento", "paguei"],
  paguei: ["pagamento", "paguei"],
  comprovante: ["comprovante", "pagamento", "documento"],
  nf: ["nota"],
  nota: ["nota"],
  notas: ["nota"],
  nfe: ["nota", "produto", "nfe"],
  nfse: ["nota", "servico", "nfse"],
  danfe: ["nota", "produto"],
  cupom: ["nota"],
  xml: ["xml", "nota"],
  cte: ["cte", "frete"],
  frete: ["cte", "frete"],
  login: ["entrar", "senha", "acesso"],
  senha: ["senha", "acesso"],
  entrar: ["entrar", "acesso"],
  acessar: ["acesso", "entrar"],
  usuario: ["usuario", "acesso", "convite"],
  funcionario: ["colaborador", "folha", "escala"],
  funcionarios: ["colaborador", "folha", "escala"],
  empregado: ["colaborador", "folha"],
  ferias: ["rescisao", "calculo", "colaborador"],
  demissao: ["rescisao", "calculo"],
  rescisao: ["rescisao", "calculo"],
  salario: ["folha", "colaborador"],
  holerite: ["folha", "documento"],
  extrato: ["extrato", "financeiro", "conciliacao"],
  banco: ["extrato", "conciliacao", "financeiro"],
  conta: ["conta", "financeiro"],
  contas: ["financeiro", "lancamento"],
  despesa: ["financeiro", "lancamento"],
  receita: ["financeiro", "lancamento"],
  caixa: ["caixa", "loja", "financeiro"],
  venda: ["venda", "loja", "caixa"],
  vender: ["venda", "loja", "caixa"],
  estoque: ["estoque", "produto", "loja"],
  produto: ["produto", "estoque"],
  orcamento: ["orcamento", "loja"],
  documento: ["documento", "enviar"],
  documentos: ["documento", "enviar"],
  arquivo: ["documento", "arquivo", "enviar"],
  mandar: ["enviar"],
  anexar: ["enviar", "documento"],
  certificado: ["certificado"],
  os: ["ordem", "servico", "esteira"],
  ordem: ["ordem", "servico", "esteira"],
  servico: ["servico"],
  esteira: ["esteira", "ordem"],
  gta: ["gta"],
  gado: ["gado", "gta", "nota"],
  boi: ["gado", "gta"],
  whatsapp: ["whatsapp", "aviso"],
  aviso: ["aviso", "notificacao"],
  avisos: ["aviso", "notificacao"],
  celular: ["celular", "aviso", "aplicativo"],
  app: ["aplicativo", "celular"],
  contador: ["escritorio", "mensagem", "solicitacao"],
  escritorio: ["escritorio"],
  falar: ["mensagem", "solicitacao"],
  ajuda: ["solicitacao", "mensagem"],
  pedido: ["solicitacao"],
  maquininha: ["maquininha", "cartao", "taxa"],
  cartao: ["maquininha", "cartao"],
  taxa: ["taxa", "maquininha"],
  vencimento: ["vencimento", "agenda", "prazo"],
  prazo: ["prazo", "vencimento", "agenda"],
  alvara: ["vencimento", "alvara"],
  relatorio: ["relatorio"],
  dre: ["relatorio", "dre"],
  balanco: ["relatorio", "balanco"],
  faturamento: ["faturamento", "declaracao"],
  declaracao: ["declaracao", "faturamento"],
  escala: ["escala", "turno"],
  turno: ["escala", "turno"],
  pix: ["pix", "pagamento"],
  honorario: ["honorario", "cobranca"],
  mensalidade: ["honorario", "cobranca"],
  contrato: ["contrato"],
  paciente: ["paciente", "clinica"],
  agenda: ["agenda"],
  hospede: ["hospede", "hotel", "reserva"],
  reserva: ["reserva", "hotel"],
};

export function normalizar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Plural e formas comuns viram a mesma raiz (notas → nota, emissões → emissao). */
export function raiz(p: string): string {
  if (p.length <= 3) return p;
  if (p.endsWith("oes")) return `${p.slice(0, -3)}ao`;
  if (p.endsWith("aes")) return `${p.slice(0, -3)}ao`;
  if (p.endsWith("ais")) return `${p.slice(0, -3)}al`;
  if (p.endsWith("eis")) return `${p.slice(0, -3)}el`;
  if (p.endsWith("res") && p.length > 5) return p.slice(0, -2);
  if (p.endsWith("ns")) return `${p.slice(0, -2)}m`;
  if (p.endsWith("s") && !p.endsWith("ss")) return p.slice(0, -1);
  return p;
}

export function termos(texto: string, expandir = false): string[] {
  const r: string[] = [];
  for (const p of normalizar(texto).split(" ")) {
    if (!p || VAZIAS.has(p)) continue;
    r.push(raiz(p));
    if (expandir) for (const s of SINONIMOS[p] ?? SINONIMOS[raiz(p)] ?? []) r.push(raiz(s));
  }
  return r;
}

interface Documento {
  entrada: EntradaGuia;
  freq: Map<string, number>;
  tamanho: number;
}

export class IndiceGuia {
  private docs: Documento[];
  private df = new Map<string, number>();
  private media: number;

  constructor(base: EntradaGuia[]) {
    this.docs = base.map((entrada) => {
      // O título conta três vezes
      const lista = [...termos(entrada.titulo), ...termos(entrada.titulo), ...termos(entrada.titulo), ...termos(entrada.texto)];
      const freq = new Map<string, number>();
      for (const t of lista) freq.set(t, (freq.get(t) ?? 0) + 1);
      for (const t of freq.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { entrada, freq, tamanho: lista.length };
    });
    this.media = this.docs.reduce((s, d) => s + d.tamanho, 0) / Math.max(this.docs.length, 1);
  }

  buscar(pergunta: string, publicos: Publico[], limite = 5): { entrada: EntradaGuia; pontos: number }[] {
    const consulta = [...new Set(termos(pergunta, true))];
    if (!consulta.length) return [];
    const n = this.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    const r: { entrada: EntradaGuia; pontos: number }[] = [];
    for (const d of this.docs) {
      if (!publicos.includes(d.entrada.publico)) continue;
      let pontos = 0;
      for (const t of consulta) {
        const f = d.freq.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (n - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        pontos += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * d.tamanho) / this.media));
      }
      if (pontos > 0) r.push({ entrada: d.entrada, pontos });
    }
    return r.sort((a, c) => c.pontos - a.pontos).slice(0, limite);
  }
}

export interface Atalho {
  rotulo: string;
  href: string;
  grupo: string;
}

/** Telas do menu que mais combinam com a pergunta (e com os trechos achados). */
export function atalhosParaPergunta(pergunta: string, atalhos: Atalho[], trechos: EntradaGuia[], limite = 3): Atalho[] {
  const consulta = new Set(termos(pergunta, true));
  const deTrechos = new Set(trechos.slice(0, 3).flatMap((t) => termos(t.titulo)));
  const pontos = atalhos.map((a) => {
    const palavras = new Set([...termos(a.rotulo), ...termos(a.grupo)]);
    let p = 0;
    for (const w of palavras) {
      if (consulta.has(w)) p += 3;
      if (deTrechos.has(w)) p += 1;
    }
    // Tela mais específica (rótulo mais curto) desempata
    return { a, p: p - a.rotulo.length / 1000 };
  });
  const vistos = new Set<string>();
  return pontos
    .filter((x) => x.p >= 1)
    .sort((x, y) => y.p - x.p)
    .map((x) => x.a)
    .filter((a) => (vistos.has(a.href) ? false : (vistos.add(a.href), true)))
    .slice(0, limite);
}

/** Resumo de um trecho para mostrar na tela (até ~320 letras, sem cortar palavra). */
export function resumo(texto: string, max = 320): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  return `${corte.slice(0, corte.lastIndexOf(" "))}…`;
}

/** Perguntas sugeridas conforme a tela em que a pessoa está. */
export function sugestoesDaTela(caminho: string, equipe: boolean): string[] {
  const r = caminho.replace(/^\/e\/[^/]+/, "");
  const mapa: [RegExp, string[]][] = [
    [/^\/os/, ["Como abro uma ordem de serviço?", "Como pauso uma OS por falta de material?", "Onde vejo o tempo de cada serviço?"]],
    [/^\/notas-servico/, ["Como emito uma nota de serviço?", "Como cancelo uma nota?", "Onde baixo o PDF da nota?"]],
    [/^\/notas-produto/, ["Como emito uma NF-e?", "Como faço a nota de venda de gado com GTA?", "Como corrijo uma nota (carta de correção)?"]],
    [/^\/documentos/, ["Como envio documentos ao escritório?", "Quais documentos preciso mandar todo mês?", "Como sei se o escritório recebeu?"]],
    [/^\/agenda/, ["Onde estão as guias para pagar?", "Como aviso que paguei uma guia?", "O que acontece se eu pagar atrasado?"]],
    [/^\/financeiro/, ["Como lanço uma despesa?", "Como importo o extrato do banco?", "Onde vejo o fluxo de caixa?"]],
    [/^\/loja/, ["Como abro o caixa do dia?", "Como faço um orçamento?", "Como lanço a entrada de estoque?"]],
    [/^\/calculos/, ["Como vejo a previsão de impostos?", "Como simulo uma rescisão?", "Como cadastro um funcionário?"]],
    [/^\/escritorio/, ["Como cadastro uma empresa nova?", "Como ligo uma ferramenta para um cliente?", "Como funciona o mapa da carteira?"]],
  ];
  for (const [re, perguntas] of mapa) if (re.test(r) || re.test(caminho)) return perguntas;
  return equipe
    ? ["Como ligo uma ferramenta para um cliente?", "Como gero as guias do mês?", "Como convido um cliente para o portal?"]
    : ["Como envio documentos ao escritório?", "Onde estão as guias para pagar?", "Como emito uma nota fiscal?"];
}
