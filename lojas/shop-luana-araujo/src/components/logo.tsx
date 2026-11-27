import Image from "next/image";
import Link from "next/link";

/** Logo original da loja (letras prateadas), recortada sem o fundo preto. */
export function Logo({ nome, className = "" }: { nome: string; className?: string }) {
  return (
    <Link href="/" className={`inline-flex shrink-0 items-center ${className}`} aria-label={`${nome} — página inicial`}>
      <Image src="/marca/logo-prata.png" alt="" width={438} height={96} unoptimized priority className="h-8 w-auto md:h-9" />
    </Link>
  );
}
