"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Calculator, Copy, FileCheck2, Landmark } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input } from "@/components/ui/form";
import { acaoDarIcms } from "@/lib/dar-mt/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

function CopiarLinha({ linha }: { linha: string }) {
  return (
    <Button
      type="button"
      variante="contorno"
      tamanho="sm"
      onClick={() => {
        navigator.clipboard.writeText(linha.replace(/\D/g, "")).then(
          () => toast.success("Código de barras copiado."),
          () => toast.error("Não foi possível copiar."),
        );
      }}
    >
      <Copy /> Copiar o código de barras
    </Button>
  );
}

const mesTexto = (aaaaMm: string) => `${aaaaMm.slice(5, 7)}/${aaaaMm.slice(0, 4)}`;

/**
 * DAR do ICMS do mês na SEFAZ-MT: a equipe confere o valor e as datas, vê a
 * multa e os juros calculados e só então pede ao robô para gerar e publicar.
 */
export function FormDarIcms({
  empresaId,
  competencia,
  valor,
  vencimento,
  pagamento,
  hoje,
  fimDoMes,
  disponivel,
  temVigente,
}: {
  empresaId: string;
  competencia: string;
  valor: string;
  vencimento: string | null;
  pagamento: string;
  hoje: string;
  fimDoMes: string;
  disponivel: boolean;
  temVigente: boolean;
}) {
  return (
    <FormularioAcao acao={acaoDarIcms.bind(null, empresaId, competencia)} className="space-y-4">
      {({ estado, pendente }) => {
        const d = estado.ok ? (estado.dados as Awaited<ReturnType<typeof acaoDarIcms>>["dados"]) : undefined;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Campo rotulo="ICMS a recolher" htmlFor="dar-valor" erro={estado.erros?.valor} ajuda="Valor do E116 da EFD do mês.">
                <Input id="dar-valor" name="valor" inputMode="decimal" defaultValue={valor} />
              </Campo>
              <Campo rotulo="Vencimento do ICMS" htmlFor="dar-venc" erro={estado.erros?.vencimento} ajuda="Fim de semana e feriado passam para o dia útil seguinte.">
                <Input id="dar-venc" name="vencimento" type="date" defaultValue={vencimento ?? ""} />
              </Campo>
              <Campo rotulo="Pagar até" htmlFor="dar-pag" erro={estado.erros?.pagamento} ajuda="A guia vale só até o fim deste mês.">
                <Input id="dar-pag" name="pagamento" type="date" defaultValue={pagamento} min={hoje} max={fimDoMes} />
              </Campo>
            </div>

            {d?.etapa === "previa" ? (
              <div className="rounded-lg border border-border p-3 text-sm">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  <dt>Principal (ICMS do mês)</dt>
                  <dd className="numero text-right">{formatarMoeda(d.principal)}</dd>
                  <dt>
                    Multa de mora
                    <span className="block text-xs text-muted-foreground">
                      {d.diasAtraso
                        ? `${d.diasAtraso} ${d.diasAtraso === 1 ? "dia" : "dias"} de atraso desde ${formatarData(d.vencimentoImposto)} × 0,333% (até 20%): ${Number(d.multaPercentual).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`
                        : "Em dia: sem multa"}
                    </span>
                  </dt>
                  <dd className="numero text-right">{formatarMoeda(d.multa)}</dd>
                  <dt>
                    Juros de mora
                    <span className="block text-xs text-muted-foreground">
                      {Number(d.jurosPercentual) > 0
                        ? `${d.mesesSelic.length ? `SELIC de ${d.mesesSelic.map(mesTexto).join(", ")} + ` : ""}1% do mês do pagamento: ${Number(d.jurosPercentual).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                        : "Sem juros (pago no mês do vencimento)"}
                    </span>
                  </dt>
                  <dd className="numero text-right">{formatarMoeda(d.juros)}</dd>
                  <dt className="font-semibold">Total do DAR (pagar até {formatarData(d.pagamento)})</dt>
                  <dd className="numero text-right font-semibold">{formatarMoeda(d.total)}</dd>
                </dl>
              </div>
            ) : null}

            {d?.etapa === "gerado" ? (
              <Alerta tom="sucesso" titulo={`DAR nº ${d.numero} gerado: ${formatarMoeda(d.total)}`}>
                <div className="space-y-2">
                  <p>O PDF oficial da SEFAZ-MT já está na agenda de pagamentos da empresa, com o “paguei”.</p>
                  {d.linhaDigitavel ? <p className="numero break-all text-xs">{d.linhaDigitavel}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {d.linhaDigitavel ? <CopiarLinha linha={d.linhaDigitavel} /> : null}
                    {d.documentoId ? (
                      <Button asChild variante="contorno" tamanho="sm">
                        <Link href={`/e/${empresaId}/documentos/${d.documentoId}`}>
                          <FileCheck2 /> Abrir a guia
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Alerta>
            ) : null}

            {temVigente && d?.etapa === "previa" ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="novamente" value="1" className="mt-0.5" />
                <span>Gerar outro DAR (já existe um DAR deste mês ainda válido)</span>
              </label>
            ) : null}

            {!disponivel ? (
              <p className="text-xs text-muted-foreground">Na demonstração o robô não acessa a SEFAZ-MT: a prévia funciona, a geração só no portal oficial.</p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <BotaoEnviar pendente={pendente} name="etapa" value="calcular" variante="secundario" textoPendente="Calculando...">
                <Calculator /> {d?.etapa === "previa" ? "Calcular de novo" : "Calcular multa e juros"}
              </BotaoEnviar>
              {d?.etapa === "previa" ? (
                <BotaoEnviar pendente={pendente} name="etapa" value="gerar" textoPendente="Gerando na SEFAZ-MT..." disabled={!disponivel}>
                  <Landmark /> Gerar o DAR na SEFAZ-MT e publicar
                </BotaoEnviar>
              ) : null}
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}
