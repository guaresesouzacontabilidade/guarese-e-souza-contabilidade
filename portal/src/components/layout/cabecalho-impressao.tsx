/* eslint-disable @next/next/no-img-element */
import { formatarDocumento } from "@/lib/formatos";

/**
 * Cabeçalho que só aparece na impressão das telas da empresa: logo do
 * escritório à esquerda e a da empresa cliente à direita, com a razão social e
 * o CNPJ. Na tela fica escondido.
 */
export function CabecalhoImpressao({
  logoEscritorioUrl,
  empresa,
}: {
  logoEscritorioUrl: string | null;
  empresa: { id: string; razao_social: string; documento: string; logo_path: string | null; logo_atualizado_em: string | null };
}) {
  const versao = empresa.logo_atualizado_em ? `?v=${encodeURIComponent(empresa.logo_atualizado_em)}` : "";
  return (
    <div className="mb-5 hidden items-center justify-between gap-6 border-b border-black/20 pb-3 text-black print:flex">
      <img src={logoEscritorioUrl ?? "/marca/logo-horizontal.svg"} alt="Guarese's ON Contabilidade" className="h-11 w-auto max-w-[220px] object-contain" />
      <div className="flex items-center gap-3 text-right">
        <div>
          <p className="text-sm font-semibold">{empresa.razao_social}</p>
          <p className="text-xs">{formatarDocumento(empresa.documento)}</p>
        </div>
        {empresa.logo_path ? (
          <img src={`/api/empresas/${empresa.id}/logo${versao}`} alt={`Logo de ${empresa.razao_social}`} className="h-12 w-auto max-w-[180px] object-contain" />
        ) : null}
      </div>
    </div>
  );
}
