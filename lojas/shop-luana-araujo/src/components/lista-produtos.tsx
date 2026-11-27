"use client";

import * as React from "react";
import { ORDENS, ordenar, type Ordem } from "@/lib/catalogo";
import type { ProdutoResumo } from "@/lib/tipos";
import { GradeProdutos } from "./cartao-produto";

const POR_VEZ = 24;

/** Produtos de uma categoria ou busca: ordenar e mostrar mais, sem recarregar a página. */
export function ListaProdutos({ produtos, ordemInicial = "destaque" }: { produtos: ProdutoResumo[]; ordemInicial?: Ordem }) {
  const [ordem, setOrdem] = React.useState<Ordem>(ordemInicial);
  const [quantos, setQuantos] = React.useState(POR_VEZ);
  const ordenados = React.useMemo(() => ordenar(produtos, ordem), [produtos, ordem]);
  const visiveis = ordenados.slice(0, quantos);
  const id = React.useId();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-linha pb-4">
        <p className="text-sm text-suave" aria-live="polite">
          {produtos.length} {produtos.length === 1 ? "produto" : "produtos"}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor={`ordem-${id}`} className="text-sm text-suave">
            Ordenar
          </label>
          <select
            id={`ordem-${id}`}
            value={ordem}
            onChange={(e) => {
              setOrdem(e.target.value as Ordem);
              setQuantos(POR_VEZ);
            }}
            className="min-h-11 border-0 border-b border-borda bg-transparent py-1 pl-1 pr-6 text-sm text-texto focus:border-tinta focus:outline-none"
          >
            {ORDENS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <GradeProdutos produtos={visiveis} prioridade={4} />
      {quantos < ordenados.length ? (
        <div className="mt-12 flex flex-col items-center gap-3">
          <p className="text-xs text-suave">
            Mostrando {visiveis.length} de {ordenados.length}
          </p>
          <button type="button" className="botao-contorno" onClick={() => setQuantos((q) => q + POR_VEZ)}>
            Ver mais produtos
          </button>
        </div>
      ) : null}
    </div>
  );
}
