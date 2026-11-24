import { BadgeCheck } from "lucide-react";
import { diaLocal, horaLocal } from "@/lib/veterinaria/rotulos";
import { formatarData } from "@/lib/formatos";
import { crefitoTexto } from "@/lib/fisioterapia/rotulos";

/** Assinatura do registro (Res. COFFITO nº 414/2012, art. 1º, VIII e art. 2º): nome, CREFITO e data. */
export function Assinatura({ profissional, finalizadoEm }: { profissional: { nome: string; crefito: string; crefito_regiao: number } | null; finalizadoEm: string | null }) {
  if (!finalizadoEm) return null;
  return (
    <p className="flex items-center gap-2 rounded-lg border border-sucesso/30 bg-sucesso-bg px-3 py-2 text-sm text-sucesso-fg">
      <BadgeCheck className="size-4 shrink-0" />
      Finalizado em {formatarData(diaLocal(finalizadoEm))} às {horaLocal(finalizadoEm)} por {profissional?.nome ?? "—"} · {crefitoTexto(profissional)}
    </p>
  );
}

/** Campo do registro finalizado (só mostra o que foi preenchido). */
export function CampoLido({ rotulo, valor }: { rotulo: string; valor: string | number | null | undefined }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-sm whitespace-pre-wrap">{valor}</dd>
    </div>
  );
}

/** Adendos (correções e complementos datados) abaixo do registro finalizado. */
export function ListaAdendos({ adendos }: { adendos: { id: string; texto: string; created_at: string; profissional: { nome: string; crefito: string; crefito_regiao: number } | null }[] }) {
  if (!adendos.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Adendos</h2>
      <ul className="space-y-2">
        {adendos.map((a) => (
          <li key={a.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="whitespace-pre-wrap">{a.texto}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatarData(diaLocal(a.created_at))} {horaLocal(a.created_at)} · {a.profissional?.nome ?? ""} · {crefitoTexto(a.profissional)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
