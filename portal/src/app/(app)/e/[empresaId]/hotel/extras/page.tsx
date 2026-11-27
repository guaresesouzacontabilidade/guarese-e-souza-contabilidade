import type { Metadata } from "next";
import { Building2, FileSpreadsheet, FileText } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { CancelarRecibo, DialogoExtra, LancarExtras } from "@/components/hotel/extras";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarExtras, empresasClientesHotel, listarRecibosExtras, reservasPorStatus, type ReciboExtra } from "@/lib/hotel/dados";
import { FORMAS_PAGAMENTO_HOTEL, NATUREZAS_EXTRA, SUGESTOES_EXTRA, UNIDADES_EXTRA, quantidadeExtra, type FormaPagamentoHotel } from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDocumento, nomeMes } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Serviços extras" };

const SITUACAO: Record<ReciboExtra["situacao"], { rotulo: string; tom: "sucesso" | "info" | "perigo" | "alerta" | "neutro" }> = {
  pago: { rotulo: "Pago", tom: "sucesso" },
  parcial: { rotulo: "Pago em parte", tom: "alerta" },
  a_receber: { rotulo: "A receber", tom: "info" },
  vencido: { rotulo: "Vencido", tom: "perigo" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
};

function ultimoDia(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export default async function PaginaExtras({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/extras">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const mes = typeof sp.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.mes) ? sp.mes : hoje.slice(0, 7);
  const deUmaReserva = typeof sp.reserva === "string";
  const [hospedados, extras, empresas, recibos] = await Promise.all([
    reservasPorStatus(ctx.supabase, empresaId, ["hospedado"]),
    carregarExtras(ctx.supabase, empresaId),
    deUmaReserva ? Promise.resolve([]) : empresasClientesHotel(ctx.supabase, empresaId),
    deUmaReserva ? Promise.resolve([]) : listarRecibosExtras(ctx.supabase, empresaId, `${mes}-01`, ultimoDia(mes)),
  ]);
  const ativos = extras.filter((e) => e.ativo);
  const fixa = deUmaReserva ? hospedados.find((h) => h.id === sp.reserva) : undefined;
  const validos = recibos.filter((r) => r.situacao !== "cancelado");
  const somar = (lista: ReciboExtra[]) => lista.reduce((s, r) => s.plus(r.total), dec(0));
  const [ano, mesNum] = mes.split("-").map(Number);
  return (
    <>
      <CabecalhoPagina
        titulo={fixa ? `Serviços extras — quarto ${fixa.quarto}` : "Serviços extras"}
        descricao={
          fixa
            ? `Na conta de ${fixa.hospede}: quantidade × preço do cadastro, cobrado no check-out.`
            : "Refeições e marmitas, lavanderia e aluguel de carro com preço fixo: lance na conta do quarto do hóspede, ou para uma empresa, com recibo."
        }
        voltar={fixa ? { href: `/e/${empresaId}/hotel/reservas/${fixa.id}`, rotulo: `Reserva nº ${fixa.numero}` } : undefined}
        acoes={ctx.gerente && extras.length ? <DialogoExtra empresaId={empresaId} /> : undefined}
      />
      {!ativos.length ? (
        ctx.gerente ? (
          <Card className="mb-5">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm">
                Cadastre os serviços que o hotel cobra à parte, com o preço de cada um. Depois a recepção só informa a quantidade (marmitas, peças, dias de aluguel). Comece
                por uma sugestão:
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGESTOES_EXTRA.map((s) => (
                  <DialogoExtra key={s.nome} empresaId={empresaId} modelo={s} />
                ))}
                <DialogoExtra empresaId={empresaId} />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Alerta tom="info">Nenhum serviço extra cadastrado. Peça ao gerente do hotel para cadastrar as refeições, a lavanderia e o aluguel com o preço de cada um.</Alerta>
        )
      ) : deUmaReserva && !fixa ? (
        <Alerta tom="info" className="mb-5">
          Esta reserva não está com o hóspede na casa. Os serviços extras entram na conta de quem já fez o check-in.
        </Alerta>
      ) : (
        <div className="mb-5">
          <LancarExtras
            key={fixa?.id ?? "todos"}
            empresaId={empresaId}
            extras={ativos}
            reservaFixa={fixa?.id}
            empresas={fixa ? undefined : empresas}
            gerente={ctx.gerente}
            hoje={hoje}
            hospedagens={hospedados.map((h) => ({ reserva_id: h.id, quarto: h.quarto, hospede: h.hospede, entrada: h.entrada }))}
          />
        </div>
      )}

      {!deUmaReserva ? (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="size-5" /> Planilhas dos serviços extras
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <form action={`/api/hotel/${empresaId}/extras/planilha`} method="get" className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Dia</span>
                <Input name="dia" type="date" defaultValue={hoje} max={hoje} required className="h-9 w-44" aria-label="Dia da planilha" />
              </label>
              <Button type="submit" variante="contorno" tamanho="sm" className="h-9">
                <FileSpreadsheet /> Planilha do dia
              </Button>
            </form>
            <Button asChild variante="contorno" tamanho="sm" className="h-9">
              <a href={`/api/hotel/${empresaId}/extras/planilha?mes=${mes}`}>
                <FileSpreadsheet /> Planilha de {nomeMes(mesNum)}
              </a>
            </Button>
            <p className="w-full text-xs text-muted-foreground">Excel com tudo o que foi lançado: na conta dos quartos e para as empresas, com o resumo por serviço e por tipo.</p>
          </CardContent>
        </Card>
      ) : null}

      {!deUmaReserva ? (
        <Card className="mb-5">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-5" /> Recibos das empresas — {nomeMes(mesNum)} de {ano}
            </CardTitle>
            <form className="flex items-center gap-2" method="get">
              <label htmlFor="recibos-mes" className="sr-only">
                Mês
              </label>
              <Input id="recibos-mes" name="mes" type="month" defaultValue={mes} max={hoje.slice(0, 7)} className="h-9 w-40" />
              <Button type="submit" variante="contorno" tamanho="sm">
                Ver
              </Button>
            </form>
          </CardHeader>
          <CardContent className="space-y-4">
            {recibos.length ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Indicador rotulo="Lançado no mês" valor={formatarMoeda(somar(validos))} tom="neutro" />
                  <Indicador rotulo="Recebido" valor={formatarMoeda(somar(validos.filter((r) => r.situacao === "pago")))} tom="sucesso" />
                  <Indicador
                    rotulo="A receber"
                    valor={formatarMoeda(somar(validos.filter((r) => r.situacao !== "pago")))}
                    tom={validos.some((r) => r.situacao === "vencido") ? "perigo" : "info"}
                  />
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Recibo</Th>
                        <Th>Empresa</Th>
                        <Th className="hidden md:table-cell">Serviços</Th>
                        <Th>Pagamento</Th>
                        <Th className="text-right">Total</Th>
                        <Th className="w-20" />
                      </Tr>
                    </THead>
                    <TBody>
                      {recibos.map((r) => {
                        const st = SITUACAO[r.situacao];
                        return (
                          <Tr key={r.id} className={cn(r.situacao === "cancelado" && "text-muted-foreground")}>
                            <Td className="align-top whitespace-nowrap">
                              <span className="font-medium numero">Nº {r.numero}</span>
                              <span className="block text-xs text-muted-foreground">{formatarData(r.data)}</span>
                            </Td>
                            <Td className="align-top">
                              {r.empresa}
                              <span className="block text-xs text-muted-foreground">
                                {r.documento ? formatarDocumento(r.documento) : null}
                                {r.solicitante ? ` · ${r.solicitante}` : ""}
                              </span>
                            </Td>
                            <Td className="hidden align-top text-xs md:table-cell">
                              {r.itens.map((i, n) => (
                                <p key={n}>
                                  {quantidadeExtra(i.quantidade, i.unidade)} — {i.descricao}
                                </p>
                              ))}
                            </Td>
                            <Td className="align-top text-xs">
                              <Badge variante={st.tom}>{st.rotulo}</Badge>
                              <span className="mt-1 block text-muted-foreground">
                                {r.pagamento === "na_hora"
                                  ? (FORMAS_PAGAMENTO_HOTEL[r.forma as FormaPagamentoHotel] ?? r.forma)
                                  : `A prazo · vence ${formatarData(r.vencimento)}`}
                              </span>
                              {r.situacao === "cancelado" && r.motivo_cancelamento ? <span className="block">{r.motivo_cancelamento}</span> : null}
                            </Td>
                            <Td className={cn("whitespace-nowrap text-right align-top font-semibold numero", r.situacao === "cancelado" && "line-through")}>{formatarMoeda(r.total)}</Td>
                            <Td className="align-top">
                              <div className="flex justify-end gap-1">
                                <Button asChild variante="fantasma" tamanho="iconeSm">
                                  <a href={`/api/hotel/${empresaId}/recibos/${r.id}`} target="_blank" rel="noopener" aria-label={`Recibo nº ${r.numero} em PDF`}>
                                    <FileText />
                                  </a>
                                </Button>
                                {ctx.gerente && r.situacao !== "cancelado" ? <CancelarRecibo empresaId={empresaId} reciboId={r.id} numero={r.numero} /> : null}
                              </div>
                            </Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pago na hora entra no Financeiro já recebido. A prazo fica nas contas a receber do Financeiro: quando a empresa pagar, dê a baixa lá e o recibo passa para
                  “Pago”.
                </p>
              </>
            ) : (
              <EstadoVazio
                icone={Building2}
                titulo="Nenhum recibo neste mês"
                descricao="Escolha “Empresa” ao lançar serviços extras para quem não está hospedado. Cada lançamento gera um recibo numerado."
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {ctx.gerente && extras.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Serviços cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Serviço</Th>
                  <Th className="hidden sm:table-cell">Tipo</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="w-12" />
                </Tr>
              </THead>
              <TBody>
                {extras.map((e) => (
                  <Tr key={e.id} className={cn(!e.ativo && "text-muted-foreground")}>
                    <Td>
                      {e.nome} {!e.ativo ? <Badge className="ml-1">Fora de uso</Badge> : null}
                    </Td>
                    <Td className="hidden sm:table-cell">{NATUREZAS_EXTRA[e.natureza].rotulo}</Td>
                    <Td className="whitespace-nowrap text-right numero">
                      {formatarMoeda(e.preco)} <span className="text-xs text-muted-foreground">/ {UNIDADES_EXTRA[e.unidade].um}</span>
                    </Td>
                    <Td>
                      <DialogoExtra empresaId={empresaId} extra={e} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
