import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ConvidarUsuario } from "@/components/usuarios/convite";
import { formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { ROTULO_PAPEL } from "@/lib/permissoes";

export const metadata: Metadata = { title: "Equipe e permissões" };
const POR_PAGINA = 30;

type PerfilLinha = {
  id: string;
  nome: string;
  email: string;
  tipo: string;
  cargo: string | null;
  ativo: boolean;
  ultimo_acesso_em: string | null;
  anonimizado_em: string | null;
};
type Seguranca = { tem_2fa: boolean; sessoes: number };

function Situacao({ p, convitePendente }: { p: PerfilLinha; convitePendente: boolean }) {
  if (p.anonimizado_em) return <Badge variante="neutro">Anonimizado</Badge>;
  if (!p.ativo) return <Badge variante="perigo">Desativado</Badge>;
  if (!p.ultimo_acesso_em && convitePendente) return <Badge variante="alerta">Convite pendente</Badge>;
  if (!p.ultimo_acesso_em) return <Badge variante="info">Nunca acessou</Badge>;
  return <Badge variante="sucesso">Ativo</Badge>;
}

function UltimoAcesso({ quando }: { quando: string | null }) {
  return quando ? <span title={formatarDataHora(quando)}>{formatarRelativo(quando)}</span> : <span>—</span>;
}

function ColunaSeguranca({ seg, exigido }: { seg?: Seguranca; exigido: boolean }) {
  if (!seg) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {seg.tem_2fa ? <Badge variante="sucesso">2 etapas</Badge> : <Badge variante={exigido ? "perigo" : "neutro"}>sem 2 etapas</Badge>}
      <span className="text-muted-foreground">{seg.sessoes ? `${seg.sessoes} sessão(ões)` : "sem sessão aberta"}</span>
    </div>
  );
}

export default async function PaginaEquipe({ searchParams }: PageProps<"/escritorio/equipe">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const admin = s.perfil.tipo === "admin";
  const aba = admin && sp.aba === "clientes" ? "clientes" : "equipe";
  const busca = typeof sp.busca === "string" ? sp.busca.trim() : "";
  const empresaFiltro = typeof sp.empresa === "string" ? sp.empresa : "";
  const situacao = typeof sp.situacao === "string" ? sp.situacao : "ativos";
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const campos = "id, nome, email, tipo, cargo, ativo, ultimo_acesso_em, anonimizado_em";

  // Perfis da aba atual
  let perfis: PerfilLinha[] = [];
  let total = 0;
  if (aba === "equipe") {
    const { data } = await s.supabase.from("perfis").select(campos).in("tipo", ["admin", "equipe"]).order("ativo", { ascending: false }).order("nome");
    perfis = (data ?? []) as PerfilLinha[];
  } else {
    let ids: string[] | null = null;
    if (empresaFiltro) {
      const { data } = await s.supabase.from("empresa_membros").select("user_id").eq("empresa_id", empresaFiltro).neq("papel", "equipe");
      ids = [...new Set((data ?? []).map((m) => m.user_id))];
    }
    let q = s.supabase
      .from("perfis")
      .select(campos, { count: "exact" })
      .eq("tipo", "cliente")
      .order("nome")
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    if (busca) q = q.or(`nome.ilike.%${busca.replace(/[%,()]/g, " ")}%,email.ilike.%${busca.replace(/[%,()]/g, " ")}%`);
    if (situacao === "ativos") q = q.eq("ativo", true);
    if (situacao === "desativados") q = q.eq("ativo", false);
    const { data, count } = await q;
    perfis = (data ?? []) as PerfilLinha[];
    total = count ?? 0;
  }
  const ids = perfis.map((p) => p.id);

  const [{ data: vinculos }, { data: seg }, { data: convites }, { data: escritorio }, { data: empresas }] = await Promise.all([
    ids.length
      ? s.supabase.from("empresa_membros").select("user_id, papel, empresa:empresas(id, razao_social, nome_fantasia)").in("user_id", ids).eq("ativo", true)
      : Promise.resolve({ data: [] }),
    admin ? s.supabase.rpc("seguranca_usuarios") : Promise.resolve({ data: [] }),
    admin && ids.length ? s.supabase.from("convites").select("user_id").in("user_id", ids).eq("status", "pendente") : Promise.resolve({ data: [] }),
    admin ? s.supabase.from("escritorio").select("exigir_2fa_equipe, exigir_2fa_clientes").eq("id", 1).maybeSingle() : Promise.resolve({ data: null }),
    aba === "clientes" ? s.supabase.from("empresas").select("id, razao_social, nome_fantasia").order("razao_social") : Promise.resolve({ data: [] }),
  ]);

  const porUsuario = new Map<string, { id: string; nome: string; papel: string }[]>();
  for (const v of vinculos ?? []) {
    const e = v.empresa as unknown as { id: string; razao_social: string; nome_fantasia: string | null } | null;
    if (!e) continue;
    const l = porUsuario.get(v.user_id) ?? [];
    l.push({ id: e.id, nome: e.nome_fantasia ?? e.razao_social, papel: v.papel });
    porUsuario.set(v.user_id, l);
  }
  const segPorUsuario = new Map<string, Seguranca>(((seg ?? []) as { user_id: string; tem_2fa: boolean; sessoes: number }[]).map((x) => [x.user_id, x]));
  const pendentes = new Set(((convites ?? []) as { user_id: string | null }[]).map((c) => c.user_id).filter(Boolean) as string[]);
  const exige2faEquipe = Boolean(escritorio?.exigir_2fa_equipe);
  const exige2faClientes = Boolean(escritorio?.exigir_2fa_clientes);

  const abas = admin
    ? [
        { valor: "equipe", rotulo: "Equipe do escritório", href: "/escritorio/equipe" },
        { valor: "clientes", rotulo: "Usuários dos clientes", href: "/escritorio/equipe?aba=clientes" },
      ]
    : null;

  const semDuasEtapas = aba === "equipe" && admin ? perfis.filter((p) => p.ativo && !segPorUsuario.get(p.id)?.tem_2fa).length : 0;
  const totalPaginas = Math.ceil(total / POR_PAGINA);

  return (
    <>
      <CabecalhoPagina
        titulo="Equipe e permissões"
        descricao={
          admin
            ? "Quem acessa o portal, com qual perfil e em quais empresas. Desative acessos de quem saiu e revise as permissões periodicamente."
            : "Pessoas da equipe do escritório. Somente administradores alteram acessos e permissões."
        }
        acoes={admin ? <ConvidarUsuario rotuloBotao="Convidar pessoa da equipe" /> : null}
      />
      {abas ? <AbasLink abas={abas} ativa={aba} className="mb-4" /> : null}

      {aba === "equipe" ? (
        <>
          {semDuasEtapas && exige2faEquipe ? (
            <Alerta tom="alerta" className="mb-4">
              {semDuasEtapas} pessoa(s) da equipe ainda sem verificação em duas etapas. Como ela é obrigatória, o cadastro será pedido no próximo acesso.
            </Alerta>
          ) : null}
          <Table>
            <THead>
              <tr>
                <Th>Pessoa</Th>
                <Th>Perfil</Th>
                <Th className="hidden md:table-cell">Empresas</Th>
                {admin ? <Th className="hidden lg:table-cell">Segurança</Th> : null}
                <Th className="hidden sm:table-cell">Último acesso</Th>
                <Th>Situação</Th>
              </tr>
            </THead>
            <TBody>
              {perfis.map((p) => {
                const emp = porUsuario.get(p.id) ?? [];
                return (
                  <Tr key={p.id}>
                    <Td>
                      {admin ? (
                        <Link href={`/escritorio/equipe/${p.id}`} className="font-medium text-titulo hover:underline">
                          {p.nome}
                        </Link>
                      ) : (
                        <p className="font-medium">{p.nome}</p>
                      )}
                      {p.id === s.usuarioId ? <span className="ml-1.5 text-xs text-muted-foreground">(você)</span> : null}
                      <p className="text-xs text-muted-foreground">
                        {p.email}
                        {p.cargo ? ` · ${p.cargo}` : ""}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap text-sm">{ROTULO_PAPEL[p.tipo] ?? p.tipo}</Td>
                    <Td className="hidden text-sm md:table-cell">
                      {p.tipo === "admin" ? (
                        <span className="text-muted-foreground">Todas as empresas</span>
                      ) : emp.length ? (
                        <span title={emp.map((e) => e.nome).join(", ")}>
                          {emp
                            .slice(0, 2)
                            .map((e) => e.nome)
                            .join(", ")}
                          {emp.length > 2 ? ` e mais ${emp.length - 2}` : ""}
                        </span>
                      ) : (
                        <span className="text-alerta">Nenhuma empresa vinculada</span>
                      )}
                    </Td>
                    {admin ? (
                      <Td className="hidden lg:table-cell">
                        <ColunaSeguranca seg={segPorUsuario.get(p.id)} exigido={exige2faEquipe && p.ativo} />
                      </Td>
                    ) : null}
                    <Td className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                      <UltimoAcesso quando={p.ultimo_acesso_em} />
                    </Td>
                    <Td>
                      <Situacao p={p} convitePendente={pendentes.has(p.id)} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </>
      ) : (
        <>
          <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="search">
            <input type="hidden" name="aba" value="clientes" />
            <div className="relative lg:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="busca" defaultValue={busca} placeholder="Buscar por nome ou e-mail" className="pl-9" aria-label="Buscar usuário" />
            </div>
            <Select name="empresa" defaultValue={empresaFiltro} aria-label="Empresa">
              <option value="">Todas as empresas</option>
              {(empresas ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome_fantasia ?? e.razao_social}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Select name="situacao" defaultValue={situacao} aria-label="Situação">
                <option value="ativos">Ativos</option>
                <option value="desativados">Desativados</option>
                <option value="todos">Todos</option>
              </Select>
              <Button type="submit" variante="secundario">
                Filtrar
              </Button>
            </div>
          </form>
          <p className="mb-3 text-xs text-muted-foreground">
            Para convidar clientes ou mudar o que cada um pode fazer em uma empresa, use a aba “Usuários e permissões” no cadastro da empresa.
          </p>
          {!perfis.length ? (
            <EstadoVazio icone={Users} titulo="Nenhum usuário encontrado" descricao="Ajuste os filtros ou convide usuários pela página da empresa." />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Pessoa</Th>
                    <Th className="hidden md:table-cell">Empresas</Th>
                    <Th className="hidden lg:table-cell">Segurança</Th>
                    <Th className="hidden sm:table-cell">Último acesso</Th>
                    <Th>Situação</Th>
                  </tr>
                </THead>
                <TBody>
                  {perfis.map((p) => {
                    const emp = porUsuario.get(p.id) ?? [];
                    return (
                      <Tr key={p.id}>
                        <Td>
                          <Link href={`/escritorio/equipe/${p.id}`} className="font-medium text-titulo hover:underline">
                            {p.nome}
                          </Link>
                          <p className="text-xs text-muted-foreground">{p.email}</p>
                        </Td>
                        <Td className="hidden text-sm md:table-cell">
                          {emp.length ? (
                            <ul className="space-y-0.5">
                              {emp.map((e) => (
                                <li key={e.id}>
                                  <Link href={`/escritorio/empresas/${e.id}?aba=usuarios`} className="hover:underline">
                                    {e.nome}
                                  </Link>{" "}
                                  <span className="text-xs text-muted-foreground">({ROTULO_PAPEL[e.papel] ?? e.papel})</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted-foreground">Sem empresa ativa</span>
                          )}
                        </Td>
                        <Td className="hidden lg:table-cell">
                          <ColunaSeguranca seg={segPorUsuario.get(p.id)} exigido={exige2faClientes && p.ativo} />
                        </Td>
                        <Td className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                          <UltimoAcesso quando={p.ultimo_acesso_em} />
                        </Td>
                        <Td>
                          <Situacao p={p} convitePendente={pendentes.has(p.id)} />
                        </Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
              <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={total} montarHref={(n) => urlCom("/escritorio/equipe", sp, { aba: "clientes", pagina: n })} />
            </>
          )}
        </>
      )}
    </>
  );
}
