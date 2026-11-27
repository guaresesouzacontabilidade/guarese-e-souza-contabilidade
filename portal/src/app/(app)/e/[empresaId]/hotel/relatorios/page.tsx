import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, ChevronLeft, ChevronRight, FileDown, Percent, TrendingUp, Wallet } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarRelatorio, mesAnterior, proximoMes } from "@/lib/hotel/relatorio";
import { FORMAS_PAGAMENTO_HOTEL, ORIGENS, SETORES, diaDaSemana, type FormaPagamentoHotel } from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { formatarMoeda } from "@/lib/dinheiro";
import { nomeMes } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Relatórios do hotel" };

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export default async function PaginaRelatoriosHotel({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/relatorios">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.gerente) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const mesAtual = hoje.slice(0, 7);
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) && sp.mes <= mesAtual ? sp.mes : mesAtual;
  const de = `${mes}-01`;
  const ate = proximoMes(mes);
  const { indicadores: i, recebido, recebidoTotal, aReceber } = await carregarRelatorio(ctx.supabase, empresaId, de, ate);
  const base = `/e/${empresaId}/hotel`;
  const nomeDoMes = nomeMes(Number(mes.slice(5, 7)));
  const nome = `${nomeDoMes.charAt(0).toUpperCase()}${nomeDoMes.slice(1)} de ${mes.slice(0, 4)}`;
  const emAndamento = mes === mesAtual;
  const maxDia = Math.max(1, ...i.porDia.map((d) => d.ocupados));

  return (
    <>
      <CabecalhoPagina
        titulo="Relatórios do hotel"
        descricao="Ocupação, diária média, receita por quarto disponível (RevPAR), origem das reservas e recebimentos do mês."
        acoes={
          <Button asChild variante="contorno">
            <a href={`/api/hotel/${empresaId}/relatorio?mes=${mes}`}>
              <FileDown /> Baixar PDF
            </a>
          </Button>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variante="contorno" tamanho="sm">
          <Link href={`${base}/relatorios?mes=${mesAnterior(mes)}`} aria-label="Mês anterior">
            <ChevronLeft />
          </Link>
        </Button>
        <span className="min-w-40 text-center font-semibold">{nome}</span>
        {mes < mesAtual ? (
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={`${base}/relatorios?mes=${proximoMes(mes).slice(0, 7)}`} aria-label="Próximo mês">
              <ChevronRight />
            </Link>
          </Button>
        ) : null}
        {emAndamento ? <span className="text-xs text-muted-foreground">mês em andamento (diárias entram na receita no check-out)</span> : null}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Taxa de ocupação" valor={pct(i.ocupacao)} detalhe={`${i.noitesVendidas} de ${i.quartosNoite} quartos-noite`} icone={Percent} tom={i.ocupacao >= 0.6 ? "sucesso" : "info"} />
        <Indicador rotulo="Diária média" valor={formatarMoeda(i.diariaMedia)} detalhe={`${i.noitesFaturadas} diárias cobradas`} icone={BedDouble} />
        <Indicador rotulo="RevPAR" valor={formatarMoeda(i.revpar)} detalhe="receita de diárias por quarto disponível" icone={TrendingUp} />
        <Indicador rotulo="Recebido no mês" valor={formatarMoeda(recebidoTotal)} detalhe={aReceber ? `+ ${formatarMoeda(aReceber)} faturado a receber` : "hospedagens"} icone={Wallet} tom="sucesso" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quartos ocupados por noite</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-end gap-0.5" role="img" aria-label="Quartos ocupados em cada noite do mês">
              {i.porDia.map((d) => (
                <div key={d.data} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.data.split("-").reverse().join("/")}: ${d.ocupados} quarto(s) — ${pct(d.ocupacao)}`}>
                  <div
                    className={cn("w-full rounded-t-sm", d.data > hoje ? "bg-muted" : d.ocupacao >= 0.8 ? "bg-sucesso" : "bg-primary/70")}
                    style={{ height: `${(d.ocupados / maxDia) * 100}%`, minHeight: d.ocupados ? 2 : 0 }}
                  />
                  <span className={cn("mt-1 text-center text-[9px] text-muted-foreground", ["sáb", "dom"].includes(diaDaSemana(d.data)) && "font-semibold")}>{Number(d.data.slice(8))}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resumo do mês</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Hospedagens no mês", String(i.hospedagens)],
                ["Receita de diárias", formatarMoeda(i.receitaDiarias)],
                ["Consumo (restaurante, bar, frigobar)", formatarMoeda(i.receitaConsumo)],
                ["Serviços e descontos", formatarMoeda(i.receitaServicos)],
                ...i.porServico.map((sv) => [`   ${SETORES[sv.setor] ?? sv.setor}`, formatarMoeda(sv.total)]),
                ["Cancelamentos", String(i.canceladas)],
                ["Não comparecimentos (no-show)", String(i.noShow)],
              ].map(([r, v]) => (
                <div key={r} className={cn("flex justify-between gap-3", r.startsWith("   ") && "pl-4 text-xs")}>
                  <dt className="text-muted-foreground">{r.trim()}</dt>
                  <dd className="whitespace-nowrap font-medium numero">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">De onde vêm as reservas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Origem</Th>
                  <Th className="text-right">Reservas</Th>
                  <Th className="text-right">Noites</Th>
                </Tr>
              </THead>
              <TBody>
                {i.porOrigem.length ? (
                  i.porOrigem.map((o) => (
                    <Tr key={o.origem}>
                      <Td>{ORIGENS[o.origem] ?? o.origem}</Td>
                      <Td className="text-right">{o.reservas}</Td>
                      <Td className="text-right">{o.noites}</Td>
                    </Tr>
                  ))
                ) : (
                  <Tr>
                    <Td colSpan={3} className="text-center text-muted-foreground">
                      Sem hospedagens no mês.
                    </Td>
                  </Tr>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por categoria de quarto</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Categoria</Th>
                  <Th className="text-right">Noites</Th>
                  <Th className="text-right">Diárias</Th>
                </Tr>
              </THead>
              <TBody>
                {i.porCategoria.map((c) => (
                  <Tr key={c.categoria}>
                    <Td>{c.categoria}</Td>
                    <Td className="text-right">{c.noites}</Td>
                    <Td className="whitespace-nowrap text-right numero">{formatarMoeda(c.receita)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recebimentos por forma</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TBody>
                {recebido.length ? (
                  recebido.map((r) => (
                    <Tr key={r.forma}>
                      <Td>
                        {FORMAS_PAGAMENTO_HOTEL[r.forma as FormaPagamentoHotel] ?? r.forma}
                        <span className="ml-1 text-xs text-muted-foreground">({r.quantidade})</span>
                      </Td>
                      <Td className="whitespace-nowrap text-right numero">{formatarMoeda(r.valor)}</Td>
                    </Tr>
                  ))
                ) : (
                  <Tr>
                    <Td className="text-center text-muted-foreground">Nenhum recebimento no mês.</Td>
                  </Tr>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Ocupação = noites ocupadas ÷ (quartos em uso × noites do mês). Diária média = receita de diárias ÷ diárias cobradas. RevPAR = receita de diárias ÷ quartos-noite
        disponíveis. As diárias entram na receita no check-out, na data de cada noite.
      </p>
    </>
  );
}
