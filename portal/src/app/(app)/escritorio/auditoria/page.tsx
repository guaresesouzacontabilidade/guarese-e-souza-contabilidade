import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { exigirAdmin, obterEmpresasDoUsuario } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Campo, Input, Select } from "@/components/ui/form";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarDataHora } from "@/lib/formatos";
import { parametro, termoBusca } from "@/lib/busca";
import { somarDias } from "@/lib/competencia";
import { ACOES_AUDITORIA, ENTIDADES_AUDITORIA, rotuloAcao, rotuloEntidade } from "@/lib/auditoria/rotulos";

export const metadata: Metadata = { title: "Auditoria" };
const POR_PAGINA = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (v: string) => DATA.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
/** Fuso do escritório (America/Araguaina, sem horário de verão). */
const OFFSET = "-03:00";

/** Histórico de auditoria (somente leitura, somente administradores). */
export default async function PaginaAuditoria({ searchParams }: PageProps<"/escritorio/auditoria">) {
  const s = await exigirAdmin();
  const sp = await searchParams;
  const empresas = await obterEmpresasDoUsuario();
  const nomesEmpresa = new Map(empresas.map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));

  const de = dataValida(parametro(sp, "de")) ? parametro(sp, "de") : "";
  const ate = dataValida(parametro(sp, "ate")) ? parametro(sp, "ate") : "";
  const usuario = UUID.test(parametro(sp, "usuario")) ? parametro(sp, "usuario") : "";
  const empresa = UUID.test(parametro(sp, "empresa")) ? parametro(sp, "empresa") : "";
  const acao = parametro(sp, "acao", Object.keys(ACOES_AUDITORIA));
  const entidade = parametro(sp, "entidade", Object.keys(ENTIDADES_AUDITORIA));
  const registro = termoBusca(sp.registro, 100);
  const pagina = Math.max(1, Number(parametro(sp, "pagina")) || 1);
  const periodoInvalido = Boolean(de && ate && de > ate);

  let q = s.supabase
    .from("auditoria")
    .select("id, ocorrido_em, user_id, user_email, empresa_id, acao, entidade, entidade_id, ip", { count: "exact" })
    .order("ocorrido_em", { ascending: false })
    .order("id", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (de) q = q.gte("ocorrido_em", `${de}T00:00:00${OFFSET}`);
  if (ate) q = q.lt("ocorrido_em", `${somarDias(ate, 1)}T00:00:00${OFFSET}`);
  if (usuario) q = q.eq("user_id", usuario);
  if (empresa) q = q.eq("empresa_id", empresa);
  if (acao) q = q.eq("acao", acao);
  if (entidade) q = q.eq("entidade", entidade);
  if (registro) q = q.eq("entidade_id", registro);

  const [{ data, count, error }, { data: usuarios }] = await Promise.all([
    periodoInvalido ? Promise.resolve({ data: [], count: 0, error: null }) : q,
    s.supabase.from("perfis").select("id, nome, email, tipo").order("nome").limit(1000),
  ]);
  const nomesUsuario = new Map((usuarios ?? []).map((u) => [u.id, u.nome]));
  const linhas = data ?? [];
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA);
  const rota = "/escritorio/auditoria";
  const filtrado = Boolean(de || ate || usuario || empresa || acao || entidade || registro);

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Histórico de alterações e eventos de segurança do portal. Os registros são gravados pelo banco de dados e não podem ser alterados nem excluídos."
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <Campo rotulo="De" htmlFor="filtro-de">
          <Input id="filtro-de" name="de" type="date" defaultValue={de} />
        </Campo>
        <Campo rotulo="Até" htmlFor="filtro-ate">
          <Input id="filtro-ate" name="ate" type="date" defaultValue={ate} />
        </Campo>
        <Campo rotulo="Usuário" htmlFor="filtro-usuario">
          <Select id="filtro-usuario" name="usuario" defaultValue={usuario}>
            <option value="">Todos os usuários</option>
            {(usuarios ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome} ({u.email})
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Empresa" htmlFor="filtro-empresa">
          <Select id="filtro-empresa" name="empresa" defaultValue={empresa}>
            <option value="">Todas as empresas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome_fantasia ?? e.razao_social}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Ação" htmlFor="filtro-acao">
          <Select id="filtro-acao" name="acao" defaultValue={acao}>
            <option value="">Todas as ações</option>
            {Object.entries(ACOES_AUDITORIA).map(([v, a]) => (
              <option key={v} value={v}>
                {a.rotulo}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Entidade" htmlFor="filtro-entidade">
          <Select id="filtro-entidade" name="entidade" defaultValue={entidade}>
            <option value="">Todas as entidades</option>
            {Object.entries(ENTIDADES_AUDITORIA).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Identificador do registro" htmlFor="filtro-registro" ajuda="Código (id) exato do registro alterado.">
          <Input id="filtro-registro" name="registro" defaultValue={registro} autoComplete="off" />
        </Campo>
        <div className="flex items-end gap-2">
          <Button type="submit" variante="secundario">
            Filtrar
          </Button>
          {filtrado ? (
            <Button variante="fantasma" asChild>
              <Link href={rota}>Limpar filtros</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {periodoInvalido ? (
        <Alerta tom="alerta" className="mb-4">
          A data inicial é posterior à data final. Ajuste o período.
        </Alerta>
      ) : null}
      {error ? (
        <Alerta tom="perigo" className="mb-4">
          Não foi possível carregar o histórico de auditoria.
        </Alerta>
      ) : null}

      {linhas.length ? (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Data e hora</Th>
                <Th>Usuário</Th>
                <Th>Ação</Th>
                <Th>Entidade</Th>
                <Th className="hidden lg:table-cell">Empresa</Th>
                <Th className="hidden xl:table-cell">IP</Th>
                <Th className="w-20" />
              </tr>
            </THead>
            <TBody>
              {linhas.map((l) => {
                const tom = ACOES_AUDITORIA[l.acao]?.tom ?? "neutro";
                const nome = l.user_id ? nomesUsuario.get(l.user_id) : null;
                return (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap text-sm numero">{formatarDataHora(l.ocorrido_em)}</Td>
                    <Td>
                      {l.user_id ? (
                        <>
                          <p className="text-sm font-medium">{nome ?? "Usuário"}</p>
                          <p className="text-xs text-muted-foreground">{l.user_email ?? "e-mail removido"}</p>
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sistema</span>
                      )}
                    </Td>
                    <Td>
                      <Badge variante={tom}>{rotuloAcao(l.acao)}</Badge>
                    </Td>
                    <Td className="text-sm">
                      {rotuloEntidade(l.entidade)}
                      {l.entidade_id ? <p className="max-w-[12rem] truncate text-xs text-muted-foreground" title={l.entidade_id}>{l.entidade_id}</p> : null}
                    </Td>
                    <Td className="hidden text-sm lg:table-cell">{l.empresa_id ? (nomesEmpresa.get(l.empresa_id) ?? "Empresa removida") : "—"}</Td>
                    <Td className="hidden text-xs text-muted-foreground xl:table-cell">{l.ip ?? "—"}</Td>
                    <Td>
                      <Link href={`${rota}/${l.id}`} className="text-sm text-primary underline-offset-2 hover:underline">
                        Detalhes
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={count ?? 0} montarHref={(p) => urlCom(rota, sp, { pagina: p })} />
        </>
      ) : (
        <EstadoVazio
          icone={ShieldCheck}
          titulo={filtrado ? "Nenhum registro encontrado com estes filtros" : "Nenhum registro de auditoria"}
          descricao="Alterações em empresas, usuários, documentos, financeiro e eventos de segurança aparecem aqui automaticamente."
        />
      )}
    </>
  );
}
