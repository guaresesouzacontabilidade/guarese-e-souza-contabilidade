import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, NotebookPen } from "lucide-react";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { BotaoExcluirHospede, DialogoHospede, DialogoObservacoesHospede } from "@/components/hotel/hospede";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { GENEROS, STATUS_RESERVA, TIPOS_DOCUMENTO, VARIANTE_STATUS, diaMes, noites, type StatusReserva } from "@/lib/hotel/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarCpf, formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Hóspede" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaHospede({ params }: PageProps<"/e/[empresaId]/hotel/hospedes/[hospedeId]">) {
  const { empresaId, hospedeId } = await params;
  if (!UUID.test(hospedeId)) notFound();
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const [{ data: h }, { data: reservas }, { data: comoAcomp }] = await Promise.all([
    ctx.supabase.from("hotel_hospedes").select("*").eq("empresa_id", empresaId).eq("id", hospedeId).maybeSingle(),
    ctx.supabase
      .from("hotel_reservas")
      .select("id, numero, status, entrada, saida, valor_previsto, quarto:hotel_quartos!hotel_reservas_empresa_id_quarto_id_fkey(numero)")
      .or(`hospede_id.eq.${hospedeId},ocupante_id.eq.${hospedeId}`)
      .order("entrada", { ascending: false }),
    ctx.supabase.from("hotel_reserva_hospedes").select("reserva_id").eq("hospede_id", hospedeId),
  ]);
  if (!h) notFound();
  const base = `/e/${empresaId}/hotel`;
  const linhas: [string, string | null][] = h.tipo_pessoa === "PJ" ? [
    ["CNPJ", h.cnpj ? formatarDocumento(h.cnpj) : null],
    ["Telefone", h.telefone ? formatarTelefone(h.telefone) : null],
    ["E-mail", h.email],
    ["Endereço", h.endereco],
    ["Cidade", h.cidade ? `${h.cidade}${h.uf ? `/${h.uf}` : ""}` : null],
    ["CEP", h.cep ? formatarCep(h.cep) : null],
  ] : [
    ["CPF", h.cpf ? formatarCpf(h.cpf) : null],
    [h.documento_tipo ? TIPOS_DOCUMENTO[h.documento_tipo] : "Outro documento", h.documento],
    ["Nascimento", h.nascimento ? formatarData(h.nascimento) : null],
    ["Gênero", h.genero ? GENEROS[h.genero] : null],
    ["Nacionalidade", h.nacionalidade],
    ["Profissão", h.profissao],
    ["Telefone", h.telefone ? formatarTelefone(h.telefone) : null],
    ["E-mail", h.email],
    ["Endereço", h.endereco],
    ["Cidade", h.cidade ? `${h.cidade}${h.uf ? `/${h.uf}` : ""}` : null],
    ["CEP", h.cep ? formatarCep(h.cep) : null],
    ["País", h.pais],
  ];
  return (
    <>
      <CabecalhoPagina
        titulo={h.nome}
        descricao={`${(reservas ?? []).filter((r) => r.status === "encerrada" || r.status === "hospedado").length} estadia(s)${comoAcomp?.length ? ` e ${comoAcomp.length} como acompanhante` : ""}`}
        voltar={{ href: `${base}/hospedes`, rotulo: "Hóspedes" }}
        acoes={
          <>
            <DialogoHospede empresaId={empresaId} hospede={{ ...h, id: h.id }} />
            {ctx.gerente && !reservas?.length && !comoAcomp?.length ? <BotaoExcluirHospede empresaId={empresaId} hospedeId={h.id} /> : null}
            <Button asChild tamanho="sm">
              <Link href={`${base}/reservas/nova?hospede=${h.id}`}>
                <CalendarPlus /> Nova reserva
              </Link>
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ficha</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              {linhas.map(([r, v]) => (
                <div key={r} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{r}</dt>
                  <dd className="text-right">{v || "—"}</dd>
                </div>
              ))}
            </dl>
            <div className={cn("mt-3 rounded-lg p-3 text-sm", h.observacoes ? "border border-alerta/40 bg-alerta-bg/40" : "bg-muted/40")}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <NotebookPen className="size-4 shrink-0" /> Observações
                </span>
                <DialogoObservacoesHospede empresaId={empresaId} hospedeId={h.id} nome={h.nome} observacoes={h.observacoes} />
              </div>
              {h.observacoes ? <p className="mt-2 whitespace-pre-line">{h.observacoes}</p> : <p className="mt-1 text-xs text-muted-foreground">Nada anotado (só o hotel vê).</p>}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {reservas?.length ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Nº</Th>
                    <Th>Quarto</Th>
                    <Th>Estadia</Th>
                    <Th className="text-right">Diárias</Th>
                    <Th>Situação</Th>
                  </Tr>
                </THead>
                <TBody>
                  {reservas.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <Link href={`${base}/reservas/${r.id}`} className="text-primary hover:underline">
                          {r.numero}
                        </Link>
                      </Td>
                      <Td>{r.quarto?.numero}</Td>
                      <Td>
                        {diaMes(r.entrada)} → {diaMes(r.saida)} ({noites(r.entrada, r.saida)} n)
                      </Td>
                      <Td className="text-right numero">{formatarMoeda(r.valor_previsto)}</Td>
                      <Td>
                        <Badge variante={VARIANTE_STATUS[r.status as StatusReserva]}>{STATUS_RESERVA[r.status as StatusReserva]}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted-foreground">Nenhuma reserva ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
