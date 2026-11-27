import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <div className="conteudo flex flex-col items-center py-28 text-center">
      <p className="sobretitulo">Página não encontrada</p>
      <h1 className="mt-4 text-4xl md:text-5xl">Este produto ou página não está mais aqui</h1>
      <p className="mt-4 max-w-md text-suave">Pode ter esgotado ou mudado de endereço. Veja as novidades ou busque pelo nome.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="botao">
          Ir para o início
        </Link>
        <Link href="/busca" className="botao-contorno">
          Buscar
        </Link>
      </div>
    </div>
  );
}
