"use client";

import * as React from "react";

/**
 * Lista que vem do servidor e também cresce na própria tela (ex.: cliente
 * cadastrado na hora, no caixa). Quando a página é atualizada, a lista nova do
 * servidor entra no lugar — sem precisar de F5 — e o que foi criado aqui e
 * ainda não voltou do servidor continua aparecendo.
 */
export function useListaDoServidor<T extends { id: string }>(doServidor: T[]): [T[], React.Dispatch<React.SetStateAction<T[]>>] {
  const [lista, setLista] = React.useState(doServidor);
  const [anterior, setAnterior] = React.useState(doServidor);
  if (anterior !== doServidor) {
    const idsAnteriores = new Set(anterior.map((x) => x.id));
    const idsNovos = new Set(doServidor.map((x) => x.id));
    setAnterior(doServidor);
    setLista((atual) => [...atual.filter((x) => !idsNovos.has(x.id) && !idsAnteriores.has(x.id)), ...doServidor]);
  }
  return [lista, setLista];
}
