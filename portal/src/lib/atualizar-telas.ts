import { revalidatePath } from "next/cache";

/**
 * Depois de gravar algo da empresa (cliente, fornecedor, produto, nota...):
 * todas as telas da empresa passam a mostrar o dado novo sem recarregar a
 * página — inclusive ao voltar pelo botão do navegador ou trocar de tela.
 * (Chamado dentro das ações do servidor, depois da gravação dar certo.)
 */
export function atualizarTelasDaEmpresa(empresaId: string) {
  revalidatePath(`/e/${empresaId}`, "layout");
}

/** O mesmo para as telas do escritório (carteira, empresas, honorários...). */
export function atualizarTelasDoEscritorio() {
  revalidatePath("/escritorio", "layout");
}
