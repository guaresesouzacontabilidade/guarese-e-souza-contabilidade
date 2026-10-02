"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Menu as IconeMenu,
  Moon,
  MoreHorizontal,
  Search,
  Sun,
  UserCircle,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/marca/logo";
import { Button } from "@/components/ui/button";
import { Gaveta } from "@/components/ui/dialog";
import { Menu, MenuConteudo, MenuGatilho, MenuItem, MenuRotulo, MenuSeparador, Popover, PopoverConteudo, PopoverGatilho } from "@/components/ui/menu";
import { formatarDocumento, formatarRelativo } from "@/lib/formatos";
import { ROTULO_PAPEL } from "@/lib/permissoes";
import { itemAtivo, menuEmpresa, menuEscritorio, telaPronta, type EmpresaMenu, type ItemMenu } from "./navegacao";
import { listarNotificacoes, marcarNotificacoesLidas, type NotificacaoResumo } from "./acoes-layout";

interface Props {
  usuario: { nome: string; email: string; tipo: "admin" | "equipe" | "cliente" };
  empresas: EmpresaMenu[];
  logoUrl: string | null;
  naoLidas: number;
  children: React.ReactNode;
}

const RE_EMPRESA = /^\/e\/([0-9a-f-]{36})/i;

function lerCookieEmpresa() {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )empresa_atual=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AppShell({ usuario, empresas, logoUrl, naoLidas, children }: Props) {
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const equipe = usuario.tipo !== "cliente";
  const idNaUrl = RE_EMPRESA.exec(caminho)?.[1] ?? null;
  const [idCookie, setIdCookie] = useState<string | null>(null);

  useEffect(() => {
    setIdCookie(lerCookieEmpresa());
  }, []);

  useEffect(() => {
    if (idNaUrl) {
      document.cookie = `empresa_atual=${encodeURIComponent(idNaUrl)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
  }, [idNaUrl]);

  useEffect(() => setMenuAberto(false), [caminho]);

  const empresaAtual = useMemo(() => {
    const id = idNaUrl ?? (equipe ? null : idCookie);
    return empresas.find((e) => e.id === id) ?? (equipe ? null : empresas[0] ?? null);
  }, [idNaUrl, idCookie, empresas, equipe]);

  const conteudoMenu = (
    <MenuLateral
      equipe={equipe}
      admin={usuario.tipo === "admin"}
      empresa={empresaAtual}
      empresaNaUrl={Boolean(idNaUrl)}
      caminho={caminho}
      logoUrl={logoUrl}
    />
  );

  return (
    <div className="min-h-dvh bg-background lg:pl-72">
      {/* Menu lateral fixo (computador) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-sidebar text-sidebar-foreground lg:flex nao-imprimir">
        {conteudoMenu}
      </aside>
      {/* Menu em gaveta (tablet e celular) */}
      <Gaveta aberto={menuAberto} aoMudar={setMenuAberto} titulo="Menu de navegação" className="bg-sidebar text-sidebar-foreground">
        <div className="flex h-full flex-col">{conteudoMenu}</div>
      </Gaveta>

      <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:px-5 nao-imprimir">
        <Button variante="fantasma" tamanho="icone" className="lg:hidden" aria-label="Abrir menu" onClick={() => setMenuAberto(true)}>
          <IconeMenu className="size-5" />
        </Button>
        <SeletorEmpresa empresas={empresas} atual={empresaAtual} equipe={equipe} caminho={caminho} />
        <div className="ml-auto flex items-center gap-1">
          <SinoNotificacoes naoLidasIniciais={naoLidas} />
          <AlternarTema />
          <MenuUsuario usuario={usuario} />
        </div>
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-7xl px-3 pb-24 pt-4 sm:px-5 sm:pt-6 lg:pb-10">
        {children}
      </main>

      {!equipe && empresaAtual ? <NavegacaoInferior empresa={empresaAtual} caminho={caminho} abrirMenu={() => setMenuAberto(true)} /> : null}
    </div>
  );
}

function LinkMenu({ item, caminho }: { item: ItemMenu; caminho: string }) {
  const ativo = itemAtivo(caminho, item);
  const Icone = item.icone;
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        ativo ? "bg-sidebar-ativo font-semibold text-white dark:text-sidebar-foreground" : "text-sidebar-foreground/85 hover:bg-sidebar-ativo/60",
      )}
    >
      <Icone className="size-4 shrink-0" />
      <span className="truncate">{item.rotulo}</span>
    </Link>
  );
}

function MenuLateral({
  equipe,
  admin,
  empresa,
  empresaNaUrl,
  caminho,
  logoUrl,
}: {
  equipe: boolean;
  admin: boolean;
  empresa: EmpresaMenu | null;
  empresaNaUrl: boolean;
  caminho: string;
  logoUrl: string | null;
}) {
  return (
    <>
      <div className="flex h-16 items-center border-b border-sidebar-borda px-4">
        <Link href="/painel" className="flex items-center" aria-label="Início">
          {logoUrl ? (
            <span className="rounded-md bg-white/95 px-2 py-1">
              <Logo logoUrl={logoUrl} className="h-9" />
            </span>
          ) : (
            <Logo tom="claro" className="h-10" />
          )}
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Menu principal">
        {equipe ? (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">Escritório</p>
            {menuEscritorio(admin).map((i) => (
              <LinkMenu key={i.href} item={i} caminho={caminho} />
            ))}
          </div>
        ) : null}
        {empresa && (!equipe || empresaNaUrl) ? (
          <div className="space-y-1">
            <p className="truncate px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted" title={empresa.nome}>
              {equipe ? `Empresa: ${empresa.nome}` : empresa.nome}
            </p>
            {menuEmpresa(empresa, equipe).map((i) => (
              <LinkMenu key={i.href} item={i} caminho={caminho} />
            ))}
            {equipe ? (
              <LinkMenu item={{ rotulo: "Cadastro da empresa", href: `/escritorio/empresas/${empresa.id}`, icone: Building2 }} caminho={caminho} />
            ) : null}
          </div>
        ) : null}
      </nav>
      <div className="border-t border-sidebar-borda px-4 py-3 text-[11px] leading-snug text-sidebar-muted">
        Portal Guarese&apos;s ON
        <br />
        Documentos, contabilidade e gestão financeira em um só lugar.
      </div>
    </>
  );
}

function SeletorEmpresa({
  empresas,
  atual,
  equipe,
  caminho,
}: {
  empresas: EmpresaMenu[];
  atual: EmpresaMenu | null;
  equipe: boolean;
  caminho: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const filtradas = empresas.filter((e) => {
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return e.nome.toLowerCase().includes(t) || e.documento.includes(t.replace(/\D/g, "") || "§");
  });

  if (!equipe && empresas.length <= 1) {
    return atual ? (
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-titulo">{atual.nome}</p>
        <p className="truncate text-xs text-muted-foreground">{formatarDocumento(atual.documento)}</p>
      </div>
    ) : null;
  }

  function trocar(id: string) {
    setAberto(false);
    // Mantém a mesma seção ao trocar de empresa (ex.: /e/A/financeiro → /e/B/financeiro)
    const secao = /^\/e\/[0-9a-f-]{36}(\/[a-z-]+)?/i.exec(caminho)?.[1] ?? "";
    router.push(`/e/${id}${secao}`);
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverGatilho asChild>
        <button
          className="flex min-w-0 max-w-[60vw] items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-left hover:bg-muted sm:max-w-sm"
          aria-label="Selecionar empresa"
        >
          <Building2 className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-titulo">{atual ? atual.nome : "Selecionar empresa"}</span>
            {atual ? <span className="block truncate text-xs text-muted-foreground">{formatarDocumento(atual.documento)}</span> : null}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverGatilho>
      <PopoverConteudo align="start" className="w-96">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou CNPJ"
            className="h-8 w-full bg-transparent text-sm outline-none"
            aria-label="Buscar empresa"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox">
          {equipe ? (
            <li>
              <Link
                href="/escritorio"
                onClick={() => setAberto(false)}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted"
              >
                <Building2 className="size-4" /> Visão geral do escritório
              </Link>
            </li>
          ) : null}
          {filtradas.map((e) => (
            <li key={e.id}>
              <button
                role="option"
                aria-selected={atual?.id === e.id}
                onClick={() => trocar(e.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatarDocumento(e.documento)} · {ROTULO_PAPEL[e.papel] ?? e.papel}
                    {e.demonstracao ? " · demonstração" : ""}
                  </span>
                </span>
                {atual?.id === e.id ? <Check className="size-4 text-primary" /> : null}
              </button>
            </li>
          ))}
          {filtradas.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma empresa encontrada.</li> : null}
        </ul>
      </PopoverConteudo>
    </Popover>
  );
}

function SinoNotificacoes({ naoLidasIniciais }: { naoLidasIniciais: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<NotificacaoResumo[] | null>(null);
  const [naoLidas, setNaoLidas] = useState(naoLidasIniciais);

  useEffect(() => setNaoLidas(naoLidasIniciais), [naoLidasIniciais]);

  useEffect(() => {
    // Atualiza o contador periodicamente (sem recarregar a página).
    const t = setInterval(() => {
      if (document.visibilityState === "visible") listarNotificacoes().then((r) => setNaoLidas(r.naoLidas)).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);

  async function abrir(v: boolean) {
    setAberto(v);
    if (v) {
      const r = await listarNotificacoes();
      setItens(r.itens);
      setNaoLidas(r.naoLidas);
    }
  }

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverGatilho asChild>
        <Button variante="fantasma" tamanho="icone" aria-label={`Notificações${naoLidas ? ` (${naoLidas} não lidas)` : ""}`} className="relative">
          <Bell className="size-5" />
          {naoLidas > 0 ? (
            <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-perigo px-1 text-[10px] font-bold text-white">
              {naoLidas > 99 ? "99+" : naoLidas}
            </span>
          ) : null}
        </Button>
      </PopoverGatilho>
      <PopoverConteudo className="w-96">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          {naoLidas > 0 ? (
            <button
              className="text-xs text-primary hover:underline"
              onClick={async () => {
                await marcarNotificacoesLidas();
                setNaoLidas(0);
                setItens((l) => l?.map((n) => ({ ...n, lida_em: n.lida_em ?? new Date().toISOString() })) ?? null);
                router.refresh();
              }}
            >
              Marcar todas como lidas
            </button>
          ) : null}
        </div>
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {itens === null ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando...</li> : null}
          {itens?.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</li> : null}
          {itens?.map((n) => (
            <li key={n.id} className={cn("px-3 py-2.5", !n.lida_em && "bg-bege/50")}>
              <Link
                href={n.link ?? "/notificacoes"}
                onClick={() => {
                  setAberto(false);
                  if (!n.lida_em) marcarNotificacoesLidas([n.id]);
                }}
                className="block space-y-0.5"
              >
                <p className="text-sm font-medium leading-snug">{n.titulo}</p>
                {n.corpo ? <p className="line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">{n.corpo}</p> : null}
                <p className="text-[11px] text-muted-foreground">{formatarRelativo(n.created_at)}</p>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-border px-3 py-2 text-center">
          <Link href="/notificacoes" onClick={() => setAberto(false)} className="text-xs text-primary hover:underline">
            Ver todas
          </Link>
        </div>
      </PopoverConteudo>
    </Popover>
  );
}

function AlternarTema() {
  const { theme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  return (
    <Menu>
      <MenuGatilho asChild>
        <Button variante="fantasma" tamanho="icone" aria-label="Tema claro ou escuro">
          {montado && theme === "dark" ? <Moon className="size-5" /> : montado && theme === "light" ? <Sun className="size-5" /> : <Monitor className="size-5" />}
        </Button>
      </MenuGatilho>
      <MenuConteudo>
        <MenuRotulo>Aparência</MenuRotulo>
        <MenuItem onSelect={() => setTheme("light")}>
          <Sun /> Clara
        </MenuItem>
        <MenuItem onSelect={() => setTheme("dark")}>
          <Moon /> Escura
        </MenuItem>
        <MenuItem onSelect={() => setTheme("system")}>
          <Monitor /> Igual ao sistema
        </MenuItem>
      </MenuConteudo>
    </Menu>
  );
}

function MenuUsuario({ usuario }: { usuario: Props["usuario"] }) {
  const iniciais = usuario.nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <Menu>
      <MenuGatilho asChild>
        <button className="ml-1 flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-label="Menu do usuário">
          {iniciais || <UserCircle className="size-5" />}
        </button>
      </MenuGatilho>
      <MenuConteudo className="w-64">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold">{usuario.nome}</p>
          <p className="truncate text-xs text-muted-foreground">{usuario.email}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{ROTULO_PAPEL[usuario.tipo]}</p>
        </div>
        <MenuSeparador />
        {telaPronta("/conta") ? (
          <MenuItem asChild>
            <Link href="/conta">
              <UserCircle /> Minha conta e segurança
            </Link>
          </MenuItem>
        ) : null}
        <MenuItem asChild>
          <Link href="/notificacoes">
            <Bell /> Notificações
          </Link>
        </MenuItem>
        <MenuSeparador />
        <form action="/auth/sair" method="post">
          <button type="submit" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-perigo hover:bg-muted [&_svg]:size-4">
            <LogOut /> Sair
          </button>
        </form>
      </MenuConteudo>
    </Menu>
  );
}

function NavegacaoInferior({ empresa, caminho, abrirMenu }: { empresa: EmpresaMenu; caminho: string; abrirMenu: () => void }) {
  const p = new Set(empresa.permissoes);
  const base = `/e/${empresa.id}`;
  const itens = menuEmpresa(empresa, false).filter((i) =>
    [base, `${base}/enviar`, `${base}/pendencias`, `${base}/financeiro`].includes(i.href),
  );
  if (!p.has("documentos.enviar") && itens.length < 2) return null;
  return (
    <nav aria-label="Atalhos" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur lg:hidden nao-imprimir">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {itens.slice(0, 4).map((i) => {
          const ativo = itemAtivo(caminho, i);
          const Icone = i.icone;
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={ativo ? "page" : undefined}
                className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", ativo ? "font-semibold text-primary" : "text-muted-foreground")}
              >
                <Icone className="size-5" />
                <span className="truncate">{i.rotulo.replace("Enviar documentos", "Enviar").replace("Visão geral", "Início")}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button onClick={abrirMenu} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
            <MoreHorizontal className="size-5" />
            Mais
          </button>
        </li>
      </ul>
    </nav>
  );
}
