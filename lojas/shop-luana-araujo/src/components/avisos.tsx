"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, X } from "lucide-react";
import { linkWhatsApp } from "@/lib/catalogo";
import { IconeWhatsApp } from "./icones";

/** Aviso discreto depois de pôr um produto na sacola (anunciado também para leitores de tela). */
export function AvisoSacola() {
  const [nome, setNome] = React.useState<string | null>(null);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const ao = (e: Event) => {
      setNome((e as CustomEvent<{ nome: string }>).detail.nome);
      clearTimeout(t);
      t = setTimeout(() => setNome(null), 4000);
    };
    window.addEventListener("sacola:adicionado", ao);
    return () => {
      window.removeEventListener("sacola:adicionado", ao);
      clearTimeout(t);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8" role="status" aria-live="polite">
      {nome ? (
        <div className="surgir pointer-events-auto flex w-full max-w-md items-center gap-3 bg-tinta px-4 py-3 text-sm text-white shadow-[0_8px_30px_rgba(12,10,9,0.25)]">
          <Check className="size-4 shrink-0 text-prata" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate">
            <span className="sr-only">Adicionado à sacola: </span>
            <span aria-hidden="true">Na sacola: </span>
            {nome}
          </p>
          <Link href="/sacola" className="shrink-0 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-prata underline-offset-4 hover:underline">
            Ver sacola
          </Link>
          <button type="button" onClick={() => setNome(null)} className="-mr-2 inline-flex size-9 shrink-0 items-center justify-center text-prata" aria-label="Fechar aviso">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Botão do WhatsApp da loja (fica fora das páginas de produto e da sacola, que têm a própria barra). */
export function WhatsAppFlutuante({ numero }: { numero: string }) {
  const caminho = usePathname();
  if (caminho.startsWith("/p/") || caminho.startsWith("/sacola")) return null;
  return (
    <a
      href={linkWhatsApp(numero, "Olá! Vim pelo site da loja.")}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-5 right-4 z-40 inline-flex size-14 items-center justify-center rounded-full bg-tinta text-prata shadow-[0_6px_24px_rgba(12,10,9,0.28)] transition-transform hover:scale-105 hover:text-white md:bottom-8 md:right-8"
      style={{ viewTransitionName: "whatsapp" }}
      aria-label="Falar com a loja no WhatsApp"
    >
      <IconeWhatsApp className="size-6" />
    </a>
  );
}
