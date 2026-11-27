import { cn } from "@/lib/utils";
import { PERIODICIDADE, type Periodicidade } from "@/lib/rh/rotulos";

/** Etiqueta da periodicidade: texto e cor (diária azul, semanal verde, quinzenal roxa, mensal laranja). */
export function EtiquetaPeriodicidade({
  periodicidade,
  className,
}: {
  periodicidade: Periodicidade;
  className?: string;
}) {
  const p = PERIODICIDADE[periodicidade];
  return (
    <span
      data-periodicidade={periodicidade}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
        p.classe,
        className,
      )}
    >
      {p.rotulo}
    </span>
  );
}
