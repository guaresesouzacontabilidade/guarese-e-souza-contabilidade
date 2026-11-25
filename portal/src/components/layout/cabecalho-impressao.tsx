/* eslint-disable @next/next/no-img-element */
import { formatarDocumento } from "@/lib/formatos";

/**
 * Cabeçalho que só aparece na impressão das telas da empresa. O documento é da
 * própria empresa: vai só a marca dela (logo, razão social e CNPJ), sem a do
 * escritório. Na tela fica escondido.
 */
export function CabecalhoImpressao({
  empresa,
}: {
  empresa: { id: string; razao_social: string; documento: string; logo_path: string | null; logo_atualizado_em: string | null };
}) {
  const versao = empresa.logo_atualizado_em ? `?v=${encodeURIComponent(empresa.logo_atualizado_em)}` : "";
  return (
    <div data-testid="cabecalho-impressao" className="mb-5 hidden items-center justify-between gap-6 border-b border-black/20 pb-3 text-black print:flex">
      {empresa.logo_path ? (
        <img src={`/api/empresas/${empresa.id}/logo${versao}`} alt={`Logo de ${empresa.razao_social}`} className="h-12 w-auto max-w-[220px] object-contain" />
      ) : (
        <p className="text-base font-semibold">{empresa.razao_social}</p>
      )}
      <div className="text-right">
        {empresa.logo_path ? <p className="text-sm font-semibold">{empresa.razao_social}</p> : null}
        <p className="text-xs">{formatarDocumento(empresa.documento)}</p>
      </div>
    </div>
  );
}
