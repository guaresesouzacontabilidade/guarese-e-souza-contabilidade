"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Gem,
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
import { MarcaEmpresa } from "@/components/empresas/marca-empresa";
import { Button } from "@/components/ui/button";
import { Gaveta } from "@/components/ui/dialog";
import { Menu, MenuConteudo, MenuGatilho, MenuItem, MenuRotulo, MenuSeparador, Popover, PopoverConteudo, PopoverGatilho } from "@/components/ui/menu";
import { formatarDocumento, formatarRelativo } from "@/lib/formatos";
import { ROTULO_PAPEL } from "@/lib/permissoes";
import { grupoAtivo, gruposEmpresa, gruposEscritorio, itemAtivo, type EmpresaMenu, type GrupoMenu, type ItemMenu } from "./navegacao";
import { listarNotificacoes, marcarNotificacoesLidas, type NotificacaoResumo } from "./acoes-layout";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { ConviteAvisos } from "@/components/notificacoes/avisos";
import { avisosAtivosParaUsuario, renovarAvisos } from "@/components/notificacoes/aparelho";

interface Props {
  usuario: { id: string; nome: string; email: string; tipo: "admin" | "equipe" | "cliente" };
  empresas: EmpresaMenu[];
  logoUrl: string | null;
  naoLidas: number;
  /** Chave pública das notificações no aparelho (null = desconectado). */
  chavePush: string | null;
  children: React.ReactNode;
}

const RE_EMPRESA = /^\/e\/([0-9a-f-]{36})/i;

const semInscricao = () => () => {};
const noNavegador = () => true;
const noServidor = () => false;

function lerCookieEmpresa() {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )empresa_atual=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AppShell({ usuario, empresas, logoUrl, naoLidas, chavePush, children }: Props) {
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const equipe = usuario.tipo !== "cliente";
  const idNaUrl = RE_EMPRESA.exec(caminho)?.[1] ?? null;
  // Lido apenas no navegador (no servidor não há cookie de seleção local).
  const idCookie = useSyncExternalStore(semInscricao, lerCookieEmpresa, () => null);

  useEffect(() => {
    if (idNaUrl) {
      document.cookie = `empresa_atual=${encodeURIComponent(idNaUrl)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    }
  }, [idNaUrl]);

  // Fecha o menu móvel ao trocar de página.
  const [caminhoAnterior, setCaminhoAnterior] = useState(caminho);
  if (caminho !== caminhoAnterior) {
    setCaminhoAnterior(caminho);
    setMenuAberto(false);
  }

  const empresaAtual = useMemo(() => {
    const id = idNaUrl ?? (equipe ? null : idCookie);
    return empresas.find((e) => e.id === id) ?? (equipe ? null : empresas[0] ?? null);
  }, [idNaUrl, idCookie, empresas, equipe]);

  // Grupo da página atual: as outras telas do grupo aparecem como abas no topo
  const grupoDaPagina = useMemo(() => {
    if (idNaUrl && empresaAtual) return grupoAtivo(caminho, gruposEmpresa(empresaAtual, equipe));
    if (equipe && caminho.startsWith("/escritorio")) return grupoAtivo(caminho, gruposEscritorio(usuario.tipo === "admin"));
    return null;
  }, [idNaUrl, empresaAtual, equipe, caminho, usuario.tipo]);

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
    <div className="min-h-dvh lg:pl-72">
      {/* Menu lateral fixo (computador) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-sidebar-borda bg-sidebar text-sidebar-foreground lg:flex nao-imprimir">
        {conteudoMenu}
      </aside>
      {/* Menu em gaveta (tablet e celular) */}
      <Gaveta aberto={menuAberto} aoMudar={setMenuAberto} titulo="Menu de navegação" className="bg-sidebar text-sidebar-foreground">
        <div className="flex h-full flex-col">{conteudoMenu}</div>
      </Gaveta>

      <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background/70 px-3 backdrop-blur-xl sm:px-5 nao-imprimir">
        <Button variante="fantasma" tamanho="icone" className="lg:hidden" aria-label="Abrir menu" onClick={() => setMenuAberto(true)}>
          <IconeMenu className="size-5" />
        </Button>
        <SeletorEmpresa empresas={empresas} atual={empresaAtual} equipe={equipe} caminho={caminho} />
        <div className="ml-auto flex items-center gap-1">
          <SinoNotificacoes naoLidasIniciais={naoLidas} usuarioId={usuario.id} chavePush={chavePush} />
          <AlternarTema />
          <MenuUsuario usuario={usuario} />
        </div>
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-7xl px-3 pb-24 pt-4 sm:px-5 sm:pt-6 lg:pb-10">
        {grupoDaPagina && grupoDaPagina.itens.length > 1 ? <AbasGrupo grupo={grupoDaPagina} caminho={caminho} /> : null}
        {/* A cada tela nova, os blocos entram suavemente em cascata */}
        <div key={caminho} className="cascata">
          {children}
        </div>
      </main>

      {!equipe && empresaAtual ? <NavegacaoInferior empresa={empresaAtual} caminho={caminho} abrirMenu={() => setMenuAberto(true)} /> : null}
    </div>
  );
}

function LinkMenu({ item, caminho, subitem = false }: { item: ItemMenu; caminho: string; subitem?: boolean }) {
  const ativo = itemAtivo(caminho, item);
  const Icone = item.icone;
  return (
    <Link
      href={item.href}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl border text-sm transition-[background-color,color,border-color,transform] duration-200",
        subitem ? "px-3 py-1.5" : "px-3 py-2",
        ativo
          ? "border-sidebar-ativo-borda font-semibold text-sidebar-ativo-texto [background:var(--sidebar-ativo-fundo)]"
          : "border-transparent text-sidebar-foreground/85 hover:translate-x-0.5 hover:bg-sidebar-ativo/70 hover:text-sidebar-foreground",
      )}
    >
      {subitem ? null : <Icone className="size-4 shrink-0" />}
      <span className="truncate">{item.rotulo}</span>
    </Link>
  );
}

/** Grupos do menu: o grupo da página atual fica aberto; os outros abrem com um toque. */
function GruposMenu({ grupos, caminho, prefixo }: { grupos: GrupoMenu[]; caminho: string; prefixo: string }) {
  const ativo = grupoAtivo(caminho, grupos)?.id ?? null;
  const [abertos, setAbertos] = useState<string[]>(() => (ativo ? [ativo] : []));
  // Ao entrar numa tela de outro grupo, ele abre sozinho
  const [ativoAnterior, setAtivoAnterior] = useState(ativo);
  if (ativo !== ativoAnterior) {
    setAtivoAnterior(ativo);
    if (ativo && !abertos.includes(ativo)) setAbertos([...abertos, ativo]);
  }
  return (
    <div className="space-y-0.5">
      {grupos.map((g) => {
        if (g.itens.length === 1) return <LinkMenu key={g.id} item={{ ...g.itens[0], rotulo: g.rotulo, icone: g.icone }} caminho={caminho} />;
        const aberto = abertos.includes(g.id);
        const temAtivo = g.id === ativo;
        const Icone = g.icone;
        const idLista = `menu-${prefixo}-${g.id}`;
        return (
          <div key={g.id}>
            <button
              type="button"
              aria-expanded={aberto}
              aria-controls={idLista}
              onClick={() => setAbertos(aberto ? abertos.filter((x) => x !== g.id) : [...abertos, g.id])}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-[background-color,color,border-color] duration-200",
                temAtivo && !aberto
                  ? "border-sidebar-ativo-borda font-semibold text-sidebar-ativo-texto [background:var(--sidebar-ativo-fundo)]"
                  : "border-transparent text-sidebar-foreground/85 hover:bg-sidebar-ativo/70 hover:text-sidebar-foreground",
                temAtivo && "font-semibold",
              )}
            >
              <Icone className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{g.rotulo}</span>
              <ChevronDown className={cn("size-4 shrink-0 text-sidebar-muted transition-transform duration-200", aberto && "rotate-180")} />
            </button>
            {aberto ? (
              <ul id={idLista} className="animar-entrada my-0.5 ml-[1.15rem] space-y-0.5 border-l border-sidebar-borda pl-2">
                {g.itens.map((i) => (
                  <li key={i.href}>
                    <LinkMenu item={i} caminho={caminho} subitem />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Abas do grupo no topo da página: as telas que andam juntas ficam a um toque. */
function AbasGrupo({ grupo, caminho }: { grupo: GrupoMenu; caminho: string }) {
  const Icone = grupo.icone;
  // O item mais específico é o atual (ex.: /loja/carregamentos não marca /loja)
  const atual = grupo.itens.filter((i) => itemAtivo(caminho, i)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label={`Telas de ${grupo.rotulo}`} className="-mx-3 mb-4 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 nao-imprimir">
      <ul className="flex min-w-max items-center gap-1.5">
        <li className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Icone className="size-3.5" aria-hidden /> {grupo.rotulo}
        </li>
        {grupo.itens.map((i) => {
          const ativo = i === atual;
          const ItemIcone = i.icone;
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
                  ativo ? "border-transparent bg-primary font-semibold text-primary-foreground shadow-sm" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <ItemIcone className="size-4" aria-hidden />
                {i.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
            <Logo tom="gradiente" className="h-10" />
          )}
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Menu principal">
        {equipe ? (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">Escritório</p>
            <GruposMenu grupos={gruposEscritorio(admin)} caminho={caminho} prefixo="escritorio" />
          </div>
        ) : null}
        {empresa && (!equipe || empresaNaUrl) ? (
          <div className="space-y-1">
            {/* A empresa em destaque, com a logo do cadastro (ou as iniciais) */}
            <div className="mb-2 space-y-2 rounded-xl border border-sidebar-borda bg-sidebar-ativo/40 p-2.5">
              <MarcaEmpresa nome={empresa.nome} logo={empresa.logo ?? null} tamanho="md" />
              <p className="truncate px-0.5 text-xs font-semibold text-sidebar-foreground" title={empresa.nome}>
                {equipe ? `Empresa: ${empresa.nome}` : empresa.nome}
              </p>
            </div>
            <GruposMenu grupos={gruposEmpresa(empresa, equipe)} caminho={caminho} prefixo="empresa" />
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
      <div className="flex min-w-0 items-center gap-2.5">
        <MarcaEmpresa nome={atual.nome} logo={atual.logo ?? null} />
        {/* No celular, com logo, o topo mostra só a logo (o nome já está nela e no início) */}
        <div className={cn("min-w-0", atual.logo && "hidden sm:block")}>
          <p className="truncate text-sm font-semibold text-titulo">{atual.nome}</p>
          <p className="truncate text-xs text-muted-foreground">{formatarDocumento(atual.documento)}</p>
        </div>
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
          {atual ? <MarcaEmpresa nome={atual.nome} logo={atual.logo ?? null} className="h-7 min-w-7" /> : <Building2 className="size-4 shrink-0 text-primary" />}
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
                {/* Clientes têm poucas empresas: a lista mostra a logo de cada uma */}
                {!equipe ? <MarcaEmpresa nome={e.nome} logo={e.logo ?? null} className="h-8 min-w-8" /> : null}
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

function SinoNotificacoes({ naoLidasIniciais, usuarioId, chavePush }: { naoLidasIniciais: number; usuarioId: string; chavePush: string | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<NotificacaoResumo[] | null>(null);
  const [naoLidas, setNaoLidas] = useState(naoLidasIniciais);
  // Quando a página é recarregada pelo servidor, o contador recebido prevalece.
  const [iniciaisAnteriores, setIniciaisAnteriores] = useState(naoLidasIniciais);
  if (naoLidasIniciais !== iniciaisAnteriores) {
    setIniciaisAnteriores(naoLidasIniciais);
    setNaoLidas(naoLidasIniciais);
  }

  useEffect(() => {
    // Atualiza o contador periodicamente (sem recarregar a página).
    const t = setInterval(() => {
      if (document.visibilityState === "visible") listarNotificacoes().then((r) => setNaoLidas(r.naoLidas)).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Quem ativou os avisos neste aparelho volta a recebê-los nesta sessão.
    renovarAvisos(usuarioId, chavePush).catch(() => {});
  }, [usuarioId, chavePush]);

  useEffect(() => {
    // Avisos em tempo real (a RLS do banco só entrega os da própria pessoa).
    const supabase = criarClienteNavegador();
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let ativo = true;

    const aoMudar = (mudanca: { eventType: string; new: Partial<NotificacaoResumo> }) => {
      listarNotificacoes()
        .then((r) => {
          setNaoLidas(r.naoLidas);
          setItens((atuais) => (atuais === null ? null : r.itens));
        })
        .catch(() => {});
      const n = mudanca.new;
      if (mudanca.eventType === "DELETE" || !n.titulo || n.lida_em) return;
      // Com os avisos ativos neste aparelho, o próprio sistema já mostra a notificação.
      if (document.visibilityState !== "visible" || avisosAtivosParaUsuario(usuarioId)) return;
      const link = n.link;
      toast(n.titulo, {
        id: `aviso-${n.id}`,
        description: n.corpo ?? undefined,
        action: link ? { label: "Abrir", onClick: () => router.push(link) } : undefined,
      });
    };

    const assinar = async () => {
      // O canal precisa se identificar com a sessão antes de entrar: sem isso o
      // banco recusa a assinatura (o aviso é filtrado pelas regras de acesso).
      await supabase.realtime.setAuth();
      if (!ativo) return;
      canal = supabase
        .channel(`avisos-${usuarioId}-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notificacoes", filter: `user_id=eq.${usuarioId}` }, (m) =>
          aoMudar(m as unknown as { eventType: string; new: Partial<NotificacaoResumo> }),
        )
        .subscribe();
    };
    assinar().catch(() => {});
    return () => {
      ativo = false;
      if (canal) supabase.removeChannel(canal);
    };
  }, [usuarioId, router]);

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
        <ConviteAvisos usuarioId={usuarioId} chavePublica={chavePush} aoNavegar={() => setAberto(false)} />
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
  const montado = useSyncExternalStore(semInscricao, noNavegador, noServidor);
  return (
    <Menu>
      <MenuGatilho asChild>
        <Button variante="fantasma" tamanho="icone" aria-label="Aparência do portal (clara, escura ou bronze)">
          {montado && theme === "dark" ? (
            <Moon className="size-5" />
          ) : montado && theme === "light" ? (
            <Sun className="size-5" />
          ) : montado && theme === "bronze" ? (
            <Gem className="size-5" />
          ) : (
            <Monitor className="size-5" />
          )}
        </Button>
      </MenuGatilho>
      <MenuConteudo>
        <MenuRotulo>Aparência</MenuRotulo>
        <MenuItem onSelect={() => setTheme("light")}>
          <Sun /> Clara (Luz)
        </MenuItem>
        <MenuItem onSelect={() => setTheme("dark")}>
          <Moon /> Escura (Aurora)
        </MenuItem>
        <MenuItem onSelect={() => setTheme("bronze")}>
          <Gem /> Bronze
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
        <button
          className="ml-1 flex size-9 items-center justify-center rounded-full bg-primary [background-image:var(--gradiente)] text-sm font-semibold text-[color:var(--gradiente-texto)] shadow-[var(--brilho)] transition-transform duration-200 hover:scale-105"
          aria-label="Menu do usuário"
        >
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
        <MenuItem asChild>
          <Link href="/conta">
            <UserCircle /> Minha conta e segurança
          </Link>
        </MenuItem>
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

/** Rótulos curtos das abas do rodapé no celular. */
const ABA_CURTA: Record<string, string> = {
  inicio: "Início",
  loja: "Loja",
  notas: "Notas",
  documentos: "Documentos",
  pagamentos: "Pagamentos",
  financeiro: "Financeiro",
  falar: "Escritório",
};

function NavegacaoInferior({ empresa, caminho, abrirMenu }: { empresa: EmpresaMenu; caminho: string; abrirMenu: () => void }) {
  const grupos = gruposEmpresa(empresa, false);
  // Os grupos mais usados no dia a dia; o resto fica em "Mais"
  const abas = ["inicio", "loja", "notas", "documentos", "pagamentos", "financeiro", "falar"]
    .map((id) => grupos.find((g) => g.id === id))
    .filter((g): g is GrupoMenu => Boolean(g))
    .slice(0, 4);
  if (abas.length < 2) return null;
  const ativo = grupoAtivo(caminho, grupos);
  return (
    <nav aria-label="Atalhos" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/80 backdrop-blur-xl lg:hidden nao-imprimir">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {abas.map((g) => {
          const atual = ativo?.id === g.id;
          const Icone = g.icone;
          return (
            <li key={g.id}>
              <Link
                href={g.itens[0].href}
                aria-current={atual ? "page" : undefined}
                className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", atual ? "font-semibold text-primary" : "text-muted-foreground")}
              >
                <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", atual && "bg-primary/12")}>
                  <Icone className="size-5" />
                </span>
                <span className="truncate">{ABA_CURTA[g.id] ?? g.rotulo}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button onClick={abrirMenu} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
            <span className="flex h-7 w-12 items-center justify-center">
              <MoreHorizontal className="size-5" />
            </span>
            Mais
          </button>
        </li>
      </ul>
    </nav>
  );
}
