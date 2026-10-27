import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { FormReserva } from "@/components/hotel/reserva";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { dadosFormReserva } from "@/lib/hotel/dados";
import { hojeLocal } from "@/lib/gestao/contexto";

export const metadata: Metadata = { title: "Nova reserva" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export default async function PaginaNovaReserva({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/reservas/nova">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const hoje = hojeLocal();
  const dados = await dadosFormReserva(ctx.supabase, empresaId, hoje);
  const quarto = typeof sp.quarto === "string" && UUID.test(sp.quarto) ? sp.quarto : undefined;
  const entrada = typeof sp.entrada === "string" && DATA.test(sp.entrada) && sp.entrada >= hoje ? sp.entrada : undefined;
  const hospede = typeof sp.hospede === "string" && UUID.test(sp.hospede) ? sp.hospede : undefined;
  return (
    <>
      <CabecalhoPagina titulo="Nova reserva" descricao="Escolha o hóspede, as datas e o quarto. O portal não deixa reservar um quarto já ocupado nas mesmas noites." voltar={{ href: `/e/${empresaId}/hotel/reservas`, rotulo: "Reservas" }} />
      {!dados.quartos.length ? (
        <Alerta tom="alerta">
          Ainda não há quartos cadastrados.{" "}
          <Link href={`/e/${empresaId}/hotel/quartos`} className="underline">
            Cadastre os quartos
          </Link>{" "}
          antes da primeira reserva.
        </Alerta>
      ) : (
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
            padrao={{ quarto_id: quarto, entrada, hospede_id: hospede }}
          />
        </div>
      )}
    </>
  );
}
