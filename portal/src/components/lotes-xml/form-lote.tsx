"use client";

import { FileArchive } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Select } from "@/components/ui/form";
import type { ResultadoAcao } from "@/lib/acoes";
import { AJUDA_TIPO_LOTE, ROTULO_TIPO_LOTE, TIPOS_LOTE } from "@/lib/lotes-xml/rotulos";

/** Pedido do lote de XML: mês de emissão e tipos de nota. */
export function FormLoteXml({
  acao,
  meses,
  padrao,
  textoBotao,
}: {
  acao: (anterior: ResultadoAcao, fd: FormData) => Promise<ResultadoAcao>;
  meses: { valor: string; rotulo: string }[];
  padrao: string;
  textoBotao: string;
}) {
  return (
    <FormularioAcao acao={acao} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Mês de emissão das notas" htmlFor="lote-competencia" erro={estado.erros?.competencia} obrigatorio>
            <Select id="lote-competencia" name="competencia" defaultValue={padrao} className="max-w-60">
              {meses.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Tipos de nota</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {TIPOS_LOTE.map((t) => (
                <label key={t} className="flex items-start gap-2 text-sm">
                  <Checkbox name="tipos" value={t} defaultChecked className="mt-0.5" />
                  <span>
                    <span className="font-medium">{ROTULO_TIPO_LOTE[t]}</span>{" "}
                    <span className="text-xs text-muted-foreground">({AJUDA_TIPO_LOTE[t]})</span>
                  </span>
                </label>
              ))}
            </div>
            {estado.erros?.tipos ? <p className="mt-1 text-xs text-perigo">{estado.erros.tipos[0]}</p> : null}
          </fieldset>
          <BotaoEnviar pendente={pendente} textoPendente="Pedindo...">
            <FileArchive /> {textoBotao}
          </BotaoEnviar>
        </>
      )}
    </FormularioAcao>
  );
}
