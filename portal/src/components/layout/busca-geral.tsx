"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { ArrowRight, Building2, CornerDownLeft, FileText, LayoutGrid, Loader2, Search, X } from "lucide-react";
import { filtrarLista, palavrasDaBusca } from "@/lib/busca";
import { buscarNoPortal, type ResultadoBusca } from "@/lib/busca-geral";
import { formatarDocumento } from "@/lib/formatos";
import { gruposEmpresa, gruposEscritorio, type EmpresaMenu } from "./navegacao";
import { cn } from "@/lib/utils";

/** Palavras que também levam à tela (o que as pessoas costumam digitar). */
const APELIDOS: [RegExp, string][] = [
  [/\/financeiro\/pagar$/, "despesa despesas boleto boletos fornecedor pagamento pagar contas"],
  [/\/financeiro\/receber$/, "receita receitas cliente recebimento receber cobrança"],
  [/\/financeiro\/caixa$/, "banco bancos saldo conta corrente"],
  [/\/conciliacao$/, "extrato ofx banco conciliar"],
  [/\/notas-produto$/, "nfe nf-e nota fiscal produto danfe emitir nota venda"],
  [/\/notas-servico$/, "nfse nfs-e nota de serviço emitir nota"],
  [/\/cte$/, "frete conhecimento transporte"],
  [/\/loja\/vender$/, "pdv caixa venda vender cupom balcão"],
  [/\/loja\/produtos$/, "estoque mercadoria produto"],
  [/\/loja\/clientes$/, "cliente clientes cadastro"],
  [/\/loja\/fornecedores$/, "fornecedor fornecedores cadastro"],
  [/\/documentos$/, "arquivos xml pdf documento"],
  [/\/enviar$/, "upload mandar arquivo enviar"],
  [/\/calculos$/, "imposto impostos das simples previsão"],
  [/\/vencimentos$/, "guias impostos vencidos prazo"],
  [/\/escritorio\/empresas$/, "clientes carteira cnpj empresa"],
];

interface Tela {
  titulo: string;
  grupo: string;
  href: string;
  apelidos: string;
}

interface Item {
  chave: string;
  grupo: string;
  titulo: string;
  detalhe: string | null;
  href: string;
  icone: "tela" | "empresa" | "dado";
}

const MAC = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const nada = () => () => {};

/**
 * Busca geral do portal (botão "Buscar" no topo ou Ctrl+K): acha telas do
 * menu, empresas e, dentro da empresa aberta, clientes, produtos, notas,
 * vendas, documentos e contas — só o que a pessoa tem permissão de ver.
 */
export function BuscaGeral({
  empresas,
  empresaAtual,
  empresaNaUrl,
  equipe,
  admin,
  honorarios,
}: {
  empresas: EmpresaMenu[];
  empresaAtual: EmpresaMenu | null;
  empresaNaUrl: boolean;
  equipe: boolean;
  admin: boolean;
  honorarios: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const [ativo, setAtivo] = React.useState(0);
  const [dados, setDados] = React.useState<{ termo: string; itens: ResultadoBusca[] }>({ termo: "", itens: [] });
  const [buscando, setBuscando] = React.useState(false);
  const pedido = React.useRef(0);
  const espera = React.useRef<number | undefined>(undefined);
  const lista = React.useRef<HTMLUListElement>(null);
  const mac = React.useSyncExternalStore(nada, MAC, () => false);
  const listaId = React.useId();

  // Dados da empresa: a da tela (equipe) ou a do cliente
  const empresaDados = empresaAtual && (empresaNaUrl || !equipe) ? empresaAtual : null;

  const telas = React.useMemo<Tela[]>(() => {
    const grupos = [...(empresaDados ? gruposEmpresa(empresaDados, equipe) : []), ...(equipe ? gruposEscritorio(admin, honorarios) : [])];
    const vistas = new Set<string>();
    const r: Tela[] = [];
    for (const g of grupos)
      for (const i of g.itens) {
        if (vistas.has(i.href)) continue;
        vistas.add(i.href);
        const escritorio = i.href.startsWith("/escritorio");
        r.push({ titulo: i.rotulo, grupo: escritorio && empresaDados ? `Escritório · ${g.rotulo}` : g.rotulo, href: i.href, apelidos: APELIDOS.find(([re]) => re.test(i.href))?.[1] ?? "" });
      }
    return r;
  }, [empresaDados, equipe, admin, honorarios]);

  // Atalho: Ctrl+K (⌘K no Mac) ou "/" fora de um campo de texto
  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName));
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAberto((a) => !a);
      } else if (e.key === "/" && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setAberto(true);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  React.useEffect(() => () => window.clearTimeout(espera.current), []);

  function mudarBusca(v: string) {
    setBusca(v);
    setAtivo(0);
    window.clearTimeout(espera.current);
    const termo = v.trim();
    if (!empresaDados || !palavrasDaBusca(termo).length || termo.replace(/\s/g, "").length < 2) {
      pedido.current++;
      setBuscando(false);
      setDados({ termo: "", itens: [] });
      return;
    }
    setBuscando(true);
    espera.current = window.setTimeout(async () => {
      const meu = ++pedido.current;
      const itens = await buscarNoPortal(empresaDados.id, termo).catch(() => [] as ResultadoBusca[]);
      // Só vale a resposta da última busca (as anteriores chegam atrasadas)
      if (meu !== pedido.current) return;
      setDados({ termo, itens });
      setBuscando(false);
    }, 250);
  }

  function abrirOuFechar(v: boolean) {
    setAberto(v);
    if (!v) {
      window.clearTimeout(espera.current);
      pedido.current++;
      setBusca("");
      setDados({ termo: "", itens: [] });
      setBuscando(false);
      setAtivo(0);
    }
  }

  const termo = busca.trim();
  const itens: Item[] = [];
  if (termo) {
    for (const t of filtrarLista(telas, termo, (t) => [t.titulo, t.grupo, t.apelidos]).slice(0, 6))
      itens.push({ chave: `t:${t.href}`, grupo: "Telas", titulo: t.titulo, detalhe: t.grupo, href: t.href, icone: "tela" });
    if (equipe || empresas.length > 1)
      for (const e of filtrarLista(empresas, termo, (e) => [e.nome, e.documento]).slice(0, 6))
        itens.push({ chave: `e:${e.id}`, grupo: "Empresas", titulo: e.nome, detalhe: formatarDocumento(e.documento), href: `/e/${e.id}`, icone: "empresa" });
    if (dados.termo === termo)
      for (const [i, d] of dados.itens.entries()) itens.push({ chave: `d:${i}:${d.href}`, grupo: d.grupo, titulo: d.titulo, detalhe: d.detalhe, href: d.href, icone: "dado" });
  }
  const atual = Math.min(ativo, Math.max(itens.length - 1, 0));

  function ir(item: Item | undefined) {
    if (!item) return;
    abrirOuFechar(false);
    router.push(item.href as never);
  }

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!itens.length) return;
      const n = (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      setAtivo(n);
      lista.current?.querySelector(`[data-indice="${n}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      ir(itens[atual]);
    }
  }

  const Icone = { tela: LayoutGrid, empresa: Building2, dado: FileText };
  let grupoAnterior = "";

  return (
    <D.Root open={aberto} onOpenChange={abrirOuFechar}>
      <D.Trigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-md border border-border bg-card/70 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:w-56 lg:w-64"
          aria-label="Buscar no portal"
          aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        >
          <Search className="size-4 shrink-0" />
          <span className="hidden flex-1 text-left md:inline">Buscar…</span>
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-medium md:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content
          className="fixed left-1/2 top-[8dvh] z-50 flex max-h-[80dvh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <D.Title className="sr-only">Buscar no portal</D.Title>
          <D.Description className="sr-only">
            Telas, empresas e, na empresa aberta, clientes, produtos, notas, vendas, documentos e contas. Use as setas e Enter.
          </D.Description>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={busca}
              onChange={(e) => mudarBusca(e.target.value)}
              onKeyDown={teclado}
              placeholder={empresaDados ? `Buscar em ${empresaDados.nome}: cliente, nota, produto, CPF/CNPJ, tela…` : "Buscar tela ou empresa (nome ou CNPJ)…"}
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              aria-label="O que você procura?"
              role="combobox"
              aria-expanded={itens.length > 0}
              aria-controls={listaId}
              aria-activedescendant={itens.length ? `${listaId}-${atual}` : undefined}
              autoComplete="off"
              enterKeyHint="search"
            />
            {buscando ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Buscando" /> : null}
            <D.Close className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fechar">
              <X className="size-4" />
            </D.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!termo ? (
              <div className="space-y-2 px-3 py-6 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">O que você procura?</p>
                <p>
                  Digite o nome, o CPF/CNPJ (com ou sem pontos), o número de uma nota ou venda, ou o nome de uma tela, como “contas a pagar”. Sem acento e em qualquer ordem
                  também funciona.
                </p>
                {!empresaDados && equipe ? <p>Para achar clientes, notas e documentos de uma empresa, abra a empresa primeiro.</p> : null}
              </div>
            ) : itens.length ? (
              <ul ref={lista} id={listaId} role="listbox" aria-label="Resultados" className="space-y-0.5">
                {itens.map((item, i) => {
                  const cabecalho = item.grupo !== grupoAnterior ? item.grupo : null;
                  grupoAnterior = item.grupo;
                  const Ic = Icone[item.icone];
                  return (
                    <React.Fragment key={item.chave}>
                      {cabecalho ? (
                        <li role="presentation" className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:pt-1">
                          {cabecalho}
                        </li>
                      ) : null}
                      <li
                        id={`${listaId}-${i}`}
                        role="option"
                        aria-selected={i === atual}
                        data-indice={i}
                        onMouseMove={() => setAtivo(i)}
                        onClick={() => ir(item)}
                        className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm", i === atual ? "bg-primary/10 text-foreground" : "hover:bg-muted")}
                      >
                        <Ic className="size-4 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.titulo}</span>
                          {item.detalhe ? <span className="block truncate text-xs text-muted-foreground">{item.detalhe}</span> : null}
                        </span>
                        {i === atual ? <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ArrowRight className="size-4 shrink-0 text-transparent" aria-hidden />}
                      </li>
                    </React.Fragment>
                  );
                })}
              </ul>
            ) : buscando ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Buscando…</p>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nada encontrado para “{termo}”. Confira a escrita ou tente só uma parte do nome.</p>
            )}
          </div>
          <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex">
            <span>↑ ↓ para escolher</span>
            <span>Enter para abrir</span>
            <span>Esc para fechar</span>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
