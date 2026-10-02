import { envPublico } from "@/lib/env";

/** Identifica claramente o ambiente de demonstração (dados fictícios). */
export function BannerAmbiente() {
  const amb = envPublico.ambiente();
  if (amb === "producao") return null;
  return (
    <div role="note" className="bg-alerta-bg px-4 py-1.5 text-center text-xs font-semibold text-alerta-fg nao-imprimir">
      {amb === "demonstracao"
        ? "AMBIENTE DE DEMONSTRAÇÃO — dados fictícios, separados dos dados reais."
        : "AMBIENTE DE DESENVOLVIMENTO — não utilize dados reais."}
    </div>
  );
}
