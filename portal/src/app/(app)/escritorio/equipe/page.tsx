import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search, Users } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador } from "@/components/ui/pagina";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ConvidarUsuario } from "@/components/usuarios/convite";
import { formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { ROTULO_PAPEL } from "@/lib/permissoes";
import { parametro, termoBusca } from "@/lib/busca";
import { buscarTudo } from "@/lib/supabase/paginar";

export const metadata: Metadata = { title: "Equipe e permissões" };

export default async function PaginaEquipe({ searchParams }: PageProps<"/escritorio/equipe">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const admin = s.perfil.tipo === "admin";
  const busca = termoBusca(sp.busca);
  const situacao = parametro(sp, "situacao", ["ativos", "inativos", "todos"]) || "ativos";
  const perfil = parametro(sp, "perfil", ["admin", "equipe"]);

  let q = s.supabase
    .from("perfis")
    .select("id, nome, email, tipo, cargo, ativo, ultimo_acesso_em, created_at")
    .in("tipo", ["admin", "equipe"])
    .order("ativo", { ascending: false })
    .order("nome");
  if (busca) q = q.or(`nome.ilike.%${busca}%,email.ilike.%${busca}%,cargo.ilike.%${busca}%`);
  if (situacao === "ativos") q = q.eq("ativo", true);
  if (situacao === "inativos") q = q.eq("ativo", false);
  if (perfil) q = q.eq("tipo", perfil);

  const [{ data: pessoas, error }, vinculos, { count: totalEmpresas }] = await Promise.all([
    q,
    buscarTudo((de, ate) => s.supabase.from("empresa_membros").select("user_id").eq("papel", "equipe").eq("ativo", true).range(de, ate)),
    s.supabase.from("empresas").select("id", { count: "exact", head: true }).eq("ativa", true),
  ]);

  const empresasPorPessoa = new Map<string, number>();
  for (const v of vinculos) empresasPorPessoa.set(v.user_id, (empresasPorPessoa.get(v.user_id) ?? 0) + 1);
  const lista = pessoas ?? [];
  const ativos = lista.filter((p) => p.ativo);
  const filtrando = Boolean(busca || perfil || situacao !== "ativos");

  return (
    <>
      <CabecalhoPagina
        titulo="Equipe e permissões"
        descricao={
          admin
            ? "Pessoas do escritório, o perfil de cada uma e as empresas que atendem. Convide, ajuste permissões por empresa e desative acessos."
            : "Pessoas do escritório e as empresas que atendem. Somente administradores alteram acessos."
        }
        acoes={admin ? <ConvidarUsuario rotuloBotao="Convidar pessoa da equipe" /> : null}
      />

      {!filtrando ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Indicador rotulo="Pessoas ativas" valor={ativos.length} icone={Users} />
          <Indicador rotulo="Administradores" valor={ativos.filter((p) => p.tipo === "admin").length} detalhe="Acessam todas as empresas" />
          <Indicador
            rotulo="Aguardando primeiro acesso"
            valor={ativos.filter((p) => !p.ultimo_acesso_em).length}
            tom={ativos.some((p) => !p.ultimo_acesso_em) ? "alerta" : "neutro"}
            detalhe="Convite ainda não aceito"
          />
        </div>
      ) : null}

      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar por nome, e-mail ou cargo" className="pl-9" aria-label="Buscar pessoa" />
        </div>
        <Select name="perfil" defaultValue={perfil} aria-label="Perfil">
          <option value="">Todos os perfis</option>
          <option value="admin">Administradores</option>
          <option value="equipe">Equipe contábil</option>
        </Select>
        <div className="flex gap-2">
          <Select name="situacao" defaultValue={situacao} aria-label="Situação">
            <option value="ativos">Ativos</option>
            <option value="inativos">Desativados</option>
            <option value="todos">Todos</option>
          </Select>
          <Button type="submit" variante="secundario">
            Filtrar
          </Button>
        </div>
      </form>

      {error ? (
        <Alerta tom="perigo">Não foi possível carregar a equipe.</Alerta>
      ) : !lista.length ? (
        <EstadoVazio
          icone={Users}
          titulo={filtrando ? "Ninguém encontrado com estes filtros" : "Nenhuma pessoa da equipe"}
          descricao={admin && !filtrando ? "Convide as pessoas do escritório para começar a distribuir a carteira." : undefined}
          acao={admin && !filtrando ? <ConvidarUsuario rotuloBotao="Convidar pessoa da equipe" /> : null}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Pessoa</Th>
              <Th>Perfil</Th>
              <Th className="hidden md:table-cell">Empresas atendidas</Th>
              <Th className="hidden sm:table-cell">Último acesso</Th>
              <Th>Situação</Th>
              <Th className="w-10" />
            </tr>
          </THead>
          <TBody>
            {lista.map((p) => {
              const qtd = empresasPorPessoa.get(p.id) ?? 0;
              return (
                <Tr key={p.id}>
                  <Td>
                    <Link href={`/escritorio/equipe/${p.id}`} className="font-medium text-titulo hover:underline">
                      {p.nome}
                    </Link>
                    {p.id === s.usuarioId ? <span className="ml-1 text-xs text-muted-foreground">(você)</span> : null}
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </Td>
                  <Td className="text-sm">
                    <p className="whitespace-nowrap">{ROTULO_PAPEL[p.tipo] ?? p.tipo}</p>
                    {p.cargo ? <p className="text-xs text-muted-foreground">{p.cargo}</p> : null}
                  </Td>
                  <Td className="hidden text-sm md:table-cell">
                    {p.tipo === "admin" ? (
                      <span className="text-muted-foreground">Todas ({totalEmpresas ?? 0} ativas)</span>
                    ) : qtd ? (
                      `${qtd} empresa(s)`
                    ) : (
                      <span className="text-alerta">Nenhuma</span>
                    )}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                    {p.ultimo_acesso_em ? <span title={formatarDataHora(p.ultimo_acesso_em)}>{formatarRelativo(p.ultimo_acesso_em)}</span> : "Nunca acessou"}
                  </Td>
                  <Td>
                    {!p.ativo ? (
                      <Badge>Desativado</Badge>
                    ) : !p.ultimo_acesso_em ? (
                      <Badge variante="alerta">Convite pendente</Badge>
                    ) : (
                      <Badge variante="sucesso">Ativo</Badge>
                    )}
                  </Td>
                  <Td>
                    <Button variante="fantasma" tamanho="iconeSm" asChild>
                      <Link href={`/escritorio/equipe/${p.id}`} aria-label={`${admin ? "Gerenciar" : "Ver"} ${p.nome}`}>
                        <ChevronRight />
                      </Link>
                    </Button>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
      {!admin ? (
        <p className="mt-3 text-xs text-muted-foreground">A contagem de empresas considera apenas as empresas que você também atende.</p>
      ) : null}
    </>
  );
}
