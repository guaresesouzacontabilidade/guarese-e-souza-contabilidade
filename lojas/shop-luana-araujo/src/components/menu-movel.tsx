"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";
import type { NoCategoria } from "@/lib/catalogo";

/** Menu de categorias em gaveta (celular) e o "Todas as categorias" do computador. */
export function MenuCategorias({ arvore, rotulo = "Abrir o menu", variante = "icone" }: { arvore: NoCategoria[]; rotulo?: string; variante?: "icone" | "texto" }) {
  const dialogo = React.useRef<HTMLDialogElement>(null);
  const caminho = usePathname();
  const [aberta, setAberta] = React.useState<string | null>(null);

  React.useEffect(() => {
    dialogo.current?.close();
  }, [caminho]);

  const abrir = () => dialogo.current?.showModal();
  const fechar = () => dialogo.current?.close();

  return (
    <>
      {variante === "icone" ? (
        <button type="button" onClick={abrir} className="inline-flex size-11 items-center justify-center text-prata hover:text-white" aria-label={rotulo}>
          <Menu className="size-6" strokeWidth={1.5} aria-hidden="true" />
        </button>
      ) : (
        <button type="button" onClick={abrir} className="py-2 text-[0.75rem] font-medium uppercase tracking-[0.16em] text-prata hover:text-white">
          {rotulo}
        </button>
      )}
      <dialog
        ref={dialogo}
        aria-label="Categorias"
        onClick={(e) => e.target === dialogo.current && fechar()}
        className="m-0 h-dvh max-h-none w-[min(22rem,88vw)] max-w-none bg-superficie p-0 text-texto backdrop:bg-noite/50 open:surgir"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b border-linha px-5">
            <span className="sobretitulo">Categorias</span>
            <button type="button" onClick={fechar} className="inline-flex size-11 items-center justify-center" aria-label="Fechar o menu">
              <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-5 py-2" aria-label="Categorias da loja">
            <ul>
              {arvore.map((c) => (
                <li key={c.id} className="border-b border-linha last:border-0">
                  <div className="flex items-center">
                    <Link href={`/c/${c.slug}`} className="flex-1 py-4 text-[0.9375rem]">
                      {c.nome}
                    </Link>
                    {c.filhas.length ? (
                      <button
                        type="button"
                        className="inline-flex size-11 items-center justify-center text-suave"
                        aria-expanded={aberta === c.id}
                        aria-controls={`sub-${c.id}`}
                        aria-label={`${aberta === c.id ? "Esconder" : "Mostrar"} as subcategorias de ${c.nome}`}
                        onClick={() => setAberta(aberta === c.id ? null : c.id)}
                      >
                        <ChevronDown className={`size-4 transition-transform ${aberta === c.id ? "rotate-180" : ""}`} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {c.filhas.length && aberta === c.id ? (
                    <ul id={`sub-${c.id}`} className="pb-3 pl-3">
                      {c.filhas.map((f) => (
                        <li key={f.id}>
                          <Link href={`/c/${f.slug}`} className="block py-2.5 text-sm text-suave hover:text-texto">
                            {f.nome}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <div className="border-t border-linha px-5 py-4 text-sm">
            <Link href="/sobre" className="block py-2 text-suave hover:text-texto">
              Sobre a loja
            </Link>
            <Link href="/trocas" className="block py-2 text-suave hover:text-texto">
              Trocas e devoluções
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}
