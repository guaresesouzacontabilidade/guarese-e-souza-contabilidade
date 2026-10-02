"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Loader2, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Confirmacao } from "@/components/ui/dialog";
import { Select, Textarea } from "@/components/ui/form";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import type { ResultadoAcao } from "@/lib/acoes";
import { analisarCombinacao, TIPOS_CONCILIACAO, TRATAMENTOS, type Tratamento } from "@/lib/conciliacao/regras";
import { confirmarSugestao, gerarSugestoesAgora, rejeitarSugestao } from "@/lib/conciliacao/acoes";
import type { SugestaoTela } from "./tipos";

export function useExecutar() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const executar = (fn: () => Promise<ResultadoAcao>, depois?: () => void) =>
    new Promise<boolean>((resolve) =>
      iniciar(async () => {
        const r = await fn();
        if (r.ok) {
          toast.success(r.mensagem ?? "Feito.");
          depois?.();
          router.refresh();
        } else toast.error(r.mensagem ?? "Não foi possível concluir.");
        resolve(r.ok);
      }),
    );
  return { executar, pendente };
}

export function BotaoGerarSugestoes({ empresaId }: { empresaId: string }) {
  const { executar, pendente } = useExecutar();
  return (
    <Button variante="contorno" disabled={pendente} onClick={() => executar(() => gerarSugestoesAgora(empresaId))}>
      {pendente ? <Loader2 className="animate-spin" /> : <Sparkles />} {pendente ? "Analisando..." : "Gerar sugestões"}
    </Button>
  );
}

function tomPontuacao(p: number | null) {
  if (p === null) return "neutro" as const;
  if (p >= 85) return "sucesso" as const;
  if (p >= 70) return "info" as const;
  return "alerta" as const;
}

function Criterios({ c }: { c: Record<string, unknown> }) {
  const itens: string[] = [];
  if (c.valor === "exato") itens.push("valor exato");
  if (c.valor === "aproximado") itens.push("valor aproximado");
  if (c.valor === "soma_exata") itens.push(`soma exata de ${c.quantidade ?? "vários"} lançamentos`);
  if (typeof c.dias === "number") itens.push(c.dias === 0 ? "mesma data" : `${c.dias} dia(s) de diferença`);
  if (c.documento === true) itens.push("mesmo CPF/CNPJ");
  if (typeof c.descricao === "number" && c.descricao > 0) itens.push("descrição parecida");
  if (c.numero_documento === true) itens.push("nº do documento na descrição");
  if (!itens.length) return null;
  return <p className="text-xs text-muted-foreground">Critérios: {itens.join(" · ")}</p>;
}

function CartaoSugestao({ empresaId, s }: { empresaId: string; s: SugestaoTela }) {
  const { executar, pendente } = useExecutar();
  const [tratamento, setTratamento] = useState<Tratamento | "">("");
  const [motivo, setMotivo] = useState("");
  const analise =
    s.tipo === "transferencia"
      ? null
      : analisarCombinacao({
          movimentos: s.movimentos,
          lancamentos: s.lancamentos.map((l) => ({ tipo: l.tipo, aberto: l.aberto })),
          baixas: s.baixas.map((b) => ({ tipo: b.tipo, total: b.total })),
        });
  const exigeTratamento = Boolean(analise?.tratamentos.length);
  const bloqueada = s.incompleta || (analise !== null && !analise.ok);

  return (
    <Card>
      <CardContent className="space-y-3 pt-4 sm:pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variante={tomPontuacao(s.pontuacao)}>{s.pontuacao ?? "—"} pts</Badge>
            <Badge variante="contorno">{TIPOS_CONCILIACAO[s.tipo] ?? s.tipo}</Badge>
            {s.observacao ? <span className="text-sm text-muted-foreground">{s.observacao}</span> : null}
          </div>
        </div>
        <div className="grid items-start gap-3 md:grid-cols-[1fr_auto_1fr]">
          <ul className="space-y-1.5">
            {s.movimentos.map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-muted/40 p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium" title={m.descricao}>
                      {m.descricao}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Extrato · {m.conta} · {formatarData(m.data)}
                    </span>
                  </span>
                  <span className={`shrink-0 font-semibold numero ${m.valor.startsWith("-") ? "text-perigo" : "text-sucesso"}`}>{formatarMoeda(m.valor, { sinal: true })}</span>
                </div>
              </li>
            ))}
          </ul>
          <ArrowRight className="mx-auto hidden size-4 text-muted-foreground md:mt-4 md:block" aria-hidden="true" />
          <ul className="space-y-1.5">
            {s.lancamentos.map((l) => (
              <li key={l.id} className="rounded-lg border border-border p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium" title={l.descricao}>
                      {l.descricao}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {l.tipo === "receber" ? "A receber" : "A pagar"} · vence {formatarData(l.vencimento)}
                      {l.contraparte ? ` · ${l.contraparte}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 numero">{formatarMoeda(l.aberto)}</span>
                </div>
              </li>
            ))}
            {s.baixas.map((b) => (
              <li key={b.id} className="rounded-lg border border-border p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{b.descricao || "Pagamento registrado"}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.tipo === "receber" ? "Recebimento" : "Pagamento"} registrado em {formatarData(b.data)}
                    </span>
                  </span>
                  <span className="shrink-0 numero">{formatarMoeda(b.total)}</span>
                </div>
              </li>
            ))}
            {s.tipo === "transferencia" ? (
              <li className="rounded-lg border border-dashed border-border p-2.5 text-sm text-muted-foreground">
                Será registrada uma transferência entre as contas (não é receita nem despesa).
              </li>
            ) : null}
          </ul>
        </div>
        <Criterios c={s.criterios} />
        {s.incompleta ? (
          <p className="text-sm text-alerta-fg">Um dos lançamentos desta sugestão já foi quitado, cancelado ou excluído. Rejeite-a e concilie manualmente.</p>
        ) : analise && !analise.ok ? (
          <p className="text-sm text-alerta-fg">{analise.erro}</p>
        ) : null}
        {exigeTratamento && analise ? (
          <div className="flex flex-col gap-2 rounded-lg bg-alerta-bg p-3 text-sm text-alerta-fg sm:flex-row sm:items-center sm:justify-between">
            <span>
              Diferença de <strong className="numero">{formatarMoeda(analise.diferenca, { sinal: true })}</strong> entre o extrato e o saldo em aberto. Como tratar?
            </span>
            <Select aria-label="Tratamento da diferença" value={tratamento} onChange={(e) => setTratamento(e.target.value as Tratamento | "")} className="h-9 sm:w-64">
              <option value="">Selecione...</option>
              {analise.tratamentos.map((t) => (
                <option key={t} value={t}>
                  {TRATAMENTOS[t]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Confirmacao
            gatilho={
              <Button variante="fantasma" tamanho="sm" disabled={pendente}>
                <X /> Rejeitar
              </Button>
            }
            titulo="Rejeitar esta sugestão?"
            descricao="O par não volta a ser sugerido. A movimentação continua pendente para conciliação manual."
            textoConfirmar="Rejeitar"
            variante="perigo"
            aoConfirmar={() => executar(() => rejeitarSugestao(empresaId, s.id, motivo)).then(() => undefined)}
          >
            <Textarea aria-label="Motivo (opcional)" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
          </Confirmacao>
          <Button
            variante="sucesso"
            tamanho="sm"
            disabled={pendente || bloqueada || (exigeTratamento && !tratamento)}
            title={exigeTratamento && !tratamento ? "Escolha como tratar a diferença" : undefined}
            onClick={() => executar(() => confirmarSugestao(empresaId, s.id, tratamento || null, null))}
          >
            {pendente ? <Loader2 className="animate-spin" /> : <Check />} Confirmar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ListaSugestoes({ empresaId, sugestoes }: { empresaId: string; sugestoes: SugestaoTela[] }) {
  return (
    <div className="space-y-3">
      {sugestoes.map((s) => (
        <CartaoSugestao key={s.id} empresaId={empresaId} s={s} />
      ))}
    </div>
  );
}
