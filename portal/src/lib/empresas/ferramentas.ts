import type { Permissao } from "@/lib/permissoes";

/**
 * Ferramentas que o escritório liga e desliga em cada empresa (Cadastro da
 * empresa → Ferramentas). A desligada some do menu, do painel e das telas da
 * empresa, para o cliente e para a equipe; os dados e as configurações ficam
 * guardados. Documentos, pendências, mensagens e configurações são sempre
 * ligados; a loja tem a própria chave (Gestão da loja).
 */
export const FERRAMENTAS = [
  { chave: "nfse", grupo: "Notas fiscais", rotulo: "Emitir nota de serviço (NFS-e)", rotas: ["/notas-servico"], permissoes: ["nfse.emitir", "nfse.configurar"] },
  {
    chave: "nfe",
    grupo: "Notas fiscais",
    rotulo: "Emitir nota de produto (NF-e)",
    descricao: "Leva junto a NF-e na venda da loja e as ordens de carregamento.",
    rotas: ["/notas-produto", "/loja/carregamentos"],
    permissoes: ["nfe.emitir", "nfe.configurar"],
  },
  { chave: "cte", grupo: "Notas fiscais", rotulo: "Emitir CT-e (frete)", rotas: ["/cte"], permissoes: ["cte.emitir", "cte.configurar"] },
  { chave: "notas_automaticas", grupo: "Notas fiscais", rotulo: "Notas automáticas (SEFAZ e NFS-e Nacional)", rotas: ["/notas-automaticas"], permissoes: [] },
  { chave: "agenda", grupo: "Pagamentos e prazos", rotulo: "Agenda de pagamentos", rotas: ["/agenda"], permissoes: [] },
  { chave: "vencimentos", grupo: "Pagamentos e prazos", rotulo: "Vencimentos (certificado, alvarás, certidões)", rotas: ["/vencimentos"], permissoes: [] },
  {
    chave: "financeiro",
    grupo: "Financeiro",
    rotulo: "Contas e fluxo de caixa",
    rotas: ["/financeiro"],
    permissoes: ["financeiro.ver", "financeiro.editar", "financeiro.importar"],
  },
  { chave: "maquininhas", grupo: "Financeiro", rotulo: "Maquininhas", rotas: ["/maquininhas"], permissoes: ["maquininhas.ver", "maquininhas.gerenciar"] },
  { chave: "conciliacao", grupo: "Financeiro", rotulo: "Conciliação bancária", rotas: ["/conciliacao"], permissoes: ["conciliacao.executar"] },
  { chave: "fechamento", grupo: "Financeiro", rotulo: "Fechamento do mês", rotas: ["/fechamento"], permissoes: ["fechamento.gerenciar", "fechamento.reabrir"] },
  {
    chave: "calculos",
    grupo: "Impostos e relatórios",
    rotulo: "Cálculos e previsão de impostos",
    rotas: ["/calculos"],
    permissoes: ["calculos.ver", "calculos.gerenciar", "colaboradores.gerenciar"],
  },
  { chave: "auditor", grupo: "Impostos e relatórios", rotulo: "Auditor fiscal (economia de impostos)", rotas: ["/auditor-fiscal"], permissoes: ["auditor.ver", "auditor.gerenciar"] },
  { chave: "relatorios", grupo: "Impostos e relatórios", rotulo: "Relatórios", rotas: ["/relatorios"], permissoes: [] },
  { chave: "declaracoes", grupo: "Impostos e relatórios", rotulo: "Declarações (faturamento)", rotas: ["/declaracoes"], permissoes: [] },
  { chave: "solicitacoes", grupo: "Atendimento", rotulo: "Solicitações ao escritório", rotas: ["/solicitacoes"], permissoes: [] },
] as const satisfies readonly { chave: string; grupo: string; rotulo: string; descricao?: string; rotas: readonly string[]; permissoes: readonly Permissao[] }[];

export type Ferramenta = (typeof FERRAMENTAS)[number]["chave"];

export const CHAVES_FERRAMENTAS: readonly string[] = FERRAMENTAS.map((f) => f.chave);

/** Permissões sem as das ferramentas desligadas (o que a pessoa vê e faz na empresa). */
export function permissoesComFerramentas(permissoes: Set<Permissao>, desligadas: readonly string[]): Set<Permissao> {
  if (!desligadas.length) return permissoes;
  const tirar = new Set<string>(FERRAMENTAS.filter((f) => desligadas.includes(f.chave)).flatMap((f) => f.permissoes));
  return new Set([...permissoes].filter((p) => !tirar.has(p)));
}

/** Ferramenta desligada a que pertence a rota da empresa (ex.: "/cte/nova"), ou null. */
export function ferramentaDaRota(rotaNaEmpresa: string, desligadas: readonly string[]): Ferramenta | null {
  for (const f of FERRAMENTAS) {
    if (!desligadas.includes(f.chave)) continue;
    if (f.rotas.some((r) => rotaNaEmpresa === r || rotaNaEmpresa.startsWith(`${r}/`))) return f.chave;
  }
  return null;
}
