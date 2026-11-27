import type { Metadata } from "next";
import { BannerAmbiente } from "@/components/layout/banner-ambiente";

// Título da aba só com o nome da página (sem o nome do portal do escritório)
export const metadata: Metadata = { title: { template: "%s", default: "Documento" } };

/**
 * Páginas que a empresa cliente manda aos clientes dela (orçamento da loja,
 * acompanhamento da ordem de serviço, confirmação do atendimento): só os
 * dados da empresa que enviou, sem o rodapé do escritório de contabilidade,
 * e impressão sempre em preto no branco.
 */
export default function LayoutPaginaDaEmpresa({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <BannerAmbiente />
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12 print:p-0 print:**:border-black/30 print:**:text-black">
        <div className="flex w-full justify-center animar-entrada">{children}</div>
      </main>
    </div>
  );
}
