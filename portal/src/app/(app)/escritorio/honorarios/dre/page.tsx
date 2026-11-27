import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";
import { CabecalhoPagina, urlCom } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorPeriodo } from "@/components/relatorios/seletor-periodo";
import { TabelaDre } from "@/components/relatorios/tabelas";
import { exigirHonorarios } from "@/lib/honorarios/acesso";
import { foraDaDre, lancamentosDoPeriodo, linhasDre, receitaPorCliente } from "@/lib/honorarios/dados";
import { montarDre } from "@/lib/relatorios/dre";
import { lerPeriodo, opcoesPeriodo, rotuloMesCurto } from "@/lib/relatorios/periodo";
import { parametro } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "DRE do escritório" };

export default async function DreEscritorio({ searchParams }: PageProps<"/escritorio/honorarios/dre">) {
  const s = await exigirHonorarios();
  const sp = await searchParams;
  const hoje = hojeISO();
  const periodo = lerPeriodo(parametro(sp, "periodo") || "12m", hoje);
  const base = (parametro(sp, "base", ["competencia", "caixa"]) || "competencia") as "competencia" | "caixa";
  const detalhe = parametro(sp, "detalhe") || null;
  const rota = "/escritorio/honorarios/dre";

  const [lancamentos, empresas, { count: aClassificar }, cobradas, pagas] = await Promise.all([
    lancamentosDoPeriodo(s.supabase, periodo.inicio, periodo.fim, base),
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia").range(de, ate)),
    s.supabase.from("escritorio_lancamentos").select("id", { count: "exact", head: true }).is("categoria_id", null),
    buscarTudo((de, ate) =>
      s.supabase.from("honorarios_cobrancas").select("valor, vencimento").in("situacao", ["aberta", "paga"]).gte("vencimento", periodo.inicio).lte("vencimento", periodo.fim).range(de, ate),
    ),
    buscarTudo((de, ate) => s.supabase.from("honorarios_cobrancas").select("valor_pago, pago_em").eq("situacao", "paga").gte("pago_em", periodo.inicio).lte("pago_em", periodo.fim).range(de, ate)),
  ]);
  const dre = montarDre(linhasDre(lancamentos, base), periodo.meses);
  const nomes = new Map(empresas.map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));
  const porCliente = receitaPorCliente(lancamentos, nomes);
  const fora = foraDaDre(lancamentos);
  const previsto = periodo.meses.map((m) => ({
    mes: m,
    cobrado: somar(cobradas.filter((c) => c.vencimento.slice(0, 7) === m.slice(0, 7)).map((c) => c.valor)),
    recebido: somar(pagas.filter((p) => (p.pago_em ?? "").slice(0, 7) === m.slice(0, 7)).map((p) => p.valor_pago)),
  }));

  // Detalhe de uma linha: os lançamentos dela no período
  const categoriaDetalhe = detalhe?.includes(":") ? detalhe.split(":")[1] : null;
  const linhasDetalhe = categoriaDetalhe ? lancamentos.filter((l) => l.categoria?.id === categoriaDetalhe) : [];

  return (
    <div className="space-y-5">
      <CabecalhoPagina
        titulo="DRE do escritório"
        descricao="O resultado do escritório: honorários, serviços, despesas e o que sobrou. Clique numa linha para ver os lançamentos."
        voltar={{ href: "/escritorio/honorarios", rotulo: "Honorários" }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <SeletorPeriodo valor={periodo.chave} opcoes={opcoesPeriodo(hoje)} />
        <nav className="flex gap-1 rounded-lg border border-border bg-card p-1" aria-label="Como contar">
          <Button asChild tamanho="sm" variante={base === "competencia" ? "secundario" : "fantasma"}>
            <Link href={urlCom(rota, sp, { base: null, detalhe: null })}>Pelo mês do serviço</Link>
          </Button>
          <Button asChild tamanho="sm" variante={base === "caixa" ? "secundario" : "fantasma"}>
            <Link href={urlCom(rota, sp, { base: "caixa", detalhe: null })}>Pelo dia em que o dinheiro entrou</Link>
          </Button>
        </nav>
      </div>
      {aClassificar ? (
        <Alerta
          tom="alerta"
          acao={
            <Button asChild tamanho="sm" variante="contorno">
              <Link href="/escritorio/honorarios/lancamentos?ver=classificar">Classificar</Link>
            </Button>
          }
        >
          {aClassificar} lançamento(s) sem linha da DRE ficaram fora deste resultado.
        </Alerta>
      ) : null}

      <TabelaDre dre={dre} rotuloPeriodo={periodo.rotulo} hrefLinha={(chave) => urlCom(rota, sp, { detalhe: chave })} ativa={detalhe} />

      {categoriaDetalhe ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>Lançamentos da linha</CardTitle>
            <Button asChild variante="fantasma" tamanho="iconeSm" aria-label="Fechar">
              <Link href={urlCom(rota, sp, { detalhe: null })}>
                <X />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {linhasDetalhe.length ? (
              <ul className="divide-y divide-border text-sm">
                {linhasDetalhe.map((l) => (
                  <li key={l.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {formatarData(l.data)} · {l.descricao}
                    </span>
                    <span className="font-medium">{formatarMoeda(l.valor)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum lançamento.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Previsto x recebido</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <THead>
                <Tr>
                  <Th>Mês</Th>
                  <Th className="text-right">Cobrado (vencimento)</Th>
                  <Th className="text-right">Recebido</Th>
                </Tr>
              </THead>
              <TBody>
                {previsto.map((p) => (
                  <Tr key={p.mes}>
                    <Td>{rotuloMesCurto(p.mes)}</Td>
                    <Td className="text-right">{formatarMoeda(p.cobrado)}</Td>
                    <Td className={`text-right font-medium ${p.recebido.lessThan(p.cobrado) ? "text-alerta" : "text-sucesso"}`}>{formatarMoeda(p.recebido)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receita por cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {porCliente.length ? (
              <ul className="divide-y divide-border text-sm">
                {porCliente.slice(0, 15).map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">{c.nome}</span>
                    <span className="font-medium">{formatarMoeda(c.total)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sem receitas no período.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {fora.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Fora da DRE (não mudam o lucro)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {fora.map((f) => (
                <li key={f.codigo} className="flex justify-between gap-2 py-2">
                  <span>
                    {f.codigo} {f.nome}
                  </span>
                  <span className="font-medium">{formatarMoeda(f.total)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
