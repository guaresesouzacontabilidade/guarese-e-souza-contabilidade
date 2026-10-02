"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alerta, Carregando } from "@/components/ui/feedback";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { dec, formatarMoeda, somar } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { carregarCandidatos, conciliarManual } from "@/lib/conciliacao/acoes";
import { ROTULO_TRATAMENTO, tratamentosPermitidos, type CandidatosConciliacao, type Tratamento } from "@/lib/conciliacao/tipos";

type Aba = "lancamentos" | "baixas" | "transferencia";
type EscolhaTransferencia = { tipo: "movimento" | "existente"; id: string } | { tipo: "conta"; id: string };

/** Diálogo de conciliação manual: movimentação(ões) do extrato × lançamentos, pagamentos ou transferências. */
export function ConciliarManual({
  empresaId,
  movimentoIds,
  aberto,
  aoMudar,
  aoConcluir,
}: {
  empresaId: string;
  movimentoIds: string[];
  aberto: boolean;
  aoMudar: (v: boolean) => void;
  aoConcluir?: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      {aberto ? (
        <DialogContent
          largura="xl"
          titulo="Conciliar movimentação"
          descricao="Escolha o que corresponde a esta movimentação do extrato. Nada é alterado até você clicar em Conciliar."
        >
          <Conteudo
            key={movimentoIds.join(",")}
            empresaId={empresaId}
            movimentoIds={movimentoIds}
            fechar={() => aoMudar(false)}
            aoConcluir={aoConcluir}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function Conteudo({
  empresaId,
  movimentoIds,
  fechar,
  aoConcluir,
}: {
  empresaId: string;
  movimentoIds: string[];
  fechar: () => void;
  aoConcluir?: () => void;
}) {
  const router = useRouter();
  const [dados, setDados] = useState<CandidatosConciliacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, iniciarBusca] = useTransition();
  const [enviando, iniciarEnvio] = useTransition();
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>("lancamentos");
  const [lancs, setLancs] = useState<Set<string>>(new Set());
  const [baixas, setBaixas] = useState<Set<string>>(new Set());
  const [transf, setTransf] = useState<EscolhaTransferencia | null>(null);
  const [tratamento, setTratamento] = useState<Tratamento | "">("");
  const [observacao, setObservacao] = useState("");

  useEffect(() => {
    let ativo = true;
    carregarCandidatos(empresaId, movimentoIds).then((r) => {
      if (!ativo) return;
      if (r.ok && r.dados) setDados(r.dados);
      else setErro(r.mensagem ?? "Não foi possível carregar as opções.");
    });
    return () => {
      ativo = false;
    };
  }, [empresaId, movimentoIds]);

  function pesquisar() {
    iniciarBusca(async () => {
      const r = await carregarCandidatos(empresaId, movimentoIds, busca);
      if (r.ok && r.dados) {
        const novos = r.dados;
        // Mantém os lançamentos já marcados, mesmo fora do resultado da busca.
        setDados((d) => (d ? { ...novos, lancamentos: unir(novos.lancamentos, d.lancamentos.filter((l) => lancs.has(l.id))) } : novos));
      } else toast.error(r.mensagem ?? "Não foi possível buscar.");
    });
  }

  const resumo = useMemo(() => {
    if (!dados) return null;
    const totalMov = somar(dados.movimentos.map((m) => dec(m.valor).abs()));
    const contas = new Set(dados.movimentos.map((m) => m.conta_id));
    const doisLados = contas.size > 1;
    const selLancs = dados.lancamentos.filter((l) => lancs.has(l.id));
    const selBaixas = dados.baixas.filter((b) => baixas.has(b.id));
    const totalAlvos = somar([...selLancs.map((l) => l.aberto), ...selBaixas.map((b) => b.total)]);
    const diferenca = totalMov.minus(totalAlvos);
    return { totalMov, doisLados, selLancs, selBaixas, totalAlvos, diferenca };
  }, [dados, lancs, baixas]);

  if (erro) return <Alerta tom="perigo">{erro}</Alerta>;
  if (!dados || !resumo) return <Carregando texto="Procurando lançamentos, pagamentos e transferências compatíveis..." />;

  const variasMov = dados.movimentos.length > 1;
  const permitidos = resumo.selLancs.length ? tratamentosPermitidos(resumo.diferenca.toNumber(), dados.tipo) : [];
  const precisaTratamento = permitidos.length > 0;
  const tratamentoValido = !precisaTratamento || (tratamento !== "" && permitidos.includes(tratamento));

  // Validações da seleção (as mesmas regras são conferidas no banco)
  let bloqueio: string | null = null;
  if (resumo.doisLados) {
    const [a, b] = dados.movimentos;
    if (dados.movimentos.length !== 2 || !dec(a.valor).plus(dec(b.valor)).isZero()) {
      bloqueio = "Movimentações de contas diferentes só podem ser conciliadas como transferência: uma saída e uma entrada de mesmo valor.";
    }
  } else if (aba !== "transferencia") {
    if (!resumo.selLancs.length && !resumo.selBaixas.length) bloqueio = "Selecione o lançamento ou o pagamento correspondente.";
    else if (variasMov && resumo.selLancs.length > 1) bloqueio = "Com várias movimentações, escolha um único lançamento (pagamentos parciais em datas diferentes).";
    else if (!resumo.selLancs.length && !resumo.diferenca.isZero()) bloqueio = `Os valores precisam ser iguais (diferença de ${formatarMoeda(resumo.diferenca.abs())}).`;
    else if (resumo.selLancs.length && resumo.selBaixas.length && dec(resumo.totalMov).lessThanOrEqualTo(somar(resumo.selBaixas.map((b) => b.total)))) {
      bloqueio = "O valor da movimentação já está coberto pelos pagamentos selecionados.";
    } else if (!tratamentoValido) bloqueio = "Informe como tratar a diferença de valor.";
  } else if (!transf) bloqueio = "Escolha a outra conta ou a transferência correspondente.";
  else if (transf.tipo === "existente") {
    const t = dados.transferencias.find((x) => x.id === transf.id);
    if (t && !dec(t.valor).equals(resumo.totalMov)) bloqueio = "O valor da transferência é diferente do valor da movimentação.";
  }

  function concluir() {
    if (!dados || !resumo) return;
    const movimentos = dados.movimentos.map((m) => m.id);
    let payload: Parameters<typeof conciliarManual>[1];
    if (resumo.doisLados) payload = { movimentos, tipo: "transferencia", observacao };
    else if (aba === "transferencia" && transf) {
      if (transf.tipo === "movimento") payload = { movimentos: [...movimentos, transf.id], tipo: "transferencia", observacao };
      else if (transf.tipo === "existente") payload = { movimentos, transferencias: [transf.id], tipo: "transferencia", observacao };
      else payload = { movimentos, tipo: "transferencia", conta_contrapartida: transf.id, observacao };
    } else {
      payload = {
        movimentos,
        lancamentos: resumo.selLancs.map((l) => l.id),
        baixas: resumo.selBaixas.map((b) => b.id),
        tipo: "lancamento",
        tratamento: precisaTratamento ? (tratamento as Tratamento) : null,
        observacao,
      };
    }
    iniciarEnvio(async () => {
      const r = await conciliarManual(empresaId, payload);
      if (r.ok) {
        toast.success(r.mensagem ?? "Conciliado.");
        aoConcluir?.();
        fechar();
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível conciliar.");
    });
  }

  const alternar = (setter: typeof setLancs, id: string, unico = false) =>
    setter((s) => {
      if (unico) return s.has(id) ? new Set() : new Set([id]);
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-5">
      {/* Movimentações selecionadas */}
      <section aria-label="Movimentações do extrato" className="rounded-lg border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extrato do banco</p>
          {variasMov ? <p className="text-sm font-semibold numero">Total {formatarMoeda(resumo.totalMov)}</p> : null}
        </div>
        <ul className="divide-y divide-border">
          {dados.movimentos.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium" title={m.descricao}>
                  {m.descricao}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatarData(m.data)} · {m.conta_nome}
                </p>
              </div>
              <ValorSinal valor={m.valor} />
            </li>
          ))}
        </ul>
      </section>

      {resumo.doisLados ? (
        bloqueio ? (
          <Alerta tom="alerta">{bloqueio}</Alerta>
        ) : (
          <Alerta tom="info" titulo="Transferência entre contas da empresa">
            A saída de {dados.movimentos.find((m) => dec(m.valor).isNegative())?.conta_nome} e a entrada em{" "}
            {dados.movimentos.find((m) => dec(m.valor).isPositive())?.conta_nome} serão registradas como uma transferência. Transferências não
            entram como receita nem como despesa.
          </Alerta>
        )
      ) : (
        <>
          <div role="tablist" aria-label="Tipo de correspondência" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            <BotaoAba ativo={aba === "lancamentos"} onClick={() => setAba("lancamentos")}>
              Lançamentos em aberto ({dados.lancamentos.length})
            </BotaoAba>
            <BotaoAba ativo={aba === "baixas"} onClick={() => setAba("baixas")}>
              Pagamentos já registrados ({dados.baixas.length})
            </BotaoAba>
            {!variasMov ? (
              <BotaoAba ativo={aba === "transferencia"} onClick={() => setAba("transferencia")}>
                <ArrowLeftRight className="size-3.5" /> Transferência entre contas
              </BotaoAba>
            ) : null}
          </div>

          {aba === "lancamentos" ? (
            <section className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  pesquisar();
                }}
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por descrição ou nº do documento"
                    className="pl-9"
                    aria-label="Buscar lançamentos"
                  />
                </div>
                <Button type="submit" variante="contorno" disabled={buscando}>
                  {buscando ? <Loader2 className="animate-spin" /> : null} Buscar
                </Button>
              </form>
              {dados.lancamentos_sugeridos ? (
                <p className="text-xs text-muted-foreground">
                  {dados.lancamentos_sugeridos} lançamento(s) {dados.tipo === "receber" ? "a receber" : "a pagar"} ainda estão como “sugeridos” (vindos
                  de XML ou leitura de documentos). Confirme-os em Financeiro → Lançamentos para que apareçam aqui.
                </p>
              ) : null}
              {dados.lancamentos.length ? (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {dados.lancamentos.map((l) => {
                    const marcado = lancs.has(l.id);
                    const igual = dec(l.aberto).equals(resumo.totalMov);
                    return (
                      <li key={l.id}>
                        <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-muted/50", marcado && "bg-bege/60")}>
                          <Checkbox className="mt-0.5" checked={marcado} onChange={() => alternar(setLancs, l.id, variasMov)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium" title={l.descricao}>
                              {l.descricao}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              Vence {formatarData(l.vencimento)}
                              {l.contraparte ? ` · ${l.contraparte}` : ""}
                              {l.numero_documento ? ` · nº ${l.numero_documento}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-semibold numero">{formatarMoeda(l.aberto)}</span>
                            {l.parcial ? (
                              <span className="block text-xs text-muted-foreground numero">de {formatarMoeda(l.previsto)}</span>
                            ) : igual ? (
                              <Badge variante="sucesso">valor igual</Badge>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  Nenhum lançamento {dados.tipo === "receber" ? "a receber" : "a pagar"} em aberto{busca ? " com esta busca" : ""}. Se a movimentação
                  não tem lançamento, use <strong>Classificar</strong> na lista para criá-lo.
                </p>
              )}
            </section>
          ) : null}

          {aba === "baixas" ? (
            <section className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Pagamentos e recebimentos registrados manualmente nesta conta (até 60 dias antes ou depois) que ainda não foram conciliados.
              </p>
              {dados.baixas.length ? (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {dados.baixas.map((b) => {
                    const marcado = baixas.has(b.id);
                    return (
                      <li key={b.id}>
                        <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50", marcado && "bg-bege/60")}>
                          <Checkbox checked={marcado} onChange={() => alternar(setBaixas, b.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{b.descricao}</span>
                            <span className="block text-xs text-muted-foreground">Pago/recebido em {formatarData(b.data)}</span>
                          </span>
                          <span className="font-semibold numero">{formatarMoeda(b.total)}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  Nenhum pagamento registrado e pendente de conciliação nesta conta.
                </p>
              )}
            </section>
          ) : null}

          {aba === "transferencia" ? (
            <section className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Dinheiro que só mudou de lugar dentro da empresa (ex.: do banco para o caixa, pagamento da fatura do cartão, aplicação). Não é
                receita nem despesa.
              </p>
              {dados.outras_contas_movimentos.length ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-sm font-medium">O outro lado aparece no extrato de outra conta</legend>
                  {dados.outras_contas_movimentos.map((m) => (
                    <OpcaoRadio
                      key={m.id}
                      marcado={transf?.tipo === "movimento" && transf.id === m.id}
                      aoMarcar={() => setTransf({ tipo: "movimento", id: m.id })}
                      titulo={m.descricao}
                      detalhe={`${formatarData(m.data)} · ${m.conta_nome}`}
                      valor={<ValorSinal valor={m.valor} />}
                    />
                  ))}
                </fieldset>
              ) : null}
              {dados.transferencias.length ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-sm font-medium">Transferência já registrada no sistema</legend>
                  {dados.transferencias.map((t) => (
                    <OpcaoRadio
                      key={t.id}
                      marcado={transf?.tipo === "existente" && transf.id === t.id}
                      aoMarcar={() => setTransf({ tipo: "existente", id: t.id })}
                      titulo={t.descricao}
                      detalhe={`${formatarData(t.data)} · ${t.origem} → ${t.destino}`}
                      valor={<span className="font-semibold numero">{formatarMoeda(t.valor)}</span>}
                    />
                  ))}
                </fieldset>
              ) : null}
              <Campo
                rotulo={dec(dados.movimentos[0].valor).isNegative() ? "Ou registrar a transferência para a conta" : "Ou registrar a transferência vinda da conta"}
                htmlFor="conta-contrapartida"
                ajuda="Use quando a outra conta não tem extrato importado (ex.: caixa físico)."
              >
                <Select
                  id="conta-contrapartida"
                  value={transf?.tipo === "conta" ? transf.id : ""}
                  onChange={(e) => setTransf(e.target.value ? { tipo: "conta", id: e.target.value } : null)}
                >
                  <option value="">Selecione...</option>
                  {dados.contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
            </section>
          ) : null}
        </>
      )}

      {/* Resumo e diferença */}
      {!resumo.doisLados && aba !== "transferencia" && (resumo.selLancs.length || resumo.selBaixas.length) ? (
        <section aria-label="Resumo" className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Extrato</dt>
              <dd className="font-semibold numero">{formatarMoeda(resumo.totalMov)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Selecionado</dt>
              <dd className="font-semibold numero">{formatarMoeda(resumo.totalAlvos)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Diferença</dt>
              <dd className={cn("font-semibold numero", !resumo.diferenca.isZero() && "text-alerta")}>{formatarMoeda(resumo.diferenca, { sinal: true })}</dd>
            </div>
          </dl>
          {precisaTratamento ? (
            <Campo
              rotulo={
                resumo.diferenca.isPositive()
                  ? `${dados.tipo === "receber" ? "Entrou" : "Saiu"} ${formatarMoeda(resumo.diferenca)} a mais. O que é essa diferença?`
                  : `${dados.tipo === "receber" ? "Entrou" : "Saiu"} ${formatarMoeda(resumo.diferenca.abs())} a menos. O que é essa diferença?`
              }
              htmlFor="tratamento"
              obrigatorio
            >
              <Select id="tratamento" value={tratamento} onChange={(e) => setTratamento(e.target.value as Tratamento | "")}>
                <option value="">Selecione...</option>
                {permitidos.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TRATAMENTO[t]}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}
        </section>
      ) : null}

      <Campo rotulo="Observação (opcional)" htmlFor="obs-conciliacao">
        <Input id="obs-conciliacao" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} />
      </Campo>

      {bloqueio && !resumo.doisLados && (resumo.selLancs.length || resumo.selBaixas.length || transf) ? (
        <p className="text-sm text-alerta-fg">{bloqueio}</p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variante="contorno" onClick={fechar}>
          Cancelar
        </Button>
        <Button onClick={concluir} disabled={Boolean(bloqueio) || enviando}>
          {enviando ? <Loader2 className="animate-spin" /> : null} Conciliar
        </Button>
      </div>
    </div>
  );
}

function unir<T extends { id: string }>(a: T[], b: T[]) {
  const ids = new Set(a.map((x) => x.id));
  return [...b.filter((x) => !ids.has(x.id)), ...a];
}

function BotaoAba({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativo}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
        ativo ? "bg-card text-titulo shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function OpcaoRadio({
  marcado,
  aoMarcar,
  titulo,
  detalhe,
  valor,
}: {
  marcado: boolean;
  aoMarcar: () => void;
  titulo: string;
  detalhe: string;
  valor: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50",
        marcado && "border-primary bg-bege/60",
      )}
    >
      <input type="radio" name="transferencia" checked={marcado} onChange={aoMarcar} className="size-4 accent-[var(--primary)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{detalhe}</span>
      </span>
      {valor}
    </label>
  );
}

export function ValorSinal({ valor, className }: { valor: string; className?: string }) {
  const positivo = dec(valor).isPositive();
  return (
    <span className={cn("shrink-0 font-semibold numero", positivo ? "text-sucesso" : "text-perigo", className)}>
      {formatarMoeda(valor, { sinal: true })}
    </span>
  );
}
