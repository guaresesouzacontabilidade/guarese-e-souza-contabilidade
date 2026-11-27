"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Printer, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { cancelarComAutorizacao } from "@/lib/gestao/cancelar-autorizado";

/**
 * Cancela a venda (devolve o estoque e cancela no Financeiro) ou o orçamento.
 * Só com a autorização de quem pode cancelar: a pessoa escolhe o próprio nome
 * e digita a senha do login do portal (conferida no servidor).
 */
export function CancelarVenda({
  empresaId,
  vendaId,
  orcamento,
  autorizadores,
}: {
  empresaId: string;
  vendaId: string;
  orcamento: boolean;
  autorizadores: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [quem, setQuem] = React.useState(autorizadores.length === 1 ? autorizadores[0].id : "");
  const [senha, setSenha] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [pendente, iniciar] = React.useTransition();

  function confirmar() {
    setErro(null);
    if (motivo.trim().length < 3) return setErro("Explique o motivo do cancelamento.");
    if (!quem) return setErro("Escolha quem autoriza.");
    if (!senha) return setErro("Digite a senha de quem autoriza.");
    iniciar(async () => {
      const r = await cancelarComAutorizacao(empresaId, vendaId, motivo, quem, senha);
      setSenha("");
      if (!r.ok) return setErro(r.mensagem ?? "Não foi possível cancelar.");
      toast.success(orcamento ? "Orçamento cancelado." : "Venda cancelada. O estoque foi devolvido.");
      setAberto(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <XCircle /> {orcamento ? "Cancelar orçamento" : "Cancelar venda"}
      </Button>
      <Dialog
        open={aberto}
        onOpenChange={(a) => {
          setAberto(a);
          if (!a) setSenha("");
        }}
      >
        <DialogContent
          titulo={orcamento ? "Cancelar este orçamento?" : "Cancelar esta venda?"}
          descricao={
            orcamento
              ? "O orçamento deixa de valer e não pode mais virar venda. Precisa da senha de quem pode autorizar."
              : "Os produtos voltam para o estoque e os recebimentos são cancelados no Financeiro (só enquanto o caixa da venda estiver aberto). Precisa da senha de quem pode autorizar."
          }
        >
          <div className="space-y-4">
            <Campo rotulo="Motivo" htmlFor="motivo-cancelamento" obrigatorio>
              <Textarea id="motivo-cancelamento" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </Campo>
            {autorizadores.length ? (
              <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
                <p className="flex items-center gap-1.5 text-sm font-medium sm:col-span-2">
                  <ShieldCheck className="size-4 text-primary" /> Autorização
                </p>
                <Campo rotulo="Quem autoriza" htmlFor="cancelar-quem" obrigatorio>
                  <Select id="cancelar-quem" value={quem} onChange={(e) => setQuem(e.target.value)}>
                    <option value="">Escolha o nome…</option>
                    {autorizadores.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Senha" htmlFor="cancelar-senha" obrigatorio ajuda="A mesma senha que essa pessoa usa para entrar no portal.">
                  <Input
                    id="cancelar-senha"
                    type="password"
                    autoComplete="off"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmar()}
                  />
                </Campo>
              </div>
            ) : (
              <p className="rounded-lg bg-alerta-bg px-3 py-2 text-sm text-alerta-fg">
                Ninguém desta empresa tem a permissão “Cancelar vendas e orçamentos”. O dono da empresa pode liberar em Acessos.
              </p>
            )}
            {erro ? (
              <p role="alert" className="rounded-lg bg-perigo-bg px-3 py-2 text-sm text-perigo-fg">
                {erro}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variante="fantasma" onClick={() => setAberto(false)}>
                Voltar
              </Button>
              <Button variante="perigo" onClick={confirmar} disabled={pendente || !autorizadores.length}>
                {pendente ? <Loader2 className="animate-spin" /> : <XCircle />} {orcamento ? "Cancelar orçamento" : "Cancelar venda"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BotaoImprimir({ rotulo = "Imprimir" }: { rotulo?: string }) {
  return (
    <Button onClick={() => window.print()}>
      <Printer /> {rotulo}
    </Button>
  );
}
