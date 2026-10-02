"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/form";

type Opcao = { valor: string; rotulo: string };

/** Seletor de período que atualiza a página ao trocar (mantém os demais filtros). */
export function SeletorPeriodo({
  valor,
  opcoes,
  className,
}: {
  valor: string;
  opcoes: { meses: Opcao[]; trimestres: Opcao[]; anos: Opcao[]; doze: Opcao };
  className?: string;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const busca = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const atual = valor.startsWith("12m") ? "12m" : valor;
  return (
    <div className={className}>
      <label className="sr-only" htmlFor="periodo">
        Período
      </label>
      <div className="flex items-center gap-2">
        <Select
          id="periodo"
          value={atual}
          className="w-full sm:w-64"
          onChange={(e) => {
            const p = new URLSearchParams(busca.toString());
            p.set("periodo", e.target.value);
            p.delete("detalhe");
            iniciar(() => router.push(`${caminho}?${p.toString()}`));
          }}
        >
          <optgroup label="Mês">
            {opcoes.meses.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
          <optgroup label="Trimestre">
            {opcoes.trimestres.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
          <optgroup label="Ano">
            {opcoes.anos.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
          <optgroup label="Outros">
            <option value={opcoes.doze.valor}>{opcoes.doze.rotulo}</option>
          </optgroup>
        </Select>
        {pendente ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando" /> : null}
      </div>
    </div>
  );
}
