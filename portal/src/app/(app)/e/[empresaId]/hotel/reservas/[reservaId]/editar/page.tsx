import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { FormReserva } from "@/components/hotel/reserva";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarReserva, dadosFormReserva } from "@/lib/hotel/dados";
import { hojeLocal } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Alterar reserva" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaEditarReserva({ params }: PageProps<"/e/[empresaId]/hotel/reservas/[reservaId]/editar">) {
  const { empresaId, reservaId } = await params;
  if (!UUID.test(reservaId)) notFound();
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const [completa, dados] = await Promise.all([carregarReserva(ctx.supabase, empresaId, reservaId), dadosFormReserva(ctx.supabase, empresaId, hoje)]);
  if (!completa) notFound();
  const r = completa.reserva;
  const voltar = { href: `/e/${empresaId}/hotel/reservas/${reservaId}`, rotulo: `Reserva nº ${r.numero}` };
  if (!["pre_reserva", "confirmada", "hospedado"].includes(r.status)) {
    return (
      <>
        <CabecalhoPagina titulo={`Reserva nº ${r.numero}`} voltar={voltar} />
        <Alerta tom="info">Esta reserva já foi encerrada ou cancelada e não pode mais ser alterada.</Alerta>
      </>
    );
  }
  return (
    <>
      <CabecalhoPagina
        titulo={`Alterar a reserva nº ${r.numero}`}
        descricao={r.status === "hospedado" ? "Hóspede na casa: dá para mudar a saída (prorrogar ou antecipar), as pessoas, a tarifa e as observações." : undefined}
        voltar={voltar}
      />
      <div className="max-w-4xl">
        <FormReserva
          empresaId={empresaId}
          hoje={hoje}
          quartos={dados.quartos}
          categorias={dados.categorias}
          tarifas={dados.tarifas}
          ocupacoes={dados.ocupacoes}
          hospedes={dados.hospedes}
          empresasFaturar={dados.empresas}
          reserva={{
            id: r.id,
            status: r.status,
            hospede_id: r.hospede_id,
            quarto_id: r.quarto_id,
            entrada: r.entrada,
            saida: r.saida,
            adultos: r.adultos,
            criancas: r.criancas,
            origem: r.origem,
            diaria_acordada: r.diaria_acordada == null ? null : Number(r.diaria_acordada),
            empresa_faturar_id: r.empresa_faturar_id,
            observacoes: r.observacoes,
            motivo_viagem: r.motivo_viagem,
            meio_transporte: r.meio_transporte,
            placa_veiculo: r.placa_veiculo,
            procedencia: r.procedencia,
            destino: r.destino,
            acompanhantes: completa.acompanhantes.map((a) => a.id),
          }}
        />
      </div>
    </>
  );
}
