"use client";

import { useState } from "react";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { lancarAjuste } from "@/lib/relatorios/acoes-modelo-dre";

/** Novo ajuste no resultado: conta, mês, valor (aumenta ou estorna) e motivo. */
export function FormularioAjuste({
  empresaId,
  contas,
  mesInicial,
}: {
  empresaId: string;
  contas: { id: string; rotulo: string; natureza: "receita" | "despesa" }[];
  mesInicial: string;
}) {
  const [conta, setConta] = useState("");
  const [chave, setChave] = useState(0);
  const natureza = contas.find((c) => c.id === conta)?.natureza;
  return (
    <FormularioAcao
      key={chave}
      acao={lancarAjuste.bind(null, empresaId)}
      aoSucesso={() => {
        setConta("");
        setChave((k) => k + 1);
      }}
      className="space-y-4"
    >
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Conta" htmlFor="aj-conta" obrigatorio erro={estado.erros?.categoria_id}>
            <Select id="aj-conta" name="categoria_id" value={conta} onChange={(e) => setConta(e.target.value)}>
              <option value="">Selecione...</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Campo rotulo="Mês" htmlFor="aj-mes" obrigatorio erro={estado.erros?.competencia}>
              <Input id="aj-mes" name="competencia" type="month" defaultValue={mesInicial} />
            </Campo>
            <Campo rotulo="Valor" htmlFor="aj-valor" obrigatorio erro={estado.erros?.valor}>
              <CampoValor id="aj-valor" name="valor" />
            </Campo>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">O ajuste</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="sentido" value="aumenta" defaultChecked className="accent-[var(--primary)]" />
              {natureza === "receita" ? "Aumenta a receita" : "Aumenta a despesa (ex.: depreciação)"}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="sentido" value="diminui" className="accent-[var(--primary)]" />
              {natureza === "receita" ? "Diminui a receita (estorno)" : "Diminui a despesa (estorno de ajuste)"}
            </label>
          </fieldset>
          <Campo rotulo="Motivo" htmlFor="aj-motivo" obrigatorio erro={estado.erros?.motivo} ajuda="Aparece no DRE ao clicar na linha e fica no histórico.">
            <Textarea id="aj-motivo" name="motivo" rows={2} maxLength={500} placeholder="Ex.: Depreciação dos equipamentos de novembro" />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Lançar ajuste</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
