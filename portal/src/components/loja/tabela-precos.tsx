"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Sparkles, TrendingUp } from "lucide-react";
import { BotaoAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { definirMargemGrupo, definirMargemPadrao, salvarPrecos, type PrecoParaSalvar } from "@/lib/gestao/acoes-precos";
import { custoMudouSemPreco, custoReferencia, margemAlvo, margemReal, precoPorM3, precoSugerido, type OrigemMargem } from "@/lib/gestao/precos";
import { formatarQuantidade, un } from "@/lib/gestao/rotulos";
import { casaBusca } from "@/lib/busca";

export interface LinhaPreco {
  id: string;
  descricao: string;
  codigo: string;
  grupo: string | null;
  unidade: string;
  preco: string | null;
  custo_medio: string | null;
  preco_custo: string | null;
  ultimo_custo_entrada: string | null;
  ultima_entrada_em: string | null;
  preco_alterado_em: string | null;
  custo_na_alteracao: string | null;
  margem_desejada: string | null;
  /** m³ em 1 unidade de venda (madeira), para o preço por m³. */
  m3: string | null;
  /** Entrou na última entrada de mercadorias (ou nos últimos 7 dias). */
  da_entrada: boolean;
}

type Filtro = "todos" | "entrada" | "custo" | "abaixo" | "semcusto";
const FILTROS: Filtro[] = ["todos", "entrada", "custo", "abaixo", "semcusto"];

const ORIGEM: Record<OrigemMargem, string> = { produto: "do produto", grupo: "do grupo", padrao: "padrão" };

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const moeda = (d: Decimal) => formatarMoeda(d, { semSimbolo: true });

/** Margem digitada ("35", "35,5") normalizada; "" = sem margem própria; null = inválida. */
function normalizarMargem(t: string): string | null {
  const s = t.replace("%", "").trim();
  if (!s) return "";
  const d = lerValorBR(s);
  if (!d || d.lt(0) || d.gt(1000)) return null;
  return d.toDecimalPlaces(2).toString();
}

function margemOriginal(v: string | null) {
  return v ? new Decimal(v).toDecimalPlaces(2).toString() : "";
}

function CampoPreco({ id, valor, aoMudar, invalido, rotulo }: { id: string; valor: string; aoMudar: (v: string) => void; invalido?: boolean; rotulo: string }) {
  return (
    <div className="relative w-32">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
      <input
        id={id}
        aria-label={rotulo}
        aria-invalid={invalido || undefined}
        inputMode="decimal"
        autoComplete="off"
        value={valor}
        onChange={(e) => aoMudar(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={() => {
          const d = lerValorBR(valor);
          if (d) aoMudar(moeda(d));
        }}
        className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-2 text-right text-sm numero focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-[invalid=true]:border-perigo"
      />
    </div>
  );
}

export function TabelaPrecos({
  empresaId,
  linhas,
  grupos,
  padrao,
  filtroInicial,
  rotuloEntrada,
}: {
  empresaId: string;
  linhas: LinhaPreco[];
  grupos: Record<string, string>;
  padrao: string | null;
  filtroInicial?: string;
  rotuloEntrada: string;
}) {
  const router = useRouter();
  const [precos, setPrecos] = React.useState<Record<string, string>>({});
  const [margens, setMargens] = React.useState<Record<string, string>>({});
  const [selecionados, setSelecionados] = React.useState<Set<string>>(new Set());
  const [filtro, setFiltro] = React.useState<Filtro>(FILTROS.includes(filtroInicial as Filtro) ? (filtroInicial as Filtro) : "todos");
  const [grupo, setGrupo] = React.useState("");
  const [busca, setBusca] = React.useState("");
  const [salvando, iniciar] = React.useTransition();

  // Conta de cada linha (com o que foi digitado e ainda não salvo)
  const calculadas = React.useMemo(
    () =>
      linhas.map((l) => {
        const custo = custoReferencia(l);
        const textoPreco = precos[l.id];
        const novo = textoPreco !== undefined && textoPreco.trim() ? lerValorBR(textoPreco) : null;
        const precoInvalido = textoPreco !== undefined && textoPreco.trim() !== "" && (!novo || novo.lt(0));
        const atual = l.preco != null ? new Decimal(l.preco) : null;
        const precoMudou = Boolean(novo && !precoInvalido && (!atual || !novo.toDecimalPlaces(2).eq(atual.toDecimalPlaces(2))));
        const textoMargem = margens[l.id];
        const margemNorm = textoMargem !== undefined ? normalizarMargem(textoMargem) : margemOriginal(l.margem_desejada);
        const margemInvalida = margemNorm === null;
        const margemMudou = !margemInvalida && textoMargem !== undefined && margemNorm !== margemOriginal(l.margem_desejada);
        const alvo = margemAlvo({ margem_desejada: margemInvalida ? l.margem_desejada : margemNorm || null, grupo: l.grupo }, grupos, padrao);
        const herdada = margemAlvo({ margem_desejada: null, grupo: l.grupo }, grupos, padrao);
        const efetivo = precoMudou ? novo : atual;
        const real = margemReal(efetivo, custo);
        const sugerido = alvo ? precoSugerido(custo, alvo.valor) : null;
        const m3 = l.m3 ? new Decimal(l.m3) : null;
        return {
          l,
          custo,
          atual,
          efetivo,
          real,
          alvo,
          herdada,
          sugerido,
          precoMudou,
          precoInvalido,
          margemMudou,
          margemInvalida,
          abaixo: alvo !== null && real !== null && real < alvo.valor - 0.05,
          custoMudou: custoMudouSemPreco(l),
          porM3: m3 && !m3.eq(1) ? precoPorM3(efetivo, m3) : null,
        };
      }),
    [linhas, precos, margens, grupos, padrao],
  );

  const contagem: Record<Filtro, number> = {
    todos: calculadas.length,
    entrada: calculadas.filter((c) => c.l.da_entrada).length,
    custo: calculadas.filter((c) => c.custoMudou).length,
    abaixo: calculadas.filter((c) => c.abaixo).length,
    semcusto: calculadas.filter((c) => !c.custo).length,
  };
  const visiveis = calculadas.filter(
    (c) =>
      (filtro === "todos" ||
        (filtro === "entrada" && c.l.da_entrada) ||
        (filtro === "custo" && c.custoMudou) ||
        (filtro === "abaixo" && c.abaixo) ||
        (filtro === "semcusto" && !c.custo)) &&
      (!grupo || c.l.grupo === grupo) &&
      casaBusca(busca, c.l.descricao, c.l.codigo, c.l.grupo),
  );
  const alteradas = calculadas.filter((c) => c.precoMudou || c.margemMudou);
  const invalidas = calculadas.filter((c) => c.precoInvalido || c.margemInvalida);
  const nomesGrupos = [...new Set(linhas.map((l) => l.grupo).filter((g): g is string => Boolean(g)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const todasMarcadas = visiveis.length > 0 && visiveis.every((c) => selecionados.has(c.l.id));
  const marcadasComSugestao = calculadas.filter((c) => selecionados.has(c.l.id) && c.sugerido);

  // Avisa antes de sair com preços digitados e não salvos
  React.useEffect(() => {
    if (!alteradas.length) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [alteradas.length]);

  function usarSugerido(id: string, sugerido: Decimal) {
    setPrecos((p) => ({ ...p, [id]: moeda(sugerido) }));
  }

  function aplicarSugeridoNosMarcados() {
    setPrecos((p) => {
      const n = { ...p };
      for (const c of marcadasComSugestao) n[c.l.id] = moeda(c.sugerido!);
      return n;
    });
    toast.success(`Preço sugerido colocado em ${marcadasComSugestao.length} produto(s). Confira e clique em Salvar.`);
  }

  function alternar(id: string) {
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function salvar() {
    if (invalidas.length) {
      toast.error(`Corrija os valores em vermelho (${invalidas.length}). Preço no formato 1.234,56 e margem entre 0 e 1000.`);
      return;
    }
    const itens: PrecoParaSalvar[] = alteradas.map((c) => ({
      produto_id: c.l.id,
      ...(c.precoMudou ? { preco: precos[c.l.id] } : {}),
      ...(c.margemMudou ? { margem: margens[c.l.id] } : {}),
    }));
    iniciar(async () => {
      const r = await salvarPrecos(empresaId, itens);
      if (r.ok) {
        toast.success(r.mensagem);
        setPrecos({});
        setMargens({});
        setSelecionados(new Set());
        router.refresh();
      } else toast.error(r.mensagem);
    });
  }

  const rotulos: Record<Filtro, string> = {
    todos: "Todos",
    entrada: rotuloEntrada,
    custo: "Custo mudou e o preço não",
    abaixo: "Margem abaixo da meta",
    semcusto: "Sem custo",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar produtos">
        {FILTROS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
              filtro === f ? "border-primary bg-secondary font-semibold text-secondary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {rotulos[f]}
            <span className="numero text-xs">{contagem[f]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou código" className="w-full sm:w-72" aria-label="Buscar produto" />
        {nomesGrupos.length ? (
          <Select value={grupo} onChange={(e) => setGrupo(e.target.value)} className="w-full sm:w-48" aria-label="Grupo">
            <option value="">Todos os grupos</option>
            {nomesGrupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        ) : null}
        <Button type="button" variante="contorno" disabled={!marcadasComSugestao.length} onClick={aplicarSugeridoNosMarcados}>
          <Sparkles /> Usar o preço sugerido nos marcados{marcadasComSugestao.length ? ` (${marcadasComSugestao.length})` : ""}
        </Button>
      </div>

      {visiveis.length ? (
        <Table>
          <THead>
            <tr>
              <Th className="w-8">
                <Checkbox
                  aria-label="Marcar todos da lista"
                  checked={todasMarcadas}
                  onChange={() =>
                    setSelecionados((s) => {
                      const n = new Set(s);
                      for (const c of visiveis) {
                        if (todasMarcadas) n.delete(c.l.id);
                        else n.add(c.l.id);
                      }
                      return n;
                    })
                  }
                />
              </Th>
              <Th>Produto</Th>
              <Th className="text-right">Custo</Th>
              <Th className="text-right">Preço atual</Th>
              <Th className="text-right">Margem</Th>
              <Th className="text-right">Meta</Th>
              <Th className="text-right">Sugerido</Th>
              <Th className="text-right">Novo preço</Th>
            </tr>
          </THead>
          <TBody>
            {visiveis.map((c) => {
              const { l } = c;
              return (
                <Tr key={l.id} className={cn(c.precoMudou || c.margemMudou ? "bg-info-bg/40" : undefined)}>
                  <Td>
                    <Checkbox aria-label={`Marcar ${l.descricao}`} checked={selecionados.has(l.id)} onChange={() => alternar(l.id)} />
                  </Td>
                  <Td className="min-w-52">
                    <Link href={`/e/${empresaId}/loja/produtos/${l.id}`} className="font-medium hover:underline">
                      {l.descricao}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {l.codigo}
                      {l.grupo ? ` · ${l.grupo}` : ""} · por {un(l.unidade)}
                    </span>
                    {c.custoMudou ? (
                      <Badge variante="alerta" className="mt-1">
                        <TrendingUp className="size-3" /> Custo mudou na última compra
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-right numero">
                    {c.custo ? formatarMoeda(c.custo) : <span className="text-muted-foreground">—</span>}
                    {l.custo_medio && Number(l.custo_medio) > 0 ? (
                      <span className="block text-xs text-muted-foreground">médio {formatarMoeda(l.custo_medio)}</span>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-right numero">
                    {c.atual ? formatarMoeda(c.atual) : "—"}
                    {c.porM3 ? <span className="block text-xs text-muted-foreground">{formatarMoeda(c.porM3)}/m³</span> : null}
                  </Td>
                  <Td className="text-right numero">
                    {c.real !== null ? (
                      <span className={cn("font-medium", c.abaixo ? "text-perigo" : c.alvo ? "text-sucesso" : undefined)}>{pct(c.real)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {c.abaixo ? <span className="block text-xs text-perigo">abaixo da meta</span> : null}
                  </Td>
                  <Td className="text-right">
                    <div className="ml-auto flex w-24 items-center gap-1">
                      <Input
                        aria-label={`Meta de margem de ${l.descricao} (%)`}
                        aria-invalid={c.margemInvalida || undefined}
                        value={margens[l.id] ?? (l.margem_desejada ? formatarQuantidade(l.margem_desejada, 2) : "")}
                        onChange={(e) => setMargens((m) => ({ ...m, [l.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                        placeholder={c.herdada ? formatarQuantidade(c.herdada.valor, 2) : "—"}
                        inputMode="decimal"
                        className="h-9 px-2 text-right numero"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <span className="block text-xs text-muted-foreground">{c.alvo ? ORIGEM[c.alvo.origem] : "sem meta"}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-right numero">
                    {c.sugerido ? (
                      <>
                        {formatarMoeda(c.sugerido)}
                        <button type="button" className="block w-full text-right text-xs text-primary hover:underline" onClick={() => usarSugerido(l.id, c.sugerido!)}>
                          usar
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{c.custo ? "defina a meta" : "sem custo"}</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <CampoPreco
                        id={`preco-${l.id}`}
                        rotulo={`Novo preço de ${l.descricao}`}
                        valor={precos[l.id] ?? ""}
                        invalido={c.precoInvalido}
                        aoMudar={(v) => setPrecos((p) => ({ ...p, [l.id]: v }))}
                      />
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio
          titulo={filtro === "todos" ? "Nenhum produto ativo" : "Nenhum produto neste filtro"}
          descricao={filtro === "custo" ? "Nenhum produto teve o custo alterado depois da última mudança de preço." : filtro === "abaixo" ? "Todos os produtos com meta estão com a margem dentro dela." : undefined}
        />
      )}

      <div
        className={cn(
          "sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-lg lg:bottom-4",
          !alteradas.length && !invalidas.length && "hidden",
        )}
        style={{ backgroundColor: "var(--card)" }}
      >
        <p className="text-sm">
          {alteradas.length} produto(s) com alteração
          {invalidas.length ? <span className="text-perigo"> · {invalidas.length} com valor inválido</span> : null}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variante="fantasma"
            disabled={salvando}
            onClick={() => {
              setPrecos({});
              setMargens({});
            }}
          >
            Descartar
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando || !alteradas.length}>
            <Save /> {salvando ? "Salvando..." : `Salvar alterações (${alteradas.length})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Margem padrão da empresa e por grupo (o produto sem meta própria usa a do grupo, senão a padrão). */
export function ConfigMargens({ empresaId, padrao, grupos }: { empresaId: string; padrao: string | null; grupos: { grupo: string; margem: string | null; produtos: number }[] }) {
  const [valorPadrao, setValorPadrao] = React.useState(padrao ? formatarQuantidade(padrao, 2) : "");
  const [valores, setValores] = React.useState<Record<string, string>>(() => Object.fromEntries(grupos.map((g) => [g.grupo, g.margem ? formatarQuantidade(g.margem, 2) : ""])));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Margem padrão da empresa</span>
          <span className="flex items-center gap-1">
            <Input value={valorPadrao} onChange={(e) => setValorPadrao(e.target.value)} inputMode="decimal" className="w-24 text-right numero" aria-label="Margem padrão (%)" placeholder="Ex.: 30" />
            <span className="text-sm text-muted-foreground">%</span>
          </span>
        </label>
        <BotaoAcao variante="contorno" acao={() => definirMargemPadrao(empresaId, valorPadrao)}>
          Salvar padrão
        </BotaoAcao>
      </div>
      {grupos.length ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Por grupo (vale para os produtos do grupo sem meta própria)</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {grupos.map((g) => (
              <li key={g.grupo} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {g.grupo} <span className="text-xs text-muted-foreground">({g.produtos})</span>
                </span>
                <Input
                  value={valores[g.grupo] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [g.grupo]: e.target.value }))}
                  inputMode="decimal"
                  className="h-9 w-20 text-right numero"
                  aria-label={`Margem do grupo ${g.grupo} (%)`}
                  placeholder={valorPadrao || "—"}
                />
                <span className="text-xs text-muted-foreground">%</span>
                <BotaoAcao tamanho="sm" variante="fantasma" acao={() => definirMargemGrupo(empresaId, g.grupo, valores[g.grupo] ?? "")}>
                  Salvar
                </BotaoAcao>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Dê um grupo aos produtos (ex.: Eucalipto, Pinus) para ter uma margem por grupo.</p>
      )}
    </div>
  );
}
