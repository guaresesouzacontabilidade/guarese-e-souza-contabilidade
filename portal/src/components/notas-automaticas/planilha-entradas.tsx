import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Select } from "@/components/ui/form";

/**
 * Planilha das NF-e de entrada do mês de emissão escolhido: de uma empresa
 * (empresaId) ou de todas as empresas que a pessoa vê. O arquivo é baixado
 * direto (/api/notas-entrada); a página continua aberta.
 */
export function FormPlanilhaEntradas({ empresaId, meses, padrao }: { empresaId?: string; meses: { valor: string; rotulo: string }[]; padrao: string }) {
  const id = empresaId ? "entradas-competencia" : "entradas-competencia-carteira";
  return (
    <form method="get" action="/api/notas-entrada" className="flex flex-wrap items-end gap-3">
      {empresaId ? <input type="hidden" name="empresa" value={empresaId} /> : null}
      <Campo rotulo="Mês de emissão" htmlFor={id} className="w-full max-w-60">
        <Select id={id} name="competencia" defaultValue={padrao}>
          {meses.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </Select>
      </Campo>
      <Button type="submit" variante="contorno">
        <FileSpreadsheet /> Baixar planilha
      </Button>
    </form>
  );
}
