import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { competenciaAtual, lerCompetencia, listaCompetencias, somarMeses } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarDataHora } from "@/lib/formatos";
import { TIPOS_RELATORIO, type TipoRelatorio } from "@/lib/relatorios/snapshot";

export const metadata: Metadata = { title: "Relatórios da carteira" };

export default async function RelatoriosCarteira({ searchParams }: PageProps<"/escritorio/relatorios">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const comp = lerCompetencia(parametro(sp, "competencia")) ?? somarMeses(competenciaAtual(), -1);
  const status = parametro(sp, "status", ["rascunho", "publicado"]);
  const busca = termoBusca(sp.busca).toLowerCase();

  const [empresas, relatorios, acessos] = await Promise.all([
    buscarTudo((de, ate) => s.supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("ativa", true).order("razao_social").range(de, ate)),
    buscarTudo((de, ate) =>
      s.supabase
        .from("relatorios_publicados")
        .select("id, empresa_id, tipo, titulo, competencia, periodo_inicio, periodo_fim, versao, situacao, status, publicado_em, atualizado_em")
        .in("status", ["rascunho", "publicado"])
        .order("atualizado_em", { ascending: false })
        .range(de, ate),
      5000,
    ),
    buscarTudo((de, ate) => s.supabase.from("relatorio_acessos").select("relatorio_id").range(de, ate), 20000),
  ]);
  const nome = new Map(empresas.map((e) => [e.id, e.nome_fantasia || e.razao_social]));
  const visualizacoes = new Map<string, number>();
  for (const a of acessos) visualizacoes.set(a.relatorio_id, (visualizacoes.get(a.relatorio_id) ?? 0) + 1);
  const doMes = relatorios.filter((r) => r.tipo === "pacote_mensal" && r.competencia === comp && r.status === "publicado");
  const comPacote = new Set(doMes.map((r) => r.empresa_id));
  const semPacote = empresas.filter((e) => !comPacote.has(e.id));
  const lista = relatorios
    .filter((r) => !status || r.status === status)
    .filter((r) => !busca || (nome.get(r.empresa_id) ?? "").toLowerCase().includes(busca) || r.titulo.toLowerCase().includes(busca))
    .slice(0, 300);

  return (
    <>
      <CabecalhoPagina titulo="Relatórios da carteira" descricao="Rascunhos em preparo e relatórios publicados para os clientes, com o registro de quantas vezes foram abertos." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo={`Pacotes de ${formatarCompetencia(comp)} publicados`} valor={`${comPacote.size} de ${empresas.length}`} icone={FileText} tom={semPacote.length ? "alerta" : "sucesso"} />
        <Indicador rotulo="Rascunhos em preparo" valor={relatorios.filter((r) => r.status === "rascunho").length} href="?status=rascunho" />
        <Indicador rotulo="Publicados (atuais)" valor={relatorios.filter((r) => r.status === "publicado").length} href="?status=publicado" />
        <Indicador rotulo="Aberturas pelos clientes" valor={acessos.length} />
      </div>

      {semPacote.length ? (
        <details className="mb-5 rounded-lg border border-alerta/40 bg-alerta-bg">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-alerta-fg">
            {semPacote.length} empresa(s) sem o pacote de {formatarCompetencia(comp, true)} publicado
          </summary>
          <ul className="grid gap-1 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            {semPacote.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{e.nome_fantasia || e.razao_social}</span>
                <Link href={`/e/${e.id}/relatorios/publicados/novo?periodo=${comp.slice(0, 7)}`} className="shrink-0 text-xs text-primary hover:underline">
                  Preparar
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Mês de referência" className="w-full sm:w-52">
          {listaCompetencias(18, 0).map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label="Situação" className="w-full sm:w-44">
          <option value="">Rascunhos e publicados</option>
          <option value="rascunho">Somente rascunhos</option>
          <option value="publicado">Somente publicados</option>
        </Select>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Empresa ou título" className="pl-9" aria-label="Buscar" />
        </div>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      {lista.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th>Relatório</Th>
              <Th>Período</Th>
              <Th>Situação</Th>
              <Th className="text-right">Aberturas</Th>
            </tr>
          </THead>
          <TBody>
            {lista.map((r) => (
              <Tr key={r.id}>
                <Td className="max-w-[12rem] truncate text-sm">{nome.get(r.empresa_id) ?? "—"}</Td>
                <Td className="max-w-[20rem]">
                  <Link href={`/e/${r.empresa_id}/relatorios/publicados/${r.id}`} className="block truncate font-medium hover:underline">
                    {r.titulo}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {TIPOS_RELATORIO[r.tipo as TipoRelatorio]?.rotulo ?? r.tipo}
                    {r.status === "publicado" ? ` · versão ${r.versao} · ${formatarDataHora(r.publicado_em)}` : ` · atualizado ${formatarDataHora(r.atualizado_em)}`}
                  </p>
                </Td>
                <Td className="whitespace-nowrap text-sm">
                  {formatarData(r.periodo_inicio)} a {formatarData(r.periodo_fim)}
                </Td>
                <Td>
                  {r.status === "rascunho" ? (
                    <Badge variante="neutro">Rascunho</Badge>
                  ) : (
                    <Badge variante={r.situacao === "revisado" ? "sucesso" : "alerta"}>{r.situacao === "revisado" ? "Revisado" : "Preliminar"}</Badge>
                  )}
                </Td>
                <Td className="text-right text-sm">{visualizacoes.get(r.id) ?? 0}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={FileText} titulo="Nenhum relatório encontrado" />
      )}
    </>
  );
}
