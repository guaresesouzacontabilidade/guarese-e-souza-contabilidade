"use client";

import * as React from "react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { salvarFicha } from "@/lib/honorarios/acoes";
import { INDICES_REAJUSTE, SERVICOS_HONORARIOS } from "@/lib/honorarios/comum";
import { nomeMes } from "@/lib/formatos";

export interface FichaForm {
  id: string | null;
  empresa_id: string;
  situacao: string;
  valor_mensal: number | null;
  dia_vencimento: number;
  inicio: string;
  fim: string | null;
  servicos: string[];
  funcionarios_inclusos: number | null;
  valor_funcionario_extra: number | null;
  notas_inclusas: number | null;
  valor_nota_extra: number | null;
  decimo_terceiro: boolean;
  decimo_terceiro_mes: number;
  reajuste_indice: string;
  reajuste_mes: number | null;
  contato_nome: string | null;
  contato_email: string | null;
  contato_whatsapp: string | null;
  whatsapp_autorizado: boolean;
  canal_email: boolean;
  canal_whatsapp: boolean;
  robo_pausado_ate: string | null;
  observacao: string | null;
}

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);

export function FormularioFicha({ ficha, empresaNome }: { ficha: FichaForm; empresaNome: string }) {
  const [extrasFunc, setExtrasFunc] = React.useState(ficha.funcionarios_inclusos !== null);
  const [extrasNotas, setExtrasNotas] = React.useState(ficha.notas_inclusas !== null);
  return (
    <FormularioAcao acao={salvarFicha} manterAoErrar className="space-y-6">
      {({ estado, pendente }) => (
        <>
          {ficha.id ? <input type="hidden" name="id" value={ficha.id} /> : null}
          <input type="hidden" name="empresa_id" value={ficha.empresa_id} />

          <section className="space-y-4">
            <h2 className="font-semibold">Valor e vencimento — {empresaNome}</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Honorário mensal" htmlFor="ficha-valor" erro={estado.erros?.valor_mensal} obrigatorio>
                <CampoValor id="ficha-valor" name="valor_mensal" valorInicial={ficha.valor_mensal} />
              </Campo>
              <Campo rotulo="Dia do vencimento" htmlFor="ficha-dia" erro={estado.erros?.dia_vencimento} obrigatorio>
                <Select id="ficha-dia" name="dia_vencimento" defaultValue={String(ficha.dia_vencimento)}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Dia {d}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Situação" htmlFor="ficha-situacao">
                <Select id="ficha-situacao" name="situacao" defaultValue={ficha.situacao}>
                  <option value="ativa">Ativa (gera a cobrança todo mês)</option>
                  <option value="pausada">Pausada (não gera)</option>
                  <option value="encerrada">Encerrada (cliente saiu)</option>
                </Select>
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Cobrar a partir do mês (referência)" htmlFor="ficha-inicio" erro={estado.erros?.inicio} obrigatorio ajuda="O primeiro mês de serviço cobrado.">
                <Input id="ficha-inicio" name="inicio" type="month" defaultValue={ficha.inicio.slice(0, 7)} />
              </Campo>
              <Campo rotulo="Até o mês (opcional)" htmlFor="ficha-fim" erro={estado.erros?.fim} ajuda="Deixe vazio enquanto o contrato valer.">
                <Input id="ficha-fim" name="fim" type="month" defaultValue={ficha.fim?.slice(0, 7) ?? ""} />
              </Campo>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Serviços incluídos</h2>
            <div className="grid gap-2 sm:grid-cols-4">
              {Object.entries(SERVICOS_HONORARIOS).map(([chave, rotulo]) => (
                <label key={chave} className="flex items-center gap-2 text-sm">
                  <Checkbox name="servicos" value={chave} defaultChecked={ficha.servicos.includes(chave)} /> {rotulo}
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Extras automáticos</h2>
            <p className="text-sm text-muted-foreground">O portal conta os funcionários e as notas do mês da empresa e cobra o que passar do limite.</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={extrasFunc} onChange={(e) => setExtrasFunc(e.target.checked)} /> Cobrar funcionário acima do limite
            </label>
            {extrasFunc ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Funcionários incluídos no honorário" htmlFor="ficha-func">
                  <Input id="ficha-func" name="funcionarios_inclusos" inputMode="numeric" defaultValue={ficha.funcionarios_inclusos ?? ""} />
                </Campo>
                <Campo rotulo="Valor por funcionário a mais" htmlFor="ficha-func-valor" erro={estado.erros?.valor_funcionario_extra}>
                  <CampoValor id="ficha-func-valor" name="valor_funcionario_extra" valorInicial={ficha.valor_funcionario_extra} />
                </Campo>
              </div>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={extrasNotas} onChange={(e) => setExtrasNotas(e.target.checked)} /> Cobrar notas fiscais acima do limite (entrada e saída)
            </label>
            {extrasNotas ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Notas incluídas por mês" htmlFor="ficha-notas">
                  <Input id="ficha-notas" name="notas_inclusas" inputMode="numeric" defaultValue={ficha.notas_inclusas ?? ""} />
                </Campo>
                <Campo rotulo="Valor por nota a mais" htmlFor="ficha-notas-valor" erro={estado.erros?.valor_nota_extra}>
                  <CampoValor id="ficha-notas-valor" name="valor_nota_extra" valorInicial={ficha.valor_nota_extra} />
                </Campo>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="decimo_terceiro" defaultChecked={ficha.decimo_terceiro} /> Cobrar 13º honorário
              </label>
              <Campo rotulo="Mês do 13º (vencimento)" htmlFor="ficha-13">
                <Select id="ficha-13" name="decimo_terceiro_mes" defaultValue={String(ficha.decimo_terceiro_mes)}>
                  {MESES.map((m) => (
                    <option key={m} value={m}>
                      {nomeMes(m)}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Reajuste anual" htmlFor="ficha-reajuste" ajuda="Guardado para o aviso de reajuste.">
                <Select id="ficha-reajuste" name="reajuste_indice" defaultValue={ficha.reajuste_indice}>
                  {Object.entries(INDICES_REAJUSTE).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Mês do reajuste" htmlFor="ficha-reajuste-mes">
                <Select id="ficha-reajuste-mes" name="reajuste_mes" defaultValue={ficha.reajuste_mes ? String(ficha.reajuste_mes) : ""}>
                  <option value="">—</option>
                  {MESES.map((m) => (
                    <option key={m} value={m}>
                      {nomeMes(m)}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Para quem mandar as cobranças</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Nome do contato" htmlFor="ficha-contato">
                <Input id="ficha-contato" name="contato_nome" maxLength={120} defaultValue={ficha.contato_nome ?? ""} placeholder="Ex.: Maria (financeiro)" />
              </Campo>
              <Campo rotulo="E-mail" htmlFor="ficha-email" erro={estado.erros?.contato_email}>
                <Input id="ficha-email" name="contato_email" type="email" defaultValue={ficha.contato_email ?? ""} />
              </Campo>
              <Campo rotulo="WhatsApp" htmlFor="ficha-zap" erro={estado.erros?.contato_whatsapp}>
                <Input id="ficha-zap" name="contato_whatsapp" inputMode="tel" defaultValue={ficha.contato_whatsapp?.replace(/^55/, "") ?? ""} placeholder="(63) 99999-0000" />
              </Campo>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="whatsapp_autorizado" defaultChecked={ficha.whatsapp_autorizado} />
              <span>O cliente autorizou receber cobranças por WhatsApp neste número (exigência do WhatsApp).</span>
            </label>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="canal_email" defaultChecked={ficha.canal_email} /> Mandar por e-mail
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="canal_whatsapp" defaultChecked={ficha.canal_whatsapp} /> Mandar por WhatsApp
              </label>
            </div>
            <Campo rotulo="Pausar os lembretes até (opcional)" htmlFor="ficha-pausa" ajuda="Ex.: cliente negociando. As cobranças continuam sendo geradas.">
              <Input id="ficha-pausa" name="robo_pausado_ate" type="date" defaultValue={ficha.robo_pausado_ate ?? ""} className="max-w-48" />
            </Campo>
          </section>

          <Campo rotulo="Observações internas" htmlFor="ficha-obs">
            <Textarea id="ficha-obs" name="observacao" rows={3} maxLength={1000} defaultValue={ficha.observacao ?? ""} />
          </Campo>
          {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar ficha</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
