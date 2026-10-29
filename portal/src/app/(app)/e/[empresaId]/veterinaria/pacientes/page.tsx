import type { Metadata } from "next";
import Link from "next/link";
import { PawPrint, Search } from "lucide-react";
import { CabecalhoPagina, Paginacao } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { DialogoTutor } from "@/components/veterinaria/cadastros";
import { ClinicaIndisponivel } from "@/components/veterinaria/comuns";
import { formatarCpf, formatarTelefone } from "@/lib/formatos";
import { obterContextoClinica } from "@/lib/veterinaria/contexto";
import { ESPECIES } from "@/lib/veterinaria/rotulos";

export const metadata: Metadata = { title: "Tutores e animais" };

const POR_PAGINA = 30;

export default async function PaginaPacientes({ params, searchParams }: PageProps<"/e/[empresaId]/veterinaria/pacientes">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoClinica(empresaId);
  if (!ctx.recepcao) return <ClinicaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.clinicaAtiva} />;
  const busca = typeof sp.busca === "string" ? sp.busca.slice(0, 60).trim() : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const base = `/e/${empresaId}/veterinaria`;

  let q = ctx.supabase.from("vet_tutores").select("id, nome, cpf, telefone, cidade, uf", { count: "exact" }).eq("empresa_id", empresaId);
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    const termo = busca.replace(/[%,()*]/g, " ").trim();
    if (digitos.length >= 4) q = q.or(`cpf.like.%${digitos}%,telefone.like.%${digitos}%,telefone2.like.%${digitos}%`);
    else {
      // Pelo nome do tutor ou de um animal dele (ou o microchip)
      const { data: animais } = await ctx.supabase
        .from("vet_pacientes")
        .select("tutor_id")
        .eq("empresa_id", empresaId)
        .or(`nome.ilike.%${termo}%,microchip.ilike.%${termo.replace(/\s/g, "")}%`)
        .limit(200);
      const ids = [...new Set((animais ?? []).map((a) => a.tutor_id))];
      q = ids.length ? q.or(`nome.ilike.%${termo}%,id.in.(${ids.join(",")})`) : q.ilike("nome", `%${termo}%`);
    }
  }
  const inicio = (pagina - 1) * POR_PAGINA;
  const { data: tutores, count } = await q.order("nome").range(inicio, inicio + POR_PAGINA - 1);
  const ids = (tutores ?? []).map((t) => t.id);
  const { data: animais } = ids.length
    ? await ctx.supabase.from("vet_pacientes").select("id, nome, especie, tutor_id, ativo, obito_em").in("tutor_id", ids).order("nome")
    : { data: [] };
  const porTutor = new Map<string, NonNullable<typeof animais>>();
  for (const a of animais ?? []) porTutor.set(a.tutor_id, [...(porTutor.get(a.tutor_id) ?? []), a]);

  return (
    <>
      <CabecalhoPagina
        titulo="Tutores e animais"
        descricao="Cadastro dos responsáveis e dos animais. Abra o animal para ver o prontuário, as vacinas, as receitas e os documentos."
        voltar={{ href: base, rotulo: "Painel da clínica" }}
        acoes={<DialogoTutor empresaId={empresaId} abrirAoCriar />}
      />
      <form className="mb-4 flex gap-2" action={`${base}/pacientes`}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Nome do tutor ou do animal, CPF, telefone ou microchip" className="pl-9" aria-label="Buscar tutor ou animal" />
        </div>
        <Button type="submit" variante="contorno">
          Buscar
        </Button>
      </form>
      {tutores?.length ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Tutor</Th>
                  <Th>Animais</Th>
                  <Th className="hidden md:table-cell">Contato</Th>
                </Tr>
              </THead>
              <TBody>
                {tutores.map((t) => (
                  <Tr key={t.id}>
                    <Td className="align-top">
                      <Link href={`${base}/tutores/${t.id}`} className="font-medium text-primary hover:underline">
                        {t.nome}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{t.cpf ? formatarCpf(t.cpf) : "sem CPF"}</span>
                    </Td>
                    <Td className="align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {(porTutor.get(t.id) ?? []).map((a) => (
                          <Link
                            key={a.id}
                            href={`${base}/pacientes/${a.id}`}
                            className={`inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:bg-muted ${!a.ativo || a.obito_em ? "opacity-60" : ""}`}
                          >
                            <PawPrint className="size-3" /> {a.nome} <span className="text-muted-foreground">({ESPECIES[a.especie] ?? a.especie})</span>
                            {a.obito_em ? " · óbito" : ""}
                          </Link>
                        ))}
                        {!(porTutor.get(t.id) ?? []).length ? <span className="text-xs text-muted-foreground">nenhum animal</span> : null}
                      </div>
                    </Td>
                    <Td className="hidden align-top md:table-cell">
                      {t.telefone ? formatarTelefone(t.telefone) : "—"}
                      <span className="block text-xs text-muted-foreground">{t.cidade ? `${t.cidade}${t.uf ? `/${t.uf}` : ""}` : ""}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={PawPrint} titulo={busca ? "Ninguém encontrado" : "Nenhum tutor cadastrado"} descricao="Cadastre o tutor e, na ficha dele, os animais." />
      )}
      <Paginacao
        pagina={pagina}
        totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)}
        total={count ?? 0}
        montarHref={(p) => `${base}/pacientes?${new URLSearchParams({ ...(busca ? { busca } : {}), pagina: String(p) })}`}
      />
    </>
  );
}
