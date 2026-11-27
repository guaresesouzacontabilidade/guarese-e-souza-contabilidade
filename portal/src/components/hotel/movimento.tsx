import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatarMoeda } from "@/lib/dinheiro";
import { hora } from "@/lib/gestao/rotulos";
import type { MovimentoHotel } from "@/lib/hotel/dados";
import { FORMAS_PAGAMENTO_HOTEL, MOVIMENTOS_HOTEL, type FormaPagamentoHotel } from "@/lib/hotel/rotulos";

const TOM: Record<string, "sucesso" | "info" | "perigo" | "alerta" | "neutro"> = {
  checkin: "sucesso",
  checkout: "info",
  reserva: "neutro",
  cancelamento: "perigo",
  no_show: "perigo",
  pagamento: "sucesso",
  estorno: "perigo",
  item_cancelado: "alerta",
  recibo: "info",
  recibo_cancelado: "alerta",
};

/** O que aconteceu no hotel (turno ou dia): hora, o que foi, reserva ou empresa, valor e quem fez. */
export function TabelaMovimento({ empresaId, movimentos }: { empresaId: string; movimentos: MovimentoHotel[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <Tr>
            <Th className="w-16">Hora</Th>
            <Th>O que</Th>
            <Th>Reserva / empresa</Th>
            <Th className="hidden md:table-cell">Detalhe</Th>
            <Th className="text-right">Valor</Th>
            <Th className="hidden sm:table-cell">Quem</Th>
          </Tr>
        </THead>
        <TBody>
          {movimentos.map((m, i) => {
            const negativo = ["estorno", "item_cancelado", "recibo_cancelado"].includes(m.tipo);
            const forma = m.forma ? (FORMAS_PAGAMENTO_HOTEL[m.forma as FormaPagamentoHotel] ?? m.forma) : null;
            return (
              <Tr key={i}>
                <Td className="align-top text-muted-foreground numero">{hora(m.quando)}</Td>
                <Td className="align-top">
                  <Badge variante={TOM[m.tipo] ?? "neutro"}>{MOVIMENTOS_HOTEL[m.tipo] ?? m.tipo}</Badge>
                  {forma && ["pagamento", "estorno", "recibo"].includes(m.tipo) ? <span className="mt-1 block text-xs text-muted-foreground">{forma}</span> : null}
                </Td>
                <Td className="align-top">
                  {m.reserva_id ? (
                    <Link href={`/e/${empresaId}/hotel/reservas/${m.reserva_id}`} className="font-medium hover:underline">
                      Nº {m.reserva_numero} · quarto {m.quarto}
                    </Link>
                  ) : m.recibo_numero ? (
                    <span className="font-medium">Recibo nº {m.recibo_numero}</span>
                  ) : null}
                  <span className="block text-xs text-muted-foreground">{m.hospede ?? m.empresa ?? ""}</span>
                </Td>
                <Td className="hidden align-top text-sm md:table-cell">{m.detalhe ?? ""}</Td>
                <Td className={`whitespace-nowrap text-right align-top numero ${negativo ? "text-perigo" : ""}`}>
                  {m.valor != null && m.tipo !== "checkin" ? `${negativo ? "− " : ""}${formatarMoeda(Math.abs(m.valor))}` : ""}
                </Td>
                <Td className="hidden align-top text-sm text-muted-foreground sm:table-cell">{m.quem ?? ""}</Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
