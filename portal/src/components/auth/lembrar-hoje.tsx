"use client";

import { Checkbox } from "@/components/ui/form";

/** Opção da tela do código: não pedir o código de novo hoje neste aparelho. */
export function LembrarHoje({ marcado, aoMudar }: { marcado: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
      <Checkbox checked={marcado} onChange={(e) => aoMudar(e.target.checked)} className="mt-0.5" />
      <span>
        <span className="font-medium">Não pedir o código de novo hoje neste aparelho</span>
        <span className="block text-xs text-muted-foreground">
          Até o fim do dia, ao fechar e abrir o portal, só a senha é pedida. Desmarque se o computador for compartilhado.
        </span>
      </span>
    </label>
  );
}
