"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Fotos do produto: desliza no celular; miniaturas e setas no computador. */
export function Galeria({ fotos, nome }: { fotos: string[]; nome: string }) {
  const trilho = React.useRef<HTMLDivElement>(null);
  const [atual, setAtual] = React.useState(0);

  React.useEffect(() => {
    const el = trilho.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) if (e.isIntersecting) setAtual(Number((e.target as HTMLElement).dataset.i));
      },
      { root: el, threshold: 0.6 },
    );
    el.querySelectorAll("[data-i]").forEach((f) => obs.observe(f));
    return () => obs.disconnect();
  }, [fotos.length]);

  const ir = (i: number) => {
    const el = trilho.current;
    if (!el) return;
    const alvo = Math.max(0, Math.min(fotos.length - 1, i));
    const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: alvo * el.clientWidth, behavior: reduzir ? "auto" : "smooth" });
  };

  if (!fotos.length) {
    return <div className="flex aspect-square items-center justify-center bg-areia font-titulo text-2xl text-prata-media">Foto em breve</div>;
  }

  return (
    <div>
      <div className="relative">
        <div
          ref={trilho}
          className="faixa-rolagem gap-0 bg-areia"
          style={{ scrollSnapType: "x mandatory" }}
          role="region"
          aria-roledescription="galeria"
          aria-label={`Fotos de ${nome}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") ir(atual + 1);
            if (e.key === "ArrowLeft") ir(atual - 1);
          }}
        >
          {fotos.map((f, i) => (
            <div key={f} data-i={i} className="relative aspect-square w-full" aria-label={`Foto ${i + 1} de ${fotos.length}`} role="group">
              <Image src={f} alt={i === 0 ? nome : ""} fill priority={i === 0} sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
            </div>
          ))}
        </div>
        {fotos.length > 1 ? (
          <>
            <span className="absolute bottom-3 right-3 bg-superficie/90 px-2 py-1 text-[0.6875rem] font-medium tabular-nums md:hidden" aria-hidden="true">
              {atual + 1} / {fotos.length}
            </span>
            <button type="button" onClick={() => ir(atual - 1)} disabled={atual === 0} className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center bg-superficie/90 transition-opacity disabled:opacity-0 md:inline-flex" aria-label="Foto anterior">
              <ChevronLeft className="size-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => ir(atual + 1)} disabled={atual === fotos.length - 1} className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center bg-superficie/90 transition-opacity disabled:opacity-0 md:inline-flex" aria-label="Próxima foto">
              <ChevronRight className="size-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      {fotos.length > 1 ? (
        <div className="mt-3 hidden grid-cols-6 gap-2 md:grid">
          {fotos.map((f, i) => (
            <button key={f} type="button" onClick={() => ir(i)} className={`relative aspect-square overflow-hidden bg-areia outline-offset-2 ${i === atual ? "ring-1 ring-tinta" : "opacity-70 hover:opacity-100"}`} aria-label={`Ver a foto ${i + 1}`} aria-current={i === atual}>
              <Image src={f} alt="" fill sizes="8vw" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
