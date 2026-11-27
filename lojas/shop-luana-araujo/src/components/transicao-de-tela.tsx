"use client";

import { ViewTransition } from "react";
import { usePathname } from "next/navigation";

/**
 * Liga a troca de tela suave: a cada página nova, este marcador invisível entra e
 * sai, e o React pede ao navegador uma transição. O efeito em si (a tela inteira se
 * desfaz e a nova surge de leve) fica no globals.css. Sem suporte no navegador, a
 * troca é instantânea, como antes.
 */
export function TransicaoDeTela() {
  const caminho = usePathname();
  return (
    <ViewTransition key={caminho} enter="marcador-tela" exit="marcador-tela" update="none" default="none">
      <span aria-hidden="true" className="pointer-events-none fixed left-0 top-0 size-px opacity-0" />
    </ViewTransition>
  );
}
