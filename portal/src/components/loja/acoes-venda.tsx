"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirmacao } from "@/components/ui/dialog";
import { Campo, Textarea } from "@/components/ui/form";
import { cancelarVenda } from "@/lib/gestao/acoes";

/** Cancela a venda (devolve o estoque e cancela no Financeiro) ou o orçamento. */
export function CancelarVenda({ empresaId, vendaId, orcamento }: { empresaId: string; vendaId: string; orcamento: boolean }) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno">
          <XCircle /> {orcamento ? "Cancelar orçamento" : "Cancelar venda"}
        </Button>
      }
      titulo={orcamento ? "Cancelar este orçamento?" : "Cancelar esta venda?"}
      descricao={
        orcamento
          ? "O orçamento deixa de valer e não pode mais virar venda."
          : "Os produtos voltam para o estoque e os recebimentos são cancelados no Financeiro. Só dá para cancelar enquanto o caixa da venda estiver aberto."
      }
      textoConfirmar={orcamento ? "Cancelar orçamento" : "Cancelar venda"}
      variante="perigo"
      aoConfirmar={async () => {
        if (motivo.trim().length < 3) {
          setErro("Explique o motivo do cancelamento.");
          return false;
        }
        const r = await cancelarVenda(empresaId, vendaId, motivo);
        if (!r.ok) {
          setErro(r.mensagem ?? "Não foi possível cancelar.");
          return false;
        }
        toast.success(orcamento ? "Orçamento cancelado." : "Venda cancelada. O estoque foi devolvido.");
        router.refresh();
      }}
    >
      <Campo rotulo="Motivo" htmlFor="motivo-cancelamento" erro={erro}>
        <Textarea id="motivo-cancelamento" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Campo>
    </Confirmacao>
  );
}

export function BotaoImprimir({ rotulo = "Imprimir" }: { rotulo?: string }) {
  return (
    <Button onClick={() => window.print()}>
      <Printer /> {rotulo}
    </Button>
  );
}
