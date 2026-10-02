import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { EM_ABERTO, STATUS_SOLICITACAO } from "@/lib/solicitacoes/rotulos";
import { buscarTudo } from "@/lib/supabase/paginar";
import { parametro, termoBusca } from "@/lib/busca";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarRelativo } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Solicitações da carteira" };

export default async function SolicitacoesCarteira({ searchParams }: PageProps<"/escritorio/solicitacoes">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const hoje = hojeISO();
  const situacao = parametro(sp, "situacao", ["abertas", "aguardando_cliente", "atrasadas", "minhas", "todas"]) || "abertas";
  const busca = termoBusca(sp.busca).toLowerCase();

  const resultado = await buscarTudo((de, ate) => {
    let q = s.supabase
      .from("solicitacoes")
      .select(
        "id, numero, empresa_id, titulo, status, prioridade, prazo, responsavel_id, updated_at, servico:servicos_catalogo(nome), empresa:empresas!inner(razao_social, nome_fantasia), responsavel:perfis!solicitacoes_responsavel_id_fkey(nome)",
      )
      .order("prazo", { ascending: true, nullsFirst: false })
      .range(de, ate);
    if (situacao !== "todas") q = q.in("status", situacao === "aguardando_cliente" ? ["aguardando_cliente"] : EM_ABERTO);
    if (situacao === "minhas") q = q.eq("responsavel_id", s.usuarioId);
    if (situacao === "atrasadas") q = q.lt("prazo", hoje);
    return q;
  })
    .then((linhas) => ({ linhas, erro: null as string | null }))
    .catch((e: unknown) => ({ linhas: [], erro: mensagemErro(e) }));
  const nome = (v: unknown) => (v as { nome: string } | null)?.nome ?? null;
  const linhas = resultado.linhas
    .map((x) => {
      const e = x.empresa as unknown as { razao_social: string; nome_fantasia: string | null };
      return { ...x, nomeEmpresa: e.nome_fantasia ?? e.razao_social };
    })
    .filter((x) => !busca || `${x.nomeEmpresa} ${x.titulo} ${x.numero}`.toLowerCase().includes(busca));
  const semResponsavel = linhas.filter((x) => !x.responsavel_id && EM_ABERTO.includes(x.status)).length;
  const atrasadas = linhas.filter((x) => x.prazo && x.prazo < hoje && EM_ABERTO.includes(x.status)).length;
  const aguardando = linhas.filter((x) => x.status === "aguardando_cliente").length;

  return (
    <>
      <CabecalhoPagina titulo="Solicitações da carteira" descricao="Pedidos de serviço dos clientes de todas as empresas, pelo prazo." />
      {resultado.erro ? <Alerta tom="perigo" className="mb-4">{resultado.erro}</Alerta> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Indicador rotulo="Sem responsável" valor={semResponsavel} tom={semResponsavel ? "alerta" : "neutro"} />
        <Indicador rotulo="Atrasadas" valor={atrasadas} tom={atrasadas ? "perigo" : "sucesso"} />
        <Indicador rotulo="Aguardando o cliente" valor={aguardando} tom={aguardando ? "info" : "neutro"} />
      </div>
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="busca" defaultValue={busca} placeholder="Buscar empresa, número ou título" className="pl-9" aria-label="Buscar" />
        </div>
        <Select name="situacao" defaultValue={situacao} aria-label="Situação">
          <option value="abertas">Em aberto</option>
          <option value="minhas">Minhas (em aberto)</option>
          <option value="aguardando_cliente">Aguardando o cliente</option>
          <option value="atrasadas">Atrasadas</option>
          <option value="todas">Todas</option>
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
                  <Th>Solicitação</Th>
                  <Th className="hidden md:table-cell">Empresa</Th>
                  <Th>Situação</Th>
                  <Th className="hidden md:table-cell">Prazo</Th>
                  <Th className="hidden lg:table-cell">Responsável</Th>
                </Tr>
              </THead>
              <TBody>
                {linhas.map((x) => {
                  const st = STATUS_SOLICITACAO[x.status];
                  const atrasada = x.prazo && x.prazo < hoje && EM_ABERTO.includes(x.status);
                  return (
                    <Tr key={x.id}>
                      <Td>
                        <Link href={`/e/${x.empresa_id}/solicitacoes/${x.id}`} className="font-medium text-primary hover:underline">
                          #{x.numero} · {x.titulo}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {nome(x.servico)}
                          {x.prioridade === "urgente" ? " · urgente" : ""} · atualizada {formatarRelativo(x.updated_at)}
                        </span>
                        <span className="block text-xs text-muted-foreground md:hidden">{x.nomeEmpresa}</span>
                      </Td>
                      <Td className="hidden md:table-cell">{x.nomeEmpresa}</Td>
                      <Td>
                        <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? x.status}</Badge>
                      </Td>
                      <Td className={`hidden md:table-cell ${atrasada ? "text-perigo" : ""}`}>{x.prazo ? formatarData(x.prazo) : "—"}</Td>
                      <Td className="hidden lg:table-cell text-sm">{nome(x.responsavel) ?? <span className="text-muted-foreground">A definir</span>}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <EstadoVazio icone={ClipboardList} titulo="Nenhuma solicitação neste filtro" descricao="As solicitações abertas pelos clientes aparecem aqui." />
      )}
    </>
  );
}
