import type { Metadata } from "next";
import Link from "next/link";
import { Download, ShieldCheck } from "lucide-react";
import { exigirAdmin } from "@/lib/auth/sessao";
import { hojeISO } from "@/lib/competencia";
import { CabecalhoPagina, Paginacao, urlCom } from "@/components/ui/pagina";
import { AbasLink } from "@/components/ui/abas";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { aplicarFiltrosAuditoria, detalharEvento, GRUPOS_EVENTO, lerFiltrosAuditoria, limitesPeriodo } from "@/lib/auditoria/consulta";
import { descreverEvento } from "@/lib/auditoria/rotulos";
import { formatarDataHora } from "@/lib/formatos";

export const metadata: Metadata = { title: "Auditoria" };
const POR_PAGINA = 50;

const TIPO_ACESSO: Record<string, string> = {
  visualizacao: "Visualizou",
  download: "Baixou",
  download_lote: "Baixou (em lote)",
  download_pdf: "Baixou em PDF",
  download_xlsx: "Baixou em Excel",
};

export default async function PaginaAuditoria({ searchParams }: PageProps<"/escritorio/auditoria">) {
  const s = await exigirAdmin();
  const sp = await searchParams;
  const aba = sp.aba === "arquivos" ? "arquivos" : "atividades";
  const origem = sp.origem === "relatorios" ? "relatorios" : "documentos";
  const f = lerFiltrosAuditoria(sp, hojeISO());
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const faixa: [number, number] = [(pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1];

  const [{ data: perfis }, { data: empresas }] = await Promise.all([
    s.supabase.from("perfis").select("id, nome, email, tipo").order("nome"),
    s.supabase.from("empresas").select("id, razao_social, nome_fantasia").order("razao_social"),
  ]);
  const nomeUsuario = new Map((perfis ?? []).map((p) => [p.id, p.nome]));
  const nomeEmpresa = new Map((empresas ?? []).map((e) => [e.id, e.nome_fantasia ?? e.razao_social]));

  const abas = [
    { valor: "atividades", rotulo: "Atividades e alterações", href: urlCom("/escritorio/auditoria", sp, { aba: null, pagina: null, origem: null }) },
    { valor: "arquivos", rotulo: "Acessos a arquivos", href: urlCom("/escritorio/auditoria", sp, { aba: "arquivos", pagina: null, grupo: null }) },
  ];

  let tabela: React.ReactNode;
  let total = 0;
  if (aba === "atividades") {
    const { data, count } = await aplicarFiltrosAuditoria(
      s.supabase.from("auditoria").select("id, ocorrido_em, user_id, user_email, empresa_id, acao, entidade, entidade_id, dados_antes, dados_depois, detalhes, ip, user_agent", { count: "exact" }),
      f,
    )
      .order("ocorrido_em", { ascending: false })
      .range(...faixa);
    total = count ?? 0;
    tabela = data?.length ? (
      <Table>
        <THead>
          <tr>
            <Th className="w-40">Quando</Th>
            <Th>Quem</Th>
            <Th>O que aconteceu</Th>
            <Th className="hidden lg:table-cell">Empresa</Th>
            <Th className="hidden md:table-cell">IP</Th>
          </tr>
        </THead>
        <TBody>
          {data.map((e) => {
            const detalhes = detalharEvento(e);
            return (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap align-top text-xs">{formatarDataHora(e.ocorrido_em)}</Td>
                <Td className="align-top text-sm">
                  {e.user_id ? (
                    <Link href={`/escritorio/equipe/${e.user_id}`} className="hover:underline">
                      {nomeUsuario.get(e.user_id) ?? e.user_email ?? "Usuário"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Sistema</span>
                  )}
                  {e.user_email && e.user_id ? <p className="text-xs text-muted-foreground">{e.user_email}</p> : null}
                </Td>
                <Td className="align-top text-sm">
                  {detalhes.length ? (
                    <details>
                      <summary className="cursor-pointer">{descreverEvento(e.acao, e.entidade)}</summary>
                      <ul className="mt-1.5 space-y-0.5 break-words text-xs text-muted-foreground">
                        {detalhes.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                        {e.user_agent ? <li>navegador: {e.user_agent}</li> : null}
                      </ul>
                    </details>
                  ) : (
                    descreverEvento(e.acao, e.entidade)
                  )}
                  <p className="text-xs text-muted-foreground lg:hidden">{e.empresa_id ? nomeEmpresa.get(e.empresa_id) : null}</p>
                </Td>
                <Td className="hidden align-top text-sm lg:table-cell">{e.empresa_id ? (nomeEmpresa.get(e.empresa_id) ?? "—") : "—"}</Td>
                <Td className="hidden whitespace-nowrap align-top text-xs text-muted-foreground md:table-cell">{e.ip ?? "—"}</Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    ) : null;
  } else {
    const { de, ate } = limitesPeriodo(f);
    if (origem === "documentos") {
      let q = s.supabase
        .from("documento_acessos")
        .select("id, ocorrido_em, user_id, empresa_id, tipo, versao, ip, documento:documentos(id, nome_original)", { count: "exact" })
        .gte("ocorrido_em", de)
        .lt("ocorrido_em", ate);
      if (f.usuario) q = q.eq("user_id", f.usuario);
      if (f.empresa) q = q.eq("empresa_id", f.empresa);
      const { data, count } = await q.order("ocorrido_em", { ascending: false }).range(...faixa);
      total = count ?? 0;
      tabela = data?.length ? (
        <Table>
          <THead>
            <tr>
              <Th className="w-40">Quando</Th>
              <Th>Quem</Th>
              <Th>Arquivo</Th>
              <Th className="hidden lg:table-cell">Empresa</Th>
              <Th className="hidden md:table-cell">IP</Th>
            </tr>
          </THead>
          <TBody>
            {data.map((a) => {
              const doc = a.documento as unknown as { id: string; nome_original: string } | null;
              return (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-xs">{formatarDataHora(a.ocorrido_em)}</Td>
                  <Td className="text-sm">{a.user_id ? (nomeUsuario.get(a.user_id) ?? "Usuário") : "—"}</Td>
                  <Td className="text-sm">
                    {TIPO_ACESSO[a.tipo] ?? a.tipo}{" "}
                    {doc ? (
                      <Link href={`/e/${a.empresa_id}/documentos/${doc.id}`} className="font-medium hover:underline">
                        {doc.nome_original}
                      </Link>
                    ) : (
                      "documento removido"
                    )}
                    {a.versao && a.versao > 1 ? <span className="text-xs text-muted-foreground"> (versão {a.versao})</span> : null}
                  </Td>
                  <Td className="hidden text-sm lg:table-cell">{nomeEmpresa.get(a.empresa_id) ?? "—"}</Td>
                  <Td className="hidden text-xs text-muted-foreground md:table-cell">{a.ip ?? "—"}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : null;
    } else {
      let q = s.supabase
        .from("relatorio_acessos")
        .select("id, ocorrido_em, user_id, empresa_id, tipo, relatorio:relatorios_publicados(id, titulo, versao)", { count: "exact" })
        .gte("ocorrido_em", de)
        .lt("ocorrido_em", ate);
      if (f.usuario) q = q.eq("user_id", f.usuario);
      if (f.empresa) q = q.eq("empresa_id", f.empresa);
      const { data, count } = await q.order("ocorrido_em", { ascending: false }).range(...faixa);
      total = count ?? 0;
      tabela = data?.length ? (
        <Table>
          <THead>
            <tr>
              <Th className="w-40">Quando</Th>
              <Th>Quem</Th>
              <Th>Relatório</Th>
              <Th className="hidden lg:table-cell">Empresa</Th>
            </tr>
          </THead>
          <TBody>
            {data.map((a) => {
              const rel = a.relatorio as unknown as { id: string; titulo: string; versao: number } | null;
              return (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap text-xs">{formatarDataHora(a.ocorrido_em)}</Td>
                  <Td className="text-sm">{a.user_id ? (nomeUsuario.get(a.user_id) ?? "Usuário") : "—"}</Td>
                  <Td className="text-sm">
                    {TIPO_ACESSO[a.tipo] ?? a.tipo}{" "}
                    {rel ? (
                      <Link href={`/e/${a.empresa_id}/relatorios/publicados/${rel.id}`} className="font-medium hover:underline">
                        {rel.titulo} (v{rel.versao})
                      </Link>
                    ) : (
                      "relatório removido"
                    )}
                  </Td>
                  <Td className="hidden text-sm lg:table-cell">{nomeEmpresa.get(a.empresa_id) ?? "—"}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : null;
    }
  }

  const totalPaginas = Math.ceil(total / POR_PAGINA);
  const exportar = urlCom("/api/auditoria/exportar", sp, { pagina: null });

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Registro de quem fez o quê e quando: entradas no portal, alterações de cadastro, permissões, lançamentos, fechamentos e acessos a arquivos. O registro não pode ser alterado por ninguém."
        acoes={
          <Button asChild variante="contorno">
            <a href={exportar}>
              <Download /> Exportar (CSV)
            </a>
          </Button>
        }
      />
      <AbasLink abas={abas} ativa={aba} className="mb-4" />
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6" role="search">
        {aba === "arquivos" ? <input type="hidden" name="aba" value="arquivos" /> : null}
        <Input type="date" name="inicio" defaultValue={f.inicio} aria-label="De" />
        <Input type="date" name="fim" defaultValue={f.fim} aria-label="Até" />
        <Select name="usuario" defaultValue={f.usuario ?? ""} aria-label="Pessoa">
          <option value="">Todas as pessoas</option>
          {(perfis ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome} ({p.tipo === "cliente" ? "cliente" : "escritório"})
            </option>
          ))}
        </Select>
        <Select name="empresa" defaultValue={f.empresa ?? ""} aria-label="Empresa">
          <option value="">Todas as empresas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome_fantasia ?? e.razao_social}
            </option>
          ))}
        </Select>
        {aba === "atividades" ? (
          <Select name="grupo" defaultValue={f.grupo ?? ""} aria-label="Tipo de evento">
            <option value="">Todos os eventos</option>
            {Object.entries(GRUPOS_EVENTO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        ) : (
          <Select name="origem" defaultValue={origem} aria-label="Arquivos">
            <option value="documentos">Documentos</option>
            <option value="relatorios">Relatórios publicados</option>
          </Select>
        )}
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
      </form>
      {tabela ?? <EstadoVazio icone={ShieldCheck} titulo="Nenhum registro no período" descricao="Ajuste o período ou os filtros." />}
      <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={total} montarHref={(n) => urlCom("/escritorio/auditoria", sp, { pagina: n })} />
    </>
  );
}
