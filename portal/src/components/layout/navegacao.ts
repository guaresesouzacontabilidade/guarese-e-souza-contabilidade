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
    { rotulo: "Empresas", href: "/escritorio/empresas", icone: Building2 },
    { rotulo: "Documentos recebidos", href: "/escritorio/documentos", icone: FileInput },
    { rotulo: "Pendências", href: "/escritorio/pendencias", icone: ListChecks },
    { rotulo: "Financeiro", href: "/escritorio/financeiro", icone: Wallet },
    { rotulo: "Conciliação", href: "/escritorio/conciliacao", icone: GitCompareArrows },
    { rotulo: "Fechamentos", href: "/escritorio/fechamentos", icone: CalendarCheck },
    { rotulo: "Relatórios", href: "/escritorio/relatorios", icone: FileBarChart },
    { rotulo: "Mensagens", href: "/escritorio/mensagens", icone: MessagesSquare },
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
  }
  if (p.has("financeiro.ver")) itens.push({ rotulo: "Financeiro", href: `${base}/financeiro`, icone: Wallet });
  if (p.has("conciliacao.executar")) itens.push({ rotulo: "Conciliação", href: `${base}/conciliacao`, icone: GitCompareArrows });
  if (p.has("fechamento.gerenciar")) itens.push({ rotulo: "Fechamento", href: `${base}/fechamento`, icone: CalendarCheck });
  if (p.has("relatorios.ver")) itens.push({ rotulo: "Relatórios", href: `${base}/relatorios`, icone: FileBarChart });
  if (p.has("mensagens.usar")) itens.push({ rotulo: "Mensagens", href: `${base}/mensagens`, icone: MessagesSquare });
  itens.push({ rotulo: "Configurações", href: `${base}/configuracoes`, icone: Settings });
  return itens;
}

export function itemAtivo(caminho: string, item: ItemMenu) {
  if (item.exato) return caminho === item.href;
  return caminho === item.href || caminho.startsWith(item.href + "/");
}
