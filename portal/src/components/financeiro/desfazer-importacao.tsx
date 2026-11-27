"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { desfazerImportacao } from "@/lib/financeiro/acoes-importacao";

export function DesfazerImportacao({ empresaId, importacaoId }: { empresaId: string; importacaoId: string }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button tamanho="iconeSm" variante="fantasma" aria-label="Desfazer importação">
          <Undo2 />
        </Button>
      }
      titulo="Desfazer esta importação?"
      descricao="Remove as movimentações (ou lançamentos) criados por ela. Não é possível desfazer se houver conciliações confirmadas ou competências fechadas — nesse caso, desfaça-as antes. O registro fica no histórico."
      textoConfirmar="Desfazer"
      variante="perigo"
      aoConfirmar={async () => {
        if (!motivo.trim()) {
          toast.error("Informe o motivo.");
          return false;
        }
        const r = await desfazerImportacao(empresaId, importacaoId, motivo);
        if (!r.ok) {
          toast.error(r.mensagem ?? "Não foi possível desfazer.");
          return false;
        }
        toast.success(r.mensagem ?? "Importação desfeita.");
        router.refresh();
      }}
    >
      <Textarea aria-label="Motivo" placeholder="Ex.: importei o extrato na conta errada" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
    </Confirmacao>
  );
}
