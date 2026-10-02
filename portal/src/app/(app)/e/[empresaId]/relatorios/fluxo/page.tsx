import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { GraficoProjecao } from "@/components/relatorios/graficos";
import { SeletorPeriodo } from "@/components/relatorios/seletor-periodo";
import { carregarFluxo, carregarProjecao } from "@/lib/relatorios/dados";
import { GRUPOS_FLUXO } from "@/lib/relatorios/fluxo";
import { lerPeriodo, opcoesPeriodo, rotuloMesCurto } from "@/lib/relatorios/periodo";
import { parametro } from "@/lib/busca";
import { hojeISO, somarDias } from "@/lib/competencia";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Fluxo de caixa" };

const Dinheiro = ({ v, sinal }: { v: string | number; sinal?: boolean }) => {
  const d = dec(v);
  return <span className={cn("numero whitespace-nowrap", d.isZero() && "text-muted-foreground", sinal && d.isNegative() && "text-perigo")}>{d.isZero() ? "—" : formatarMoeda(d)}</span>;
};

export default async function FluxoCaixa({ params, searchParams }: PageProps<"/e/[empresaId]/relatorios/fluxo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("financeiro.ver")) redirect(`/e/${empresaId}/relatorios/publicados`);
  const hoje = hojeISO();
  const periodo = lerPeriodo(parametro(sp, "periodo"), hoje);
  const [fluxo, prev] = await Promise.all([carregarFluxo(ctx.supabase, empresaId, periodo.inicio, periodo.fim), carregarProjecao(ctx.supabase, empresaId, hoje, 90)]);
  const grupos = Object.keys(GRUPOS_FLUXO).filter((g) => fluxo.meses.some((m) => m.porGrupo[g]));
  const temAbertura = fluxo.meses.some((m) => !dec(m.abertura).isZero());
  const proximos = prev.linhas.filter((l) => l.data <= somarDias(hoje, 30)).slice(0, 60);
  const exportar = (formato: string) => `/api/relatorios/exportar?empresa=${empresaId}&tipo=fluxo&periodo=${periodo.chave}&formato=${formato}`;
  const p = prev.projecao;

  return (
    <>
      <CabecalhoPagina
        titulo="Fluxo de caixa"
        descricao="O dinheiro que efetivamente entrou e saiu (pela data do pagamento) e a previsão para os próximos 90 dias."
        acoes={
          <>
            <Button asChild variante="contorno">
              <a href={exportar("pdf")}>
                <FileDown /> PDF
              </a>
            </Button>
            <Button asChild variante="contorno">
              <a href={exportar("xlsx")}>
                <FileSpreadsheet /> Excel
              </a>
            </Button>
          </>
        }
      />
      <SeletorPeriodo valor={periodo.chave} opcoes={opcoesPeriodo(hoje)} className="mb-4" />

      <section className="mb-8 space-y-3" aria-labelledby="t-realizado">
        <h2 id="t-realizado" className="text-base font-semibold">
          Realizado — {periodo.rotulo}
        </h2>
        <Table className="min-w-[560px]">
          <THead>
            <tr>
              <Th className="sticky left-0 z-10 min-w-56 bg-muted">Movimento</Th>
              {fluxo.meses.map((m) => (
                <Th key={m.mes} className="text-right">
                  {rotuloMesCurto(m.mes)}
                </Th>
              ))}
              {fluxo.meses.length > 1 ? <Th className="text-right">Total</Th> : null}
            </tr>
          </THead>
          <TBody>
            <Tr className="bg-muted/50">
              <Td className="sticky left-0 z-10 bg-muted font-semibold">Saldo no início</Td>
              {fluxo.meses.map((m) => (
                <Td key={m.mes} className="text-right font-semibold">
                  <Dinheiro v={m.saldoInicial} sinal />
                </Td>
              ))}
              {fluxo.meses.length > 1 ? <Td /> : null}
            </Tr>
            {grupos.map((g) => (
              <Linhas key={g} grupo={g} meses={fluxo.meses} />
            ))}
            {temAbertura ? (
              <Tr>
                <Td className="sticky left-0 z-10 bg-card text-sm">Saldo inicial de contas cadastradas</Td>
                {fluxo.meses.map((m) => (
                  <Td key={m.mes} className="text-right text-sm">
                    <Dinheiro v={m.abertura} />
                  </Td>
                ))}
                {fluxo.meses.length > 1 ? <Td /> : null}
              </Tr>
            ) : null}
          </TBody>
          <TFoot>
            <Tr>
              <Td className="sticky left-0 z-10 bg-muted">Geração de caixa (entradas − saídas)</Td>
              {fluxo.meses.map((m) => (
                <Td key={m.mes} className="text-right">
                  <Dinheiro v={dec(m.entradas).minus(m.saidas).toFixed(2)} sinal />
                </Td>
              ))}
              {fluxo.meses.length > 1 ? (
                <Td className="text-right">
                  <Dinheiro v={fluxo.total.geracao} sinal />
                </Td>
              ) : null}
            </Tr>
            <Tr>
              <Td className="sticky left-0 z-10 bg-muted">Saldo no fim</Td>
              {fluxo.meses.map((m) => (
                <Td key={m.mes} className="text-right">
                  <Dinheiro v={m.saldoFinal} sinal />
                </Td>
              ))}
              {fluxo.meses.length > 1 ? <Td /> : null}
            </Tr>
          </TFoot>
        </Table>
        <p className="text-xs text-muted-foreground">
          Considera as contas que compõem o saldo disponível (bancos, caixa, cartões). Transferências entre essas contas não aparecem porque o dinheiro
          continua na empresa.
        </p>

        {fluxo.porCategoria.length ? (
          <details className="rounded-lg border border-border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Ver entradas e saídas por categoria</summary>
            <div className="px-4 pb-4">
              <Table>
                <THead>
                  <tr>
                    <Th>Grupo</Th>
                    <Th>Categoria</Th>
                    <Th className="text-right">Entradas</Th>
                    <Th className="text-right">Saídas</Th>
                  </tr>
                </THead>
                <TBody>
                  {fluxo.porCategoria.map((c) => (
                    <Tr key={`${c.grupo}|${c.categoria}`}>
                      <Td className="text-sm text-muted-foreground">{GRUPOS_FLUXO[c.grupo] ?? c.grupo}</Td>
                      <Td className="text-sm">{c.categoria}</Td>
                      <Td className="text-right text-sm text-sucesso">
                        <Dinheiro v={c.entradas} />
                      </Td>
                      <Td className="text-right text-sm text-perigo">
                        <Dinheiro v={c.saidas} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </details>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="t-projetado">
        <h2 id="t-projetado" className="text-base font-semibold">
          Previsão — próximos 90 dias
        </h2>
        {prev.semSaldoInicial ? (
          <Alerta tom="alerta">
            {prev.semSaldoInicial} conta(s) sem saldo inicial válido para hoje. Confira em{" "}
            <Link className="underline" href={`/e/${empresaId}/financeiro/contas`}>
              Contas e saldos
            </Link>
            .
          </Alerta>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
          <Indicador rotulo="Saldo disponível hoje" valor={formatarMoeda(prev.saldoHoje)} tom={dec(prev.saldoHoje).isNegative() ? "perigo" : "neutro"} />
          {p.janelas.map((j) => (
            <Indicador
              key={j.dias}
              rotulo={`Previsto em ${j.dias} dias`}
              valor={formatarMoeda(j.saldo)}
              tom={dec(j.saldo).isNegative() ? "perigo" : "neutro"}
              detalhe={
                <>
                  +{formatarMoeda(j.entradas)} / −{formatarMoeda(j.saidas)}
                </>
              }
            />
          ))}
        </div>
        {p.menorSaldo && dec(p.menorSaldo.valor).isNegative() ? (
          <Alerta tom="perigo" titulo={`O caixa pode ficar negativo em ${formatarData(p.menorSaldo.data)}`}>
            Menor saldo previsto: {formatarMoeda(p.menorSaldo.valor)}. Considere antecipar recebimentos, negociar prazos ou adiar pagamentos.
          </Alerta>
        ) : null}
        <GraficoProjecao pontos={p.pontos} />
        <h3 className="pt-2 text-sm font-semibold">Contas dos próximos 30 dias (incluindo vencidas)</h3>
        {proximos.length ? (
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
              {proximos.map((l, i) => (
                <Tr key={`${l.lancamento_id ?? l.descricao}-${i}`}>
                  <Td className="whitespace-nowrap text-sm">
                    {l.vencido ? <Badge variante="perigo">vencida</Badge> : formatarData(l.data)}
                  </Td>
                  <Td className="max-w-[20rem]">
                    {l.lancamento_id ? (
                      <Link href={`/e/${empresaId}/financeiro/lancamentos/${l.lancamento_id}`} className="block truncate hover:underline">
                        {l.descricao}
                      </Link>
                    ) : (
                      <span className="block truncate">{l.descricao}</span>
                    )}
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
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma conta a pagar ou a receber nos próximos 30 dias.</p>
        )}
      </section>
    </>
  );
}

function Linhas({ grupo, meses }: { grupo: string; meses: { mes: string; porGrupo: Record<string, { entradas: string; saidas: string }> }[] }) {
  const entradas = meses.map((m) => m.porGrupo[grupo]?.entradas ?? "0");
  const saidas = meses.map((m) => m.porGrupo[grupo]?.saidas ?? "0");
  const soma = (l: string[]) => l.reduce((t, v) => t.plus(dec(v)), dec(0)).toFixed(2);
  const varios = meses.length > 1;
  return (
    <>
      <Tr>
        <Td className="sticky left-0 z-10 bg-card text-sm">
          <span className="font-medium">{GRUPOS_FLUXO[grupo]}</span> — entradas
        </Td>
        {entradas.map((v, i) => (
          <Td key={meses[i].mes} className="text-right text-sm text-sucesso">
            <Dinheiro v={v} />
          </Td>
        ))}
        {varios ? (
          <Td className="text-right text-sm text-sucesso">
            <Dinheiro v={soma(entradas)} />
          </Td>
        ) : null}
      </Tr>
      <Tr>
        <Td className="sticky left-0 z-10 bg-card text-sm">
          <span className="font-medium">{GRUPOS_FLUXO[grupo]}</span> — saídas
        </Td>
        {saidas.map((v, i) => (
          <Td key={meses[i].mes} className="text-right text-sm text-perigo">
            <Dinheiro v={v} />
          </Td>
        ))}
        {varios ? (
          <Td className="text-right text-sm text-perigo">
            <Dinheiro v={soma(saidas)} />
          </Td>
        ) : null}
      </Tr>
    </>
  );
}
