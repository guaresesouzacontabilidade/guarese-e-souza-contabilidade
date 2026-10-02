import { AlertTriangle } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Indicador } from "@/components/ui/pagina";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { CartoesSaude } from "./cartoes-saude";
import { GraficoComposicao, GraficoEvolucao } from "./graficos";
import { Dinheiro, TabelaDre, TabelaFluxo } from "./tabelas";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import type { SnapshotRelatorio } from "@/lib/relatorios/snapshot";

function Paragrafos({ texto }: { texto: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {texto
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
    </div>
  );
}

/** Conteúdo de um relatório (rascunho ou publicado) a partir da "foto" dos números. */
export function VisualizacaoRelatorio({
  tipo,
  dados,
  resumo,
  comentarios,
  limitacoes,
}: {
  tipo: string;
  dados: SnapshotRelatorio;
  resumo: string | null;
  comentarios: string | null;
  limitacoes: string[];
}) {
  const completo = tipo === "pacote_mensal";
  const mostrarDre = completo || tipo === "dre";
  const mostrarFluxo = completo || tipo === "fluxo_caixa";
  const mostrarIndicadores = completo || tipo === "resumo_executivo";
  const t = dados.dre.totais;
  const p = dados.projecao;

  return (
    <div className="space-y-6">
      {resumo?.trim() ? (
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-2 text-base font-semibold">Resumo</h2>
          <Paragrafos texto={resumo} />
        </section>
      ) : null}
      {comentarios?.trim() ? (
        <section className="rounded-xl border border-primary/30 bg-bege/50 p-5">
          <h2 className="mb-2 text-base font-semibold">Comentários do contador</h2>
          <Paragrafos texto={comentarios} />
        </section>
      ) : null}

      {mostrarIndicadores || mostrarDre ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
          <Indicador rotulo="Receitas" valor={formatarMoeda(t.receita_bruta.total)} />
          <Indicador rotulo="Custos e despesas" valor={formatarMoeda(dec(t.receita_bruta.total).minus(t.resultado_liquido.total))} />
          <Indicador
            rotulo={dec(t.resultado_liquido.total).isNegative() ? "Prejuízo" : "Lucro"}
            valor={formatarMoeda(t.resultado_liquido.total)}
            tom={dec(t.resultado_liquido.total).isNegative() ? "perigo" : "sucesso"}
          />
          <Indicador rotulo={`Saldo disponível em ${formatarData(dados.dataBase)}`} valor={formatarMoeda(p.saldoHoje)} />
        </div>
      ) : null}

      {mostrarIndicadores ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Indicadores de saúde financeira</h2>
          <CartoesSaude indicadores={dados.indicadores} />
        </section>
      ) : null}

      {completo && dados.evolucao.length ? (
        <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
          <GraficoEvolucao dados={dados.evolucao} />
          <GraficoComposicao dados={dados.composicao} />
        </div>
      ) : null}

      {mostrarDre ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Resultado do período (DRE)</h2>
          <TabelaDre dre={dados.dre} rotuloPeriodo={dados.periodo.rotulo} />
        </section>
      ) : null}

      {mostrarFluxo ? (
        <>
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Fluxo de caixa realizado</h2>
            <TabelaFluxo fluxo={dados.fluxo} />
          </section>
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Previsão de caixa (a partir de {formatarData(dados.dataBase)})</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
              <Indicador rotulo="Saldo na data" valor={formatarMoeda(p.saldoHoje)} />
              {p.janelas.map((j) => (
                <Indicador key={j.dias} rotulo={`Em ${j.dias} dias`} valor={formatarMoeda(j.saldo)} tom={dec(j.saldo).isNegative() ? "perigo" : "neutro"} />
              ))}
            </div>
            {p.menorSaldo && dec(p.menorSaldo.valor).isNegative() ? (
              <Alerta tom="perigo" titulo={`O caixa podia ficar negativo em ${formatarData(p.menorSaldo.data)}`}>
                Menor saldo previsto: {formatarMoeda(p.menorSaldo.valor)}.
              </Alerta>
            ) : null}
            {p.proximas.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Vencimento</Th>
                    <Th>Descrição</Th>
                    <Th className="text-right">A receber</Th>
                    <Th className="text-right">A pagar</Th>
                  </tr>
                </THead>
                <TBody>
                  {p.proximas.map((l, i) => (
                    <Tr key={i}>
                      <Td className="whitespace-nowrap text-sm">{l.vencido ? <Badge variante="perigo">vencida</Badge> : formatarData(l.data)}</Td>
                      <Td className="max-w-[20rem]">
                        <span className="block truncate">{l.descricao}</span>
                        {l.contraparte ? <span className="block truncate text-xs text-muted-foreground">{l.contraparte}</span> : null}
                      </Td>
                      <Td className="text-right text-sucesso">
                        <Dinheiro v={l.entrada} />
                      </Td>
                      <Td className="text-right text-perigo">
                        <Dinheiro v={l.saida} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : null}
          </section>
        </>
      ) : null}

      {limitacoes.length ? (
        <section className="rounded-xl border border-alerta/40 bg-alerta-bg p-4 text-sm text-alerta-fg">
          <p className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4" aria-hidden /> Limitações dos dados deste relatório
          </p>
          <ul className="list-disc space-y-0.5 pl-6">
            {limitacoes.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Relatório gerencial elaborado com base nas informações e documentos enviados pela empresa e registrados no portal. Não substitui as
        demonstrações contábeis oficiais.
      </p>
    </div>
  );
}
