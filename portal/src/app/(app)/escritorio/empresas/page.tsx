import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { exigirEquipe } from "@/lib/auth/sessao";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio, Progresso } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarDocumento } from "@/lib/formatos";
import { REGIMES } from "@/lib/rotulos";
import { competenciaAtual } from "@/lib/competencia";

export const metadata: Metadata = { title: "Empresas" };
const POR_PAGINA = 25;

export default async function PaginaEmpresas({ searchParams }: PageProps<"/escritorio/empresas">) {
  const s = await exigirEquipe();
  const sp = await searchParams;
  const busca = typeof sp.busca === "string" ? sp.busca.trim() : "";
  const regime = typeof sp.regime === "string" ? sp.regime : "";
  const situacao = typeof sp.situacao === "string" ? sp.situacao : "ativas";
  const responsavel = typeof sp.responsavel === "string" ? sp.responsavel : "";
  const pagina = Math.max(1, Number(sp.pagina) || 1);

  let q = s.supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia, documento, regime_tributario, ativa, demonstracao, servicos, contador:perfis!empresas_contador_responsavel_id_fkey(nome)", { count: "exact" })
    .order("razao_social")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    q = digitos.length >= 3 ? q.or(`razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%,documento.ilike.%${digitos}%`) : q.or(`razao_social.ilike.%${busca}%,nome_fantasia.ilike.%${busca}%`);
  }
  if (regime) q = q.eq("regime_tributario", regime);
  if (situacao === "ativas") q = q.eq("ativa", true);
  if (situacao === "inativas") q = q.eq("ativa", false);
  if (responsavel) q = q.eq("contador_responsavel_id", responsavel);

  const [{ data: empresas, count }, { data: equipe }, { data: itens }] = await Promise.all([
    q,
    s.supabase.from("perfis").select("id, nome").in("tipo", ["admin", "equipe"]).eq("ativo", true).order("nome"),
    s.supabase.from("checklist_itens").select("empresa_id, status, obrigatorio").eq("competencia", competenciaAtual()),
  ]);

  const progresso = new Map<string, { total: number; ok: number }>();
  for (const i of itens ?? []) {
    if (!i.obrigatorio) continue;
    const p = progresso.get(i.empresa_id) ?? { total: 0, ok: 0 };
    p.total++;
    if (i.status === "concluido" || i.status === "nao_se_aplica") p.ok++;
    progresso.set(i.empresa_id, p);
  }
  const totalPaginas = Math.ceil((count ?? 0) / POR_PAGINA);

  return (
    <>
      <CabecalhoPagina
        titulo="Empresas"
        descricao="Empresas atendidas pelo escritório, com dados cadastrais, usuários, contas e checklist mensal."
        acoes={
          s.perfil.tipo === "admin" ? (
            <Button asChild>
              <Link href="/escritorio/empresas/nova">
                <Plus /> Nova empresa
              </Link>
            </Button>
          ) : null
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="busca" defaultValue={busca} placeholder="Buscar por nome ou CNPJ" className="pl-9" aria-label="Buscar empresa" />
        </div>
        <Select name="regime" defaultValue={regime} aria-label="Regime tributário">
          <option value="">Todos os regimes</option>
          {Object.entries(REGIMES).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
        <Select name="responsavel" defaultValue={responsavel} aria-label="Contador responsável">
          <option value="">Todos os responsáveis</option>
          {(equipe ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Select name="situacao" defaultValue={situacao} aria-label="Situação">
            <option value="ativas">Ativas</option>
            <option value="inativas">Inativas</option>
            <option value="todas">Todas</option>
          </Select>
          <Button type="submit" variante="secundario">
            Filtrar
          </Button>
        </div>
      </form>

      {!empresas?.length ? (
        <EstadoVazio
          icone={Building2}
          titulo={busca || regime || responsavel ? "Nenhuma empresa encontrada com estes filtros" : "Nenhuma empresa cadastrada"}
          descricao={
            s.perfil.tipo === "admin"
              ? "Cadastre a primeira empresa para começar a receber documentos."
              : "Você ainda não foi vinculado a nenhuma empresa. Fale com o administrador do escritório."
          }
          acao={
            s.perfil.tipo === "admin" ? (
              <Button asChild>
                <Link href="/escritorio/empresas/nova">
                  <Plus /> Cadastrar empresa
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Empresa</Th>
                <Th className="hidden md:table-cell">Regime</Th>
                <Th className="hidden lg:table-cell">Responsável</Th>
                <Th className="w-48">Documentação do mês</Th>
                <Th>Situação</Th>
              </tr>
            </THead>
            <TBody>
              {empresas.map((e) => {
                const p = progresso.get(e.id);
                const pct = p && p.total ? Math.round((100 * p.ok) / p.total) : null;
                const contador = e.contador as unknown as { nome: string } | null;
                return (
                  <Tr key={e.id}>
                    <Td>
                      <Link href={`/escritorio/empresas/${e.id}`} className="font-medium text-titulo hover:underline">
                        {e.nome_fantasia ?? e.razao_social}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {e.nome_fantasia ? `${e.razao_social} · ` : ""}
                        {formatarDocumento(e.documento)}
                      </p>
                    </Td>
                    <Td className="hidden text-sm md:table-cell">{REGIMES[e.regime_tributario] ?? e.regime_tributario}</Td>
                    <Td className="hidden text-sm lg:table-cell">{contador?.nome ?? "—"}</Td>
                    <Td>
                      {pct === null ? (
                        <span className="text-xs text-muted-foreground">Checklist não gerado</span>
                      ) : (
                        <div className="space-y-1">
                          <Progresso valor={pct} rotulo="Documentação do mês" />
                          <p className="text-xs text-muted-foreground">
                            {p!.ok} de {p!.total} itens ({pct}%)
                          </p>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {e.ativa ? <Badge variante="sucesso">Ativa</Badge> : <Badge>Inativa</Badge>}
                        {e.demonstracao ? <Badge variante="alerta">Demonstração</Badge> : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={count ?? 0} montarHref={(p) => urlCom("/escritorio/empresas", sp, { pagina: p })} />
        </>
      )}
    </>
  );
}
