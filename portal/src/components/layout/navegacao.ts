import {
  LayoutDashboard,
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
  if (p.has("documentos.enviar")) itens.push({ rotulo: "Enviar documentos", href: `${base}/enviar`, icone: Upload });
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
