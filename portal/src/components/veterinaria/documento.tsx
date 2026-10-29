"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { emitirDocumento } from "@/lib/veterinaria/acoes";
import { TIPOS_DOCUMENTO } from "@/lib/veterinaria/rotulos";

export interface VacinacaoOpcao {
  id: string;
  rotulo: string;
}

/** Atestados e termos de consentimento (modelos da Res. CFMV nº 1.321/2020, com o conteúdo mínimo de cada um). */
export function FormularioDocumento({
  empresaId,
  pacienteId,
  atendimentoId,
  tipoInicial,
  vacinacoes,
  tutorSemDados,
  obito,
}: {
  empresaId: string;
  pacienteId: string;
  atendimentoId: string | null;
  tipoInicial: string;
  vacinacoes: VacinacaoOpcao[];
  tutorSemDados: string[];
  obito: boolean;
}) {
  const router = useRouter();
  const [tipo, setTipo] = React.useState(Object.hasOwn(TIPOS_DOCUMENTO, tipoInicial) ? tipoInicial : "atestado_sanitario");
  const def = TIPOS_DOCUMENTO[tipo];
  const grupos = ["Atestados", "Termos de consentimento"] as const;
  const termo = def.grupo === "Termos de consentimento";
  const permitidos = obito ? ["atestado_obito", "termo_retirada_corpo", "termo_doacao_corpo"] : null;

  return (
    <FormularioAcao
      acao={emitirDocumento.bind(null, empresaId)}
      aoSucesso={(r) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        if (id) router.push(`/e/${empresaId}/veterinaria/documentos/${id}`);
      }}
      atualizarAoSucesso={false}
      className="space-y-5"
    >
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="paciente_id" value={pacienteId} />
          <input type="hidden" name="atendimento_id" value={atendimentoId ?? ""} />
          <Campo rotulo="Documento" htmlFor="dc-tipo">
            <Select id="dc-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {grupos.map((g) => (
                <optgroup key={g} label={g}>
                  {Object.entries(TIPOS_DOCUMENTO)
                    .filter(([v, d]) => d.grupo === g && (!permitidos || permitidos.includes(v)))
                    .map(([v, d]) => (
                      <option key={v} value={v}>
                        {d.rotulo}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Campo>
          <p className="text-sm text-muted-foreground">{def.descricao}</p>
          {tutorSemDados.length ? (
            <Alerta tom="alerta">
              Falta no cadastro do tutor: {tutorSemDados.join(", ")}. Os documentos devem trazer o nome, o CPF e o endereço completo do responsável (Res. CFMV nº
              1.321/2020).
            </Alerta>
          ) : null}

          {tipo === "atestado_vacinacao" ? (
            <fieldset className="space-y-2 rounded-xl border border-border p-3">
              <legend className="px-1 text-sm font-medium">Vacinas do atestado (aplicadas na clínica)</legend>
              {vacinacoes.length ? (
                vacinacoes.map((v) => (
                  <label key={v.id} className="flex items-start gap-2 text-sm">
                    <Checkbox name="vacinacao" value={v.id} defaultChecked className="mt-0.5" /> {v.rotulo}
                  </label>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Este animal ainda não tem vacina aplicada na clínica.</p>
              )}
              {estado.erros?.vacinacao ? <p className="text-xs text-perigo">{estado.erros.vacinacao[0]}</p> : null}
            </fieldset>
          ) : null}

          {def.campos.map((c) => (
            <Campo key={c.nome} rotulo={c.rotulo} htmlFor={`dc-${c.nome}`} obrigatorio={c.obrigatorio} ajuda={c.ajuda} erro={estado.erros?.[c.nome]}>
              {c.tipo === "area" ? (
                <Textarea id={`dc-${c.nome}`} name={c.nome} rows={3} maxLength={2000} />
              ) : c.tipo === "datahora" ? (
                <Input id={`dc-${c.nome}`} name={c.nome} type="datetime-local" />
              ) : (
                <Input id={`dc-${c.nome}`} name={c.nome} maxLength={200} />
              )}
            </Campo>
          ))}
          <Campo rotulo="Observações do veterinário" htmlFor="dc-obs-vet">
            <Textarea id="dc-obs-vet" name="observacoes_veterinario" rows={2} maxLength={2000} />
          </Campo>
          {termo ? (
            <Campo rotulo="Observações do responsável" htmlFor="dc-obs-resp" ajuda="Também pode ser escrito à mão no papel, antes da assinatura.">
              <Textarea id="dc-obs-resp" name="observacoes_responsavel" rows={2} maxLength={2000} />
            </Campo>
          ) : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Emitindo...">
              Emitir documento
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
