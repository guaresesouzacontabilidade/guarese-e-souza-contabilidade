import {
  LayoutDashboard,
  PackageCheck,
  Building2,
  FileInput,
  FolderOpen,
  ListChecks,
  Wallet,
  GitCompareArrows,
  CalendarCheck,
  FileBarChart,
  MessagesSquare,
  Users,
  Settings,
  Upload,
  Home,
  ShieldCheck,
  CalendarClock,
  Calculator,
  CalendarX2,
  CalendarDays,
  ClipboardList,
  CloudDownload,
  ScanSearch,
  PiggyBank,
  CreditCard,
  FileSignature,
  Landmark,
  ReceiptText,
  Store,
  ShoppingCart,
  Boxes,
  Banknote,
  Truck,
  Route,
  Inbox,
  type LucideIcon,
} from "lucide-react";
import type { Permissao } from "@/lib/permissoes";
import { ferramentaDaRota } from "@/lib/empresas/ferramentas";

export interface ItemMenu {
  rotulo: string;
  href: string;
  icone: LucideIcon;
  exato?: boolean;
}

export interface EmpresaMenu {
  id: string;
  nome: string;
  documento: string;
  papel: string;
  permissoes: Permissao[];
  demonstracao: boolean;
  /** Gestão da loja ligada para a empresa. */
  loja: boolean;
  /** Modalidade da gestão: loja completa ou só notas e transporte. */
  modalidade: "loja" | "notas" | null;
  /** CT-e configurado pelo escritório (ligado ou em conferência). */
  cte?: boolean;
  /** Endereço da logo da empresa (rota protegida), quando cadastrada. */
  logo?: string | null;
  /** Ferramentas desligadas pelo escritório (somem do menu). */
  desligadas?: string[];
}

export interface GrupoMenu {
  /** Identificador estável (guarda o grupo aberto no menu). */
  id: string;
  rotulo: string;
  icone: LucideIcon;
  itens: ItemMenu[];
}

/** Grupos do escritório: as ferramentas que andam juntas ficam no mesmo grupo. */
export function gruposEscritorio(admin: boolean): GrupoMenu[] {
  const grupos: GrupoMenu[] = [
    { id: "visao", rotulo: "Visão geral", icone: LayoutDashboard, itens: [{ rotulo: "Visão geral", href: "/escritorio", icone: LayoutDashboard, exato: true }] },
    { id: "empresas", rotulo: "Empresas", icone: Building2, itens: [{ rotulo: "Empresas", href: "/escritorio/empresas", icone: Building2 }] },
    {
      id: "atendimento",
      rotulo: "Atendimento",
      icone: Inbox,
      itens: [
        { rotulo: "Documentos recebidos", href: "/escritorio/documentos", icone: FileInput },
        { rotulo: "Pendências", href: "/escritorio/pendencias", icone: ListChecks },
        { rotulo: "Solicitações", href: "/escritorio/solicitacoes", icone: ClipboardList },
        { rotulo: "Mensagens", href: "/escritorio/mensagens", icone: MessagesSquare },
      ],
    },
    {
      id: "prazos",
      rotulo: "Prazos",
      icone: CalendarClock,
      itens: [
        { rotulo: "Obrigações e prazos", href: "/escritorio/obrigacoes", icone: CalendarClock },
        { rotulo: "Vencimentos", href: "/escritorio/vencimentos", icone: CalendarX2 },
        { rotulo: "Fechamentos", href: "/escritorio/fechamentos", icone: CalendarCheck },
      ],
    },
    {
      id: "notas",
      rotulo: "Notas fiscais",
      icone: ReceiptText,
      itens: [
        { rotulo: "Notas automáticas", href: "/escritorio/notas-automaticas", icone: CloudDownload },
        { rotulo: "Notas de serviço emitidas", href: "/escritorio/notas-servico", icone: ReceiptText },
        { rotulo: "Notas de produto emitidas", href: "/escritorio/notas-produto", icone: PackageCheck },
        { rotulo: "CT-e emitidos", href: "/escritorio/cte", icone: Route },
      ],
    },
    {
      id: "fiscal",
      rotulo: "Fiscal",
      icone: Landmark,
      itens: [
        { rotulo: "Apuração do ICMS", href: "/escritorio/icms", icone: Landmark },
        { rotulo: "Auditor fiscal", href: "/escritorio/auditor-fiscal", icone: ScanSearch },
        { rotulo: "Maquininhas", href: "/escritorio/maquininhas", icone: CreditCard },
      ],
    },
    {
      id: "financeiro",
      rotulo: "Financeiro",
      icone: Wallet,
      itens: [
        { rotulo: "Financeiro da carteira", href: "/escritorio/financeiro", icone: Wallet },
        { rotulo: "Conciliação", href: "/escritorio/conciliacao", icone: GitCompareArrows },
        { rotulo: "Relatórios", href: "/escritorio/relatorios", icone: FileBarChart },
      ],
    },
    {
      id: "escritorio",
      rotulo: "Escritório",
      icone: Users,
      itens: [
        { rotulo: "Equipe e permissões", href: "/escritorio/equipe", icone: Users },
        ...(admin
          ? [
              { rotulo: "Configurações", href: "/escritorio/configuracoes", icone: Settings },
              { rotulo: "Auditoria", href: "/escritorio/auditoria", icone: ShieldCheck },
            ]
          : []),
      ],
    },
  ];
  return grupos;
}

/** Grupos da empresa, conforme as permissões de quem acessa (grupo sem item não aparece). */
export function gruposEmpresa(empresa: EmpresaMenu, equipe: boolean): GrupoMenu[] {
  const p = new Set(empresa.permissoes);
  const base = `/e/${empresa.id}`;
  const transporte = empresa.loja && empresa.modalidade === "notas";
  const loja: ItemMenu[] = [];
  const notas: ItemMenu[] = [];
  const documentos: ItemMenu[] = [];
  const pagamentos: ItemMenu[] = [];
  const financeiro: ItemMenu[] = [];
  const impostos: ItemMenu[] = [];
  const falar: ItemMenu[] = [];
  const configuracoes: ItemMenu[] = [];

  if (transporte) {
    if (p.has("nfe.emitir")) notas.push({ rotulo: "Ordens de carregamento", href: `${base}/loja/carregamentos`, icone: Truck });
  } else if (empresa.loja && p.has("gestao.vender")) {
    loja.push({ rotulo: "Loja", href: `${base}/loja`, icone: Store, exato: true });
    loja.push({ rotulo: "Vender", href: `${base}/loja/vender`, icone: ShoppingCart });
    loja.push({ rotulo: "Caixa do dia", href: `${base}/loja/caixa`, icone: Banknote });
    loja.push({ rotulo: "Produtos e estoque", href: `${base}/loja/produtos`, icone: Boxes });
    loja.push({ rotulo: "Vendas e orçamentos", href: `${base}/loja/vendas`, icone: ReceiptText });
  } else if (equipe && p.has("gestao.gerenciar")) {
    configuracoes.push({ rotulo: "Gestão da loja", href: `${base}/loja/configuracoes`, icone: Store });
  }
  if (p.has("nfse.emitir") || p.has("nfse.configurar")) notas.push({ rotulo: "Emitir nota de serviço", href: `${base}/notas-servico`, icone: ReceiptText });
  if (p.has("nfe.emitir") || p.has("nfe.configurar")) notas.push({ rotulo: "Emitir nota de produto", href: `${base}/notas-produto`, icone: PackageCheck });
  // CT-e: para a equipe sempre; para o cliente, quando o escritório configurou o CT-e (transportadoras)
  if (p.has("cte.configurar") || (p.has("cte.emitir") && empresa.cte)) notas.push({ rotulo: "Emitir CT-e (frete)", href: `${base}/cte`, icone: Route });
  if (p.has("certificado.gerenciar") || p.has("documentos.ver")) notas.push({ rotulo: "Notas automáticas", href: `${base}/notas-automaticas`, icone: CloudDownload });

  if (p.has("documentos.enviar")) documentos.push({ rotulo: "Enviar documentos", href: `${base}/enviar`, icone: Upload });
  if (p.has("documentos.ver")) {
    documentos.push({ rotulo: equipe ? "Documentos" : "Meus documentos", href: `${base}/documentos`, icone: FolderOpen });
    documentos.push({ rotulo: "Pendências", href: `${base}/pendencias`, icone: ListChecks });
    pagamentos.push({ rotulo: "Agenda de pagamentos", href: `${base}/agenda`, icone: CalendarDays });
    pagamentos.push({ rotulo: "Vencimentos", href: `${base}/vencimentos`, icone: CalendarX2 });
  }
  if (p.has("financeiro.ver")) financeiro.push({ rotulo: "Contas e fluxo de caixa", href: `${base}/financeiro`, icone: Wallet });
  if (p.has("maquininhas.ver")) financeiro.push({ rotulo: "Maquininhas", href: `${base}/maquininhas`, icone: CreditCard });
  if (p.has("conciliacao.executar")) financeiro.push({ rotulo: "Conciliação", href: `${base}/conciliacao`, icone: GitCompareArrows });
  if (p.has("fechamento.gerenciar")) financeiro.push({ rotulo: "Fechamento", href: `${base}/fechamento`, icone: CalendarCheck });
  if (p.has("calculos.ver")) impostos.push({ rotulo: "Cálculos e previsão", href: `${base}/calculos`, icone: Calculator });
  if (p.has("auditor.gerenciar")) impostos.push({ rotulo: "Auditor fiscal", href: `${base}/auditor-fiscal`, icone: ScanSearch });
  else if (p.has("auditor.ver")) impostos.push({ rotulo: "Economia de impostos", href: `${base}/auditor-fiscal`, icone: PiggyBank });
  if (p.has("relatorios.ver")) {
    impostos.push({ rotulo: "Relatórios", href: `${base}/relatorios`, icone: FileBarChart });
    impostos.push({ rotulo: "Declarações", href: `${base}/declaracoes`, icone: FileSignature });
  }
  if (p.has("mensagens.usar")) {
    falar.push({ rotulo: "Mensagens", href: `${base}/mensagens`, icone: MessagesSquare });
    falar.push({ rotulo: "Solicitações", href: `${base}/solicitacoes`, icone: ClipboardList });
  }
  configuracoes.unshift({ rotulo: "Configurações", href: `${base}/configuracoes`, icone: Settings });
  if (equipe) configuracoes.push({ rotulo: "Cadastro da empresa", href: `/escritorio/empresas/${empresa.id}`, icone: Building2 });

  const grupos: GrupoMenu[] = [
    { id: "inicio", rotulo: "Início", icone: Home, itens: [{ rotulo: "Início", href: base, icone: Home, exato: true }] },
    { id: "loja", rotulo: "Loja", icone: Store, itens: loja },
    { id: "notas", rotulo: transporte ? "Notas e transporte" : "Notas", icone: transporte ? Truck : ReceiptText, itens: notas },
    { id: "documentos", rotulo: "Documentos", icone: FolderOpen, itens: documentos },
    { id: "pagamentos", rotulo: "Pagamentos e prazos", icone: CalendarDays, itens: pagamentos },
    { id: "financeiro", rotulo: "Financeiro", icone: Wallet, itens: financeiro },
    { id: "impostos", rotulo: "Impostos e relatórios", icone: Calculator, itens: impostos },
    { id: "falar", rotulo: "Falar com o escritório", icone: MessagesSquare, itens: falar },
    { id: "configuracoes", rotulo: "Configurações", icone: Settings, itens: configuracoes },
  ];
  // Ferramentas desligadas pelo escritório saem do menu (as permissões delas já não valem)
  const desligadas = empresa.desligadas ?? [];
  return grupos
    .map((g) => (desligadas.length ? { ...g, itens: g.itens.filter((i) => !i.href.startsWith(base) || !ferramentaDaRota(i.href.slice(base.length), desligadas)) } : g))
    .filter((g) => g.itens.length > 0);
}

/** Todos os itens, na ordem dos grupos. */
export function menuEscritorio(admin: boolean): ItemMenu[] {
  return gruposEscritorio(admin).flatMap((g) => g.itens);
}

export function menuEmpresa(empresa: EmpresaMenu, equipe: boolean): ItemMenu[] {
  return gruposEmpresa(empresa, equipe).flatMap((g) => g.itens);
}

/** Grupo da página atual (o item mais específico vence: /loja/carregamentos não é /loja). */
export function grupoAtivo(caminho: string, grupos: GrupoMenu[]): GrupoMenu | null {
  let melhor: { grupo: GrupoMenu; tamanho: number } | null = null;
  for (const g of grupos) {
    for (const i of g.itens) {
      if (itemAtivo(caminho, i) && (!melhor || i.href.length > melhor.tamanho)) melhor = { grupo: g, tamanho: i.href.length };
    }
  }
  return melhor?.grupo ?? null;
}

export function itemAtivo(caminho: string, item: ItemMenu) {
  if (item.exato) return caminho === item.href;
  return caminho === item.href || caminho.startsWith(item.href + "/");
}
