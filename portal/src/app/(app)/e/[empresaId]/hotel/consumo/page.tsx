import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta } from "@/components/ui/feedback";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { LancarConsumo } from "@/components/hotel/conta";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { reservasPorStatus } from "@/lib/hotel/dados";

export const metadata: Metadata = { title: "Lançar consumo no quarto" };

export default async function PaginaConsumo({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/consumo">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const [hospedados, { data: produtos }] = await Promise.all([
    reservasPorStatus(ctx.supabase, empresaId, ["hospedado"]),
    ctx.supabase
      .from("nfe_produtos")
      .select("id, codigo, descricao, unidade, grupo, valor_unitario, estoque_atual, controla_estoque")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .not("valor_unitario", "is", null)
      .order("descricao")
      .limit(1000),
  ]);
  const fixa = typeof sp.reserva === "string" ? hospedados.find((h) => h.id === sp.reserva) : undefined;
  return (
    <>
      <CabecalhoPagina
        titulo={fixa ? `Consumo — quarto ${fixa.quarto}` : "Lançar consumo no quarto"}
        descricao={
          fixa
            ? `Na conta de ${fixa.hospede}. Sai do estoque na hora e é cobrado no check-out.`
            : "Restaurante, bar e frigobar na conta do hóspede: sai do estoque na hora e é cobrado no check-out. Para quem não está hospedado, use Restaurante e bar → Vender."
        }
        voltar={fixa ? { href: `/e/${empresaId}/hotel/reservas/${fixa.id}`, rotulo: `Reserva nº ${fixa.numero}` } : undefined}
      />
      {!hospedados.length ? (
        <Alerta tom="info">Nenhum hóspede na casa agora. O consumo é lançado na conta de quem já fez o check-in.</Alerta>
      ) : !produtos?.length ? (
        <Alerta tom="info">
          Cadastre os alimentos e bebidas (com o preço de venda) em{" "}
          <Link href={`/e/${empresaId}/loja/produtos`} className="underline">
            Produtos e estoque
          </Link>
          .
        </Alerta>
      ) : (
        <LancarConsumo
          key={fixa?.id ?? "todos"}
          empresaId={empresaId}
          reservaFixa={fixa?.id}
          hospedagens={hospedados.map((h) => ({ reserva_id: h.id, quarto: h.quarto, hospede: h.hospede }))}
          produtos={(produtos ?? []).map((p) => ({
            ...p,
            valor_unitario: p.valor_unitario == null ? null : Number(p.valor_unitario),
            estoque_atual: Number(p.estoque_atual),
          }))}
        />
      )}
    </>
  );
}
