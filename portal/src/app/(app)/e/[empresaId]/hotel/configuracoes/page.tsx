import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Alerta } from "@/components/ui/feedback";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { FormConfigHotel } from "@/components/hotel/cadastros";
import { obterContextoHotel } from "@/lib/hotel/contexto";

export const metadata: Metadata = { title: "Configurações do hotel" };

export default async function PaginaConfigHotel({ params }: PageProps<"/e/[empresaId]/hotel/configuracoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.gerente) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const { data: cfg } = await ctx.supabase.from("hotel_config").select("*").eq("empresa_id", empresaId).maybeSingle();
  return (
    <>
      <CabecalhoPagina titulo="Configurações do hotel" descricao="Horários, taxa de serviço e as regras que aparecem na confirmação da reserva." />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="pt-5">
            <FormConfigHotel
              empresaId={empresaId}
              config={{
                hora_checkin: cfg?.hora_checkin ?? "14:00",
                hora_checkout: cfg?.hora_checkout ?? "12:00",
                taxa_servico: cfg?.taxa_servico == null ? null : Number(cfg.taxa_servico),
                cafe_incluso: cfg?.cafe_incluso ?? true,
                politica: cfg?.politica ?? null,
              }}
            />
          </CardContent>
        </Card>
        <div className="space-y-3">
          <Alerta tom="info" titulo="Quem pode usar">
            A recepção precisa da permissão “Vender no caixa”: faz reservas, check-in, check-out, lança consumo e recebe. O gerente (“Gerenciar a loja”) cadastra quartos e
            tarifas, dá descontos, estorna e vê os relatórios. Convide as pessoas em{" "}
            <Link href={`/e/${empresaId}/configuracoes`} className="underline">
              Configurações
            </Link>
            .
          </Alerta>
          <Alerta tom="sucesso" titulo="Tudo vai para a contabilidade">
            Cada pagamento de hospedagem entra no Financeiro na hora (Prestação de serviços), e o consumo baixa o estoque. As contas do caixa, do banco e da maquininha ficam
            em{" "}
            <Link href={`/e/${empresaId}/loja/configuracoes`} className="underline">
              Restaurante e bar → configurações
            </Link>
            .
          </Alerta>
          <Alerta tom="alerta" titulo="Nota fiscal e ficha de registro">
            A hospedagem é serviço: a nota é a NFS-e, emitida em Notas → Emitir nota de serviço (quando o escritório liga a emissão). A ficha de registro do hóspede (FNRH)
            sai em PDF em cada reserva; o envio ao sistema do Ministério do Turismo não é feito pelo portal.
          </Alerta>
        </div>
      </div>
    </>
  );
}
