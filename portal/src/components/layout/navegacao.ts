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
  type LucideIcon,
} from "lucide-react";
import type { Permissao } from "@/lib/permissoes";

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
}

export function menuEscritorio(admin: boolean): ItemMenu[] {
  const itens: ItemMenu[] = [
    { rotulo: "Visão geral da carteira", href: "/escritorio", icone: LayoutDashboard, exato: true },
    { rotulo: "Obrigações e prazos", href: "/escritorio/obrigacoes", icone: CalendarClock },
    { rotulo: "Empresas", href: "/escritorio/empresas", icone: Building2 },
    { rotulo: "Documentos recebidos", href: "/escritorio/documentos", icone: FileInput },
    { rotulo: "Pendências", href: "/escritorio/pendencias", icone: ListChecks },
    { rotulo: "Vencimentos", href: "/escritorio/vencimentos", icone: CalendarX2 },
    { rotulo: "Notas automáticas", href: "/escritorio/notas-automaticas", icone: CloudDownload },
    { rotulo: "Notas de serviço emitidas", href: "/escritorio/notas-servico", icone: ReceiptText },
    { rotulo: "Notas de produto emitidas", href: "/escritorio/notas-produto", icone: PackageCheck },
    { rotulo: "CT-e emitidos", href: "/escritorio/cte", icone: Route },
    { rotulo: "Apuração do ICMS", href: "/escritorio/icms", icone: Landmark },
    { rotulo: "Auditor fiscal", href: "/escritorio/auditor-fiscal", icone: ScanSearch },
    { rotulo: "Maquininhas", href: "/escritorio/maquininhas", icone: CreditCard },
    { rotulo: "Financeiro", href: "/escritorio/financeiro", icone: Wallet },
    { rotulo: "Conciliação", href: "/escritorio/conciliacao", icone: GitCompareArrows },
    { rotulo: "Fechamentos", href: "/escritorio/fechamentos", icone: CalendarCheck },
    { rotulo: "Relatórios", href: "/escritorio/relatorios", icone: FileBarChart },
    { rotulo: "Mensagens", href: "/escritorio/mensagens", icone: MessagesSquare },
    { rotulo: "Solicitações", href: "/escritorio/solicitacoes", icone: ClipboardList },
    { rotulo: "Equipe e permissões", href: "/escritorio/equipe", icone: Users },
  ];
  if (admin) {
    itens.push({ rotulo: "Configurações", href: "/escritorio/configuracoes", icone: Settings });
    itens.push({ rotulo: "Auditoria", href: "/escritorio/auditoria", icone: ShieldCheck });
  }
  return itens;
}

export function menuEmpresa(empresa: EmpresaMenu, equipe: boolean): ItemMenu[] {
  const p = new Set(empresa.permissoes);
  const base = `/e/${empresa.id}`;
  const itens: ItemMenu[] = [{ rotulo: "Visão geral", href: base, icone: Home, exato: true }];
  if (empresa.loja && empresa.modalidade === "notas") {
    if (p.has("nfe.emitir")) itens.push({ rotulo: "Ordens de carregamento", href: `${base}/loja/carregamentos`, icone: Truck });
  } else if (empresa.loja && p.has("gestao.vender")) {
    itens.push({ rotulo: "Loja", href: `${base}/loja`, icone: Store, exato: true });
    itens.push({ rotulo: "Vender", href: `${base}/loja/vender`, icone: ShoppingCart });
    itens.push({ rotulo: "Caixa do dia", href: `${base}/loja/caixa`, icone: Banknote });
    itens.push({ rotulo: "Produtos e estoque", href: `${base}/loja/produtos`, icone: Boxes });
    itens.push({ rotulo: "Vendas e orçamentos", href: `${base}/loja/vendas`, icone: ReceiptText });
  } else if (equipe && p.has("gestao.gerenciar")) {
    itens.push({ rotulo: "Gestão da loja", href: `${base}/loja/configuracoes`, icone: Store });
  }
  if (p.has("documentos.enviar")) itens.push({ rotulo: "Enviar documentos", href: `${base}/enviar`, icone: Upload });
  if (p.has("nfse.emitir") || p.has("nfse.configurar")) itens.push({ rotulo: "Emitir nota de serviço", href: `${base}/notas-servico`, icone: ReceiptText });
  if (p.has("nfe.emitir") || p.has("nfe.configurar")) itens.push({ rotulo: "Emitir nota de produto", href: `${base}/notas-produto`, icone: PackageCheck });
  // CT-e: para a equipe sempre; para o cliente, quando o escritório configurou o CT-e (transportadoras)
  if (p.has("cte.configurar") || (p.has("cte.emitir") && empresa.cte)) itens.push({ rotulo: "Emitir CT-e (frete)", href: `${base}/cte`, icone: Route });
  if (p.has("documentos.ver")) {
    itens.push({ rotulo: equipe ? "Documentos" : "Meus documentos", href: `${base}/documentos`, icone: FolderOpen });
    itens.push({ rotulo: "Pendências", href: `${base}/pendencias`, icone: ListChecks });
    itens.push({ rotulo: "Agenda de pagamentos", href: `${base}/agenda`, icone: CalendarDays });
    itens.push({ rotulo: "Vencimentos", href: `${base}/vencimentos`, icone: CalendarX2 });
  }
  if (p.has("certificado.gerenciar") || p.has("documentos.ver")) {
    itens.push({ rotulo: "Notas automáticas", href: `${base}/notas-automaticas`, icone: CloudDownload });
  }
  if (p.has("financeiro.ver")) itens.push({ rotulo: "Financeiro", href: `${base}/financeiro`, icone: Wallet });
  if (p.has("maquininhas.ver")) itens.push({ rotulo: "Maquininhas", href: `${base}/maquininhas`, icone: CreditCard });
  if (p.has("conciliacao.executar")) itens.push({ rotulo: "Conciliação", href: `${base}/conciliacao`, icone: GitCompareArrows });
  if (p.has("fechamento.gerenciar")) itens.push({ rotulo: "Fechamento", href: `${base}/fechamento`, icone: CalendarCheck });
  if (p.has("relatorios.ver")) {
    itens.push({ rotulo: "Relatórios", href: `${base}/relatorios`, icone: FileBarChart });
    itens.push({ rotulo: "Declarações", href: `${base}/declaracoes`, icone: FileSignature });
  }
  if (p.has("calculos.ver")) itens.push({ rotulo: "Cálculos", href: `${base}/calculos`, icone: Calculator });
  if (p.has("auditor.gerenciar")) itens.push({ rotulo: "Auditor fiscal", href: `${base}/auditor-fiscal`, icone: ScanSearch });
  else if (p.has("auditor.ver")) itens.push({ rotulo: "Economia de impostos", href: `${base}/auditor-fiscal`, icone: PiggyBank });
  if (p.has("mensagens.usar")) {
    itens.push({ rotulo: "Solicitações", href: `${base}/solicitacoes`, icone: ClipboardList });
    itens.push({ rotulo: "Mensagens", href: `${base}/mensagens`, icone: MessagesSquare });
  }
  itens.push({ rotulo: "Configurações", href: `${base}/configuracoes`, icone: Settings });
  return itens;
}

export function itemAtivo(caminho: string, item: ItemMenu) {
  if (item.exato) return caminho === item.href;
  return caminho === item.href || caminho.startsWith(item.href + "/");
}
