"use client";

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import { BotaoAcao } from "@/components/ui/acao";
import { Input } from "@/components/ui/form";
import { definirPagarDesde } from "@/lib/financeiro/acoes-importacao";

/**
 * Data de início do contas a pagar no portal: antes dela, as contas não são
 * criadas das notas fiscais de compra nem entram pela importação.
 */
export function ConfigPagarDesde({ empresaId, valor, podeEditar }: { empresaId: string; valor: string | null; podeEditar: boolean }) {
  const [data, setData] = useState(valor ?? "");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="mb-1 flex items-center gap-1.5 font-medium">
          <CalendarCheck className="size-4 text-primary" /> Contas a pagar no portal a partir de
        </span>
        <Input type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={!podeEditar} className="w-48" aria-label="Contas a pagar no portal a partir de" />
      </label>
      {podeEditar ? (
        <>
          <BotaoAcao variante="contorno" acao={() => definirPagarDesde(empresaId, data)}>
            Salvar data
          </BotaoAcao>
          {valor ? (
            <BotaoAcao
              variante="fantasma"
              acao={async () => {
                const r = await definirPagarDesde(empresaId, "");
                if (r.ok) setData("");
                return r;
              }}
            >
              Tirar a data
            </BotaoAcao>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
