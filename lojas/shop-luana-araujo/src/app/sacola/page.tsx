import type { Metadata } from "next";
import { obterVitrine } from "@/lib/portal";
import { SacolaPagina } from "@/components/sacola-pagina";

export const metadata: Metadata = { title: "Sacola", robots: { index: false } };
export const revalidate = 60;

export default async function Sacola() {
  const { loja } = await obterVitrine();
  return (
    <SacolaPagina
      loja={{ nome: loja.nome, whatsapp: loja.whatsapp, entregas: loja.entregas, pagamentos: loja.pagamentos, pedido_minimo: loja.pedido_minimo }}
    />
  );
}
