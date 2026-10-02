import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { situacaoVencimento, TIPOS_VENCIMENTO } from "@/lib/vencimentos/rotulos";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { hojeISO, somarDias } from "@/lib/competencia";
import { formatarData } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Vencimentos da carteira" };

export default async function VencimentosCarteira({ searchParams }: PageProps<"/escritorio/vencimentos">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const hoje = hojeISO();
  const filtro = parametro(sp, "situacao", ["vencidos", "30", "60", "todos"]) || "60";
  const tipo = parametro(sp, "tipo", Object.keys(TIPOS_VENCIMENTO));
  const busca = termoBusca(sp.busca).toLowerCase();
  const limite = filtro === "30" ? somarDias(hoje, 30) : filtro === "60" ? somarDias(hoje, 60) : filtro === "vencidos" ? somarDias(hoje, -1) : null;

  const resultado = await buscarTudo((de, ate) => {
    let q = s.supabase
      .from("vencimentos")
      .select("id, empresa_id, tipo, descricao, validade, responsavel, empresa:empresas!inner(razao_social, nome_fantasia, ativa)")
      .eq("situacao", "ativo")
      .eq("empresa.ativa", true)
      .order("validade")
      .range(de, ate);
    if (limite) q = q.lte("validade", limite);
    if (tipo) q = q.eq("tipo", tipo);
    return q;
  })
    .then((linhas) => ({ linhas, erro: null as string | null }))
    .catch((e: unknown) => ({ linhas: [], erro: mensagemErro(e) }));
  const erro = resultado.erro;
  const linhas = resultado.linhas
    .map((v) => {
      const e = v.empresa as unknown as { razao_social: string; nome_fantasia: string | null };
      return { ...v, nomeEmpresa: e.nome_fantasia ?? e.razao_social, s: situacaoVencimento(v.validade, hoje) };
    })
    .filter((v) => !busca || `${v.nomeEmpresa} ${v.descricao}`.toLowerCase().includes(busca));
  const vencidos = linhas.filter((v) => v.s.situacao === "vencido" || v.s.situacao === "vence_hoje").length;
  const em15 = linhas.filter((v) => v.s.situacao === "proximo").length;
  const em30 = linhas.filter((v) => v.s.situacao === "atencao").length;

  return (
    <>
      <CabecalhoPagina
        titulo="Vencimentos da carteira"
        descricao="Certificados digitais, alvarás, licenças e certidões de todas as empresas, pela data de validade."
      />
      {erro ? <Alerta tom="perigo" className="mb-4">{erro}</Alerta> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Indicador rotulo="Vencidos ou vencendo hoje" valor={vencidos} tom={vencidos ? "perigo" : "sucesso"} />
        <Indicador rotulo="Vencem em até 15 dias" valor={em15} tom={em15 ? "alerta" : "neutro"} />
        <Indicador rotulo="Vencem em 16 a 30 dias" valor={em30} tom={em30 ? "info" : "neutro"} />
      </div>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa ou documento" className="pl-9" aria-label="Buscar" />
        </div>
        <Select name="situacao" defaultValue={filtro} aria-label="Período">
          <option value="vencidos">Somente vencidos</option>
          <option value="30">Vencidos e próximos 30 dias</option>
          <option value="60">Vencidos e próximos 60 dias</option>
          <option value="todos">Todos</option>
        </Select>
        <Select name="tipo" defaultValue={tipo} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS_VENCIMENTO).map(([v, t]) => (
            <option key={v} value={v}>
              {t.rotulo}
            </option>
          ))}
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>
      {linhas.length ? (
        <Card>
          <CardContent className="px-0 pt-2 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Documento</Th>
                  <Th className="hidden md:table-cell">Validade</Th>
                  <Th>Situação</Th>
                  <Th className="hidden lg:table-cell">Quem renova</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((v) => (
                  <Tr key={v.id}>
                    <Td>
                      <Link href={`/e/${v.empresa_id}/vencimentos`} className="font-medium text-primary hover:underline">
                        {v.nomeEmpresa}
                      </Link>
                    </Td>
                    <Td>
                      {v.descricao}
                      <span className="block text-xs text-muted-foreground">{TIPOS_VENCIMENTO[v.tipo]?.rotulo ?? v.tipo}</span>
                    </Td>
                    <Td className="hidden md:table-cell">{formatarData(v.validade)}</Td>
                    <Td>
                      <Badge variante={v.s.tom}>{v.s.rotulo}</Badge>
                    </Td>
                    <Td className="hidden lg:table-cell text-sm">{v.responsavel === "cliente" ? "A empresa" : "Escritório"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={CalendarClock} titulo="Nada vencendo neste período" descricao="Cadastre os vencimentos na área de cada empresa (menu Vencimentos)." />
      )}
    </>
  );
}
