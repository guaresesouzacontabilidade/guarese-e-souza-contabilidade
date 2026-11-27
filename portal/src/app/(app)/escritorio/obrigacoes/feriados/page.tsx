import type { Metadata } from "next";
import Link from "next/link";
import { CalendarOff, ChevronLeft, ChevronRight } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { NovoFeriado, RemoverFeriado } from "@/components/obrigacoes/feriados";
import { parametro } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { formatarData, nomeMes } from "@/lib/formatos";
import { carregarLocalEscritorio } from "@/lib/obrigacoes/local";
import { ABRANGENCIAS, TIPOS_FERIADO } from "@/lib/obrigacoes/rotulos";

export const metadata: Metadata = { title: "Feriados" };

const SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export default async function Feriados({ searchParams }: PageProps<"/escritorio/obrigacoes/feriados">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const hoje = hojeISO();
  const ano = Number(parametro(sp, "ano")) || Number(hoje.slice(0, 4));
  const admin = s.perfil.tipo === "admin";
  const [{ data: feriados }, local] = await Promise.all([
    s.supabase.from("feriados").select("*").gte("data", `${ano}-01-01`).lte("data", `${ano}-12-31`).order("data"),
    carregarLocalEscritorio(s.supabase),
  ]);
  const codigos = [...new Set((feriados ?? []).map((f) => f.municipio_ibge).filter(Boolean) as string[])];
  const { data: municipios } = codigos.length ? await s.supabase.from("municipios").select("ibge, nome, uf").in("ibge", codigos) : { data: [] };
  const nomeMunicipio = new Map((municipios ?? []).map((m) => [m.ibge, `${m.nome}/${m.uf}`]));
  const meses = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => (feriados ?? []).some((f) => Number(f.data.slice(5, 7)) === m));
  const temMunicipal = (feriados ?? []).some((f) => f.abrangencia === "municipal");

  return (
    <>
      <CabecalhoPagina
        titulo="Feriados"
        descricao="Usados no cálculo dos dias úteis. Cada regra define se considera só feriados nacionais (declarações federais) ou também os estaduais e municipais (pagamentos e tributos locais)."
        acoes={
          <div className="flex items-center gap-2">
            <Button variante="contorno" tamanho="icone" asChild aria-label="Ano anterior">
              <Link href={`/escritorio/obrigacoes/feriados?ano=${ano - 1}`}>
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-14 text-center text-base font-semibold text-titulo">{ano}</span>
            <Button variante="contorno" tamanho="icone" asChild aria-label="Próximo ano">
              <Link href={`/escritorio/obrigacoes/feriados?ano=${ano + 1}`}>
                <ChevronRight />
              </Link>
            </Button>
            {admin ? <NovoFeriado local={local} /> : null}
          </div>
        }
      />
      {!temMunicipal ? (
        <Alerta tom="alerta" className="mb-4" titulo="Feriados municipais não cadastrados">
          Os feriados nacionais e do Tocantins já estão cadastrados com a fonte. Os municipais (ex.: aniversário de Porto Nacional) variam pela lei de cada município: cadastre-os com a fonte para que os prazos locais fiquem corretos.
        </Alerta>
      ) : null}
      {(feriados ?? []).length ? (
        <div className="space-y-5">
          {meses.map((m) => (
            <section key={m}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{nomeMes(m)}</h2>
              <Table>
                <THead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Feriado</Th>
                    <Th>Abrangência</Th>
                    <Th className="hidden md:table-cell">Fonte</Th>
                    {admin ? <Th className="w-10" /> : null}
                  </tr>
                </THead>
                <TBody>
                  {(feriados ?? [])
                    .filter((f) => Number(f.data.slice(5, 7)) === m)
                    .map((f) => (
                      <Tr key={f.id} className={f.data < hoje ? "opacity-70" : undefined}>
                        <Td className="whitespace-nowrap text-sm">
                          <span className="font-medium numero">{formatarData(f.data)}</span>
                          <span className="block text-xs text-muted-foreground">{SEMANA[new Date(`${f.data}T12:00:00Z`).getUTCDay()]}</span>
                        </Td>
                        <Td>
                          <p className="font-medium">{f.nome}</p>
                          {f.tipo !== "feriado" ? <Badge variante="info">{TIPOS_FERIADO[f.tipo]}</Badge> : null}
                        </Td>
                        <Td className="text-sm">
                          {ABRANGENCIAS[f.abrangencia]}
                          {f.abrangencia === "estadual" ? ` · ${f.uf}` : f.abrangencia === "municipal" ? ` · ${nomeMunicipio.get(f.municipio_ibge ?? "") ?? f.municipio_ibge}` : ""}
                        </Td>
                        <Td className="hidden max-w-sm text-xs text-muted-foreground md:table-cell">{f.fonte}</Td>
                        {admin ? (
                          <Td>
                            <RemoverFeriado id={f.id} nome={f.nome} />
                          </Td>
                        ) : null}
                      </Tr>
                    ))}
                </TBody>
              </Table>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-border p-10 text-center">
          <CalendarOff className="mb-2 size-6 text-muted-foreground" />
          <p className="font-semibold">Nenhum feriado cadastrado em {ano}</p>
          <p className="text-sm text-muted-foreground">Sem feriados cadastrados, só fins de semana deixam de ser dias úteis.</p>
        </div>
      )}
    </>
  );
}
