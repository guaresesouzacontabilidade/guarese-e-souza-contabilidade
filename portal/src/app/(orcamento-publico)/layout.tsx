import { BannerAmbiente } from "@/components/layout/banner-ambiente";

/**
 * Orçamento da loja aberto pelo cliente da loja (link do WhatsApp): só os
 * dados da loja que fez o orçamento — sem o rodapé do escritório de
 * contabilidade — e impressão sempre em preto no branco.
 */
export default function LayoutOrcamentoPublico({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <BannerAmbiente />
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12 print:p-0 print:**:border-black/30 print:**:text-black">
        {children}
      </main>
    </div>
  );
}
