import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";
import { cnpjVisivel, linkWhatsApp, telefoneVisivel } from "@/lib/catalogo";
import type { Loja } from "@/lib/tipos";
import { IconeInstagram, IconeWhatsApp } from "./icones";

export function Rodape({ loja }: { loja: Loja }) {
  const ano = new Date().getFullYear();
  return (
    <footer className="no-escuro mt-24 bg-tinta text-prata">
      <div className="conteudo grid gap-10 py-14 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Image src="/marca/logo-prata.png" alt={loja.nome} width={438} height={96} unoptimized className="h-9 w-auto" />
          {loja.sobre ? <p className="mt-5 max-w-xs text-sm leading-relaxed text-prata-media">{loja.sobre.split("\n")[0]}</p> : null}
        </div>
        <div>
          <h2 className="font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-white">Atendimento</h2>
          <ul className="mt-4 space-y-3 text-sm">
            {loja.whatsapp ? (
              <li>
                <a href={linkWhatsApp(loja.whatsapp)} className="inline-flex items-center gap-2 hover:text-white" target="_blank" rel="noopener noreferrer">
                  <IconeWhatsApp className="size-4" /> {telefoneVisivel(loja.whatsapp)}
                </a>
              </li>
            ) : null}
            {loja.instagram ? (
              <li>
                <a href={`https://instagram.com/${loja.instagram}`} className="inline-flex items-center gap-2 hover:text-white" target="_blank" rel="noopener noreferrer">
                  <IconeInstagram className="size-4" /> @{loja.instagram}
                </a>
              </li>
            ) : null}
            {loja.email ? (
              <li>
                <a href={`mailto:${loja.email}`} className="inline-flex items-center gap-2 break-all hover:text-white">
                  <Mail className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" /> {loja.email}
                </a>
              </li>
            ) : null}
            {loja.horario ? <li className="text-prata-media">{loja.horario}</li> : null}
          </ul>
        </div>
        <div>
          <h2 className="font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-white">Loja</h2>
          <address className="mt-4 space-y-1 text-sm not-italic text-prata-media">
            {loja.endereco_loja ? <p>{loja.endereco_loja}</p> : null}
            {loja.cidade ? <p>{loja.cidade}</p> : null}
          </address>
        </div>
        <div>
          <h2 className="font-sans text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-white">Informações</h2>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <Link href="/sobre" className="hover:text-white">
                Sobre a loja
              </Link>
            </li>
            <li>
              <Link href="/sobre#como-comprar" className="hover:text-white">
                Como comprar
              </Link>
            </li>
            <li>
              <Link href="/trocas" className="hover:text-white">
                Trocas e devoluções
              </Link>
            </li>
            <li>
              <Link href="/privacidade" className="hover:text-white">
                Privacidade
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="conteudo py-6 text-xs leading-relaxed text-prata-media">
          © {ano} {loja.nome}
          {loja.razao_social ? ` · ${loja.razao_social}` : ""}
          {loja.cnpj ? ` · CNPJ ${cnpjVisivel(loja.cnpj)}` : ""}
          {loja.endereco_loja ? ` · ${[loja.endereco_loja, loja.cidade].filter(Boolean).join(", ")}` : ""}
        </p>
      </div>
    </footer>
  );
}
