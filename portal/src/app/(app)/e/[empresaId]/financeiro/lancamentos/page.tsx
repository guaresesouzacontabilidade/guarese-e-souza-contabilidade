import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus, Receipt, Search } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { TabelaLancamentos, type LinhaLancamento } from "@/components/financeiro/tabela-lancamentos";
import { hojeISO } from "@/lib/competencia";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Lançamentos" };
const POR_PAGINA = 50;
const UUID = /^[0-9a-f-]{36}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export default async function PaginaLancamentos({ params, searchParams }: PageProps<"/e/[empresaId]/financeiro/lancamentos">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  const hoje = hojeISO();
  const tipo = parametro(sp, "tipo", ["receber", "pagar"]);
  const situacao = parametro(sp, "situacao", ["aberto", "parcial", "quitado", "cancelado", "atrasado", "em_aberto"]);
  const revisao = parametro(sp, "revisao", ["sugerido", "confirmado"]);
  const periodoPor = parametro(sp, "por", ["vencimento", "competencia"]) || "vencimento";
  const inicio = DATA.test(parametro(sp, "inicio")) ? parametro(sp, "inicio") : "";
  const fim = DATA.test(parametro(sp, "fim")) ? parametro(sp, "fim") : "";
  const categoria = UUID.test(parametro(sp, "categoria")) ? parametro(sp, "categoria") : "";
  const contraparte = UUID.test(parametro(sp, "contraparte")) ? parametro(sp, "contraparte") : "";
  const busca = termoBusca(sp.busca);
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  const colunaData = periodoPor === "competencia" ? "data_competencia" : "data_vencimento";

  function filtrar<T extends { eq: (...a: never[]) => T }>(q: T): T {
    let r = q as unknown as ReturnType<typeof consulta>;
    r = r.eq("empresa_id", empresaId);
    if (tipo) r = r.eq("tipo", tipo);
    if (situacao === "atrasado") r = r.in("situacao", ["aberto", "parcial"]).lt("data_vencimento", hoje);
    else if (situacao === "em_aberto") r = r.in("situacao", ["aberto", "parcial"]);
    else if (situacao) r = r.eq("situacao", situacao);
    else r = r.neq("situacao", "cancelado");
    if (revisao) r = r.eq("status_revisao", revisao);
    if (inicio) r = r.gte(colunaData, inicio);
    if (fim) r = r.lte(colunaData, fim);
    if (categoria) r = r.eq("categoria_id", categoria);
    if (contraparte) r = r.eq("contraparte_id", contraparte);
    if (busca) r = r.or(`descricao.ilike.%${busca}%,numero_documento.ilike.%${busca}%`);
    return r as unknown as T;
  }
  const consulta = () =>
    ctx.supabase
      .from("lancamentos")
      .select(
        "id, tipo, descricao, data_competencia, data_vencimento, valor_previsto, valor_baixado, situacao, status_revisao, origem, parcela_numero, parcela_total, categoria:categorias_financeiras(nome), contraparte:contrapartes(nome)",
        { count: "exact" },
      );

  const [{ data, count }, totais, { data: categorias }, { data: contrapartes }] = await Promise.all([
    filtrar(consulta())
      .order(colunaData, { ascending: situacao === "atrasado" || situacao === "em_aberto" })
      .order("id")
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1),
    buscarTudo(
      (de, ate) => filtrar(ctx.supabase.from("lancamentos").select("tipo, valor_previsto, valor_baixado, situacao")).range(de, ate),
      20000,
    ),
    ctx.supabase.from("categorias_financeiras").select("id, nome, codigo, natureza, sintetica").eq("empresa_id", empresaId).eq("ativa", true).order("codigo"),
    ctx.supabase.from("contrapartes").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome").limit(1000),
  ]);

  const linhas: LinhaLancamento[] = (data ?? []).map((l) => ({
    id: l.id,
    tipo: l.tipo,
    descricao: l.descricao,
    categoria: (l.categoria as { nome: string } | null)?.nome ?? null,
    contraparte: (l.contraparte as { nome: string } | null)?.nome ?? null,
    competencia: l.data_competencia,
    vencimento: l.data_vencimento,
    valor: dec(l.valor_previsto).toFixed(2),
    aberto: dec(l.valor_previsto).minus(dec(l.valor_baixado)).toFixed(2),
    situacao: l.situacao,
    atrasado: ["aberto", "parcial"].includes(l.situacao) && l.data_vencimento < hoje,
    revisao: l.status_revisao,
    origem: l.origem,
    parcela: l.parcela_numero ? `${l.parcela_numero}/${l.parcela_total}` : null,
  }));
  const validos = totais.filter((t) => t.situacao !== "cancelado");
  const totReceber = somar(validos.filter((t) => t.tipo === "receber").map((t) => t.valor_previsto));
  const totPagar = somar(validos.filter((t) => t.tipo === "pagar").map((t) => t.valor_previsto));
  const abReceber = somar(validos.filter((t) => t.tipo === "receber").map((t) => dec(t.valor_previsto).minus(dec(t.valor_baixado))));
  const abPagar = somar(validos.filter((t) => t.tipo === "pagar").map((t) => dec(t.valor_previsto).minus(dec(t.valor_baixado))));
  const base = `/e/${empresaId}/financeiro/lancamentos`;
  const exportar = (formato: string) => urlCom(`/api/financeiro/exportar`, sp, { empresa: empresaId, formato, pagina: null });

  return (
    <>
      <CabecalhoPagina
        titulo="Contas a pagar e a receber"
        descricao="Lançamentos por competência e vencimento, com pagamentos parciais, juros, multas, descontos e taxas."
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={exportar("xlsx")}>
                <Download /> Excel
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={exportar("csv")}>
                <Download /> CSV
              </a>
            </Button>
            {ctx.pode("financeiro.editar") ? (
              <Button asChild>
                <Link href={`${base}/novo`}>
                  <Plus /> Novo lançamento
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Descrição ou nº do documento" className="pl-9" aria-label="Buscar" />
        </div>
        <Select name="tipo" defaultValue={tipo} aria-label="Tipo">
          <option value="">Pagar e receber</option>
          <option value="receber">A receber</option>
          <option value="pagar">A pagar</option>
        </Select>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação">
          <option value="">Todas (sem canceladas)</option>
          <option value="em_aberto">Em aberto (inclui parciais)</option>
          <option value="atrasado">Vencidas</option>
          <option value="parcial">Parcialmente pagas</option>
          <option value="quitado">Quitadas</option>
          <option value="cancelado">Canceladas</option>
        </Select>
        <Select name="revisao" defaultValue={revisao} aria-label="Revisão">
          <option value="">Confirmados e sugeridos</option>
          <option value="sugerido">Somente sugeridos</option>
          <option value="confirmado">Somente confirmados</option>
        </Select>
        <Select name="categoria" defaultValue={categoria} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {(categorias ?? [])
            .filter((c) => !c.sintetica)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} {c.nome}
              </option>
            ))}
        </Select>
        <Select name="contraparte" defaultValue={contraparte} aria-label="Cliente ou fornecedor">
          <option value="">Clientes e fornecedores</option>
          {(contrapartes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
        <Select name="por" defaultValue={periodoPor} aria-label="Período por">
          <option value="vencimento">Período por vencimento</option>
          <option value="competencia">Período por competência</option>
        </Select>
        <Input type="date" name="inicio" defaultValue={inicio} aria-label="Data inicial" />
        <Input type="date" name="fim" defaultValue={fim} aria-label="Data final" />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" variante="secundario" className="flex-1">
            Filtrar
          </Button>
          <Button asChild variante="fantasma">
            <Link href={base}>Limpar</Link>
          </Button>
        </div>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total a receber (filtro)</p>
          <p className="font-semibold text-sucesso numero">{formatarMoeda(totReceber)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Em aberto a receber</p>
          <p className="font-semibold numero">{formatarMoeda(abReceber)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Total a pagar (filtro)</p>
          <p className="font-semibold text-perigo numero">{formatarMoeda(totPagar)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground">Em aberto a pagar</p>
          <p className="font-semibold numero">{formatarMoeda(abPagar)}</p>
        </div>
      </div>

      {linhas.length ? (
        <>
          <TabelaLancamentos
            empresaId={empresaId}
            linhas={linhas}
            podeEditar={ctx.pode("financeiro.editar")}
            categorias={(categorias ?? []).filter((c) => !c.sintetica).map((c) => ({ id: c.id, nome: `${c.codigo} ${c.nome}`, natureza: c.natureza ?? "" }))}
          />
          <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(p) => urlCom(base, sp, { pagina: p })} />
        </>
      ) : (
        <EstadoVazio icone={Receipt} titulo="Nenhum lançamento encontrado" descricao="Registre contas a pagar e a receber, ou importe uma planilha." />
      )}
    </>
  );
}
