"use client";

import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { BotaoAcao } from "@/components/ui/acao";
import { conferirSpedDeNovo, excluirSped } from "@/lib/sped/acoes";

/** Conferir de novo (depois que chegaram XML) e tirar o arquivo da conferência. */
export function AcoesSped({ empresaId, arquivoId, conferir }: { empresaId: string; arquivoId: string; conferir: boolean }) {
  const router = useRouter();
  return (
    <>
      {conferir ? (
        <BotaoAcao variante="contorno" tamanho="sm" acao={() => conferirSpedDeNovo(empresaId, arquivoId)}>
          <RefreshCw /> Conferir de novo
        </BotaoAcao>
      ) : null}
      <BotaoAcao
        variante="fantasma"
        tamanho="sm"
        acao={() => excluirSped(empresaId, arquivoId)}
        aoSucesso={() => router.push(`/e/${empresaId}/auditor-fiscal/sped`)}
        confirmar={{
          titulo: "Tirar este arquivo da conferência?",
          descricao: "A conferência deste arquivo é apagada. O arquivo continua em Documentos; se houver um anterior do mesmo período, ele volta a valer.",
          textoConfirmar: "Tirar da conferência",
          perigo: true,
        }}
      >
        <Trash2 /> Excluir
      </BotaoAcao>
    </>
  );
}
