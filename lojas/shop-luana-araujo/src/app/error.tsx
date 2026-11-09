"use client";

export default function Erro({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="conteudo flex flex-col items-center py-28 text-center">
      <h1 className="text-4xl md:text-5xl">Estamos atualizando a loja</h1>
      <p className="mt-4 max-w-md text-suave">Não conseguimos carregar esta página agora. Tente de novo em instantes.</p>
      <button type="button" onClick={reset} className="botao mt-8">
        Tentar de novo
      </button>
    </div>
  );
}
