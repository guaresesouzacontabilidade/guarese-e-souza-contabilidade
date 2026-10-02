import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, GitCompareArrows, Inbox, Search, Sparkles } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { diasEntre, hojeISO } from "@/lib/competencia";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarData, formatarRelativo } from "@/lib/formatos";

export const metadata: Metadata = { title: "Conciliação da carteira" };

export default async function ConciliacaoCarteira({ searchParams }: PageProps<"/escritorio/conciliacao">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const situacao = parametro(sp, "situacao", ["pendentes", "sugestoes", "em_dia", "sem_extrato"]);
  const busca = termoBusca(sp.busca).toLowerCase();
  const hoje = hojeISO();

  const [empresas, resumo] = await Promise.all([
    buscarTudo((de, ate) =>
      s.supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, contador:perfis!empresas_contador_responsavel_id_fkey(nome)")
        .eq("ativa", true)
        .order("razao_social")
        .range(de, ate),
    ),
    s.supabase.rpc("resumo_conciliacao_carteira"),
  ]);
  if (resumo.error) return <Alerta tom="perigo">Não foi possível carregar o resumo: {resumo.error.message}</Alerta>;
  const porEmpresa = new Map((resumo.data ?? []).map((r) => [r.empresa_id, r]));

  const linhas = empresas
    .map((e) => {
      const r = porEmpresa.get(e.id);
      const pendentes = r?.pendentes ?? 0;
      const sugestoes = r?.sugestoes ?? 0;
      const atraso = r?.pendente_mais_antiga ? diasEntre(r.pendente_mais_antiga, hoje) : 0;
      return {
        id: e.id,
        nome: e.nome_fantasia || e.razao_social,
        razao: e.razao_social,
        contador: (e.contador as { nome: string } | null)?.nome ?? null,
        pendentes,
        sugestoes,
        entradas: dec(r?.entradas_pendentes ?? 0),
        saidas: dec(r?.saidas_pendentes ?? 0),
        maisAntiga: r?.pendente_mais_antiga ?? null,
        atraso,
        conciliadas: r?.conciliadas_30d ?? 0,
        ultimaImportacao: r?.ultima_importacao ?? null,
      };
    })
    .filter((l) => !busca || l.nome.toLowerCase().includes(busca) || l.razao.toLowerCase().includes(busca))
    .filter((l) => {
      if (situacao === "pendentes") return l.pendentes > 0;
      if (situacao === "sugestoes") return l.sugestoes > 0;
      if (situacao === "em_dia") return l.ultimaImportacao && l.pendentes === 0;
      if (situacao === "sem_extrato") return !l.ultimaImportacao;
      return true;
    })
    .sort((a, b) => b.sugestoes + b.pendentes - (a.sugestoes + a.pendentes) || b.atraso - a.atraso || a.nome.localeCompare(b.nome, "pt-BR"));

  const todas = [...porEmpresa.values()];
  const totalPend = todas.reduce((t, r) => t + r.pendentes, 0);
  const totalSug = todas.reduce((t, r) => t + r.sugestoes, 0);
  const semExtrato = empresas.filter((e) => !porEmpresa.get(e.id)?.ultima_importacao).length;
  const valorPend = somar(todas.map((r) => dec(r.entradas_pendentes).plus(dec(r.saidas_pendentes))));

  return (
    <>
      <CabecalhoPagina
        titulo="Conciliação da carteira"
        descricao="Situação da conciliação bancária de cada empresa: movimentações pendentes, sugestões para revisar e último extrato importado."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Indicador rotulo="Movimentações pendentes" valor={totalPend} tom={totalPend ? "alerta" : "sucesso"} icone={Inbox} detalhe={<span className="numero">{formatarMoeda(valorPend)} movimentados</span>} href="?situacao=pendentes" />
        <Indicador rotulo="Sugestões para revisar" valor={totalSug} tom={totalSug ? "info" : "neutro"} icone={Sparkles} href="?situacao=sugestoes" />
        <Indicador rotulo="Empresas em dia" valor={empresas.length - semExtrato - todas.filter((r) => r.pendentes > 0).length} icone={CircleCheck} tom="sucesso" href="?situacao=em_dia" />
        <Indicador rotulo="Sem extrato importado" valor={semExtrato} icone={GitCompareArrows} tom={semExtrato ? "alerta" : "neutro"} href="?situacao=sem_extrato" />
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-full sm:w-60">
          <option value="">Todas as empresas</option>
          <option value="pendentes">Com movimentações pendentes</option>
          <option value="sugestoes">Com sugestões para revisar</option>
          <option value="em_dia">Em dia</option>
          <option value="sem_extrato">Sem extrato importado</option>
        </Select>
        <Button type="submit" variante="contorno">
          Filtrar
        </Button>
      </form>

      {linhas.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th className="text-right">Pendentes</Th>
              <Th className="text-right">Sugestões</Th>
              <Th>Mais antiga</Th>
              <Th className="text-right">Conciliadas (30 dias)</Th>
              <Th>Último extrato</Th>
              <Th className="text-right">Ação</Th>
            </tr>
          </THead>
          <TBody>
            {linhas.map((l) => (
              <Tr key={l.id}>
                <Td className="max-w-[16rem]">
                  <p className="truncate font-medium" title={l.razao}>
                    {l.nome}
                  </p>
                  {l.contador ? <p className="truncate text-xs text-muted-foreground">Responsável: {l.contador}</p> : null}
                </Td>
                <Td className="text-right">
                  {l.pendentes ? (
                    <>
                      <span className="font-semibold">{l.pendentes}</span>
                      <span className="block text-xs text-muted-foreground numero">
                        +{formatarMoeda(l.entradas, { semSimbolo: true })} / −{formatarMoeda(l.saidas, { semSimbolo: true })}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </Td>
                <Td className="text-right">{l.sugestoes ? <Badge variante="info">{l.sugestoes}</Badge> : <span className="text-muted-foreground">0</span>}</Td>
                <Td className="whitespace-nowrap text-sm">
                  {l.maisAntiga ? (
                    <>
                      {formatarData(l.maisAntiga)}
                      {l.atraso > 30 ? (
                        <Badge variante="perigo" className="ml-1">
                          {l.atraso} dias
                        </Badge>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="text-right">{l.conciliadas}</Td>
                <Td className="whitespace-nowrap text-sm">
                  {l.ultimaImportacao ? formatarRelativo(l.ultimaImportacao) : <Badge variante="alerta">nenhum</Badge>}
                </Td>
                <Td className="text-right">
                  <Button asChild tamanho="sm" variante={l.sugestoes || l.pendentes ? "primario" : "contorno"}>
                    <Link href={`/e/${l.id}/conciliacao`}>{l.sugestoes || l.pendentes ? "Conciliar" : "Abrir"}</Link>
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio icone={GitCompareArrows} titulo="Nenhuma empresa nesta situação" />
      )}
    </>
  );
}
