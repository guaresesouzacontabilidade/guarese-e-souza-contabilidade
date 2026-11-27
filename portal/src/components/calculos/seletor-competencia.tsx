"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/form";

/** Troca a competência da página (parâmetro ?competencia=AAAA-MM), mantendo os demais filtros. */
export function SeletorCompetencia({ valor, opcoes, rotulo = "Competência" }: { valor: string; opcoes: { valor: string; rotulo: string }[]; rotulo?: string }) {
  const router = useRouter();
  const caminho = usePathname();
  const busca = useSearchParams();
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="competencia">
        {rotulo}
      </label>
      <Select
        id="competencia"
        value={valor}
        className="w-full sm:w-96"
        onChange={(e) => {
          const p = new URLSearchParams(busca.toString());
          p.set("competencia", e.target.value);
          iniciar(() => router.push(`${caminho}?${p.toString()}`));
        }}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </Select>
      {pendente ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando" /> : null}
    </div>
  );
}
