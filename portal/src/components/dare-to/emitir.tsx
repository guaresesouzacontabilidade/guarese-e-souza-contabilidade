"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Copy, ExternalLink, FileCheck2, Landmark } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { emitirDareComplementacao } from "@/lib/dare-to/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";

export interface EmissaoDareTela {
  id: string;
  numero: string;
  total: number | string;
  vencimento: string;
  linha_digitavel: string | null;
  documento_id: string | null;
  gerado_por: string | null;
  created_at: string;
}

function CopiarLinha({ linha }: { linha: string }) {
  return (
    <Button
      type="button"
      variante="contorno"
      tamanho="sm"
      onClick={() =>
        navigator.clipboard.writeText(linha.replace(/\D/g, "")).then(
          () => toast.success("Código de barras copiado."),
          () => toast.error("Não foi possível copiar."),
        )
      }
    >
      <Copy /> Copiar o código de barras
    </Button>
  );
}

/**
 * DARE da complementação de alíquota (SEFAZ-TO, receita 105): o robô emite
 * com o valor conferido e o vencimento do dia 9 e publica o PDF na empresa.
 * Os motivos que impedem a emissão aparecem antes do botão.
 */
export function EmitirDareTo({
  empresaId,
  competencia,
  valor,
  vencimento,
  bloqueio,
  emissoes,
  conferida,
}: {
  empresaId: string;
  competencia: string;
  valor: string;
  vencimento: string;
  /** Por que o botão está desligado (null: pode emitir). */
  bloqueio: React.ReactNode | null;
  emissoes: EmissaoDareTela[];
  /** O valor vem da apuração conferida (senão, do cálculo de agora, só para referência). */
  conferida: boolean;
}) {
  const [ano, mes] = competencia.split("-");
  const jaTemIgual = emissoes.some((e) => Number(e.total).toFixed(2) === Number(valor).toFixed(2));
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Receita</dt>
          <dd className="font-medium">105 · Complementação de alíquota (Simples)</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Referência</dt>
          <dd className="font-medium">
            {mes}/{ano}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Vencimento</dt>
          <dd className="font-medium">{formatarData(vencimento)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{conferida ? "Valor (apuração conferida)" : "Valor (calculado agora, sem conferência)"}</dt>
          <dd className="numero font-semibold">{formatarMoeda(valor)}</dd>
        </div>
      </dl>

      {emissoes.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {emissoes.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="font-medium">DARE nº {e.numero}</span> · {formatarMoeda(e.total)} · vence {formatarData(e.vencimento)}
                <span className="block text-xs text-muted-foreground">
                  Emitido em {formatarDataHora(e.created_at)}
                  {e.gerado_por ? ` por ${e.gerado_por}` : ""}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {e.linha_digitavel ? <CopiarLinha linha={e.linha_digitavel} /> : null}
                {e.documento_id ? (
                  <Button asChild variante="contorno" tamanho="sm">
                    <Link href={`/e/${empresaId}/documentos/${e.documento_id}`}>
                      <FileCheck2 /> Abrir a guia
                    </Link>
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <FormularioAcao acao={emitirDareComplementacao.bind(null, empresaId, competencia)} className="space-y-3">
        {({ estado, pendente }) => {
          const d = estado.ok ? (estado.dados as Awaited<ReturnType<typeof emitirDareComplementacao>>["dados"]) : undefined;
          return (
            <>
              {d ? (
                <Alerta tom="sucesso" titulo={`DARE nº ${d.numero} emitido: ${formatarMoeda(d.total)}`}>
                  O PDF oficial da SEFAZ-TO já está na agenda de pagamentos da empresa, com vencimento em {formatarData(d.vencimento)}.
                </Alerta>
              ) : null}
              {bloqueio ? <Alerta tom="info">{bloqueio}</Alerta> : null}
              {jaTemIgual && !bloqueio ? (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="novamente" value="1" className="mt-0.5" />
                  <span>Emitir outro DARE (já existe um deste mês com este valor)</span>
                </label>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button asChild variante="fantasma" tamanho="sm">
                  <a href="https://www.sefaz.to.gov.br/dare/servlet/hnetccwkda" target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Emitir pelo site da SEFAZ-TO
                  </a>
                </Button>
                <BotaoEnviar pendente={pendente} textoPendente="Emitindo na SEFAZ-TO..." disabled={Boolean(bloqueio)}>
                  <Landmark /> Emitir o DARE e publicar
                </BotaoEnviar>
              </div>
            </>
          );
        }}
      </FormularioAcao>
    </div>
  );
}
