import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, FileText, Pencil, Printer, UserRound, UtensilsCrossed } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import {
  BotaoCheckout,
  CancelarItem,
  DialogoCancelarReserva,
  DialogoCheckin,
  DialogoPagamento,
  DialogoServico,
  DialogoTrocarQuarto,
  EstornarPagamento,
} from "@/components/hotel/conta";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarQuartos, carregarReserva, empresasParaFaturar } from "@/lib/hotel/dados";
import {
  FORMAS_PAGAMENTO_HOTEL,
  LIMPEZA,
  MEIOS_TRANSPORTE,
  MOTIVOS_VIAGEM,
  ORIGENS,
  SETORES,
  STATUS_RESERVA,
  TIPOS_DOCUMENTO,
  TIPOS_ITEM,
  VARIANTE_STATUS,
  diaMes,
  noites,
  type Limpeza,
  type StatusReserva,
} from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCpf, formatarData, formatarDataHora, formatarTelefone } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reserva" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right font-medium">{valor ?? "—"}</dd>
    </div>
  );
}

export default async function PaginaReserva({ params }: PageProps<"/e/[empresaId]/hotel/reservas/[reservaId]">) {
  const { empresaId, reservaId } = await params;
  if (!UUID.test(reservaId)) notFound();
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const [completa, quartos, empresas, { data: ativas }] = await Promise.all([
    carregarReserva(ctx.supabase, empresaId, reservaId),
    carregarQuartos(ctx.supabase, empresaId, true),
    empresasParaFaturar(ctx.supabase, empresaId),
    ctx.supabase.from("hotel_reservas").select("id, quarto_id, entrada, saida").eq("empresa_id", empresaId).in("status", ["pre_reserva", "confirmada", "hospedado"]).gte("saida", hoje),
  ]);
  if (!completa) notFound();
  const { reserva: r, itens, pagamentos, acompanhantes, resumo } = completa;
  const status = r.status as StatusReserva;
  const h = r.hospede;
  const base = `/e/${empresaId}/hotel`;
  const aberta = ["pre_reserva", "confirmada", "hospedado"].includes(status);
  const hospedado = status === "hospedado";
  const aguardando = status === "pre_reserva" || status === "confirmada";
  const limpeza = (r.quarto?.limpeza ?? "limpo") as Limpeza;
  const bloqueioCheckin = aguardando
    ? r.entrada > hoje
      ? `A entrada desta reserva é ${formatarData(r.entrada)}. Para fazer o check-in hoje, altere a data de entrada.`
      : limpeza !== "limpo"
        ? `O quarto ${r.quarto?.numero} está ${LIMPEZA[limpeza].toLowerCase()}. Libere-o na governança ou troque o quarto antes do check-in.`
        : !h?.cpf && !h?.documento
          ? `Complete o cadastro de ${h?.nome} com o CPF ou outro documento antes do check-in.`
          : null
    : null;
  const inicioTroca = hospedado ? (r.entrada > hoje ? r.entrada : hoje) : r.entrada;
  const opcoesTroca = quartos
    .filter((q) => q.id !== r.quarto_id)
    .map((q) => {
      const ocupado = (ativas ?? []).some((a) => a.id !== r.id && a.quarto_id === q.id && a.entrada < r.saida && inicioTroca < a.saida);
      const cabe = r.adultos + r.criancas <= q.categoria.capacidade;
      const livre = !ocupado && cabe && (!hospedado || q.limpeza === "limpo");
      return {
        id: q.id,
        livre,
        rotulo: `${q.numero} — ${q.categoria.nome}${ocupado ? " · ocupado" : !cabe ? " · pequeno" : hospedado && q.limpeza !== "limpo" ? ` · ${LIMPEZA[q.limpeza].toLowerCase()}` : ""}`,
      };
    });
  const itensValidos = itens.filter((i) => !i.cancelado_em);
  const pagosValidos = pagamentos.filter((p) => !p.cancelado_em);
  const saldo = resumo?.saldo ?? 0;

  return (
    <>
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Reserva nº {r.numero} <Badge variante={VARIANTE_STATUS[status]}>{STATUS_RESERVA[status]}</Badge>
          </span>
        }
        descricao={`${h?.nome ?? ""} · quarto ${r.quarto?.numero ?? ""} (${r.categoria?.nome ?? ""}) · ${diaMes(r.entrada)} a ${diaMes(r.saida)}`}
        voltar={{ href: `${base}/reservas`, rotulo: "Reservas" }}
        acoes={
          <>
            <Button asChild variante="contorno" tamanho="sm">
              <a href={`/api/hotel/${empresaId}/reservas/${r.id}?doc=ficha`} target="_blank" rel="noopener">
                <Printer /> Ficha do hóspede
              </a>
            </Button>
            <Button asChild variante="contorno" tamanho="sm">
              <a href={`/api/hotel/${empresaId}/reservas/${r.id}?doc=conta`} target="_blank" rel="noopener">
                <FileText /> {status === "encerrada" ? "Recibo da conta" : aguardando ? "Confirmação" : "Extrato da conta"}
              </a>
            </Button>
            {aberta ? (
              <Button asChild variante="contorno" tamanho="sm">
                <Link href={`${base}/reservas/${r.id}/editar`}>
                  <Pencil /> Alterar
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {aguardando ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-info/40 bg-info-bg/40 p-4">
          <p className="mr-auto text-sm">
            {r.entrada <= hoje ? <strong>O hóspede chega hoje.</strong> : <>Chegada em {formatarData(r.entrada)}.</>} Faça o check-in quando ele chegar.
          </p>
          <DialogoCheckin
            empresaId={empresaId}
            reservaId={r.id}
            quarto={r.quarto?.numero ?? ""}
            bloqueio={bloqueioCheckin}
            padrao={{ motivo_viagem: r.motivo_viagem, meio_transporte: r.meio_transporte, placa_veiculo: r.placa_veiculo, procedencia: r.procedencia, destino: r.destino }}
          />
          <DialogoTrocarQuarto empresaId={empresaId} reservaId={r.id} quartos={opcoesTroca} />
          <DialogoCancelarReserva empresaId={empresaId} reservaId={r.id} podeNoShow={r.entrada <= hoje} />
        </div>
      ) : null}
      {hospedado ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-sucesso/40 bg-sucesso-bg/40 p-4">
          <p className="mr-auto text-sm">
            <strong>Hospedado</strong> desde {formatarDataHora(r.checkin_em)}. Saída prevista: {formatarData(r.saida)}
            {r.saida < hoje ? <span className="text-perigo"> (passou da data — prorrogue em Alterar ou faça o check-out)</span> : null}.
          </p>
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={`${base}/consumo?reserva=${r.id}`}>
              <UtensilsCrossed /> Lançar consumo
            </Link>
          </Button>
          <DialogoServico empresaId={empresaId} reservaId={r.id} />
          {ctx.gerente ? <DialogoServico empresaId={empresaId} reservaId={r.id} desconto /> : null}
          <DialogoTrocarQuarto empresaId={empresaId} reservaId={r.id} quartos={opcoesTroca} />
        </div>
      ) : null}
      {status === "cancelada" || status === "no_show" ? (
        <Alerta tom="perigo" className="mb-5">
          {STATUS_RESERVA[status]} em {formatarDataHora(r.cancelada_em)}: {r.motivo_cancelamento}
        </Alerta>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conta do hóspede</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <Tr>
                    <Th>Data</Th>
                    <Th>Lançamento</Th>
                    <Th className="text-right">Qtd.</Th>
                    <Th className="text-right">Valor</Th>
                    {ctx.gerente && hospedado ? <Th /> : null}
                  </Tr>
                </THead>
                <TBody>
                  {status !== "encerrada" && resumo && resumo.noites > 0 ? (
                    <Tr className="text-muted-foreground">
                      <Td>{diaMes(r.entrada)}</Td>
                      <Td>
                        {resumo.noites} diária{resumo.noites > 1 ? "s" : ""} {hospedado ? "até hoje (lançadas no check-out)" : "previstas"}
                      </Td>
                      <Td className="text-right">{resumo.noites}</Td>
                      <Td className="text-right numero">{formatarMoeda(resumo.diarias)}</Td>
                      {ctx.gerente && hospedado ? <Td /> : null}
                    </Tr>
                  ) : null}
                  {itens.map((i) => (
                    <Tr key={i.id} className={cn(i.cancelado_em && "text-muted-foreground line-through")}>
                      <Td className="whitespace-nowrap">{diaMes(i.data)}</Td>
                      <Td>
                        {i.descricao}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {TIPOS_ITEM[i.tipo]}
                          {i.setor ? ` · ${SETORES[i.setor] ?? i.setor}` : ""}
                        </span>
                      </Td>
                      <Td className="text-right">{Number(i.quantidade).toLocaleString("pt-BR")}</Td>
                      <Td className="text-right numero">{formatarMoeda(i.total)}</Td>
                      {ctx.gerente && hospedado ? (
                        <Td className="w-10">{!i.cancelado_em && i.tipo !== "diaria" && i.tipo !== "taxa_servico" ? <CancelarItem empresaId={empresaId} itemId={i.id} descricao={i.descricao} /> : null}</Td>
                      ) : null}
                    </Tr>
                  ))}
                  {hospedado && resumo && resumo.taxa_servico > 0 ? (
                    <Tr className="text-muted-foreground">
                      <Td />
                      <Td>Taxa de serviço ({String(resumo.taxa_servico_percentual ?? "").replace(".", ",")}% do consumo, lançada no check-out)</Td>
                      <Td />
                      <Td className="text-right numero">{formatarMoeda(resumo.taxa_servico)}</Td>
                      {ctx.gerente ? <Td /> : null}
                    </Tr>
                  ) : null}
                  {!itensValidos.length && !(resumo && resumo.noites) ? (
                    <Tr>
                      <Td colSpan={5} className="text-center text-muted-foreground">
                        Nada lançado ainda.
                      </Td>
                    </Tr>
                  ) : null}
                </TBody>
                <TFoot>
                  <Tr>
                    <Td colSpan={3} className="font-semibold">
                      Total {status === "encerrada" ? "" : hospedado ? "se sair hoje" : "previsto"}
                    </Td>
                    <Td className="text-right font-semibold numero">{formatarMoeda(resumo?.total ?? 0)}</Td>
                    {ctx.gerente && hospedado ? <Td /> : null}
                  </Tr>
                </TFoot>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Pagamentos</CardTitle>
              {aberta ? (
                <DialogoPagamento
                  empresaId={empresaId}
                  reservaId={r.id}
                  sugerido={Math.max(hospedado ? saldo : 0, 0)}
                  sinal={!hospedado}
                  empresas={empresas.map((e) => ({ id: e.id, nome: e.nome }))}
                  faturarPadrao={r.empresa_faturar_id}
                  hoje={hoje}
                />
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {pagamentos.length ? (
                <Table>
                  <TBody>
                    {pagamentos.map((p) => (
                      <Tr key={p.id} className={cn(p.cancelado_em && "text-muted-foreground line-through")}>
                        <Td className="whitespace-nowrap">{diaMes(p.data)}</Td>
                        <Td>
                          {FORMAS_PAGAMENTO_HOTEL[p.forma as keyof typeof FORMAS_PAGAMENTO_HOTEL] ?? p.forma}
                          {p.adiantamento ? <Badge className="ml-1">Sinal</Badge> : null}
                          {p.forma === "faturado" ? <span className="block text-xs text-muted-foreground">{p.contraparte?.nome} · vence {p.vencimento ? formatarData(p.vencimento) : ""}</span> : null}
                          {p.cancelado_em ? <span className="block text-xs no-underline">Estornado: {p.motivo_cancelamento}</span> : p.observacao ? <span className="block text-xs text-muted-foreground">{p.observacao}</span> : null}
                        </Td>
                        <Td className="text-right numero">{formatarMoeda(p.valor)}</Td>
                        {ctx.gerente && aberta ? (
                          <Td className="w-10">{!p.cancelado_em ? <EstornarPagamento empresaId={empresaId} pagamentoId={p.id} descricao={`${FORMAS_PAGAMENTO_HOTEL[p.forma as keyof typeof FORMAS_PAGAMENTO_HOTEL]} de ${formatarMoeda(p.valor)}`} /> : null}</Td>
                        ) : null}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className={cn(hospedado && saldo !== 0 && "border-alerta/50")}>
            <CardContent className="space-y-1 pt-5">
              <Linha rotulo={hospedado ? `Diárias até hoje (${resumo?.noites ?? 0})` : `Diárias (${resumo?.noites ?? 0})`} valor={formatarMoeda(resumo?.diarias ?? 0)} />
              <Linha rotulo="Consumo" valor={formatarMoeda(resumo?.consumo ?? 0)} />
              {resumo?.taxa_servico ? <Linha rotulo="Taxa de serviço" valor={formatarMoeda(resumo.taxa_servico)} /> : null}
              {resumo?.servicos ? <Linha rotulo="Serviços" valor={formatarMoeda(resumo.servicos)} /> : null}
              {resumo?.descontos ? <Linha rotulo="Descontos" valor={formatarMoeda(resumo.descontos)} /> : null}
              <Linha rotulo="Pago" valor={formatarMoeda(resumo?.pago ?? 0)} />
              <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
                <span className="font-semibold">{saldo >= 0 ? "Falta receber" : "Pago a mais"}</span>
                <span className={cn("font-titulo text-2xl font-bold numero", saldo > 0 ? "text-alerta" : saldo < 0 ? "text-perigo" : "text-sucesso")}>{formatarMoeda(Math.abs(saldo))}</span>
              </div>
              {hospedado && resumo && resumo.noites_previstas !== resumo.noites ? (
                <p className="text-xs text-muted-foreground">
                  Se ficar até {formatarData(r.saida)}: {resumo.noites_previstas} diárias, total {formatarMoeda(resumo.total_previsto)}.
                </p>
              ) : null}
              {hospedado ? (
                <div className="pt-3">
                  <BotaoCheckout empresaId={empresaId} reservaId={r.id} saldo={saldo} />
                </div>
              ) : null}
              {status === "encerrada" ? <p className="pt-2 text-xs text-muted-foreground">Check-out em {formatarDataHora(r.checkout_em)}.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="size-4" /> Hóspede
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Linha
                  rotulo="Nome"
                  valor={
                    <Link href={`${base}/hospedes/${r.hospede_id}`} className="text-primary hover:underline">
                      {h?.nome}
                    </Link>
                  }
                />
                <Linha rotulo="CPF" valor={h?.cpf ? formatarCpf(h.cpf) : null} />
                {h?.documento ? <Linha rotulo={TIPOS_DOCUMENTO[h.documento_tipo ?? "outro"] ?? "Documento"} valor={h.documento} /> : null}
                <Linha rotulo="Telefone" valor={h?.telefone ? formatarTelefone(h.telefone) : null} />
                <Linha rotulo="Cidade" valor={h?.cidade ? `${h.cidade}${h.uf ? `/${h.uf}` : ""}` : null} />
                {acompanhantes.length ? <Linha rotulo="Acompanhantes" valor={acompanhantes.map((a) => a.nome).join(", ")} /> : null}
              </dl>
              {!h?.cpf && !h?.documento ? (
                <Alerta tom="alerta" className="mt-3">
                  Falta o documento para a ficha de registro.{" "}
                  <Link href={`${base}/hospedes/${r.hospede_id}`} className="underline">
                    Completar o cadastro
                  </Link>
                </Alerta>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4" /> Estadia
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Linha rotulo="Entrada" valor={formatarData(r.entrada)} />
                <Linha rotulo="Saída" valor={`${formatarData(r.saida)} (${noites(r.entrada, r.saida)} noites)`} />
                <Linha rotulo="Pessoas" valor={`${r.adultos} adulto(s)${r.criancas ? ` e ${r.criancas} criança(s)` : ""}`} />
                <Linha rotulo="Quarto" valor={`${r.quarto?.numero} — ${r.categoria?.nome}`} />
                <Linha rotulo="Origem" valor={ORIGENS[r.origem] ?? r.origem} />
                {r.diaria_acordada ? <Linha rotulo="Diária acordada" valor={formatarMoeda(r.diaria_acordada)} /> : null}
                {r.faturar ? <Linha rotulo="Faturar para" valor={r.faturar.nome} /> : null}
                {r.motivo_viagem ? <Linha rotulo="Motivo da viagem" valor={MOTIVOS_VIAGEM[r.motivo_viagem]} /> : null}
                {r.meio_transporte ? <Linha rotulo="Transporte" valor={`${MEIOS_TRANSPORTE[r.meio_transporte]}${r.placa_veiculo ? ` · ${r.placa_veiculo}` : ""}`} /> : null}
                {r.procedencia ? <Linha rotulo="Vem de" valor={r.procedencia} /> : null}
                {r.destino ? <Linha rotulo="Próximo destino" valor={r.destino} /> : null}
              </dl>
              {r.observacoes ? <p className="mt-3 whitespace-pre-line rounded-lg bg-muted/50 p-3 text-sm">{r.observacoes}</p> : null}
            </CardContent>
          </Card>
          {pagosValidos.some((p) => p.forma === "faturado") ? (
            <Alerta tom="info">O valor faturado ficou como conta a receber no Financeiro, no nome da empresa, com o vencimento informado.</Alerta>
          ) : null}
        </div>
      </div>
    </>
  );
}
