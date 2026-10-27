import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { CabecalhoPagina, Paginacao } from "@/components/ui/pagina";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { HotelIndisponivel } from "@/components/hotel/navegacao";
import { DialogoHospede } from "@/components/hotel/hospede";
import { obterContextoHotel } from "@/lib/hotel/contexto";
import { formatarCpf, formatarTelefone } from "@/lib/formatos";

export const metadata: Metadata = { title: "Hóspedes" };

const POR_PAGINA = 40;

export default async function PaginaHospedes({ params, searchParams }: PageProps<"/e/[empresaId]/hotel/hospedes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoHotel(empresaId);
  if (!ctx.recepcao) return <HotelIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativo={ctx.hotelAtivo} />;
  const busca = typeof sp.busca === "string" ? sp.busca.slice(0, 60).trim() : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  let q = ctx.supabase.from("hotel_hospedes").select("id, nome, cpf, documento, telefone, cidade, uf, email", { count: "exact" }).eq("empresa_id", empresaId);
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    const termo = busca.replace(/[%,()]/g, " ");
    q = digitos.length >= 3 ? q.or(`cpf.like.%${digitos}%,telefone.like.%${digitos}%`) : q.ilike("nome", `%${termo}%`);
  }
  const inicio = (pagina - 1) * POR_PAGINA;
  const { data: hospedes, count } = await q.order("nome").range(inicio, inicio + POR_PAGINA - 1);
  const ids = (hospedes ?? []).map((h) => h.id);
  const { data: estadias } = ids.length
    ? await ctx.supabase.from("hotel_reservas").select("hospede_id, entrada, status").in("hospede_id", ids).in("status", ["hospedado", "encerrada"])
    : { data: [] };
  const resumo = new Map<string, { n: number; ultima: string }>();
  for (const e of estadias ?? []) {
    const a = resumo.get(e.hospede_id) ?? { n: 0, ultima: "" };
    a.n += 1;
    if (e.entrada > a.ultima) a.ultima = e.entrada;
    resumo.set(e.hospede_id, a);
  }
  const base = `/e/${empresaId}/hotel`;
  return (
    <>
      <CabecalhoPagina titulo="Hóspedes" descricao="Cadastro com os dados da ficha de registro e o histórico de cada hóspede. Só o hotel vê." acoes={<DialogoHospede empresaId={empresaId} abrirAoCriar />} />
      <form className="mb-4 flex gap-2" action={`${base}/hospedes`}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Nome, CPF ou telefone" className="pl-9" aria-label="Buscar hóspede" />
        </div>
        <Button type="submit" variante="contorno">
          Buscar
        </Button>
      </form>
      {hospedes?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Nome</Th>
                  <Th>Documento</Th>
                  <Th className="hidden sm:table-cell">Telefone</Th>
                  <Th className="hidden md:table-cell">Cidade</Th>
                  <Th className="text-right">Estadias</Th>
                </Tr>
              </THead>
              <TBody>
                {hospedes.map((h) => (
                  <Tr key={h.id}>
                    <Td>
                      <Link href={`${base}/hospedes/${h.id}`} className="font-medium text-primary hover:underline">
                        {h.nome}
                      </Link>
                    </Td>
                    <Td>{h.cpf ? formatarCpf(h.cpf) : h.documento ?? <span className="text-alerta">sem documento</span>}</Td>
                    <Td className="hidden sm:table-cell">{h.telefone ? formatarTelefone(h.telefone) : "—"}</Td>
                    <Td className="hidden md:table-cell">{h.cidade ? `${h.cidade}${h.uf ? `/${h.uf}` : ""}` : "—"}</Td>
                    <Td className="text-right">{resumo.get(h.id)?.n ?? 0}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio titulo={busca ? "Nenhum hóspede encontrado" : "Nenhum hóspede cadastrado"} descricao="O cadastro também pode ser feito na hora da reserva." />
      )}
      <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(p) => `${base}/hospedes?${new URLSearchParams({ ...(busca ? { busca } : {}), pagina: String(p) })}`} />
    </>
  );
}
