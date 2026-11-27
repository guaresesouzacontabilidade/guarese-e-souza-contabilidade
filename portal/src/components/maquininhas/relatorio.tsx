"use client";

import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { BotaoAcao } from "@/components/ui/acao";
import { excluirRelatorio, reimportarRelatorio } from "@/lib/maquininhas/acoes";

/** Importar de novo e excluir um relatório (depois de excluir, volta às maquininhas). */
export function AcoesRelatorio({
  empresaId,
  importacaoId,
  reimportar,
  excluir,
}: {
  empresaId: string;
  importacaoId: string;
  reimportar: boolean;
  excluir: boolean;
}) {
  const router = useRouter();
  return (
    <>
      {reimportar ? (
        <BotaoAcao variante="contorno" tamanho="sm" acao={() => reimportarRelatorio(empresaId, importacaoId)}>
          <RefreshCw /> Importar de novo
        </BotaoAcao>
      ) : null}
      {excluir ? (
        <BotaoAcao
          variante="fantasma"
          tamanho="sm"
          acao={() => excluirRelatorio(empresaId, importacaoId)}
          aoSucesso={() => router.push(`/e/${empresaId}/maquininhas`)}
          confirmar={{
            titulo: "Tirar este relatório da conferência?",
            descricao: "As vendas que vieram só deste relatório saem da conferência. O arquivo continua em Documentos.",
            textoConfirmar: "Tirar da conferência",
            perigo: true,
          }}
        >
          <Trash2 /> Excluir
        </BotaoAcao>
      ) : null}
    </>
  );
}
