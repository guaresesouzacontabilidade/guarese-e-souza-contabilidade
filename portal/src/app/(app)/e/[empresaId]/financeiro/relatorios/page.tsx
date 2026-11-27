import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, ChartLine, FileSpreadsheet, FileText, HeartPulse, Scale, Truck } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Relatórios do financeiro" };

type Item = { titulo: string; descricao: string; href: string; icone: typeof ChartLine; externo?: boolean };

/** Relatórios do financeiro reunidos num lugar só. */
export default async function RelatoriosFinanceiro({ params }: PageProps<"/e/[empresaId]/financeiro/relatorios">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  const f = `/e/${empresaId}/financeiro`;
  const exportar = ctx.pode("financeiro.exportar");
  const grupos: { titulo: string; itens: Item[] }[] = [
    {
      titulo: "Resultado e caixa",
      itens: [
        { titulo: "Saúde financeira", descricao: "Resultado, caixa, contas a pagar e a receber — com explicações simples.", href: `${f}/relatorios/saude`, icone: HeartPulse },
        { titulo: "Resultado (DRE gerencial)", descricao: "Receitas, custos, despesas e lucro pela competência; abra a composição de cada linha.", href: `${f}/relatorios/dre`, icone: Scale },
        { titulo: "Fluxo de caixa", descricao: "Entradas e saídas realizadas e previstas, por mês.", href: `${f}/fluxo`, icone: ChartLine },
      ],
    },
    {
      titulo: "Contas a pagar e a receber (planilhas com os filtros da tela)",
      itens: exportar
        ? [
            { titulo: "Contas a pagar em Excel", descricao: "Tudo em aberto, com vencimento, fornecedor, valor original, pago e saldo.", href: `/api/financeiro/exportar?empresa=${empresaId}&formato=xlsx&tipo=pagar&situacao=em_aberto`, icone: FileSpreadsheet, externo: true },
            { titulo: "Contas a receber em Excel", descricao: "Tudo em aberto, com vencimento, cliente, valor original, recebido e saldo.", href: `/api/financeiro/exportar?empresa=${empresaId}&formato=xlsx&tipo=receber&situacao=em_aberto`, icone: FileSpreadsheet, externo: true },
            { titulo: "Inadimplência (vencidos a receber)", descricao: "Os recebimentos vencidos, do mais antigo ao mais novo.", href: `/api/financeiro/exportar?empresa=${empresaId}&formato=xlsx&tipo=receber&situacao=em_aberto&prazo=vencido`, icone: FileSpreadsheet, externo: true },
          ]
        : [],
    },
    {
      titulo: "Outros",
      itens: [
        ...(ctx.pode("relatorios.ver") ? [{ titulo: "Relatórios do escritório", descricao: "Os relatórios que o escritório publicou para a empresa.", href: `/e/${empresaId}/relatorios/publicados`, icone: BookOpenCheck }] : []),
        ...(ctx.acesso.frota || ctx.acesso.cte || ctx.equipe ? [{ titulo: "Rentabilidade da frota", descricao: "Resultado por caminhão e por viagem.", href: `/e/${empresaId}/frota`, icone: Truck }] : []),
      ],
    },
  ];

  return (
    <>
      <CabecalhoPagina titulo="Relatórios do financeiro" descricao="Resultado, caixa e as listas de contas a pagar e a receber. Para imprimir, abra o relatório e use o PDF ou a impressão do navegador." />
      <div className="space-y-6">
        {grupos
          .filter((g) => g.itens.length)
          .map((g) => (
            <section key={g.titulo}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{g.titulo}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.itens.map((i) => {
                  const Icone = i.icone;
                  const conteudo = (
                    <>
                      <Icone className="mt-0.5 size-5 shrink-0 text-primary" />
                      <span>
                        <span className="block font-medium">{i.titulo}</span>
                        <span className="text-sm text-muted-foreground">{i.descricao}</span>
                      </span>
                    </>
                  );
                  const classe = "flex h-full items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40";
                  return (
                    <li key={i.titulo}>
                      {i.externo ? (
                        <a href={i.href} className={classe}>
                          {conteudo}
                        </a>
                      ) : (
                        <Link href={i.href} className={classe}>
                          {conteudo}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p className="mb-1 flex items-center gap-2 font-medium text-foreground">
            <FileText className="size-4" /> Próximos relatórios <Badge variante="neutro">etapa 3</Badge>
          </p>
          Inadimplência por faixa de atraso, extrato financeiro, despesas por categoria, resultado por empresa, filial e centro de custo, fluxo projetado por
          dia/semana/mês e comparação de períodos na DRE.
        </section>
      </div>
    </>
  );
}
