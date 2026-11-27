import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina } from "@/components/ui/pagina";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { EM_ABERTO, STATUS_SOLICITACAO } from "@/lib/solicitacoes/rotulos";
import { hojeISO } from "@/lib/competencia";
import { formatarData, formatarRelativo } from "@/lib/formatos";
import { mensagemErro } from "@/lib/acoes";

export const metadata: Metadata = { title: "Solicitações" };

export default async function PaginaSolicitacoes({ params }: PageProps<"/e/[empresaId]/solicitacoes">) {
  const { empresaId } = await params;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("mensagens.usar")) return <Alerta tom="alerta">Seu acesso não inclui as solicitações desta empresa.</Alerta>;
  const hoje = hojeISO();
  const { data, error } = await ctx.supabase
    .from("solicitacoes")
    .select("id, numero, titulo, status, prioridade, prazo, updated_at, servico:servicos_catalogo(nome)")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(200);
  const lista = data ?? [];
  const abertas = lista.filter((s) => EM_ABERTO.includes(s.status));
  const encerradas = lista.filter((s) => !EM_ABERTO.includes(s.status));
  const base = `/e/${empresaId}/solicitacoes`;

  const tabela = (itens: typeof lista) => (
    <Table>
      <THead>
        <Tr>
          <Th>Solicitação</Th>
          <Th>Situação</Th>
          <Th className="hidden md:table-cell">Prazo</Th>
          <Th className="hidden lg:table-cell">Atualizada</Th>
        </Tr>
      </THead>
      <TBody>
        {itens.map((s) => {
          const st = STATUS_SOLICITACAO[s.status];
          const atrasada = s.prazo && s.prazo < hoje && EM_ABERTO.includes(s.status);
          return (
            <Tr key={s.id}>
              <Td>
                <Link href={`${base}/${s.id}`} className="font-medium text-primary hover:underline">
                  #{s.numero} · {s.titulo}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {(s.servico as unknown as { nome: string } | null)?.nome}
                  {s.prioridade === "urgente" ? " · urgente" : ""}
                </span>
              </Td>
              <Td>
                <Badge variante={st?.tom ?? "neutro"}>{st?.rotulo ?? s.status}</Badge>
              </Td>
              <Td className={`hidden md:table-cell ${atrasada ? "text-perigo" : ""}`}>{s.prazo ? formatarData(s.prazo) : "—"}</Td>
              <Td className="hidden lg:table-cell text-sm text-muted-foreground">{formatarRelativo(s.updated_at)}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );

  return (
    <>
      <CabecalhoPagina
        titulo="Solicitações"
        descricao="Peça serviços ao escritório (alteração contratual, declarações, admissões, férias, certidões...) e acompanhe o andamento."
        acoes={
          <Button asChild>
            <Link href={`${base}/nova`}>
              <Plus /> Nova solicitação
            </Link>
          </Button>
        }
      />
      {error ? <Alerta tom="perigo" className="mb-4">{mensagemErro(error)}</Alerta> : null}
      {lista.length === 0 ? (
        <EstadoVazio
          icone={ClipboardList}
          titulo="Nenhuma solicitação ainda"
          descricao="Quando precisar de um serviço do escritório, abra uma solicitação: você acompanha cada etapa e conversa com a equipe por ali."
          acao={
            <Button asChild>
              <Link href={`${base}/nova`}>
                <Plus /> Nova solicitação
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="px-0 pt-2 sm:px-0">
              {abertas.length ? tabela(abertas) : <p className="p-4 text-sm text-muted-foreground">Nenhuma solicitação em aberto.</p>}
            </CardContent>
          </Card>
          {encerradas.length ? (
            <details className="rounded-xl border border-border bg-card">
              <summary className="cursor-pointer p-4 text-sm font-medium">Concluídas e canceladas ({encerradas.length})</summary>
              {tabela(encerradas)}
            </details>
          ) : null}
        </div>
      )}
    </>
  );
}
