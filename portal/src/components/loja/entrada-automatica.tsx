"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2, Zap, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apagarVinculoEstoque, definirEntradaAutomatica } from "@/lib/gestao/acoes";

/** Liga ou desliga a entrada automática das notas de compra no estoque. */
export function BotaoEntradaAutomatica({ empresaId, ligada }: { empresaId: string; ligada: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  async function alternar() {
    setEnviando(true);
    const r = await definirEntradaAutomatica(empresaId, !ligada);
    setEnviando(false);
    if (r.ok) {
      toast.success(r.mensagem);
      router.refresh();
    } else toast.error(r.mensagem);
  }
  return (
    <Button onClick={alternar} disabled={enviando} variante={ligada ? "contorno" : "primario"}>
      {enviando ? <Loader2 className="animate-spin" /> : ligada ? <ZapOff /> : <Zap />}
      {ligada ? "Desligar a entrada automática" : "Ligar a entrada automática"}
    </Button>
  );
}

/** Esquece um vínculo do fornecedor com o produto. */
export function ApagarVinculo({ empresaId, vinculoId, descricao }: { empresaId: string; vinculoId: string; descricao: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  async function apagar() {
    if (!window.confirm(`Esquecer o vínculo de “${descricao}”? A próxima nota com este item vai pedir conferência.`)) return;
    setEnviando(true);
    const r = await apagarVinculoEstoque(empresaId, vinculoId);
    setEnviando(false);
    if (r.ok) {
      toast.success(r.mensagem);
      router.refresh();
    } else toast.error(r.mensagem);
  }
  return (
    <Button tamanho="icone" variante="fantasma" onClick={apagar} disabled={enviando} aria-label={`Apagar o vínculo de ${descricao}`} title="Apagar o vínculo">
      {enviando ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}
