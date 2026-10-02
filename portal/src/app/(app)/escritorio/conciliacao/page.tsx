import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, GitCompareArrows, Search } from "lucide-react";
import { exigirEquipe, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { consolidarEscritorio } from "@/lib/conciliacao/regras";
import { competenciaDe, diasEntre, hojeISO, somarDias } from "@/lib/competencia";
import { formatarCompetencia, formatarData, formatarRelativo } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Conciliação da carteira" };

export default async function ConciliacaoCarteira({ searchParams }: PageProps<"/escritorio/conciliacao">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const situacao = parametro(sp, "situacao", ["pendentes", "sugestoes", "em_dia", "sem_contas"]);
  const busca = termoBusca(sp.busca).toLowerCase();
  const hoje = hojeISO();

  // Somente empresas que o usuário acessa e cujo financeiro ele pode ver (o RLS também restringe as consultas).
  const empresas = (await obterEmpresasDoUsuario()).filter((e) => e.ativa && e.permissoes.has("financeiro.ver"));
  const acessiveis = new Set(empresas.map((e) => e.id));
  const podeConciliar = new Set(empresas.filter((e) => e.permissoes.has("conciliacao.executar")).map((e) => e.id));

  const [pendentes, sugestoes, confirmadas, contas] = empresas.length
    ? await Promise.all([
        buscarTudo(
          (de, ate) => s.supabase.from("movimentos_bancarios").select("empresa_id, data, valor").eq("status_conciliacao", "pendente").order("id").range(de, ate),
          200_000,
        ),
        buscarTudo((de, ate) => s.supabase.from("conciliacoes").select("empresa_id").eq("status", "sugerida").order("id").range(de, ate), 100_000),
        buscarTudo(
          (de, ate) =>
            s.supabase
              .from("conciliacoes")
              .select("empresa_id, confirmada_em")
              .eq("status", "confirmada")
              .gte("confirmada_em", somarDias(hoje, -400))
              .order("confirmada_em", { ascending: false })
              .order("id")
              .range(de, ate),
          50_000,
        ),
        buscarTudo((de, ate) => s.supabase.from("contas_financeiras").select("empresa_id").eq("ativa", true).order("id").range(de, ate)),
      ])
    : [[], [], [], []];

  const doUsuario = <T extends { empresa_id: string }>(l: T[]) => l.filter((x) => acessiveis.has(x.empresa_id));
  const linhas = consolidarEscritorio(
    empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia ?? e.razao_social })),
    doUsuario(pendentes),
    doUsuario(sugestoes),
    doUsuario(confirmadas),
    doUsuario(contas),
  );

  const filtradas = linhas
    .filter((l) => !busca || l.nome.toLowerCase().includes(busca))
    .filter((l) => {
      switch (situacao) {
        case "pendentes":
          return l.pendentes > 0;
        case "sugestoes":
          return l.sugestoes > 0;
        case "em_dia":
          return l.contas > 0 && l.pendentes === 0;
        case "sem_contas":
          return l.contas === 0;
        default:
          return true;
      }
    })
    .sort((a, b) => b.pendentes - a.pendentes || (a.maisAntiga ?? "9999").localeCompare(b.maisAntiga ?? "9999") || a.nome.localeCompare(b.nome, "pt-BR"));

  const totalPendentes = linhas.reduce((n, l) => n + l.pendentes, 0);
  const totalSugestoes = linhas.reduce((n, l) => n + l.sugestoes, 0);
  const comPendencia = linhas.filter((l) => l.pendentes > 0).length;
  const emDia = linhas.filter((l) => l.contas > 0 && l.pendentes === 0).length;

  return (
    <>
      <CabecalhoPagina
        titulo="Conciliação da carteira"
        descricao="Movimentações bancárias importadas que ainda aguardam conciliação, por empresa. As sugestões automáticas só valem depois de confirmadas."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Movimentações pendentes" valor={totalPendentes} tom={totalPendentes ? "alerta" : "sucesso"} />
        <Indicador rotulo="Sugestões a confirmar" valor={totalSugestoes} tom={totalSugestoes ? "info" : "neutro"} />
        <Indicador rotulo="Empresas com pendências" valor={comPendencia} tom={comPendencia ? "alerta" : "neutro"} />
        <Indicador rotulo="Empresas em dia" valor={emDia} tom="sucesso" detalhe={linhas.length ? `de ${linhas.length} com financeiro` : undefined} />
      </div>
      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação">
          <option value="">Todas</option>
          <option value="pendentes">Com movimentações pendentes</option>
          <option value="sugestoes">Com sugestões a confirmar</option>
          <option value="em_dia">Em dia</option>
          <option value="sem_contas">Sem contas cadastradas</option>
        </Select>
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
      </form>
      {filtradas.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th className="text-right">Pendentes</Th>
              <Th className="text-right">Valor pendente</Th>
              <Th>Mais antiga</Th>
              <Th className="text-right">Sugestões</Th>
              <Th>Última conciliação</Th>
              <Th className="w-10">
                <span className="sr-only">Abrir</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {filtradas.map((l) => {
              const atraso = l.maisAntiga ? diasEntre(l.maisAntiga, hoje) : 0;
              const href = `/e/${l.id}/conciliacao${l.maisAntiga ? `?competencia=${competenciaDe(l.maisAntiga).slice(0, 7)}` : ""}`;
              return (
                <Tr key={l.id}>
                  <Td className="max-w-[18rem]">
                    <span className="block truncate text-sm font-medium">{l.nome}</span>
                    {l.contas === 0 ? <span className="text-xs text-muted-foreground">Nenhuma conta bancária cadastrada</span> : null}
                  </Td>
                  <Td className="text-right numero">
                    {l.pendentes ? <Badge variante={atraso > 45 ? "perigo" : "alerta"}>{l.pendentes}</Badge> : <span className="text-muted-foreground">0</span>}
                  </Td>
                  <Td className="text-right numero">{l.pendentes ? formatarMoeda(l.valorPendente) : "—"}</Td>
                  <Td className="whitespace-nowrap text-sm">
                    {l.maisAntiga ? (
                      <>
                        {formatarData(l.maisAntiga)}
                        <span className="block text-xs text-muted-foreground">competência {formatarCompetencia(competenciaDe(l.maisAntiga))}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-right numero">{l.sugestoes ? <Badge variante="info">{l.sugestoes}</Badge> : <span className="text-muted-foreground">0</span>}</Td>
                  <Td className="whitespace-nowrap text-sm">{l.ultimaConciliacao ? formatarRelativo(l.ultimaConciliacao) : <span className="text-muted-foreground">Nenhuma no último ano</span>}</Td>
                  <Td>
                    {podeConciliar.has(l.id) ? (
                      <Button asChild tamanho="iconeSm" variante="fantasma" aria-label={`Conciliar ${l.nome}`}>
                        <Link href={href}>
                          <ArrowRight />
                        </Link>
                      </Button>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio
          icone={GitCompareArrows}
          titulo={linhas.length ? "Nenhuma empresa com estes filtros" : "Nenhuma empresa com financeiro acessível"}
          descricao={linhas.length ? undefined : "A conciliação aparece aqui para as empresas cujo financeiro você pode acessar."}
        />
      )}
    </>
  );
}
