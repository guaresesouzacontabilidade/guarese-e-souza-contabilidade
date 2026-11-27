import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, FileText, FileUp, MessageCircle, Package, ReceiptText, ShoppingBag, Wallet } from "lucide-react";
import { CabecalhoPagina, Indicador, Paginacao, urlCom } from "@/components/ui/pagina";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { LojaIndisponivel, NavegacaoLoja } from "@/components/loja/navegacao-loja";
import { BotaoAtivarCadastro, BotaoTrazerFornecedores, DialogoCadastro, type CadastroTela } from "@/components/loja/cadastros";
import { obterContextoLoja } from "@/lib/gestao/contexto";
import type { PapelCadastro } from "@/lib/gestao/cadastros";
import { linkWhatsApp } from "@/lib/os/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCep, formatarData, formatarDocumento, formatarTelefone } from "@/lib/formatos";
import { aplicarBusca } from "@/lib/busca";
import { CampoBusca } from "@/components/ui/campo-busca";

const POR_PAGINA = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS =
  "id, nome, documento, telefone, email, cep, logradouro, numero, complemento, bairro, municipio_ibge, inscricao_estadual, contato, prazo_pagamento_dias, observacoes, ativo, papeis, municipio:municipios(nome, uf)";

type Linha = Omit<CadastroTela, "uf"> & { papeis: string[]; municipio: { nome: string; uf: string } | null };

function paraTela(l: Linha): CadastroTela {
  return { ...l, uf: l.municipio?.uf ?? null };
}

const NOMES = {
  cliente: { singular: "cliente", plural: "Clientes", vazio: "Nenhum cliente cadastrado ainda." },
  fornecedor: { singular: "fornecedor", plural: "Fornecedores", vazio: "Nenhum fornecedor cadastrado ainda." },
};

/** Lista de clientes ou de fornecedores da loja (o banco só entrega os da empresa). */
export async function ListaCadastrosLoja({
  empresaId,
  papel,
  sp,
}: {
  empresaId: string;
  papel: PapelCadastro;
  sp: Record<string, string | string[] | undefined>;
}) {
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (papel === "fornecedor" && !ctx.gerente) notFound();

  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const situacao = sp.situacao === "inativos" || sp.situacao === "todos" ? sp.situacao : "ativos";
  const pagina = Math.max(1, Number(sp.pagina) || 1);
  const base = `/e/${empresaId}/loja/${papel === "cliente" ? "clientes" : "fornecedores"}`;

  let q = ctx.supabase
    .from("contrapartes")
    .select(CAMPOS, { count: "exact" })
    .eq("empresa_id", empresaId)
    .contains("papeis", [papel])
    .order("nome")
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (situacao !== "todos") q = q.eq("ativo", situacao === "ativos");
  q = aplicarBusca(q, busca);
  const { data, count } = await q;
  const linhas = (data ?? []) as unknown as Linha[];
  const nomes = NOMES[papel];

  return (
    <>
      <CabecalhoPagina
        titulo={nomes.plural}
        descricao={
          papel === "cliente"
            ? "Quem compra da loja. É o mesmo cadastro usado no Financeiro e na nota fiscal."
            : "De quem a loja compra. Quem emite as notas de compra entra aqui sozinho, pelo CNPJ."
        }
        acoes={
          <>
            {papel === "fornecedor" ? <BotaoTrazerFornecedores empresaId={empresaId} /> : null}
            {ctx.gerente ? (
              <Button asChild variante="contorno">
                <Link href={`${base}/importar`}>
                  <FileUp /> Importar planilha
                </Link>
              </Button>
            ) : null}
            <DialogoCadastro empresaId={empresaId} papel={papel} />
          </>
        }
      />
      <NavegacaoLoja empresaId={empresaId} configurar={ctx.gerente} />
      <Card>
        <CardContent className="space-y-4 pt-5">
          <form className="flex flex-wrap items-end gap-2" role="search">
            <CampoBusca defaultValue={busca} placeholder="Buscar por nome, CPF/CNPJ ou telefone" rotulo={`Buscar ${nomes.singular}`} className="w-full sm:w-80" />
            <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-full sm:w-40">
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
              <option value="todos">Todos</option>
            </Select>
            <Button type="submit" variante="contorno">
              Buscar
            </Button>
          </form>
          {linhas.length === 0 ? (
            <EstadoVazio
              titulo={busca ? "Nada encontrado" : nomes.vazio}
              descricao={
                busca
                  ? "Confira o que foi digitado ou mude o filtro de situação."
                  : papel === "cliente"
                    ? "Cadastre aqui ou direto no caixa, na hora da venda."
                    : "Cadastre aqui ou use “Trazer das notas de compra” para puxar os emitentes das notas já recebidas."
              }
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Nome</Th>
                  <Th>CPF/CNPJ</Th>
                  <Th>Telefone</Th>
                  <Th>Cidade</Th>
                  {papel === "fornecedor" ? <Th>Contato</Th> : null}
                  <Th className="w-0" />
                </Tr>
              </THead>
              <TBody>
                {linhas.map((l) => {
                  const zap = linkWhatsApp(l.telefone, "Olá!");
                  return (
                    <Tr key={l.id} data-testid="linha-cadastro">
                      <Td>
                        <Link href={`${base}/${l.id}`} className="font-medium hover:underline">
                          {l.nome}
                        </Link>
                        {!l.ativo ? (
                          <Badge variante="neutro" className="ml-2">
                            Inativo
                          </Badge>
                        ) : null}
                        {papel === "cliente" && l.papeis.includes("fornecedor") ? (
                          <Badge variante="info" className="ml-2">
                            Também fornecedor
                          </Badge>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">{l.documento ? formatarDocumento(l.documento) : "—"}</Td>
                      <Td className="whitespace-nowrap">
                        {l.telefone ? formatarTelefone(l.telefone) : "—"}
                        {zap ? (
                          <a href={zap} target="_blank" rel="noreferrer" className="ml-2 inline-flex text-sucesso" aria-label={`WhatsApp de ${l.nome}`}>
                            <MessageCircle className="size-4" />
                          </a>
                        ) : null}
                      </Td>
                      <Td>{l.municipio ? `${l.municipio.nome} / ${l.municipio.uf}` : "—"}</Td>
                      {papel === "fornecedor" ? <Td>{l.contato ?? "—"}</Td> : null}
                      <Td>{ctx.gerente ? <DialogoCadastro empresaId={empresaId} papel={papel} cadastro={paraTela(l)} gatilho="icone" /> : null}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          )}
          <Paginacao pagina={pagina} totalPaginas={Math.ceil((count ?? 0) / POR_PAGINA)} total={count ?? 0} montarHref={(p) => urlCom(base, sp, { pagina: p })} />
        </CardContent>
      </Card>
    </>
  );
}

interface Ficha {
  resumo: Record<string, number | string | null>;
  lista: Record<string, string | number | null>[];
  produtos: { id: string; descricao: string; codigo: string | null }[];
  contas: { quantidade: number; valor?: number; vencidas: number } | null;
  mostra_valores: boolean;
}

const SITUACAO_VENDA: Record<string, { rotulo: string; variante: "sucesso" | "perigo" | "info" | "neutro" }> = {
  concluida: { rotulo: "Concluída", variante: "sucesso" },
  cancelada: { rotulo: "Cancelada", variante: "perigo" },
  aberto: { rotulo: "Em aberto", variante: "info" },
  convertido: { rotulo: "Virou venda", variante: "neutro" },
};

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

/** Ficha do cliente (compras, orçamentos, contas a receber) ou do fornecedor (notas, produtos, contas a pagar). */
export async function FichaCadastroLoja({ empresaId, papel, id }: { empresaId: string; papel: PapelCadastro; id: string }) {
  const ctx = await obterContextoLoja(empresaId);
  if (!ctx.vende) return <LojaIndisponivel empresaId={empresaId} equipe={ctx.equipe} ativa={ctx.lojaAtiva} notas={ctx.notas} />;
  if (!UUID.test(id) || (papel === "fornecedor" && !ctx.gerente)) notFound();
  const lista = `/e/${empresaId}/loja/${papel === "cliente" ? "clientes" : "fornecedores"}`;

  const [{ data: linha }, { data: ficha, error }] = await Promise.all([
    ctx.supabase.from("contrapartes").select(CAMPOS).eq("id", id).eq("empresa_id", empresaId).contains("papeis", [papel]).maybeSingle(),
    ctx.supabase.rpc("gestao_contraparte_ficha", { p_empresa_id: empresaId, p_id: id, p_papel: papel }),
  ]);
  if (!linha || error || !ficha) notFound();
  const c = linha as unknown as Linha;
  const f = ficha as unknown as Ficha;
  const zap = linkWhatsApp(c.telefone, `Olá, ${c.nome.split(" ")[0]}!`);
  const endereco = [
    [c.logradouro, c.numero].filter(Boolean).join(", "),
    c.complemento,
    c.bairro,
    c.municipio ? `${c.municipio.nome} / ${c.municipio.uf}` : null,
    c.cep ? `CEP ${formatarCep(c.cep)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const r = f.resumo ?? {};

  return (
    <>
      <CabecalhoPagina
        titulo={c.nome}
        voltar={{ href: lista, rotulo: papel === "cliente" ? "Clientes" : "Fornecedores" }}
        descricao={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge variante="info">{papel === "cliente" ? "Cliente" : "Fornecedor"}</Badge>
            {c.papeis.includes(papel === "cliente" ? "fornecedor" : "cliente") ? (
              <Badge variante="neutro">{papel === "cliente" ? "Também fornecedor" : "Também cliente"}</Badge>
            ) : null}
            {!c.ativo ? <Badge variante="neutro">Inativo</Badge> : null}
          </span>
        }
        acoes={
          <>
            {zap ? (
              <Button asChild variante="contorno">
                <a href={zap} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            ) : null}
            {ctx.gerente ? <DialogoCadastro empresaId={empresaId} papel={papel} cadastro={paraTela(c)} gatilho="texto" /> : null}
            {ctx.gerente ? <BotaoAtivarCadastro empresaId={empresaId} id={c.id} nome={c.nome} ativo={c.ativo} /> : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {papel === "cliente" ? (
          <>
            <Indicador rotulo="Compras" valor={String(r.compras ?? 0)} icone={ShoppingBag} />
            <Indicador rotulo="Total comprado" valor={formatarMoeda(Number(r.total_comprado ?? 0))} icone={ReceiptText} />
            <Indicador rotulo="Última compra" valor={r.ultima_compra ? formatarData(String(r.ultima_compra)) : "—"} icone={CalendarClock} />
            <Indicador
              rotulo="A receber em aberto"
              valor={formatarMoeda(Number(f.contas?.valor ?? 0))}
              detalhe={f.contas?.vencidas ? `${f.contas.vencidas} parcela(s) vencida(s)` : `${f.contas?.quantidade ?? 0} parcela(s)`}
              tom={f.contas?.vencidas ? "perigo" : "neutro"}
              icone={Wallet}
            />
          </>
        ) : (
          <>
            <Indicador rotulo="Notas de compra" valor={String(r.notas ?? 0)} icone={FileText} />
            <Indicador rotulo="Total comprado" valor={f.mostra_valores ? formatarMoeda(Number(r.total_compras ?? 0)) : "—"} detalhe={f.mostra_valores ? undefined : "Só com “Ver custos e margens”"} icone={ReceiptText} />
            <Indicador rotulo="Última nota" valor={r.ultima_nota ? formatarData(String(r.ultima_nota)) : "—"} icone={CalendarClock} />
            <Indicador
              rotulo="Contas a pagar em aberto"
              valor={f.mostra_valores ? formatarMoeda(Number(f.contas?.valor ?? 0)) : String(f.contas?.quantidade ?? 0)}
              detalhe={f.contas?.vencidas ? `${f.contas.vencidas} vencida(s)` : undefined}
              tom={f.contas?.vencidas ? "perigo" : "neutro"}
              icone={Wallet}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{papel === "cliente" ? "Compras e orçamentos" : "Notas de compra"}</CardTitle>
            <CardDescription>{papel === "cliente" ? "As 30 mais recentes." : "As 30 mais recentes recebidas deste fornecedor."}</CardDescription>
          </CardHeader>
          <CardContent>
            {f.lista.length === 0 ? (
              <p className="text-sm text-muted-foreground">{papel === "cliente" ? "Nenhuma compra ainda." : "Nenhuma nota de compra deste fornecedor ainda."}</p>
            ) : papel === "cliente" ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Nº</Th>
                    <Th>Data</Th>
                    <Th>Situação</Th>
                    <Th className="text-right">Total</Th>
                  </Tr>
                </THead>
                <TBody>
                  {f.lista.map((v) => {
                    const s = SITUACAO_VENDA[String(v.status)] ?? { rotulo: String(v.status), variante: "neutro" as const };
                    return (
                      <Tr key={String(v.id)}>
                        <Td>
                          <Link href={`/e/${empresaId}/loja/vendas/${v.id}`} className="hover:underline">
                            {v.tipo === "orcamento" ? "Orçamento" : "Venda"} {v.numero}
                          </Link>
                        </Td>
                        <Td>{formatarData(String(v.data))}</Td>
                        <Td>
                          <Badge variante={s.variante}>{s.rotulo}</Badge>
                        </Td>
                        <Td className="text-right">{formatarMoeda(Number(v.total ?? 0))}</Td>
                      </Tr>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Nota</Th>
                    <Th>Emissão</Th>
                    <Th className="text-right">Valor</Th>
                  </Tr>
                </THead>
                <TBody>
                  {f.lista.map((n, i) => (
                    <Tr key={i}>
                      <Td>
                        {n.numero ?? "—"}
                        {n.serie ? `/${n.serie}` : ""}
                      </Td>
                      <Td>{n.data_emissao ? formatarData(String(n.data_emissao)) : "—"}</Td>
                      <Td className="text-right">{f.mostra_valores && n.valor_total != null ? formatarMoeda(Number(n.valor_total)) : "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Dados do cadastro</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3">
                <Dado rotulo="CPF/CNPJ">{c.documento ? formatarDocumento(c.documento) : "—"}</Dado>
                <Dado rotulo="Telefone / WhatsApp">{c.telefone ? formatarTelefone(c.telefone) : "—"}</Dado>
                <Dado rotulo="E-mail">{c.email ?? "—"}</Dado>
                <Dado rotulo="Endereço">{endereco || "—"}</Dado>
                <Dado rotulo="Inscrição estadual">{c.inscricao_estadual ?? "—"}</Dado>
                {papel === "fornecedor" ? (
                  <>
                    <Dado rotulo="Vendedor / contato">{c.contato ?? "—"}</Dado>
                    <Dado rotulo="Prazo de pagamento">{c.prazo_pagamento_dias != null ? `${c.prazo_pagamento_dias} dias` : "—"}</Dado>
                  </>
                ) : null}
                {c.observacoes ? <Dado rotulo="Observações">{c.observacoes}</Dado> : null}
              </dl>
              {papel === "cliente" && (!c.documento || !c.logradouro || !c.municipio_ibge) ? (
                <p className="mt-3 text-xs text-muted-foreground">Para a nota fiscal sair com os dados do cliente, complete o CPF/CNPJ e o endereço.</p>
              ) : null}
            </CardContent>
          </Card>
          {papel === "fornecedor" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="size-5" /> Produtos deste fornecedor
                </CardTitle>
                <CardDescription>Ligados nas entradas de nota.</CardDescription>
              </CardHeader>
              <CardContent>
                {f.produtos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum produto ligado ainda.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {f.produtos.map((p) => (
                      <li key={p.id}>
                        <Link href={`/e/${empresaId}/loja/produtos/${p.id}`} className="hover:underline">
                          {p.descricao}
                        </Link>
                        {p.codigo ? <span className="text-muted-foreground"> · {p.codigo}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
