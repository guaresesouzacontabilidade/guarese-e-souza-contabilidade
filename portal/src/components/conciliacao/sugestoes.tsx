"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, CheckCheck, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { cn } from "@/lib/utils";
import { confirmarSugestao, confirmarSugestoesEmLote, rejeitarSugestao } from "@/lib/conciliacao/acoes";
import { ROTULO_TRATAMENTO, tratamentosPermitidos, type Tratamento } from "@/lib/conciliacao/tipos";
import { ValorSinal } from "./conciliar-manual";

export interface SugestaoVisual {
  id: string;
  tipo: string;
  pontuacao: number | null;
  criterios: Record<string, unknown>;
  observacao: string | null;
  sentido: "receber" | "pagar";
  movimentos: { id: string; data: string; valor: string; descricao: string; conta: string }[];
  lancamentos: { id: string; descricao: string; contraparte: string | null; vencimento: string; aberto: string }[];
  baixas: { id: string; data: string; total: string; descricao: string }[];
  /** Extrato − selecionado (positivo: entrou/saiu a mais). */
  diferenca: string;
}

function confianca(p: number | null) {
  const v = p ?? 0;
  if (v >= 80) return { rotulo: "Alta confiança", variante: "sucesso" as const };
  if (v >= 65) return { rotulo: "Média confiança", variante: "info" as const };
  return { rotulo: "Baixa confiança", variante: "alerta" as const };
}

function criteriosLegiveis(c: Record<string, unknown>): string[] {
  const r: string[] = [];
  if (c.valor === "exato" || c.valor === true) r.push("Valor exato");
  else if (c.valor === "aproximado") r.push("Valor aproximado");
  else if (c.valor === "soma_exata") r.push(`Soma exata de ${c.quantidade ?? "vários"} lançamentos`);
  if (typeof c.dias === "number") r.push(c.dias === 0 ? "Mesma data" : `${c.dias} dia(s) de diferença`);
  if (c.documento === true) r.push("CPF/CNPJ confere");
  if (typeof c.descricao === "number" && c.descricao > 0) r.push("Descrição semelhante");
  if (c.numero_documento === true) r.push("Nº do documento na descrição");
  if (c.cartao === true) r.push("Pagamento de fatura do cartão");
  else if (c.transferencia === true) r.push("Mesmo valor entre contas da empresa");
  return r;
}

export function ListaSugestoes({ empresaId, sugestoes, podeExecutar }: { empresaId: string; sugestoes: SugestaoVisual[]; podeExecutar: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pendente, iniciar] = useTransition();
  const semDiferenca = sugestoes.filter((s) => dec(s.diferenca).isZero());

  function confirmarLote() {
    iniciar(async () => {
      const r = await confirmarSugestoesEmLote(empresaId, [...sel]);
      if (r.ok) {
        toast.success(r.mensagem ?? "Confirmadas.");
        setSel(new Set());
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível confirmar.");
    });
  }

  return (
    <div className="space-y-3">
      {podeExecutar && semDiferenca.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
          <label className="flex items-center gap-2 px-1 text-sm">
            <Checkbox
              checked={semDiferenca.every((s) => sel.has(s.id))}
              onChange={(e) => setSel(e.target.checked ? new Set(semDiferenca.map((s) => s.id)) : new Set())}
            />
            Selecionar as {semDiferenca.length} sugestões sem diferença de valor
          </label>
          {sel.size ? (
            <Button tamanho="sm" variante="sucesso" onClick={confirmarLote} disabled={pendente}>
              {pendente ? <Loader2 className="animate-spin" /> : <CheckCheck />} Confirmar {sel.size} selecionada(s)
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className="space-y-3">
        {sugestoes.map((s) => (
          <li key={s.id}>
            <CartaoSugestao
              empresaId={empresaId}
              s={s}
              podeExecutar={podeExecutar}
              selecionada={sel.has(s.id)}
              aoSelecionar={
                dec(s.diferenca).isZero()
                  ? () =>
                      setSel((x) => {
                        const n = new Set(x);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      })
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CartaoSugestao({
  empresaId,
  s,
  podeExecutar,
  selecionada,
  aoSelecionar,
}: {
  empresaId: string;
  s: SugestaoVisual;
  podeExecutar: boolean;
  selecionada: boolean;
  aoSelecionar?: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [tratamento, setTratamento] = useState<Tratamento | "">("");
  const [motivo, setMotivo] = useState("");
  const conf = confianca(s.pontuacao);
  const dif = dec(s.diferenca);
  const permitidos = s.lancamentos.length ? tratamentosPermitidos(dif.toNumber(), s.sentido) : [];
  const transferencia = s.tipo === "transferencia";

  function confirmar() {
    iniciar(async () => {
      const r = await confirmarSugestao(empresaId, s.id, { tratamento: tratamento || null });
      if (r.ok) {
        toast.success(r.mensagem ?? "Confirmada.");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível confirmar.");
    });
  }

  async function rejeitar() {
    const r = await rejeitarSugestao(empresaId, s.id, motivo);
    if (r.ok) {
      toast.success(r.mensagem ?? "Rejeitada.");
      router.refresh();
    } else toast.error(r.mensagem ?? "Não foi possível rejeitar.");
  }

  return (
    <article className={cn("rounded-xl border border-border bg-card shadow-sm", selecionada && "border-primary ring-1 ring-primary/30")}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {podeExecutar && aoSelecionar ? <Checkbox aria-label="Selecionar sugestão" checked={selecionada} onChange={aoSelecionar} /> : null}
        <Badge variante={conf.variante}>
          {conf.rotulo}
          {s.pontuacao !== null ? ` · ${s.pontuacao}%` : ""}
        </Badge>
        {transferencia ? <Badge variante="primario">Transferência entre contas</Badge> : null}
        {s.observacao ? <span className="text-sm text-muted-foreground">{s.observacao}</span> : null}
      </header>
      <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{transferencia ? "Saída" : "Extrato do banco"}</p>
          {(transferencia ? s.movimentos.filter((m) => dec(m.valor).lessThan(0)) : s.movimentos).map((m) => (
            <LinhaItem key={m.id} titulo={m.descricao} detalhe={`${formatarData(m.data)} · ${m.conta}`} valor={<ValorSinal valor={m.valor} />} />
          ))}
        </div>
        <ArrowRight className="mx-auto hidden size-5 text-muted-foreground md:block" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{transferencia ? "Entrada" : "No sistema"}</p>
          {transferencia
            ? s.movimentos
                .filter((m) => dec(m.valor).greaterThan(0))
                .map((m) => (
                  <LinhaItem key={m.id} titulo={m.descricao} detalhe={`${formatarData(m.data)} · ${m.conta}`} valor={<ValorSinal valor={m.valor} />} />
                ))
            : null}
          {s.lancamentos.map((l) => (
            <LinhaItem
              key={l.id}
              titulo={l.descricao}
              detalhe={`Vence ${formatarData(l.vencimento)}${l.contraparte ? ` · ${l.contraparte}` : ""}`}
              valor={<span className="font-semibold numero">{formatarMoeda(l.aberto)}</span>}
            />
          ))}
          {s.baixas.map((b) => (
            <LinhaItem
              key={b.id}
              titulo={b.descricao}
              detalhe={`Pagamento registrado em ${formatarData(b.data)}`}
              valor={<span className="font-semibold numero">{formatarMoeda(b.total)}</span>}
            />
          ))}
        </div>
      </div>
      <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {criteriosLegiveis(s.criterios).map((c) => (
            <Badge key={c} variante="contorno">
              <Check /> {c}
            </Badge>
          ))}
          {!dif.isZero() ? <Badge variante="alerta">Diferença de {formatarMoeda(dif.abs())}</Badge> : null}
        </div>
        {podeExecutar ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {permitidos.length ? (
              <Campo rotulo="Tratar a diferença como" htmlFor={`trat-${s.id}`} className="sm:w-64">
                <Select id={`trat-${s.id}`} value={tratamento} onChange={(e) => setTratamento(e.target.value as Tratamento | "")} className="h-9">
                  <option value="">Selecione...</option>
                  {permitidos.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TRATAMENTO[t]}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
            <div className="flex gap-2">
              <Confirmacao
                gatilho={
                  <Button tamanho="sm" variante="contorno">
                    <X /> Rejeitar
                  </Button>
                }
                titulo="Rejeitar sugestão?"
                descricao="Este par não será sugerido novamente. A movimentação continua pendente para conciliação manual."
                textoConfirmar="Rejeitar"
                variante="perigo"
                aoConfirmar={rejeitar}
              >
                <Campo rotulo="Motivo (opcional)" htmlFor={`mot-${s.id}`}>
                  <Input id={`mot-${s.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
                </Campo>
              </Confirmacao>
              <Button tamanho="sm" variante="sucesso" onClick={confirmar} disabled={pendente || (permitidos.length > 0 && !tratamento)}>
                {pendente ? <Loader2 className="animate-spin" /> : <Check />} Confirmar
              </Button>
            </div>
          </div>
        ) : null}
      </footer>
    </article>
  );
}

function LinhaItem({ titulo, detalhe, valor }: { titulo: string; detalhe: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium" title={titulo}>
          {titulo}
        </p>
        <p className="truncate text-xs text-muted-foreground">{detalhe}</p>
      </div>
      {valor}
    </div>
  );
}
