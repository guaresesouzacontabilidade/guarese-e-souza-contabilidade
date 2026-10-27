import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Search } from "lucide-react";
import { CabecalhoPagina, Paginacao } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { listarReservas } from "@/lib/hotel/dados";
import { ORIGENS, STATUS_RESERVA, VARIANTE_STATUS, diaMes, noites } from "@/lib/hotel/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";

export const metadata: Metadata = { title: "Reservas e hospedagens" };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 30;

export default async function PaginaReservas({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/reservas">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const status = typeof sp.status === "string" && (sp.status === "ativas" || sp.status in STATUS_RESERVA) ? sp.status : "ativas";
  const de = typeof sp.de === "string" && DATA.test(sp.de) ? sp.de : "";
  const ate = typeof sp.ate === "string" && DATA.test(sp.ate) ? sp.ate : "";
  const busca = typeof sp.busca === "string" ? sp.busca.slice(0, 60) : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const { reservas, total } = await listarReservas(ctx.supabase, empresaId, { status: status === "todas" ? "" : status, de, ate, busca, pagina, porPagina: POR_PAGINA });
  const base = `/e/${empresaId}/hotel`;
  const montarHref = (p: number) => {
    const q = new URLSearchParams();
    if (status !== "ativas") q.set("status", status);
    if (de) q.set("de", de);
    if (ate) q.set("ate", ate);
    if (busca) q.set("busca", busca);
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return `${base}/reservas${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <CabecalhoPagina
        titulo="Reservas e hospedagens"
        descricao="Reservas futuras, hóspedes na casa e o histórico das estadias."
        acoes={
          <Button asChild>
            <Link href={`${base}/reservas/nova`}>
              <CalendarPlus /> Nova reserva
            </Link>
          </Button>
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]" action={`${base}/reservas`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Nome do hóspede" className="pl-9" aria-label="Buscar pelo nome do hóspede" />
        </div>
        <Select name="status" defaultValue={status} aria-label="Situação">
          <option value="ativas">Em aberto (reservas e hospedados)</option>
          <option value="todas">Todas</option>
          {Object.entries(STATUS_RESERVA).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <Input name="de" type="date" defaultValue={de} aria-label="Entrada a partir de" />
        <Input name="ate" type="date" defaultValue={ate} aria-label="Entrada até" />
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>
      {reservas.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Nº</Th>
                  <Th>Hóspede</Th>
                  <Th>Quarto</Th>
                  <Th>Estadia</Th>
                  <Th className="hidden md:table-cell">Origem</Th>
                  <Th className="text-right">Diárias previstas</Th>
                  <Th>Situação</Th>
                </Tr>
              </THead>
              <TBody>
                {reservas.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`${base}/reservas/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.numero}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`${base}/reservas/${r.id}`} className="hover:underline">
                        {r.hospede}
                      </Link>
                    </Td>
                    <Td>
                      {r.quarto} <span className="text-xs text-muted-foreground">{r.categoria}</span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {diaMes(r.entrada)} → {diaMes(r.saida)} <span className="text-xs text-muted-foreground">({noites(r.entrada, r.saida)} n)</span>
                    </Td>
                    <Td className="hidden md:table-cell">{ORIGENS[r.origem] ?? r.origem}</Td>
                    <Td className="text-right numero">{formatarMoeda(r.valor_previsto)}</Td>
                    <Td>
                      <Badge variante={VARIANTE_STATUS[r.status]}>{STATUS_RESERVA[r.status]}</Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio titulo="Nenhuma reserva encontrada" descricao="Mude os filtros ou crie uma reserva nova." />
      )}
      <Paginacao pagina={pagina} totalPaginas={Math.ceil(total / POR_PAGINA)} total={total} montarHref={montarHref} />
    </>
  );
}
