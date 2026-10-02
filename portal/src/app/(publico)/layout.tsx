import { obterEscritorioPublico } from "@/lib/auth/escritorio-publico";
import { formatarCep, formatarCnpj, formatarTelefone } from "@/lib/formatos";
import { BannerAmbiente } from "@/components/layout/banner-ambiente";
import Link from "next/link";

export default async function LayoutPublico({ children }: { children: React.ReactNode }) {
  const esc = await obterEscritorioPublico();
  return (
    <div className="flex min-h-dvh flex-col bg-muted/60">
      <BannerAmbiente />
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">{children}</main>
      <footer className="border-t border-border bg-card px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">{esc.nome_fantasia}</p>
        <p>
          {esc.razao_social} — CNPJ {formatarCnpj(esc.cnpj)}
        </p>
        <p>
          {[esc.logradouro, esc.numero ? `nº ${esc.numero}` : null, esc.bairro].filter(Boolean).join(", ")}
          {esc.cidade ? ` — ${esc.cidade}${esc.uf ? ` – ${esc.uf}` : ""}` : ""}
          {esc.cep ? ` — CEP ${formatarCep(esc.cep)}` : ""}
        </p>
        <p>
          {esc.email ? (
            <a className="underline-offset-2 hover:underline" href={`mailto:${esc.email}`}>
              {esc.email}
            </a>
          ) : null}
          {esc.whatsapp ? ` · WhatsApp ${formatarTelefone(esc.whatsapp)}` : ""}
        </p>
        <p className="mt-2 space-x-3">
          <Link className="underline-offset-2 hover:underline" href="/privacidade">
            Política de privacidade
          </Link>
          <Link className="underline-offset-2 hover:underline" href="/termos">
            Termos de uso
          </Link>
        </p>
      </footer>
    </div>
  );
}
