"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, GitCompareArrows, Link2, Loader2, RotateCcw, Search, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { analisarCombinacao, ordenarCandidatos, TIPOS_CONCILIACAO, TRATAMENTOS, tratamentoValido, type Tratamento } from "@/lib/conciliacao/regras";
import { classificarMovimento, conciliarManual, conciliarTransferencia, desfazerConciliacao, ignorarMovimento } from "@/lib/conciliacao/acoes";
import { useExecutar } from "./sugestoes";
import type { BaixaLivre, CategoriaOpcao, LancamentoAberto, MovimentoTela, Opcao, TransferenciaLivre } from "./tipos";

interface Dados {
  lancamentos: LancamentoAberto[];
  baixas: BaixaLivre[];
  transferencias: TransferenciaLivre[];
  contas: Opcao[];
  categorias: CategoriaOpcao[];
  contrapartes: Opcao[];
}

const STATUS: Record<MovimentoTela["status"], { rotulo: string; variante: "alerta" | "sucesso" | "neutro" }> = {
  pendente: { rotulo: "Pendente", variante: "alerta" },
  conciliado: { rotulo: "Conciliada", variante: "sucesso" },
  ignorado: { rotulo: "Ignorada", variante: "neutro" },
};

function Valor({ v, className }: { v: string; className?: string }) {
  return <span className={cn("font-semibold numero", v.startsWith("-") ? "text-perigo" : "text-sucesso", className)}>{formatarMoeda(v, { sinal: true })}</span>;
}

export function TabelaMovimentos({
  empresaId,
  movimentos,
  dados,
  podeCriarLancamento,
}: {
  empresaId: string;
  movimentos: MovimentoTela[];
  dados: Dados;
  podeCriarLancamento: boolean;
}) {
  const { executar, pendente } = useExecutar();
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [emConciliacao, setEmConciliacao] = useState<MovimentoTela[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const pendentes = movimentos.filter((m) => m.status === "pendente");
  const marcados = movimentos.filter((m) => selecionados.includes(m.id) && m.status === "pendente");
  const alternar = (id: string) => setSelecionados((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const todosMarcados = pendentes.length > 0 && pendentes.every((m) => selecionados.includes(m.id));
  const somaMarcados = marcados.reduce((a, m) => a.plus(dec(m.valor)), dec(0));

  return (
    <>
      {marcados.length ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-secondary/40 p-3 text-sm">
          <span>
            {marcados.length} selecionada(s) · soma <Valor v={somaMarcados.toFixed(2)} />
          </span>
          <span className="flex gap-2">
            <Button tamanho="sm" variante="fantasma" onClick={() => setSelecionados([])}>
              Limpar seleção
            </Button>
            <Button tamanho="sm" onClick={() => setEmConciliacao(marcados)}>
              <GitCompareArrows /> Conciliar selecionadas
            </Button>
          </span>
        </div>
      ) : null}
      <Table>
        <THead>
          <tr>
            <Th className="w-8">
              <Checkbox
                aria-label="Selecionar todas as pendentes"
                checked={todosMarcados}
                disabled={!pendentes.length}
                onChange={() => setSelecionados(todosMarcados ? [] : pendentes.map((m) => m.id))}
              />
            </Th>
            <Th>Data</Th>
            <Th>Descrição</Th>
            <Th>Conta</Th>
            <Th className="text-right">Valor</Th>
            <Th>Situação</Th>
            <Th className="text-right">
              <span className="sr-only">Ações</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {movimentos.map((m) => (
            <Tr key={m.id} className={cn(selecionados.includes(m.id) && "bg-secondary/30")}>
              <Td>
                {m.status === "pendente" ? <Checkbox aria-label={`Selecionar ${m.descricao}`} checked={selecionados.includes(m.id)} onChange={() => alternar(m.id)} /> : null}
              </Td>
              <Td className="whitespace-nowrap text-sm">{formatarData(m.data)}</Td>
              <Td className="max-w-[22rem]">
                <span className="block truncate text-sm font-medium" title={m.descricao}>
                  {m.descricao}
                </span>
                <span className="text-xs text-muted-foreground">
                  {m.status === "conciliado" && m.conciliacao_tipo ? `${TIPOS_CONCILIACAO[m.conciliacao_tipo] ?? m.conciliacao_tipo}${m.conciliada_em ? ` · ${formatarDataHora(m.conciliada_em)}` : ""}` : null}
                  {m.status === "ignorado" && m.ignorado_motivo ? `Motivo: ${m.ignorado_motivo}` : null}
                  {m.status === "pendente" && m.em_sugestao ? "Há sugestão aguardando confirmação" : null}
                </span>
              </Td>
              <Td className="whitespace-nowrap text-sm">{m.conta}</Td>
              <Td className="whitespace-nowrap text-right">
                <Valor v={m.valor} />
              </Td>
              <Td>
                <Badge variante={STATUS[m.status].variante}>{STATUS[m.status].rotulo}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-right">
                {m.status === "pendente" ? (
                  <span className="inline-flex gap-1">
                    <Button tamanho="sm" variante="contorno" onClick={() => setEmConciliacao([m])}>
                      <Link2 /> Conciliar
                    </Button>
                    <Confirmacao
                      gatilho={
                        <Button tamanho="iconeSm" variante="fantasma" aria-label="Ignorar" title="Ignorar">
                          <Ban />
                        </Button>
                      }
                      titulo="Ignorar esta movimentação?"
                      descricao="Use para lançamentos que não precisam de conciliação (ex.: estorno do próprio banco que se anula). Ela pode ser reativada depois."
                      textoConfirmar="Ignorar"
                      variante="perigo"
                      aoConfirmar={async () => {
                        if (!motivo.trim()) {
                          toast.error("Informe o motivo.");
                          return false;
                        }
                        await executar(() => ignorarMovimento(empresaId, m.id, true, motivo), () => setMotivo(""));
                      }}
                    >
                      <Textarea aria-label="Motivo" placeholder="Por que esta movimentação será ignorada?" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
                    </Confirmacao>
                  </span>
                ) : m.status === "ignorado" ? (
                  <Button tamanho="sm" variante="fantasma" disabled={pendente} onClick={() => executar(() => ignorarMovimento(empresaId, m.id, false, null))}>
                    <RotateCcw /> Reativar
                  </Button>
                ) : m.conciliacao_id ? (
                  <Confirmacao
                    gatilho={
                      <Button tamanho="sm" variante="fantasma">
                        <Undo2 /> Desfazer
                      </Button>
                    }
                    titulo="Desfazer esta conciliação?"
                    descricao="Os pagamentos, transferências e lançamentos criados por ela são removidos e as movimentações voltam a ficar pendentes. Fica registrado no histórico."
                    textoConfirmar="Desfazer"
                    variante="perigo"
                    aoConfirmar={async () => {
                      if (!motivo.trim()) {
                        toast.error("Informe o motivo.");
                        return false;
                      }
                      await executar(() => desfazerConciliacao(empresaId, m.conciliacao_id!, motivo), () => setMotivo(""));
                    }}
                  >
                    <Textarea aria-label="Motivo" placeholder="Motivo para desfazer" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
                  </Confirmacao>
                ) : null}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <Dialog open={emConciliacao !== null} onOpenChange={(v) => !v && setEmConciliacao(null)}>
        {emConciliacao ? (
          <DialogContent
            largura="xl"
            titulo={emConciliacao.length > 1 ? `Conciliar ${emConciliacao.length} movimentações` : "Conciliar movimentação"}
            descricao="Escolha o que corresponde a esta movimentação do extrato. O lançamento é a fonte da receita/despesa — conciliar não duplica valores."
          >
            <PainelConciliacao
              empresaId={empresaId}
              movimentos={emConciliacao}
              dados={dados}
              podeCriarLancamento={podeCriarLancamento}
              aoConcluir={() => {
                setEmConciliacao(null);
                setSelecionados([]);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

type Aba = "lancamentos" | "novo" | "transferencia";

function PainelConciliacao({
  empresaId,
  movimentos,
  dados,
  podeCriarLancamento,
  aoConcluir,
}: {
  empresaId: string;
  movimentos: MovimentoTela[];
  dados: Dados;
  podeCriarLancamento: boolean;
  aoConcluir: () => void;
}) {
  const unico = movimentos.length === 1 ? movimentos[0] : null;
  const mesmaConta = movimentos.every((m) => m.conta_id === movimentos[0].conta_id);
  const parTransferencia =
    movimentos.length === 2 && movimentos[0].conta_id !== movimentos[1].conta_id && dec(movimentos[0].valor).plus(dec(movimentos[1].valor)).isZero();
  const [aba, setAba] = useState<Aba>(parTransferencia ? "transferencia" : "lancamentos");
  const soma = movimentos.reduce((a, m) => a.plus(dec(m.valor)), dec(0));
  const abas: { valor: Aba; rotulo: string; disponivel: boolean }[] = [
    { valor: "lancamentos", rotulo: "Lançamentos e pagamentos", disponivel: mesmaConta },
    { valor: "novo", rotulo: "Criar lançamento", disponivel: Boolean(unico) && podeCriarLancamento },
    { valor: "transferencia", rotulo: "Transferência entre contas", disponivel: Boolean(unico) || parTransferencia },
  ];

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {movimentos.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium" title={m.descricao}>
                {m.descricao}
              </span>
              <span className="text-xs text-muted-foreground">
                {m.conta} · {formatarData(m.data)}
                {m.documento ? ` · doc. ${m.documento}` : ""}
              </span>
            </span>
            <Valor v={m.valor} className="shrink-0" />
          </li>
        ))}
        {movimentos.length > 1 ? (
          <li className="flex justify-between px-2.5 text-sm">
            <span className="text-muted-foreground">Soma</span>
            <Valor v={soma.toFixed(2)} />
          </li>
        ) : null}
      </ul>
      {!mesmaConta && !parTransferencia ? (
        <p className="text-sm text-alerta-fg">As movimentações selecionadas são de contas diferentes. Só é possível conciliá-las juntas como transferência (saída e entrada de mesmo valor).</p>
      ) : null}
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {abas
          .filter((a) => a.disponivel)
          .map((a) => (
            <button
              key={a.valor}
              type="button"
              role="tab"
              aria-selected={aba === a.valor}
              onClick={() => setAba(a.valor)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                aba === a.valor ? "border-primary font-semibold text-titulo" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {a.rotulo}
            </button>
          ))}
      </div>
      {aba === "lancamentos" && mesmaConta ? <AbaLancamentos empresaId={empresaId} movimentos={movimentos} dados={dados} aoConcluir={aoConcluir} /> : null}
      {aba === "novo" && unico && podeCriarLancamento ? <AbaNovo empresaId={empresaId} mov={unico} dados={dados} aoConcluir={aoConcluir} /> : null}
      {aba === "transferencia" && (unico || parTransferencia) ? (
        <AbaTransferencia empresaId={empresaId} movimentos={movimentos} par={parTransferencia} dados={dados} aoConcluir={aoConcluir} />
      ) : null}
    </div>
  );
}

function AbaLancamentos({ empresaId, movimentos, dados, aoConcluir }: { empresaId: string; movimentos: MovimentoTela[]; dados: Dados; aoConcluir: () => void }) {
  const { executar, pendente } = useExecutar();
  const [busca, setBusca] = useState("");
  const [lancSel, setLancSel] = useState<string[]>([]);
  const [baixaSel, setBaixaSel] = useState<string[]>([]);
  const [tratamento, setTratamento] = useState<Tratamento | "">("");
  const [observacao, setObservacao] = useState("");
  const referencia = movimentos[0];
  const soma = movimentos.reduce((a, m) => a.plus(dec(m.valor)), dec(0)).toFixed(2);
  const tipo = dec(soma).isPositive() ? "receber" : "pagar";

  const candidatos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrados = termo
      ? dados.lancamentos.filter((l) => `${l.descricao} ${l.contraparte ?? ""} ${l.numero ?? ""}`.toLowerCase().includes(termo) || l.aberto.includes(termo.replace(",", ".")))
      : dados.lancamentos;
    return ordenarCandidatos({ valor: soma, data: referencia.data }, filtrados).slice(0, 60);
  }, [busca, dados.lancamentos, soma, referencia.data]);

  const baixas = useMemo(
    () =>
      dados.baixas
        .filter((b) => b.tipo === tipo && b.conta_id === referencia.conta_id)
        .sort((a, b) => dec(a.total).minus(dec(soma).abs()).abs().comparedTo(dec(b.total).minus(dec(soma).abs()).abs()))
        .slice(0, 20),
    [dados.baixas, tipo, referencia.conta_id, soma],
  );

  const escolhidosL = dados.lancamentos.filter((l) => lancSel.includes(l.id));
  const escolhidosB = dados.baixas.filter((b) => baixaSel.includes(b.id));
  const analise = analisarCombinacao({
    movimentos,
    lancamentos: escolhidosL.map((l) => ({ tipo: l.tipo, aberto: l.aberto })),
    baixas: escolhidosB.map((b) => ({ tipo: b.tipo, total: b.total })),
  });
  const trat = tratamento || null;
  const pronto = analise.ok && tratamentoValido(analise, trat);
  const alternar = (lista: string[], set: (v: string[]) => void, id: string) => set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por descrição, cliente/fornecedor, nº do documento ou valor" className="pl-9" aria-label="Buscar lançamentos" />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contas {tipo === "receber" ? "a receber" : "a pagar"} em aberto</p>
        {candidatos.length ? (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {candidatos.map((l) => (
              <li key={l.id}>
                <label className="flex cursor-pointer items-start gap-3 p-2.5 text-sm hover:bg-muted/40">
                  <Checkbox className="mt-0.5" checked={lancSel.includes(l.id)} onChange={() => alternar(lancSel, setLancSel, l.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.descricao}</span>
                    <span className="text-xs text-muted-foreground">
                      vence {formatarData(l.vencimento)}
                      {l.contraparte ? ` · ${l.contraparte}` : ""}
                      {l.numero ? ` · nº ${l.numero}` : ""}
                    </span>
                  </span>
                  <span className={cn("shrink-0 numero", dec(l.aberto).equals(dec(soma).abs()) && "font-semibold text-sucesso")}>{formatarMoeda(l.aberto)}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum lançamento em aberto {busca ? "com esta busca" : "neste sentido"}. Use “Criar lançamento”.</p>
        )}
      </div>
      {baixas.length ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tipo === "receber" ? "Recebimentos" : "Pagamentos"} já registrados nesta conta e ainda não conciliados
          </p>
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {baixas.map((b) => (
              <li key={b.id}>
                <label className="flex cursor-pointer items-start gap-3 p-2.5 text-sm hover:bg-muted/40">
                  <Checkbox className="mt-0.5" checked={baixaSel.includes(b.id)} onChange={() => alternar(baixaSel, setBaixaSel, b.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{b.descricao || "Pagamento registrado"}</span>
                    <span className="text-xs text-muted-foreground">em {formatarData(b.data)}</span>
                  </span>
                  <span className="shrink-0 numero">{formatarMoeda(b.total)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Extrato</p>
          <p className="font-semibold numero">{formatarMoeda(analise.caixa)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Selecionado</p>
          <p className="font-semibold numero">{formatarMoeda(analise.alvos)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Diferença</p>
          <p className={cn("font-semibold numero", !dec(analise.diferenca).isZero() && "text-alerta")}>{formatarMoeda(analise.diferenca, { sinal: true })}</p>
        </div>
      </div>
      {lancSel.length + baixaSel.length > 0 && analise.erro ? <p className="text-sm text-alerta-fg">{analise.erro}</p> : null}
      {analise.ok && analise.tratamentos.length ? (
        <Campo rotulo={dec(analise.diferenca).isPositive() ? "O extrato é maior que o saldo em aberto. A diferença é:" : "O extrato é menor que o saldo em aberto. A diferença é:"} htmlFor="c-trat" obrigatorio>
          <Select id="c-trat" value={tratamento} onChange={(e) => setTratamento(e.target.value as Tratamento | "")}>
            <option value="">Selecione...</option>
            {analise.tratamentos.map((t) => (
              <option key={t} value={t}>
                {TRATAMENTOS[t]}
              </option>
            ))}
          </Select>
        </Campo>
      ) : null}
      <Campo rotulo="Observação" htmlFor="c-obs">
        <Textarea id="c-obs" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </Campo>
      <div className="flex justify-end">
        <Button
          disabled={!pronto || pendente}
          onClick={() =>
            executar(
              () =>
                conciliarManual(empresaId, {
                  movimentos: movimentos.map((m) => m.id),
                  lancamentos: lancSel,
                  baixas: baixaSel,
                  tratamento: analise.tratamentos.length ? trat : null,
                  observacao,
                }),
              aoConcluir,
            )
          }
        >
          {pendente ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Conciliar
        </Button>
      </div>
    </div>
  );
}

function AbaNovo({ empresaId, mov, dados, aoConcluir }: { empresaId: string; mov: MovimentoTela; dados: Dados; aoConcluir: () => void }) {
  const natureza = dec(mov.valor).isPositive() ? "receita" : "despesa";
  const categorias = dados.categorias.filter((c) => c.natureza === natureza);
  return (
    <FormularioAcao acao={classificarMovimento.bind(null, empresaId)} aoSucesso={aoConcluir} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="movimento_id" value={mov.id} />
          <p className="text-sm text-muted-foreground">
            Cria um lançamento {natureza === "receita" ? "a receber" : "a pagar"} já {natureza === "receita" ? "recebido" : "pago"} de {formatarMoeda(dec(mov.valor).abs())} em {formatarData(mov.data)}, nesta conta, e concilia.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Categoria" htmlFor="n-cat" obrigatorio erro={estado.erros?.categoria_id} className="sm:col-span-2">
              <Select id="n-cat" name="categoria_id" defaultValue="">
                <option value="">Selecione...</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Descrição" htmlFor="n-desc" erro={estado.erros?.descricao} className="sm:col-span-2">
              <Input id="n-desc" name="descricao" defaultValue={mov.descricao} maxLength={300} />
            </Campo>
            <Campo rotulo={natureza === "receita" ? "Cliente" : "Fornecedor"} htmlFor="n-contra" erro={estado.erros?.contraparte_id}>
              <Select id="n-contra" name="contraparte_id" defaultValue="">
                <option value="">—</option>
                {dados.contrapartes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Data de competência" htmlFor="n-comp" erro={estado.erros?.data_competencia} ajuda="Quando a receita/despesa aconteceu (padrão: data do extrato).">
              <Input id="n-comp" name="data_competencia" type="date" defaultValue={mov.data} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Conciliando...">
              Criar e conciliar
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

function AbaTransferencia({
  empresaId,
  movimentos,
  par,
  dados,
  aoConcluir,
}: {
  empresaId: string;
  movimentos: MovimentoTela[];
  par: boolean;
  dados: Dados;
  aoConcluir: () => void;
}) {
  const { executar, pendente } = useExecutar();
  const mov = movimentos[0];
  const [modo, setModo] = useState<"nova" | "existente">("nova");
  const [conta, setConta] = useState("");
  const [transf, setTransf] = useState("");
  const [observacao, setObservacao] = useState("");
  const saida = dec(mov.valor).isNegative();
  const existentes = useMemo(
    () =>
      par
        ? []
        : dados.transferencias.filter(
            (t) =>
              dec(t.valor).equals(dec(mov.valor).abs()) &&
              (saida ? t.origem_id === mov.conta_id && !t.origem_conciliada : t.destino_id === mov.conta_id && !t.destino_conciliada) &&
              Math.abs(Date.parse(`${t.data}T12:00:00Z`) - Date.parse(`${mov.data}T12:00:00Z`)) <= 10 * 86400000,
          ),
    [par, dados.transferencias, mov, saida],
  );

  if (par) {
    const s = movimentos.find((m) => dec(m.valor).isNegative())!;
    const e = movimentos.find((m) => dec(m.valor).isPositive())!;
    return (
      <div className="space-y-4">
        <p className="text-sm">
          Registrar transferência de <strong>{formatarMoeda(dec(e.valor))}</strong> de <strong>{s.conta}</strong> para <strong>{e.conta}</strong> e conciliar as duas movimentações. Não é receita nem despesa.
        </p>
        <Campo rotulo="Descrição / observação" htmlFor="t-obs">
          <Input id="t-obs" value={observacao} onChange={(ev) => setObservacao(ev.target.value)} placeholder="Transferência entre contas" />
        </Campo>
        <div className="flex justify-end">
          <Button disabled={pendente} onClick={() => executar(() => conciliarTransferencia(empresaId, { movimentos: movimentos.map((m) => m.id), observacao }), aoConcluir)}>
            {pendente ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Registrar e conciliar
          </Button>
        </div>
      </div>
    );
  }

  const outras = dados.contas.filter((c) => c.id !== mov.conta_id);
  return (
    <div className="space-y-4">
      {existentes.length ? (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="modo-transf" checked={modo === "nova"} onChange={() => setModo("nova")} /> Registrar nova transferência
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="modo-transf" checked={modo === "existente"} onChange={() => setModo("existente")} /> Usar transferência já registrada
          </label>
        </div>
      ) : null}
      {modo === "existente" && existentes.length ? (
        <Campo rotulo="Transferência registrada" htmlFor="t-exist" obrigatorio>
          <Select id="t-exist" value={transf} onChange={(e) => setTransf(e.target.value)}>
            <option value="">Selecione...</option>
            {existentes.map((t) => (
              <option key={t.id} value={t.id}>
                {formatarData(t.data)} · {t.origem} → {t.destino} · {formatarMoeda(t.valor)}
                {t.descricao ? ` · ${t.descricao}` : ""}
              </option>
            ))}
          </Select>
        </Campo>
      ) : (
        <>
          <Campo rotulo={saida ? "Conta de destino (para onde o dinheiro foi)" : "Conta de origem (de onde o dinheiro veio)"} htmlFor="t-conta" obrigatorio>
            <Select id="t-conta" value={conta} onChange={(e) => setConta(e.target.value)}>
              <option value="">Selecione...</option>
              {outras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Descrição / observação" htmlFor="t-obs1">
            <Input id="t-obs1" value={observacao} onChange={(ev) => setObservacao(ev.target.value)} placeholder="Transferência entre contas" />
          </Campo>
          <p className="text-xs text-muted-foreground">
            Quando o extrato da outra conta for importado, concilie a movimentação correspondente com esta transferência (opção “Usar transferência já registrada”).
          </p>
        </>
      )}
      <div className="flex justify-end">
        <Button
          disabled={pendente || (modo === "existente" ? !transf : !conta)}
          onClick={() =>
            executar(
              () =>
                conciliarTransferencia(empresaId, {
                  movimentos: [mov.id],
                  conta_contrapartida: modo === "nova" ? conta : null,
                  transferencia_id: modo === "existente" ? transf : null,
                  observacao,
                }),
              aoConcluir,
            )
          }
        >
          {pendente ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Conciliar como transferência
        </Button>
      </div>
    </div>
  );
}
