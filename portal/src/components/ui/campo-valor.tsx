"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";

/**
 * Campo de valor em reais. O texto digitado é interpretado no padrão
 * brasileiro (1.234,56) e normalizado ao sair do campo. O servidor sempre
 * reinterpreta o valor com Decimal — nunca com ponto flutuante.
 */
export const CampoValor = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "value" | "onChange"> & {
    valorInicial?: string | number | null;
    aoMudar?: (texto: string) => void;
    permitirNegativo?: boolean;
  }
>(({ className, valorInicial, aoMudar, permitirNegativo = false, ...props }, ref) => {
  const inicial = valorInicial === null || valorInicial === undefined || valorInicial === "" ? "" : formatarMoeda(valorInicial, { semSimbolo: true });
  const [texto, setTexto] = React.useState(inicial);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
      <input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        value={texto}
        onChange={(e) => {
          const v = e.target.value.replace(permitirNegativo ? /[^\d.,-]/g : /[^\d.,]/g, "");
          setTexto(v);
          aoMudar?.(v);
        }}
        onBlur={() => {
          const d = lerValorBR(texto);
          if (d) {
            const f = formatarMoeda(d, { semSimbolo: true }).replace("−", "-");
            setTexto(f);
            aoMudar?.(f);
          }
        }}
        className={cn(
          "h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-right text-sm numero focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-[invalid=true]:border-perigo",
          className,
        )}
        {...props}
      />
    </div>
  );
});
CampoValor.displayName = "CampoValor";
