"use client";

import { useEffect, useState } from "react";
import { formatarMoeda } from "@/lib/dinheiro";

type Formato = "moeda" | "inteiro" | "percentual";

function formatar(v: number, formato: Formato) {
  if (formato === "moeda") return formatarMoeda(v);
  if (formato === "percentual") return `${Math.round(v)}%`;
  return Math.round(v).toLocaleString("pt-BR");
}

/**
 * Número que "conta" do zero até o valor ao abrir a tela. O servidor já entrega
 * o valor final (quem desliga as animações no aparelho vê o número parado).
 */
export function NumeroAnimado({ valor, formato = "inteiro", duracaoMs = 1100 }: { valor: number; formato?: Formato; duracaoMs?: number }) {
  const [mostrado, setMostrado] = useState(valor);

  useEffect(() => {
    const parado = !valor || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let quadro = 0;
    const inicio = performance.now();
    const passo = (agora: number) => {
      const t = parado ? 1 : Math.min(1, (agora - inicio) / duracaoMs);
      setMostrado(valor * (1 - Math.pow(1 - t, 3)));
      if (t < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor, duracaoMs]);

  return <span className="numero">{formatar(mostrado, formato)}</span>;
}
