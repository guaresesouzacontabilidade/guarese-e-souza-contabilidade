const PAGINA = 1000;

/**
 * Lê todas as linhas de uma consulta em páginas (o PostgREST limita cada
 * resposta a 1.000 linhas). `consulta` recebe o intervalo [de, ate].
 */
export async function buscarTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maximo = 50_000,
): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; de < maximo; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return linhas;
}
