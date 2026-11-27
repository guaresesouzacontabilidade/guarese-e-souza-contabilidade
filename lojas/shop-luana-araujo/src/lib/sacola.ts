"use client";

import * as React from "react";

/**
 * Sacola guardada só no aparelho da cliente (armazenamento do navegador).
 * Preço e estoque são conferidos de novo no portal na hora do pedido.
 */
export interface ItemSacola {
  produto_id: string;
  variacao: string | null;
  rotulo_variacao: string | null;
  quantidade: number;
  nome: string;
  preco: number;
  foto: string | null;
  url: string;
  maximo: number;
}

const CHAVE = "shop-luana-sacola-v1";
const VAZIA: ItemSacola[] = [];
let itens: ItemSacola[] = VAZIA;
let lida = false;
const ouvintes = new Set<() => void>();

export const chaveItem = (i: Pick<ItemSacola, "produto_id" | "variacao">) => `${i.produto_id}|${i.variacao ?? ""}`;

function valido(x: unknown): x is ItemSacola {
  const i = x as ItemSacola;
  return (
    !!i &&
    typeof i.produto_id === "string" &&
    typeof i.nome === "string" &&
    typeof i.preco === "number" &&
    Number.isInteger(i.quantidade) &&
    i.quantidade > 0 &&
    i.quantidade <= 99
  );
}

function ler(): ItemSacola[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(v) ? v.filter(valido).slice(0, 60) : VAZIA;
  } catch {
    return VAZIA;
  }
}

function gravar(novos: ItemSacola[]) {
  itens = novos;
  try {
    localStorage.setItem(CHAVE, JSON.stringify(novos));
  } catch {
    // Navegação privada ou armazenamento cheio: a sacola vale só enquanto a página estiver aberta.
  }
  ouvintes.forEach((f) => f());
}

function assinar(aoMudar: () => void) {
  ouvintes.add(aoMudar);
  const outraAba = (e: StorageEvent) => {
    if (e.key === CHAVE) {
      itens = ler();
      aoMudar();
    }
  };
  window.addEventListener("storage", outraAba);
  return () => {
    ouvintes.delete(aoMudar);
    window.removeEventListener("storage", outraAba);
  };
}

function atual() {
  if (!lida) {
    itens = ler();
    lida = true;
  }
  return itens;
}

export function useSacola() {
  const lista = React.useSyncExternalStore(assinar, atual, () => VAZIA);
  return React.useMemo(() => {
    const quantidade = lista.reduce((s, i) => s + i.quantidade, 0);
    const subtotal = Math.round(lista.reduce((s, i) => s + i.preco * i.quantidade, 0) * 100) / 100;
    return {
      itens: lista,
      quantidade,
      subtotal,
      adicionar(novo: ItemSacola) {
        const k = chaveItem(novo);
        const existente = atual().find((i) => chaveItem(i) === k);
        if (existente) {
          gravar(
            atual().map((i) =>
              chaveItem(i) === k ? { ...novo, quantidade: Math.min(i.quantidade + novo.quantidade, novo.maximo, 99) } : i,
            ),
          );
        } else {
          gravar([...atual(), { ...novo, quantidade: Math.min(novo.quantidade, novo.maximo, 99) }]);
        }
        window.dispatchEvent(new CustomEvent("sacola:adicionado", { detail: { nome: novo.nome } }));
      },
      alterar(k: string, quantidade: number) {
        gravar(atual().map((i) => (chaveItem(i) === k ? { ...i, quantidade: Math.max(1, Math.min(quantidade, i.maximo, 99)) } : i)));
      },
      atualizar(k: string, dados: Partial<ItemSacola>) {
        gravar(atual().map((i) => (chaveItem(i) === k ? { ...i, ...dados } : i)));
      },
      remover(k: string) {
        gravar(atual().filter((i) => chaveItem(i) !== k));
      },
      limpar() {
        gravar(VAZIA);
      },
    };
  }, [lista]);
}
