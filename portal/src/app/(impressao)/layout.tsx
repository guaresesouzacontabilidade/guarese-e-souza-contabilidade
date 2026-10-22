import { exigirSessao } from "@/lib/auth/sessao";

/** Páginas para imprimir (comprovante, orçamento): sem o menu do portal. O acesso segue as regras do banco. */
export default async function LayoutImpressao({ children }: LayoutProps<"/">) {
  await exigirSessao();
  return <div className="min-h-dvh bg-white text-black">{children}</div>;
}
