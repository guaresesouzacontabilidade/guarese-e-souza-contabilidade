"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { Alerta } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarMoeda } from "@/lib/dinheiro";
import { salvarFaixasAprovacao } from "@/lib/financeiro/acoes-titulos";

type Faixa = { chave: number; valor_minimo: string; aprovacoes: number };

/**
 * Faixas de aprovação de pagamentos: a partir de qual valor um pagamento
 * precisa ser aprovado (e por quantas pessoas) antes de ser baixado. Sem
 * faixas, nada pede aprovação.
 */
export function FaixasAprovacao({
  empresaId,
  faixas: iniciais,
  podeEditar,
  pendentes,
}: {
  empresaId: string;
  faixas: { valor_minimo: number; aprovacoes: number }[];
  podeEditar: boolean;
  pendentes: number;
}) {
  const router = useRouter();
  const seq = React.useRef(iniciais.length + 1);
  const [faixas, setFaixas] = React.useState<Faixa[]>(() => iniciais.map((f, i) => ({ chave: i + 1, valor_minimo: String(f.valor_minimo), aprovacoes: f.aprovacoes })));
  const [salvando, iniciar] = React.useTransition();

  function salvar() {
    iniciar(async () => {
      const r = await salvarFaixasAprovacao(
        empresaId,
        faixas.map((f) => ({ valor_minimo: f.valor_minimo, aprovacoes: f.aprovacoes })),
      );
      if (r.ok) {
        toast.success(r.mensagem ?? "Salvo.");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível salvar.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" /> Aprovação de pagamentos
        </CardTitle>
        <CardDescription>
          Pagamentos a partir do valor da faixa ficam “aguardando aprovação” e só podem ser baixados depois que alguém com a permissão <strong>Aprovar
          pagamentos</strong> aprovar. Quem lançou não aprova o próprio pagamento. O que o banco já mostrou (conciliação) entra mesmo assim.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendentes ? (
          <Alerta tom="alerta">
            {pendentes} pagamento(s) aguardando aprovação agora. Eles aparecem na Visão geral e em Contas a pagar (filtro “Aguardando aprovação”).
          </Alerta>
        ) : null}
        {faixas.length ? (
          <ul className="space-y-2" aria-label="Faixas de aprovação">
            {faixas.map((f, i) => (
              <li key={f.chave} className="grid items-end gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_12rem_auto]">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">A partir de</span>
                  <CampoValor
                    aria-label={`Valor mínimo da faixa ${i + 1}`}
                    valorInicial={f.valor_minimo}
                    disabled={!podeEditar}
                    aoMudar={(v) => setFaixas((l) => l.map((x) => (x.chave === f.chave ? { ...x, valor_minimo: v } : x)))}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Precisa de</span>
                  <Select
                    aria-label={`Aprovações da faixa ${i + 1}`}
                    value={f.aprovacoes}
                    disabled={!podeEditar}
                    onChange={(e) => setFaixas((l) => l.map((x) => (x.chave === f.chave ? { ...x, aprovacoes: Number(e.target.value) } : x)))}
                  >
                    <option value={1}>1 aprovação</option>
                    <option value={2}>2 aprovações (pessoas diferentes)</option>
                    <option value={3}>3 aprovações (pessoas diferentes)</option>
                  </Select>
                </label>
                {podeEditar ? (
                  <Button variante="fantasma" tamanho="icone" aria-label={`Tirar a faixa ${i + 1}`} onClick={() => setFaixas((l) => l.filter((x) => x.chave !== f.chave))}>
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma faixa: os pagamentos não precisam de aprovação.</p>
        )}
        {iniciais.length ? (
          <p className="text-xs text-muted-foreground">
            Hoje:{" "}
            {iniciais
              .map((f) => `a partir de ${formatarMoeda(f.valor_minimo)}, ${f.aprovacoes} aprovação(ões)`)
              .join("; ")}
            .
          </p>
        ) : null}
        {podeEditar ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variante="contorno"
              disabled={faixas.length >= 5}
              onClick={() => setFaixas((l) => [...l, { chave: seq.current++, valor_minimo: "", aprovacoes: 1 }])}
            >
              <Plus /> Nova faixa
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Salvar aprovação
            </Button>
          </div>
        ) : (
          <Alerta tom="info">Só quem tem a permissão “Aprovar pagamentos” muda as faixas.</Alerta>
        )}
      </CardContent>
    </Card>
  );
}
