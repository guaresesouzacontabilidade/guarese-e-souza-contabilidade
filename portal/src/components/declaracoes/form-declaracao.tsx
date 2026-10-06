"use client";

import * as React from "react";
import { FileSignature } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { emitirDeclaracao } from "@/lib/declaracoes/acoes";
import { lerValorBR, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia } from "@/lib/formatos";
import type { MesDeclaracao } from "@/lib/declaracoes/faturamento";

export interface PadroesDeclaracao {
  representante_nome: string;
  representante_cpf: string;
  representante_cargo: string;
  contador_nome: string;
  contador_crc: string;
  cidade: string;
  uf: string;
  data_declaracao: string;
  finalidade: string;
  observacao: string;
}

/** Valor com vírgula para o campo ("1234.5" → "1.234,50"). */
const paraCampo = (v: string) => formatarMoeda(v, { semSimbolo: true });

/**
 * Formulário da declaração: um campo por mês (já preenchido com o valor
 * sugerido), total ao vivo, representante legal, contador, local e data.
 */
export function FormDeclaracao({
  empresaId,
  periodo,
  meses,
  padroes,
}: {
  empresaId: string;
  periodo: { inicio: string; fim: string };
  meses: MesDeclaracao[];
  padroes: PadroesDeclaracao;
}) {
  const [valores, setValores] = React.useState(() => meses.map((m) => paraCampo(m.valor)));
  const [editados, setEditados] = React.useState<boolean[]>(() => meses.map(() => false));
  const total = valores.reduce((t, v) => t + (lerValorBR(v)?.toNumber() ?? 0), 0);
  const invalidos = valores.filter((v) => {
    const d = lerValorBR(v);
    return !d || d.isNegative();
  }).length;

  return (
    <FormularioAcao acao={emitirDeclaracao.bind(null, empresaId)} className="space-y-6" atualizarAoSucesso={false}>
      {({ estado, pendente }) => {
        const erro = (k: string) => estado.erros?.[k];
        return (
          <>
            <input type="hidden" name="periodo_inicio" value={periodo.inicio.slice(0, 7)} />
            <input type="hidden" name="periodo_fim" value={periodo.fim.slice(0, 7)} />
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-titulo">Faturamento de cada mês</legend>
              <p className="text-xs text-muted-foreground">
                Os valores vêm preenchidos pelas notas do portal (vendas e serviços, menos as devoluções) ou pela receita informada nos Cálculos.
                Confira e mude o que precisar.
              </p>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {meses.map((m, i) => {
                  const rotulo = formatarCompetencia(m.competencia, true);
                  return (
                    <div key={m.competencia}>
                      <input type="hidden" name="competencia" value={m.competencia.slice(0, 7)} />
                      <input type="hidden" name="origem" value={editados[i] ? "digitado" : m.origem} />
                      <Campo
                        rotulo={rotulo.charAt(0).toUpperCase() + rotulo.slice(1)}
                        htmlFor={`valor-${i}`}
                        erro={erro(`valor_${i}`)}
                        ajuda={editados[i] ? "valor digitado" : m.detalhe}
                      >
                        <Input
                          id={`valor-${i}`}
                          name="valor"
                          inputMode="decimal"
                          className="numero text-right"
                          value={valores[i]}
                          onChange={(e) => {
                            const novo = e.target.value;
                            setValores((v) => v.map((x, j) => (j === i ? novo : x)));
                            setEditados((v) => v.map((x, j) => (j === i ? true : x)));
                          }}
                        />
                      </Campo>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm">
                <span>
                  Total de {meses.length} {meses.length === 1 ? "mês" : "meses"}
                  {invalidos ? <span className="text-perigo"> · {invalidos} valor(es) a corrigir</span> : null}
                </span>
                <strong className="numero text-base">{formatarMoeda(total)}</strong>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold text-titulo">Representante legal da empresa</legend>
              <Campo rotulo="Nome" htmlFor="dec-rep-nome" erro={erro("representante_nome")} obrigatorio className="sm:col-span-3">
                <Input id="dec-rep-nome" name="representante_nome" defaultValue={padroes.representante_nome} maxLength={200} />
              </Campo>
              <Campo rotulo="CPF" htmlFor="dec-rep-cpf" erro={erro("representante_cpf")} ajuda="Opcional.">
                <Input id="dec-rep-cpf" name="representante_cpf" defaultValue={padroes.representante_cpf} inputMode="numeric" maxLength={14} />
              </Campo>
              <Campo rotulo="Cargo" htmlFor="dec-rep-cargo" className="sm:col-span-2">
                <Input id="dec-rep-cargo" name="representante_cargo" defaultValue={padroes.representante_cargo} maxLength={100} />
              </Campo>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold text-titulo">Contador responsável</legend>
              <Campo rotulo="Nome" htmlFor="dec-cont-nome" erro={erro("contador_nome")} obrigatorio className="sm:col-span-2">
                <Input id="dec-cont-nome" name="contador_nome" defaultValue={padroes.contador_nome} maxLength={200} />
              </Campo>
              <Campo rotulo="CRC" htmlFor="dec-cont-crc" erro={erro("contador_crc")} obrigatorio ajuda="Ex.: TO-012345/O-6">
                <Input id="dec-cont-crc" name="contador_crc" defaultValue={padroes.contador_crc} maxLength={40} />
              </Campo>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-4">
              <legend className="mb-2 text-sm font-semibold text-titulo">Local, data e finalidade</legend>
              <Campo rotulo="Cidade" htmlFor="dec-cidade" erro={erro("cidade")} obrigatorio className="sm:col-span-2">
                <Input id="dec-cidade" name="cidade" defaultValue={padroes.cidade} maxLength={100} />
              </Campo>
              <Campo rotulo="UF" htmlFor="dec-uf">
                <Input id="dec-uf" name="uf" defaultValue={padroes.uf} maxLength={2} />
              </Campo>
              <Campo rotulo="Data" htmlFor="dec-data" erro={erro("data_declaracao")} obrigatorio>
                <Input id="dec-data" name="data_declaracao" type="date" defaultValue={padroes.data_declaracao} />
              </Campo>
              <Campo
                rotulo="Finalidade"
                htmlFor="dec-finalidade"
                className="sm:col-span-4"
                ajuda="Opcional. Entra no texto como “Esta declaração destina-se a …”. Ex.: comprovação de faturamento junto a instituição financeira."
              >
                <Input id="dec-finalidade" name="finalidade" defaultValue={padroes.finalidade} maxLength={300} />
              </Campo>
              <Campo rotulo="Observação" htmlFor="dec-obs" className="sm:col-span-4" ajuda="Opcional. Sai em letra menor, antes das assinaturas.">
                <Textarea id="dec-obs" name="observacao" rows={2} defaultValue={padroes.observacao} maxLength={1000} />
              </Campo>
            </fieldset>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Depois de emitida, a declaração não muda: para corrigir, cancele e emita outra.</p>
              <BotaoEnviar pendente={pendente} textoPendente="Emitindo..." disabled={invalidos > 0}>
                <FileSignature /> Emitir declaração
              </BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}
