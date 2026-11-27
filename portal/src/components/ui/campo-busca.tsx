"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

/**
 * Caixa de busca das listas: os resultados aparecem enquanto a pessoa digita
 * (sem precisar apertar Enter). Atualiza o endereço da página com o que foi
 * digitado e com os outros filtros do mesmo formulário, sem recarregar a
 * página nem tirar o cursor da caixa. Enter continua funcionando.
 */
export function CampoBusca({
  name = "q",
  defaultValue = "",
  placeholder = "Buscar",
  rotulo,
  className,
  atraso = 350,
  id,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Nome da caixa para leitores de tela (padrão: o placeholder). */
  rotulo?: string;
  className?: string;
  atraso?: number;
  id?: string;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const [pendente, iniciar] = React.useTransition();
  const [temTexto, setTemTexto] = React.useState(Boolean(defaultValue));
  const ref = React.useRef<HTMLInputElement>(null);
  const espera = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(espera.current), []);

  function buscar() {
    const input = ref.current;
    if (!input) return;
    const params = new URLSearchParams(window.location.search);
    const form = input.form;
    if (form) {
      // Os outros filtros do formulário vão junto (mesmo comportamento do Enter)
      const dados = new FormData(form);
      for (const k of new Set(dados.keys())) params.delete(k);
      for (const [k, v] of dados) if (typeof v === "string" && v.trim()) params.append(k, v);
    } else if (input.value.trim()) {
      params.set(name, input.value);
    } else {
      params.delete(name);
    }
    // Nova busca começa da primeira página
    params.delete("pagina");
    const qs = params.toString();
    iniciar(() => router.replace(qs ? `${caminho}?${qs}` : caminho, { scroll: false }));
  }

  function agendar(imediato = false) {
    window.clearTimeout(espera.current);
    if (imediato) buscar();
    else espera.current = window.setTimeout(buscar, atraso);
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={ref}
        id={id}
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={rotulo ?? placeholder}
        autoComplete="off"
        enterKeyHint="search"
        className="pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => {
          const vazio = !e.currentTarget.value.trim();
          setTemTexto(!vazio);
          agendar(vazio);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && e.currentTarget.value) {
            e.preventDefault();
            e.currentTarget.value = "";
            setTemTexto(false);
            agendar(true);
          }
        }}
      />
      {pendente ? (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Buscando" />
      ) : temTexto ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Limpar a busca"
          onClick={() => {
            if (ref.current) ref.current.value = "";
            setTemTexto(false);
            agendar(true);
            ref.current?.focus();
          }}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
