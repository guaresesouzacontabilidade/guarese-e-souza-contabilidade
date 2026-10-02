import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, GitCompareArrows, Landmark, Sparkles } from "lucide-react";
import { obterContextoEmpresa } from "@/lib/auth/sessao";
import { CabecalhoPagina, Indicador, urlCom } from "@/components/ui/pagina";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { AbasLink } from "@/components/ui/abas";
import { BotaoGerarSugestoes, ListaSugestoes } from "@/components/conciliacao/sugestoes";
import { TabelaMovimentos } from "@/components/conciliacao/movimentos";
import { ConcluirEtapa, InformarSaldo } from "@/components/conciliacao/saldos";
import { carregarConciliacao } from "@/lib/conciliacao/dados";
import { avaliarFinalizacao, competenciaPadrao } from "@/lib/conciliacao/regras";
import { hojeISO, lerCompetencia, listaCompetencias, ultimoDiaDoMes } from "@/lib/competencia";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { parametro } from "@/lib/busca";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conciliação bancária" };
const UUID = /^[0-9a-f-]{36}$/i;
const SITUACOES = ["pendente", "conciliado", "ignorado", "todos"] as const;

export default async function PaginaConciliacao({ params, searchParams }: PageProps<"/e/[empresaId]/conciliacao">) {
  const { empresaId } = await params;
  const sp = await searchParams;
  const ctx = await obterContextoEmpresa(empresaId);
  if (!ctx.pode("conciliacao.executar")) return <Alerta tom="alerta">Seu acesso não inclui a conciliação bancária desta empresa.</Alerta>;
  if (!ctx.pode("financeiro.ver")) return <Alerta tom="alerta">Para conciliar é preciso também acesso de leitura ao financeiro desta empresa.</Alerta>;

  const base = `/e/${empresaId}/conciliacao`;
  const { data: contasBrutas } = await ctx.supabase.from("contas_financeiras").select("id, nome, tipo").eq("empresa_id", empresaId).eq("ativa", true).order("nome");
  const contas = contasBrutas ?? [];
  const contaParam = parametro(sp, "conta");
  const contaId = UUID.test(contaParam) && contas.some((c) => c.id === contaParam) ? contaParam : null;
  const situacao = (parametro(sp, "situacao", SITUACOES) || "pendente") as (typeof SITUACOES)[number];

  let comp = lerCompetencia(parametro(sp, "competencia"));
  if (!comp) {
    let q = ctx.supabase.from("movimentos_bancarios").select("data").eq("empresa_id", empresaId).eq("status_conciliacao", "pendente");
    if (contaId) q = q.eq("conta_financeira_id", contaId);
    const { data: maisAntiga } = await q.order("data").limit(1).maybeSingle();
    comp = competenciaPadrao(maisAntiga?.data);
  }
  const inicio = comp;
  const fim = ultimoDiaDoMes(comp);

  if (!contas.length) {
    return (
      <>
        <CabecalhoPagina titulo="Conciliação bancária" />
        <EstadoVazio
          icone={Landmark}
          titulo="Nenhuma conta bancária cadastrada"
          descricao="Cadastre as contas da empresa no financeiro e importe os extratos para começar a conciliar."
          acao={
            <Button asChild>
              <Link href={`/e/${empresaId}/financeiro/contas`}>Cadastrar contas</Link>
            </Button>
          }
        />
      </>
    );
  }

  const d = await carregarConciliacao(ctx.supabase, empresaId, { contaId, inicio, fim }, contas);
  const contagem = { pendente: 0, conciliado: 0, ignorado: 0 };
  for (const m of d.movimentos) contagem[m.status]++;
  const visiveis = situacao === "todos" ? d.movimentos : d.movimentos.filter((m) => m.status === situacao);
  const total = d.movimentos.length;
  const percentual = total ? Math.round((100 * (contagem.conciliado + contagem.ignorado)) / total) : null;

  // Finalização considera todas as contas (a etapa do fechamento é da empresa).
  const podeFechamento = ctx.pode("fechamento.gerenciar");
  let pendentesMes = contagem.pendente;
  let etapaConcluida = false;
  if (podeFechamento) {
    const [pend, etapa] = await Promise.all([
      contaId
        ? ctx.supabase
            .from("movimentos_bancarios")
            .select("id", { count: "exact", head: true })
            .eq("empresa_id", empresaId)
            .eq("status_conciliacao", "pendente")
            .gte("data", inicio)
            .lte("data", fim)
        : Promise.resolve({ count: contagem.pendente }),
      ctx.supabase.from("fechamento_etapas").select("status, competencias!inner(competencia)").eq("empresa_id", empresaId).eq("etapa", "conciliacao").eq("competencias.competencia", comp).maybeSingle(),
    ]);
    pendentesMes = pend.count ?? 0;
    etapaConcluida = etapa.data?.status === "concluida";
  }
  const saldosConferidos = contaId ? d.saldos.filter((s) => s.conta_id === contaId) : d.saldos;
  const avaliacao = avaliarFinalizacao(pendentesMes, d.saldos);
  const filtros = { conta: contaId ?? undefined, competencia: comp.slice(0, 7), situacao: situacao === "pendente" ? undefined : situacao };
  const hoje = hojeISO();
  const meses = listaCompetencias(36, 0);
  if (!meses.some((m) => m.valor === comp.slice(0, 7))) meses.push({ valor: comp.slice(0, 7), rotulo: formatarCompetencia(comp, true) });

  return (
    <>
      <CabecalhoPagina
        titulo="Conciliação bancária"
        descricao="Compare o extrato do banco com os lançamentos. Sugestões automáticas só têm efeito depois de confirmadas."
        acoes={
          <>
            <BotaoGerarSugestoes empresaId={empresaId} />
            {ctx.pode("financeiro.importar") ? (
              <Button asChild variante="contorno">
                <Link href={`/e/${empresaId}/financeiro/importar`}>
                  <FileUp /> Importar extrato
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" role="search">
        <Select name="conta" defaultValue={contaId ?? ""} aria-label="Conta">
          <option value="">Todas as contas</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
        <Select name="competencia" defaultValue={comp.slice(0, 7)} aria-label="Mês">
          {meses.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </Select>
        {situacao !== "pendente" ? <input type="hidden" name="situacao" value={situacao} /> : null}
        <Button type="submit" variante="secundario">
          Filtrar
        </Button>
      </form>

      {d.pendentesForaPeriodo > 0 ? (
        <Alerta tom="info" className="mb-4">
          Há {d.pendentesForaPeriodo} movimentação(ões) pendente(s) em outros meses{contaId ? " nesta conta" : ""}.{" "}
          <Link className="font-medium underline" href={urlCom(base, {}, { conta: contaId })}>
            Ir para o mês mais antigo com pendências
          </Link>
        </Alerta>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Pendentes" valor={contagem.pendente} tom={contagem.pendente ? "alerta" : "sucesso"} detalhe={formatarCompetencia(comp, true)} />
        <Indicador rotulo="Sugestões" valor={d.sugestoes.length} tom={d.sugestoes.length ? "info" : "neutro"} detalhe={d.totalSugestoes > d.sugestoes.length ? `${d.totalSugestoes} na empresa` : "aguardando confirmação"} />
        <Indicador rotulo="Conciliadas" valor={contagem.conciliado} tom="sucesso" detalhe={percentual !== null ? `${percentual}% do mês tratado` : "sem movimentações"} />
        <Indicador rotulo="Ignoradas" valor={contagem.ignorado} />
      </div>

      {d.sugestoes.length ? (
        <section className="mb-6" aria-labelledby="titulo-sugestoes">
          <h2 id="titulo-sugestoes" className="mb-2 flex items-center gap-2 text-base font-semibold text-titulo">
            <Sparkles className="size-4 text-primary" /> Sugestões para confirmar
          </h2>
          <ListaSugestoes empresaId={empresaId} sugestoes={d.sugestoes} />
        </section>
      ) : null}

      <section className="mb-6" aria-labelledby="titulo-movimentos">
        <h2 id="titulo-movimentos" className="mb-2 text-base font-semibold text-titulo">
          Movimentações do extrato
        </h2>
        <AbasLink
          ativa={situacao}
          abas={[
            { valor: "pendente", rotulo: "Pendentes", href: urlCom(base, filtros, { situacao: null }), contador: contagem.pendente },
            { valor: "conciliado", rotulo: "Conciliadas", href: urlCom(base, filtros, { situacao: "conciliado" }), contador: contagem.conciliado },
            { valor: "ignorado", rotulo: "Ignoradas", href: urlCom(base, filtros, { situacao: "ignorado" }), contador: contagem.ignorado },
            { valor: "todos", rotulo: "Todas", href: urlCom(base, filtros, { situacao: "todos" }) },
          ]}
          className="mb-3"
        />
        {d.lancamentosTruncados ? (
          <Alerta tom="alerta" className="mb-3">
            Há mais de 5.000 lançamentos em aberto: a busca manual mostra apenas os de vencimento mais antigo.
          </Alerta>
        ) : null}
        {visiveis.length ? (
          <TabelaMovimentos
            empresaId={empresaId}
            movimentos={visiveis}
            podeCriarLancamento={ctx.pode("financeiro.editar")}
            dados={{
              lancamentos: d.lancamentos,
              baixas: d.baixas,
              transferencias: d.transferencias,
              contas: contas.map((c) => ({ id: c.id, nome: c.nome })),
              categorias: d.categorias,
              contrapartes: d.contrapartes,
            }}
          />
        ) : (
          <EstadoVazio
            icone={GitCompareArrows}
            titulo={situacao === "pendente" ? (total ? "Tudo conciliado neste mês" : "Nenhuma movimentação neste mês") : "Nenhuma movimentação nesta situação"}
            descricao={total ? undefined : "Importe o extrato do banco (OFX ou planilha) para conciliar este período."}
          />
        )}
      </section>

      <Card>
        <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Conferência de saldos — {formatarCompetencia(comp, true)}</CardTitle>
            <CardDescription>Saldo calculado pelo sistema comparado ao último saldo do extrato no mês (importado ou informado).</CardDescription>
          </div>
          {ctx.pode("financeiro.editar") ? (
            <InformarSaldo empresaId={empresaId} contas={(contaId ? contas.filter((c) => c.id === contaId) : contas).map((c) => ({ id: c.id, nome: c.nome }))} dataPadrao={fim < hoje ? fim : hoje} />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {d.erroSaldos ? <Alerta tom="perigo">Não foi possível calcular a conferência de saldos: {d.erroSaldos}</Alerta> : null}
          {saldosConferidos.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Conta</Th>
                  <Th className="text-right">Saldo inicial</Th>
                  <Th className="text-right">Entradas</Th>
                  <Th className="text-right">Saídas</Th>
                  <Th className="text-right">Saldo no sistema</Th>
                  <Th className="text-right">Saldo do extrato</Th>
                  <Th className="text-right">Diferença</Th>
                  <Th className="text-right">Pendentes</Th>
                </tr>
              </THead>
              <TBody>
                {saldosConferidos.map((s) => {
                  const dif = s.diferenca === null ? null : dec(String(s.diferenca));
                  return (
                    <Tr key={s.conta_id}>
                      <Td className="text-sm font-medium">{s.conta_nome}</Td>
                      <Td className="text-right numero">{formatarMoeda(String(s.saldo_inicial_sistema))}</Td>
                      <Td className="text-right numero text-sucesso">{formatarMoeda(String(s.entradas_sistema))}</Td>
                      <Td className="text-right numero text-perigo">{formatarMoeda(String(s.saidas_sistema))}</Td>
                      <Td className="text-right numero">{formatarMoeda(String(s.saldo_final_sistema))}</Td>
                      <Td className="text-right numero">
                        {s.saldo_extrato === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {formatarMoeda(String(s.saldo_extrato))}
                            <span className="block text-xs text-muted-foreground">em {formatarData(s.saldo_extrato_data)}</span>
                          </>
                        )}
                      </Td>
                      <Td className={cn("text-right font-semibold numero", dif && !dif.isZero() ? "text-perigo" : dif ? "text-sucesso" : "text-muted-foreground")}>
                        {dif === null ? "—" : dif.isZero() ? "Confere" : formatarMoeda(dif, { sinal: true })}
                      </Td>
                      <Td className="text-right numero">{s.movimentos_pendentes}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma conta ativa para conferir.</p>
          )}
          {podeFechamento ? (
            <div className="border-t border-border pt-4">
              <ConcluirEtapa empresaId={empresaId} competencia={comp.slice(0, 7)} impedimentos={avaliacao.impedimentos} avisos={avaliacao.avisos} concluida={etapaConcluida} />
            </div>
          ) : avaliacao.pode && !avaliacao.avisos.length && total > 0 ? (
            <Alerta tom="sucesso">Todas as movimentações do mês foram tratadas e os saldos conferem com o extrato.</Alerta>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
