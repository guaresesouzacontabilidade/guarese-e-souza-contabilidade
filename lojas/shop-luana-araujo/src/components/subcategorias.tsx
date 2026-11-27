"use client";

import * as React from "react";
import Link from "next/link";

const NO_COMPUTADOR = 10;

/**
 * Subcategorias: no celular, todas numa faixa que desliza; no computador, as
 * maiores primeiro e o resto atrás de "Mais", para os produtos aparecerem logo.
 */
export function Subcategorias({
  principal,
  filhas,
  atual,
}: {
  principal: { slug: string; nome: string };
  filhas: { id: string; nome: string; slug: string }[];
  atual: string | null;
}) {
  const [todas, setTodas] = React.useState(false);
  const escondidas = filhas.length - NO_COMPUTADOR;
  return (
    <nav aria-label={`Subcategorias de ${principal.nome}`} className="mt-6">
      <ul className="faixa-rolagem scroll-px-4 -mx-4 px-4 md:mx-0 md:flex-wrap md:px-0">
        <li>
          <Link href={`/c/${principal.slug}`} className="opcao" aria-current={!atual ? "page" : undefined}>
            Todos
          </Link>
        </li>
        {filhas.map((f, i) => (
          <li key={f.id} className={i >= NO_COMPUTADOR && !todas && f.id !== atual ? "md:hidden" : undefined}>
            <Link href={`/c/${f.slug}`} className="opcao" aria-current={f.id === atual ? "page" : undefined}>
              {f.nome}
            </Link>
          </li>
        ))}
        {escondidas > 0 ? (
          <li className="hidden md:block">
            <button type="button" className="opcao border-dashed text-suave" aria-expanded={todas} onClick={() => setTodas((v) => !v)}>
              {todas ? "Menos" : `Mais ${escondidas}`}
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
