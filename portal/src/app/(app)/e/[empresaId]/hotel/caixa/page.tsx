import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, FileText, ListChecks } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { TabelaMovimento } from "@/components/hotel/movimento";
import { AbrirCaixa, FecharCaixa, MovimentoCaixa } from "@/components/loja/formularios-caixa";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { movimentoHotel } from "@/lib/hotel/dados";
import { contasParaSangria, hojeLocal } from "@/lib/gestao/contexto";
import { FORMAS_COM_COMPROVANTE, carregarRelatorioCaixa } from "@/lib/gestao/dados";
import { hora } from "@/lib/gestao/rotulos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export const metadata: Metadata = { title: "Caixa do turno" };

const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const OITO_DIAS = 8 * 24 * 3600 * 1000 - 60_000;

/** Sugestão de nome do turno pela hora (a pessoa pode trocar). */
function sugestaoTurno() {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Araguaina", hour: "2-digit", hour12: false }).format(new Date()));
  return h < 12 ? "Manhã" : h < 18 ? "Tarde" : "Noite";
}

const nome = (p: unknown) => (p as { nome?: string } | null)?.nome ?? "—";

export default async function PaginaCaixaTurno({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/caixa">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const dia = typeof sp.dia === "string" && DIA.test(sp.dia) && sp.dia <= hoje ? sp.dia : hoje;

  const [{ data: abertos }, { data: turnosDoDia }] = await Promise.all([
    ctx.supabase
      .from("caixa_sessoes")
      .select("id, caixa_nome, operador_id, aberto_em, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "aberto")
      .order("aberto_em"),
    ctx.supabase
      .from("caixa_sessoes")
      .select("id, caixa_nome, status, aberto_em, fechado_em, diferenca, resumo, operador:perfis!caixa_sessoes_operador_id_fkey(nome)")
      .eq("empresa_id", empresaId)
      .eq("data", dia)
      .order("aberto_em"),
  ]);
  const meu = (abertos ?? []).find((s) => s.operador_id === ctx.sessao.usuarioId);
  const outros = (abertos ?? []).filter((s) => s.id !== meu?.id);
  const agora = new Date().toISOString();
  const [relatorio, contas, movimentos] = meu
    ? await Promise.all([
        carregarRelatorioCaixa(ctx.supabase, meu.id),
        contasParaSangria(ctx.supabase, empresaId),
        movimentoHotel(ctx.supabase, empresaId, new Date(Math.max(new Date(meu.aberto_em).getTime(), new Date(agora).getTime() - OITO_DIAS)).toISOString(), agora),
      ])
    : [null, [], []];
  const r = relatorio?.resumo;
  const recebido = r ? Number(r.hotel_total ?? 0) + Number(r.vendas_total ?? 0) : 0;
  const semComprovante = relatorio
    ? relatorio.hotel.filter((h) => !h.estornado && !h.recibo_numero && FORMAS_COM_COMPROVANTE.has(h.forma) && !h.comprovantes.length).length
    : 0;
  const conta = (t: string) => movimentos.filter((m) => m.tipo === t).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Caixa do turno"
        descricao="Abra o turno com o troco da gaveta, receba os pagamentos das reservas e feche contando o dinheiro. O relatório do turno mostra tudo o que aconteceu no hotel no horário."
      />
      <div className="space-y-6">
        {relatorio && meu ? (
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Banknote className="size-5" /> {meu.caixa_nome} <Badge variante="sucesso">Aberto</Badge>
                </CardTitle>
                <CardDescription>
                  Aberto às {hora(meu.aberto_em)} por {nome(meu.operador)}. Pagamentos de hospedagem, serviços extras pagos na hora e vendas do restaurante feitos por você entram
                  neste caixa.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variante="contorno">
                  <a href={`/api/hotel/${empresaId}/turnos/${meu.id}`} target="_blank" rel="noopener">
                    <FileText /> Relatório do turno
                  </a>
                </Button>
                <MovimentoCaixa empresaId={empresaId} sessaoId={meu.id} tipo="sangria" contas={contas} esperado={Number(r?.dinheiro_esperado ?? 0)} />
                <MovimentoCaixa empresaId={empresaId} sessaoId={meu.id} tipo="suprimento" contas={contas} esperado={Number(r?.dinheiro_esperado ?? 0)} />
                <FecharCaixa empresaId={empresaId} sessaoId={meu.id} esperado={Number(r?.dinheiro_esperado ?? 0)} semComprovante={semComprovante} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Indicador rotulo="Recebido no turno" valor={formatarMoeda(recebido)} tom="sucesso" />
                <Indicador rotulo="Dinheiro na gaveta (esperado)" valor={formatarMoeda(r?.dinheiro_esperado ?? 0)} tom="neutro" />
                <Indicador rotulo="Check-ins / check-outs" valor={`${conta("checkin")} / ${conta("checkout")}`} tom="info" />
                <Indicador rotulo="Reservas feitas" valor={conta("reserva")} tom="neutro" />
              </div>
              <div>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <ListChecks className="size-4" /> O que aconteceu no hotel durante o turno
                </h2>
                {movimentos.length ? (
                  <TabelaMovimento empresaId={empresaId} movimentos={[...movimentos].reverse()} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nada aconteceu nas reservas desde a abertura do turno.</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Para ver as vendas do restaurante uma a uma, abra o{" "}
                <Link href={`/e/${empresaId}/loja/caixa`} className="underline">
                  Caixa do dia
                </Link>{" "}
                (é o mesmo caixa).
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Abrir o turno</CardTitle>
              <CardDescription>Dê um nome ao turno (ex.: Manhã — Ana) e informe o troco que já está na gaveta.</CardDescription>
            </CardHeader>
            <CardContent>
              <AbrirCaixa empresaId={empresaId} sugestaoNome={sugestaoTurno()} turno />
            </CardContent>
          </Card>
        )}

        {outros.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outros turnos abertos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {outros.map((s) => (
                <Button key={s.id} asChild variante="contorno" tamanho="sm">
                  <a href={`/api/hotel/${empresaId}/turnos/${s.id}`} target="_blank" rel="noopener">
                    {s.caixa_nome} · {nome(s.operador)} · desde {hora(s.aberto_em)}
                  </a>
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Turnos de {dia === hoje ? "hoje" : formatarData(dia)}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <form method="get" className="flex items-center gap-2">
                <label htmlFor="turnos-dia" className="sr-only">
                  Dia
                </label>
                <Input id="turnos-dia" name="dia" type="date" defaultValue={dia} max={hoje} className="h-9 w-44" />
                <Button type="submit" variante="contorno" tamanho="sm">
                  Ver
                </Button>
              </form>
              <Button asChild tamanho="sm">
                <a href={`/api/hotel/${empresaId}/relatorio-dia?data=${dia}`} target="_blank" rel="noopener">
                  <FileText /> Relatório do dia
                </a>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(turnosDoDia ?? []).length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Turno</Th>
                    <Th>Horário</Th>
                    <Th className="text-right">Recebido</Th>
                    <Th className="text-right">Gaveta</Th>
                    <Th className="w-16" />
                  </Tr>
                </THead>
                <TBody>
                  {(turnosDoDia ?? []).map((t) => {
                    const res = (t.resumo ?? {}) as { hotel_total?: number; vendas_total?: number };
                    const dif = t.diferenca == null ? null : dec(t.diferenca);
                    return (
                      <Tr key={t.id}>
                        <Td>
                          {t.caixa_nome}
                          <span className="block text-xs text-muted-foreground">{nome(t.operador)}</span>
                        </Td>
                        <Td className="numero">
                          {hora(t.aberto_em)} – {t.fechado_em ? hora(t.fechado_em) : <Badge variante="sucesso">aberto</Badge>}
                        </Td>
                        <Td className="text-right numero">{t.status === "fechado" ? formatarMoeda(Number(res.hotel_total ?? 0) + Number(res.vendas_total ?? 0)) : "—"}</Td>
                        <Td className="text-right">
                          {dif == null ? (
                            "—"
                          ) : dif.isZero() ? (
                            <Badge variante="sucesso">Conferiu</Badge>
                          ) : (
                            <Badge variante={dif.gt(0) ? "alerta" : "perigo"}>
                              {dif.gt(0) ? "Sobra" : "Falta"} {formatarMoeda(dif.abs())}
                            </Badge>
                          )}
                        </Td>
                        <Td className="text-right">
                          <a href={`/api/hotel/${empresaId}/turnos/${t.id}`} target="_blank" rel="noopener" className="text-sm text-primary hover:underline">
                            PDF
                          </a>
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <EstadoVazio icone={Banknote} titulo="Nenhum turno neste dia" descricao="Os turnos aparecem aqui assim que alguém abre o caixa." />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
