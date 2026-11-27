"use client";

import { Checkbox } from "@/components/ui/form";
import { GRUPOS_PERMISSOES, PERMISSOES_EXCLUSIVAS_EQUIPE, type Permissao } from "@/lib/permissoes";

/** Caixas de seleção de permissões agrupadas (visualização, edição, aprovação, download...). */
export function SeletorPermissoes({
  selecionadas,
  aoMudar,
  apenasCliente,
  limite,
}: {
  selecionadas: Set<Permissao>;
  aoMudar: (s: Set<Permissao>) => void;
  apenasCliente: boolean;
  limite?: Set<Permissao>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GRUPOS_PERMISSOES.map((g) => {
        const itens = g.itens.filter(
          (i) => !(apenasCliente && PERMISSOES_EXCLUSIVAS_EQUIPE.includes(i.chave)) && (!limite || limite.has(i.chave)),
        );
        if (!itens.length) return null;
        return (
          <fieldset key={g.grupo} className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.grupo}</legend>
            {itens.map((i) => (
              <label key={i.chave} className="flex items-start gap-2 text-sm">
                <Checkbox
                  name="permissoes"
                  value={i.chave}
                  className="mt-0.5"
                  checked={selecionadas.has(i.chave)}
                  onChange={(e) => {
                    const n = new Set(selecionadas);
                    if (e.target.checked) n.add(i.chave);
                    else n.delete(i.chave);
                    aoMudar(n);
                  }}
                />
                <span>
                  <span className="font-medium">{i.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{i.descricao}</span>
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
