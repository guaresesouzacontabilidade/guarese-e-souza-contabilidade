import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, CalendarPlus, DoorOpen, LogIn, LogOut, Settings, Soup, Sparkles, UtensilsCrossed, Wallet } from "lucide-react";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { BotoesLimpeza } from "@/components/hotel/cadastros";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarQuartos, reservasPorStatus } from "@/lib/hotel/dados";
import { LIMPEZA, VARIANTE_LIMPEZA, diaMes, somarDias } from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { formatarMoeda } from "@/lib/dinheiro";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Painel do hotel" };

export default async function PaginaPainelHotel({ params }: PageProps<"/e/[empresaId]/hotel">) {
  const { empresaId } = await params;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const inicioMes = `${hoje.slice(0, 8)}01`;
  const [quartos, ativas, { data: pagos }] = await Promise.all([
    carregarQuartos(ctx.supabase, empresaId, true),
    reservasPorStatus(ctx.supabase, empresaId, ["pre_reserva", "confirmada", "hospedado"]),
    ctx.supabase.from("hotel_pagamentos").select("valor").eq("empresa_id", empresaId).is("cancelado_em", null).gte("data", inicioMes),
  ]);
  const hospedados = ativas.filter((r) => r.status === "hospedado");
  const chegadas = ativas.filter((r) => r.status !== "hospedado" && r.entrada <= hoje);
  const saidas = hospedados.filter((r) => r.saida <= hoje);
  const proximas = ativas.filter((r) => r.status !== "hospedado" && r.entrada > hoje && r.entrada <= somarDias(hoje, 7));
  const ocupacao = quartos.length ? Math.round((hospedados.length / quartos.length) * 100) : 0;
  const sujos = quartos.filter((q) => q.limpeza === "sujo" || q.limpeza === "em_limpeza").length;
  const recebidoMes = (pagos ?? []).reduce((s, p) => s + Number(p.valor), 0);
  const porQuarto = new Map(hospedados.map((r) => [r.quarto_id, r]));
  const chegandoNoQuarto = new Map(chegadas.map((r) => [r.quarto_id, r]));
  const base = `/e/${empresaId}/hotel`;

  return (
    <>
      <CabecalhoPagina
        titulo="Painel do hotel"
        descricao={`Hoje, ${hoje.split("-").reverse().join("/")}: chegadas, saídas, hóspedes na casa e a situação de cada quarto.`}
        acoes={
          <>
            {ctx.gerente ? (
              <Button asChild variante="contorno" tamanho="icone" aria-label="Configurações do hotel" title="Configurações do hotel">
                <Link href={`${base}/configuracoes`}>
                  <Settings />
                </Link>
              </Button>
            ) : null}
            <Button asChild variante="contorno">
              <Link href={`${base}/consumo`}>
                <UtensilsCrossed /> Lançar consumo
              </Link>
            </Button>
            <Button asChild variante="contorno">
              <Link href={`${base}/extras`}>
                <Soup /> Serviços extras
              </Link>
            </Button>
            <Button asChild>
              <Link href={`${base}/reservas/nova`}>
                <CalendarPlus /> Nova reserva
              </Link>
            </Button>
          </>
        }
      />

      {!quartos.length ? (
        <Alerta tom="info" titulo="Comece pelos quartos" className="mb-5">
          Cadastre as categorias (Standard, Luxo...) com a diária e depois os quartos em{" "}
          <Link href={`${base}/quartos`} className="underline">
            Quartos e governança
          </Link>
          .
        </Alerta>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Indicador rotulo="Ocupação hoje" valor={`${ocupacao}%`} detalhe={`${hospedados.length} de ${quartos.length} quartos`} icone={BedDouble} tom={ocupacao >= 70 ? "sucesso" : "info"} />
        <Indicador rotulo="Chegadas" valor={chegadas.length} detalhe={proximas.length ? `+${proximas.length} nos próximos 7 dias` : "nos próximos 7 dias: nenhuma"} icone={LogIn} tom="info" />
        <Indicador rotulo="Saídas hoje" valor={saidas.length} detalhe="check-outs previstos" icone={LogOut} tom={saidas.length ? "alerta" : "neutro"} />
        <Indicador rotulo="Quartos para limpar" valor={sujos} detalhe="sujos ou em limpeza" icone={Sparkles} tom={sujos ? "alerta" : "sucesso"} href={`${base}/quartos`} />
        <Indicador rotulo="Recebido no mês" valor={formatarMoeda(recebidoMes)} detalhe="hospedagens (Financeiro)" icone={Wallet} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="size-4" /> Chegadas de hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {chegadas.length ? (
              chegadas.map((r) => (
                <Link key={r.id} href={`${base}/reservas/${r.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm hover:bg-muted">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.hospede}</span>
                    <span className="text-muted-foreground">
                      Quarto {r.quarto} · {r.adultos + r.criancas} pessoa(s) · até {diaMes(r.saida)}
                    </span>
                  </span>
                  {r.entrada < hoje ? <Badge variante="alerta">Atrasada desde {diaMes(r.entrada)}</Badge> : <Badge variante={r.status === "pre_reserva" ? "alerta" : "info"}>{r.status === "pre_reserva" ? "Pré-reserva" : "Confirmada"}</Badge>}
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma chegada prevista para hoje.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LogOut className="size-4" /> Saídas de hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {saidas.length ? (
              saidas.map((r) => (
                <Link key={r.id} href={`${base}/reservas/${r.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm hover:bg-muted">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.hospede}</span>
                    <span className="text-muted-foreground">Quarto {r.quarto} · entrou em {diaMes(r.entrada)}</span>
                  </span>
                  <Badge variante={r.saida < hoje ? "perigo" : "alerta"}>{r.saida < hoje ? `Saída era ${diaMes(r.saida)}` : "Fechar a conta"}</Badge>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum check-out previsto para hoje.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DoorOpen className="size-4" /> Quartos agora
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {quartos.map((q) => {
              const h = porQuarto.get(q.id);
              const c = chegandoNoQuarto.get(q.id);
              return (
                <div
                  key={q.id}
                  className={cn(
                    "space-y-2 rounded-2xl border p-3",
                    h ? "border-sucesso/40 bg-sucesso-bg/40" : q.limpeza === "manutencao" ? "border-perigo/40 bg-perigo-bg/30" : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-titulo text-xl font-bold">{q.numero}</p>
                      <p className="text-xs text-muted-foreground">{q.categoria.nome}</p>
                    </div>
                    <Badge variante={VARIANTE_LIMPEZA[q.limpeza]}>{LIMPEZA[q.limpeza]}</Badge>
                  </div>
                  {h ? (
                    <Link href={`${base}/reservas/${h.id}`} className="block text-sm hover:underline">
                      <span className="font-medium">{h.hospede}</span>
                      <span className="block text-xs text-muted-foreground">Ocupado até {diaMes(h.saida)}</span>
                    </Link>
                  ) : c ? (
                    <Link href={`${base}/reservas/${c.id}`} className="block text-sm hover:underline">
                      <span className="font-medium">Chega hoje: {c.hospede}</span>
                      <span className="block text-xs text-muted-foreground">Reserva nº {c.numero}</span>
                    </Link>
                  ) : (
                    <p className="text-sm text-muted-foreground">{q.limpeza === "manutencao" ? q.motivo_manutencao : "Livre"}</p>
                  )}
                  <BotoesLimpeza empresaId={empresaId} quartoId={q.id} numero={q.numero} limpeza={q.limpeza} ocupado={Boolean(h)} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
