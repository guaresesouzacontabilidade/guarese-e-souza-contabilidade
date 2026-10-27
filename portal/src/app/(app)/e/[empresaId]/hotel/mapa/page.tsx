import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarQuartos, reservasNoPeriodo, type ReservaResumo } from "@/lib/hotel/dados";
import { COR_STATUS, STATUS_RESERVA, diaDaSemana, diaMes, noites, somarDias } from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Mapa de reservas" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export default async function PaginaMapa({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/mapa">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const dias = sp.dias === "30" ? 30 : 14;
  const inicio = typeof sp.inicio === "string" && DATA.test(sp.inicio) ? sp.inicio : somarDias(hoje, -1);
  const fim = somarDias(inicio, dias);
  const [quartos, reservas] = await Promise.all([carregarQuartos(ctx.supabase, empresaId, true), reservasNoPeriodo(ctx.supabase, empresaId, inicio, fim)]);
  const datas = Array.from({ length: dias }, (_, i) => somarDias(inicio, i));
  const base = `/e/${empresaId}/hotel`;
  const link = (ini: string, d = dias) => `${base}/mapa?inicio=${ini}${d === 30 ? "&dias=30" : ""}`;
  const porQuarto = new Map<string, ReservaResumo[]>();
  for (const r of reservas) porQuarto.set(r.quarto_id, [...(porQuarto.get(r.quarto_id) ?? []), r]);
  const ocupadosNoDia = (d: string) => reservas.filter((r) => (r.status === "hospedado" || r.status === "encerrada" || r.status === "confirmada" || r.status === "pre_reserva") && r.entrada <= d && d < r.saida).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Mapa de reservas"
        descricao="Cada linha é um quarto; cada coluna, uma noite. Clique num espaço livre para reservar aquele quarto naquela data."
        acoes={
          <Button asChild>
            <Link href={`${base}/reservas/nova`}>
              <CalendarPlus /> Nova reserva
            </Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={link(somarDias(inicio, -dias))} aria-label="Período anterior">
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={link(somarDias(hoje, -1))}>Hoje</Link>
          </Button>
          <Button asChild variante="contorno" tamanho="sm">
            <Link href={link(somarDias(inicio, dias))} aria-label="Próximo período">
              <ChevronRight />
            </Link>
          </Button>
          <span className="ml-2 text-sm text-muted-foreground">
            {diaMes(inicio)} a {diaMes(somarDias(fim, -1))}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link href={link(inicio, 14)} className={cn("rounded-md px-2 py-1", dias === 14 ? "bg-muted font-medium" : "text-muted-foreground")}>
            14 dias
          </Link>
          <Link href={link(inicio, 30)} className={cn("rounded-md px-2 py-1", dias === 30 ? "bg-muted font-medium" : "text-muted-foreground")}>
            30 dias
          </Link>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(["pre_reserva", "confirmada", "hospedado", "encerrada"] as const).map((s) => (
          <span key={s} className={cn("rounded-md border px-2 py-0.5", COR_STATUS[s])}>
            {STATUS_RESERVA[s]}
          </span>
        ))}
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: 112 + dias * 44 }}>
            <colgroup>
              <col className="w-28" />
              {datas.map((d) => (
                <col key={d} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-2 text-left">Quarto</th>
                {datas.map((d) => (
                  <th
                    key={d}
                    className={cn(
                      "border-b border-border px-1 py-1 text-center font-normal",
                      d === hoje && "bg-primary/10 font-semibold text-titulo",
                      ["sáb", "dom"].includes(diaDaSemana(d)) && d !== hoje && "bg-muted/50",
                    )}
                  >
                    <span className="block text-[10px] uppercase text-muted-foreground">{diaDaSemana(d)}</span>
                    {d.slice(8, 10)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quartos.map((q) => {
                const lista = (porQuarto.get(q.id) ?? []).sort((a, b) => a.entrada.localeCompare(b.entrada));
                const celulas: ReactNode[] = [];
                let i = 0;
                while (i < datas.length) {
                  const d = datas[i];
                  const r = lista.find((x) => x.entrada <= d && d < x.saida);
                  if (r) {
                    const span = Math.min(noites(d, r.saida), datas.length - i);
                    celulas.push(
                      <td key={d} colSpan={span} className="border-b border-border p-0.5">
                        <Link
                          href={`${base}/reservas/${r.id}`}
                          title={`${r.hospede} · ${STATUS_RESERVA[r.status]} · ${diaMes(r.entrada)} a ${diaMes(r.saida)}`}
                          className={cn("block truncate rounded-md border px-1.5 py-1.5 font-medium hover:brightness-95", COR_STATUS[r.status])}
                        >
                          {r.hospede}
                        </Link>
                      </td>,
                    );
                    i += span;
                  } else {
                    celulas.push(
                      <td key={d} className={cn("border-b border-border p-0.5", d === hoje && "bg-primary/5")}>
                        {d >= somarDias(hoje, -1) ? (
                          <Link
                            href={`${base}/reservas/nova?quarto=${q.id}&entrada=${d}`}
                            className="block h-7 rounded-md hover:bg-muted"
                            aria-label={`Reservar o quarto ${q.numero} em ${diaMes(d)}`}
                          />
                        ) : (
                          <span className="block h-7" />
                        )}
                      </td>,
                    );
                    i += 1;
                  }
                }
                return (
                  <tr key={q.id}>
                    <th className="sticky left-0 z-10 border-b border-r border-border bg-card px-2 py-1 text-left font-normal">
                      <span className="block font-semibold">{q.numero}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{q.categoria.nome}</span>
                    </th>
                    {celulas}
                  </tr>
                );
              })}
              <tr>
                <th className="sticky left-0 z-10 border-r border-border bg-card px-2 py-1 text-left font-normal text-muted-foreground">Ocupação</th>
                {datas.map((d) => {
                  const n = ocupadosNoDia(d);
                  const pct = quartos.length ? Math.round((n / quartos.length) * 100) : 0;
                  return (
                    <td key={d} className={cn("px-1 py-1 text-center", pct >= 80 ? "font-semibold text-sucesso" : "text-muted-foreground")}>
                      {pct}%
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
