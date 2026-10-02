import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileText, Sparkles } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { SecaoContas, SecaoDre, SecaoFluxo, SecaoSaldos } from "@/components/relatorios/secoes-empresa";
import { competenciaAtual, hojeISO, somarMeses, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { parametro } from "@/lib/busca";
import { mesesEntre, periodoMensal } from "@/lib/relatorios/calculos";
import { RELATORIOS, carregarAging, carregarDre, carregarFluxo, carregarSaldos, lerTipoRelatorio } from "@/lib/relatorios/dados";

export const metadata: Metadata = { title: "Relatórios" };

interface Qualidade {
  lancamentos_sugeridos?: number;
  movimentos?: { pendentes: number } | null;
  competencias?: { mes: string; status: string }[];
}

export default async function PaginaRelatorios({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("relatorios.ver")) return <Alerta tom="alerta">Seu acesso não inclui os relatórios desta empresa.</Alerta>;

  const hoje = hojeISO();
  const atual = competenciaAtual();
  const aba = lerTipoRelatorio(sp.aba);
  const { inicio, fim } = periodoMensal(parametro(sp, "de"), parametro(sp, "ate"), atual);
  const de = inicio.slice(0, 7);
  const ate = fim.slice(0, 7);
  const base = `/e/${empresaId}`;
  const aqui = `${base}/relatorios`;
  const financeiro = ctx.pode("financeiro.ver");

  const publicadosP = ctx.supabase
    .from("relatorios_publicados")
    .select("id, titulo, periodo_inicio, periodo_fim, versao, situacao, publicado_em")
    .eq("empresa_id", empresaId)
    .eq("status", "publicado")
    .order("publicado_em", { ascending: false })
    .limit(6);

  if (!financeiro) {
    const { data: publicados } = await publicadosP;
    return (
      <>
        <CabecalhoPagina titulo="Relatórios" descricao="Relatórios gerenciais da empresa." />
        <Alerta tom="info" className="mb-5" titulo="Relatórios financeiros indisponíveis">
          Os relatórios de fluxo de caixa, resultado e saldos usam os dados do financeiro, que não fazem parte do seu acesso. Peça ao responsável pela empresa
          para incluir a permissão de visualizar o financeiro.
        </Alerta>
        <Publicados lista={publicados ?? []} />
      </>
    );
  }

  const [conteudo, qualidadeR, { data: publicados }] = await Promise.all([
    (async () => {
      switch (aba) {
        case "dre": {
          const d = await carregarDre(ctx.supabase, empresaId, inicio, fim);
          return <SecaoDre dre={d} meses={d.meses} base={base} />;
        }
        case "contas":
          return <SecaoContas aging={await carregarAging(ctx.supabase, empresaId, hoje)} hoje={hoje} base={base} />;
        case "saldos":
          return <SecaoSaldos saldos={await carregarSaldos(ctx.supabase, empresaId, inicio, fim, hoje)} base={base} />;
        default:
          return <SecaoFluxo fluxo={await carregarFluxo(ctx.supabase, empresaId, inicio, fim)} />;
      }
    })(),
    ctx.supabase.rpc("qualidade_dados", { p_empresa_id: empresaId, p_inicio: inicio, p_fim: ultimoDiaDoMes(fim) }),
    publicadosP,
  ]);

  const q = (qualidadeR.data ?? {}) as Qualidade;
  const abertas = (q.competencias ?? []).filter((c) => c.status !== "fechada" && c.mes <= atual);
  const totalMeses = mesesEntre(inicio, fim).length;
  const exportar = (formato: string) => urlCom("/api/relatorios/exportar", {}, { empresa: empresaId, relatorio: aba, de, ate, formato });
  const lancamentosPeriodo = urlCom("/api/financeiro/exportar", {}, { empresa: empresaId, por: "competencia", inicio, fim: ultimoDiaDoMes(fim), formato: "xlsx" });
  const atalhos = [
    { rotulo: "Mês atual", de: atual, ate: atual },
    { rotulo: "Mês anterior", de: somarMeses(atual, -1), ate: somarMeses(atual, -1) },
    { rotulo: "Últimos 6 meses", de: somarMeses(atual, -5), ate: atual },
    { rotulo: "Últimos 12 meses", de: somarMeses(atual, -11), ate: atual },
    { rotulo: `Ano de ${atual.slice(0, 4)}`, de: `${atual.slice(0, 4)}-01-01`, ate: `${atual.slice(0, 4)}-12-01` },
  ];

  return (
    <>
      <CabecalhoPagina
        titulo="Relatórios"
        descricao={`Fluxo de caixa, resultado, contas em aberto e saldos · ${
          inicio === fim ? formatarCompetencia(inicio, true) : `${formatarCompetencia(inicio, true)} a ${formatarCompetencia(fim, true)}`
        }`}
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={exportar("xlsx")}>
                <Download /> Excel
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={exportar("pdf")}>
                <FileText /> PDF
              </a>
            </Button>
          </>
        }
      />

      <form className="mb-3 flex flex-wrap items-end gap-2" aria-label="Período do relatório">
        <input type="hidden" name="aba" value={aba} />
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">De</span>
          <Input type="month" name="de" defaultValue={de} className="w-40" aria-label="Mês inicial" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">Até</span>
          <Input type="month" name="ate" defaultValue={ate} className="w-40" aria-label="Mês final" />
        </label>
        <Button type="submit" variante="secundario">
          Atualizar
        </Button>
        <a href={lancamentosPeriodo} className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <Download className="size-4" /> Lançamentos do período (Excel)
        </a>
      </form>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {atalhos.map((a) => {
          const ativo = a.de === inicio && a.ate === fim;
          return (
            <Link
              key={a.rotulo}
              href={urlCom(aqui, {}, { aba, de: a.de.slice(0, 7), ate: a.ate.slice(0, 7) })}
              aria-current={ativo ? "true" : undefined}
              className={
                ativo
                  ? "rounded-full border border-primary bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              }
            >
              {a.rotulo}
            </Link>
          );
        })}
        <span className="self-center text-xs text-muted-foreground">Até 24 meses por consulta.</span>
      </div>

      <AbasLink
        ativa={aba}
        abas={(Object.keys(RELATORIOS) as (keyof typeof RELATORIOS)[]).map((k) => ({ valor: k, rotulo: RELATORIOS[k], href: urlCom(aqui, {}, { aba: k, de, ate }) }))}
      />

      {(q.lancamentos_sugeridos ?? 0) > 0 || abertas.length > 0 ? (
        <Alerta
          tom="info"
          className="mb-5"
          titulo={abertas.length ? "Relatório preliminar" : "Lançamentos aguardando revisão"}
          acao={
            (q.lancamentos_sugeridos ?? 0) > 0 ? (
              <Button asChild tamanho="sm" variante="secundario">
                <Link href={`${base}/financeiro/lancamentos?revisao=sugerido`}>
                  <Sparkles /> Revisar
                </Link>
              </Button>
            ) : null
          }
        >
          <ul className="list-disc pl-5">
            {abertas.length ? (
              <li>
                {abertas.length} de {totalMeses} competência(s) do período ainda não fechada(s) pelo escritório: os valores podem mudar.
              </li>
            ) : null}
            {(q.lancamentos_sugeridos ?? 0) > 0 ? <li>{q.lancamentos_sugeridos} lançamento(s) sugerido(s) no período não entram nos relatórios até serem confirmados.</li> : null}
            {q.movimentos?.pendentes ? <li>{q.movimentos.pendentes} movimentação(ões) bancária(s) do período ainda não conciliada(s).</li> : null}
          </ul>
        </Alerta>
      ) : null}

      {conteudo}

      <Publicados lista={publicados ?? []} className="mt-6" />
    </>
  );
}

function Publicados({
  lista,
  className,
}: {
  lista: { id: string; titulo: string; periodo_inicio: string; periodo_fim: string; versao: number; situacao: string; publicado_em: string | null }[];
  className?: string;
}) {
  if (!lista.length) return null;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Relatórios publicados pelo escritório</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {lista.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block font-medium">{r.titulo}</span>
                <span className="text-xs text-muted-foreground">
                  {formatarData(r.periodo_inicio)} a {formatarData(r.periodo_fim)} · versão {r.versao} · publicado em {formatarDataHora(r.publicado_em)}
                </span>
              </span>
              <Badge variante={r.situacao === "revisado" ? "sucesso" : "alerta"}>{r.situacao === "revisado" ? "Revisado" : "Preliminar"}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
