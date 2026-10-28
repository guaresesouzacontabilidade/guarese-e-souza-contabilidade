import type { Metadata } from "next";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { DialogoExtra, LancarExtras, SUGESTOES_EXTRA } from "@/components/hotel/extras";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { carregarExtras, reservasPorStatus } from "@/lib/hotel/dados";
import { NATUREZAS_EXTRA, UNIDADES_EXTRA } from "@/lib/hotel/rotulos";
import { hojeLocal } from "@/lib/gestao/contexto";
import { formatarMoeda } from "@/lib/dinheiro";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Serviços extras" };

export default async function PaginaExtras({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/extras">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const [hospedados, extras] = await Promise.all([reservasPorStatus(ctx.supabase, empresaId, ["hospedado"]), carregarExtras(ctx.supabase, empresaId)]);
  const ativos = extras.filter((e) => e.ativo);
  const fixa = typeof sp.reserva === "string" ? hospedados.find((h) => h.id === sp.reserva) : undefined;
  return (
    <>
      <CabecalhoPagina
        titulo={fixa ? `Serviços extras — quarto ${fixa.quarto}` : "Serviços extras"}
        descricao={
          fixa
            ? `Na conta de ${fixa.hospede}: quantidade × preço do cadastro, cobrado no check-out.`
            : "Refeições e marmitas, lavanderia e aluguel de carro com preço fixo: informe a quantidade e o valor entra na conta do quarto."
        }
        voltar={fixa ? { href: `/e/${empresaId}/hotel/reservas/${fixa.id}`, rotulo: `Reserva nº ${fixa.numero}` } : undefined}
        acoes={ctx.gerente && extras.length ? <DialogoExtra empresaId={empresaId} /> : undefined}
      />
      {!ativos.length ? (
        ctx.gerente ? (
          <Card className="mb-5">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm">
                Cadastre os serviços que o hotel cobra à parte, com o preço de cada um. Depois a recepção só informa a quantidade (marmitas, peças, dias de aluguel). Comece
                por uma sugestão:
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGESTOES_EXTRA.map((s) => (
                  <DialogoExtra key={s.nome} empresaId={empresaId} modelo={s} />
                ))}
                <DialogoExtra empresaId={empresaId} />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Alerta tom="info">Nenhum serviço extra cadastrado. Peça ao gerente do hotel para cadastrar as refeições, a lavanderia e o aluguel com o preço de cada um.</Alerta>
        )
      ) : !hospedados.length ? (
        <Alerta tom="info" className="mb-5">
          Nenhum hóspede na casa agora. Os serviços extras são lançados na conta de quem já fez o check-in.
        </Alerta>
      ) : (
        <div className="mb-5">
          <LancarExtras
            key={fixa?.id ?? "todos"}
            empresaId={empresaId}
            extras={ativos}
            reservaFixa={fixa?.id}
            gerente={ctx.gerente}
            hoje={hojeLocal()}
            hospedagens={hospedados.map((h) => ({ reserva_id: h.id, quarto: h.quarto, hospede: h.hospede, entrada: h.entrada }))}
          />
        </div>
      )}
      {ctx.gerente && extras.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Serviços cadastrados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Serviço</Th>
                  <Th className="hidden sm:table-cell">Tipo</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="w-12" />
                </Tr>
              </THead>
              <TBody>
                {extras.map((e) => (
                  <Tr key={e.id} className={cn(!e.ativo && "text-muted-foreground")}>
                    <Td>
                      {e.nome} {!e.ativo ? <Badge className="ml-1">Fora de uso</Badge> : null}
                    </Td>
                    <Td className="hidden sm:table-cell">{NATUREZAS_EXTRA[e.natureza].rotulo}</Td>
                    <Td className="whitespace-nowrap text-right numero">
                      {formatarMoeda(e.preco)} <span className="text-xs text-muted-foreground">/ {UNIDADES_EXTRA[e.unidade].um}</span>
                    </Td>
                    <Td>
                      <DialogoExtra empresaId={empresaId} extra={e} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
