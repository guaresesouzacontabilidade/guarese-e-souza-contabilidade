"use client";

import { useState } from "react";
import { FilePlus2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Campo, Checkbox, Input, Label, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { proporRegraIcms, salvarIcmsUf } from "@/lib/obrigacoes/icms-acoes";
import {
  AJUSTES_PRAZO,
  SITUACAO_ALIQUOTA,
  SITUACAO_VENCIMENTO,
  aliquotaInterestadual,
  diferencialAliquotas,
  textoAliquota,
  type SituacaoAliquota,
} from "@/lib/fiscal/icms-estados";

export interface EstadoIcms {
  uf: string;
  nome: string;
  aliquota_interna: number | null;
  fcp: number | null;
  fcp_observacao: string | null;
  aliquota_situacao: string;
  aliquota_vigencia: string | null;
  aliquota_base_legal: string | null;
  aliquota_fonte_url: string | null;
  aliquota_observacao: string | null;
  vencimento_situacao: string;
  vencimento_dia: number | null;
  vencimento_ajuste: string | null;
  vencimento_base_legal: string | null;
  vencimento_fonte_url: string | null;
  vencimento_observacao: string | null;
  conferido_em: string;
}

const numeroBR = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

/** Consulta rápida: alíquota interestadual e diferencial de alíquotas entre dois estados. */
export function SimuladorIcms({ estados, origemInicial }: { estados: EstadoIcms[]; origemInicial: string }) {
  const [origem, setOrigem] = useState(origemInicial);
  const [destino, setDestino] = useState(origemInicial === "SP" ? "TO" : "SP");
  const [importado, setImportado] = useState(false);
  const porUf = new Map(estados.map((e) => [e.uf, e]));
  const inter = aliquotaInterestadual(origem, destino, importado);
  const dest = porUf.get(destino);
  const orig = porUf.get(origem);
  const internaDestino = dest?.aliquota_interna ?? null;
  const difal = inter !== null && internaDestino !== null ? diferencialAliquotas(internaDestino, dest?.fcp ?? null, inter) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold text-titulo">Consulta entre estados</h2>
      <p className="mb-4 text-sm text-muted-foreground">Escolha de onde sai e para onde vai a mercadoria.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Estado de origem" htmlFor="sim-origem">
          <Select id="sim-origem" value={origem} onChange={(e) => setOrigem(e.target.value)}>
            {estados.map((e) => (
              <option key={e.uf} value={e.uf}>
                {e.uf} — {e.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Estado de destino" htmlFor="sim-destino">
          <Select id="sim-destino" value={destino} onChange={(e) => setDestino(e.target.value)}>
            {estados.map((e) => (
              <option key={e.uf} value={e.uf}>
                {e.uf} — {e.nome}
              </option>
            ))}
          </Select>
        </Campo>
        <div className="flex items-end pb-2">
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Checkbox checked={importado} onChange={(e) => setImportado(e.target.checked)} />
            Mercadoria importada (origem 1, 2, 3 ou 8)
          </Label>
        </div>
      </div>
      <div id="sim-resultado" className="mt-4 grid gap-3 sm:grid-cols-3" aria-live="polite">
        {inter === null ? (
          <div className="rounded-lg bg-muted/50 p-3 sm:col-span-3">
            <p className="text-sm font-medium">Operação interna em {origem}</p>
            <p className="text-sm text-muted-foreground">
              Alíquota interna geral: <strong className="numero">{textoAliquota(orig?.aliquota_interna)}</strong>
              {orig?.fcp ? ` + ${textoAliquota(orig.fcp)} de fundo de pobreza` : ""}
              {orig && orig.aliquota_situacao !== "conferida" ? ` (${SITUACAO_ALIQUOTA[orig.aliquota_situacao as SituacaoAliquota]?.rotulo.toLowerCase()})` : ""}. Produtos com alíquota própria ou redução seguem a regra deles.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Alíquota interestadual</p>
              <p className="text-2xl font-semibold text-titulo numero">{textoAliquota(inter)}</p>
              <p className="text-xs text-muted-foreground">
                {importado ? "Resolução do Senado nº 13/2012" : "Resolução do Senado nº 22/1989"}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Interna geral do destino ({destino})</p>
              <p className="text-2xl font-semibold text-titulo numero">
                {textoAliquota(internaDestino)}
                {dest?.fcp ? <span className="text-base font-medium"> + {textoAliquota(dest.fcp)}</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {dest ? SITUACAO_ALIQUOTA[dest.aliquota_situacao as SituacaoAliquota]?.rotulo : ""}
                {dest?.fcp ? " · com fundo de pobreza" : ""}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Diferencial de alíquotas (DIFAL)</p>
              <p className="text-2xl font-semibold text-titulo numero">{difal === null ? "—" : `${textoAliquota(difal)}`}</p>
              <p className="text-xs text-muted-foreground">Interna do destino menos a interestadual, na compra para uso e consumo ou venda a consumidor final.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Formulário do administrador para completar ou atualizar os dados de um estado. */
export function EditarIcmsUf({ estado, hoje }: { estado: EstadoIcms; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  const [vencSituacao, setVencSituacao] = useState(estado.vencimento_situacao);
  return (
    <>
      <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar ${estado.nome}`} onClick={() => setAberto(true)}>
        <Pencil />
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto ? (
          <DialogContent
            largura="lg"
            titulo={`ICMS de ${estado.nome} (${estado.uf})`}
            descricao="Preencha com base na lei e no regulamento do estado, sempre com a fonte. Prazo conferido não vira tarefa sozinho: depois de salvar, use 'Propor regra' e valide em Atualizações normativas."
          >
            <FormularioAcao acao={salvarIcmsUf} aoSucesso={() => setAberto(false)}>
              {({ estado: e, pendente }) => (
                <div className="space-y-5">
                  <input type="hidden" name="uf" value={estado.uf} />
                  <fieldset className="grid gap-4 sm:grid-cols-3">
                    <legend className="mb-2 text-sm font-semibold text-titulo sm:col-span-3">Alíquota interna geral</legend>
                    <Campo rotulo="Alíquota (%)" htmlFor="aliquota_interna" erro={e.erros?.aliquota_interna}>
                      <Input id="aliquota_interna" name="aliquota_interna" inputMode="decimal" defaultValue={numeroBR(estado.aliquota_interna)} placeholder="Ex.: 20,5" />
                    </Campo>
                    <Campo rotulo="Fundo de pobreza geral (%)" htmlFor="fcp" erro={e.erros?.fcp} ajuda="Só se incidir sobre as operações em geral.">
                      <Input id="fcp" name="fcp" inputMode="decimal" defaultValue={numeroBR(estado.fcp)} placeholder="Ex.: 2" />
                    </Campo>
                    <Campo rotulo="Situação" htmlFor="aliquota_situacao" erro={e.erros?.aliquota_situacao}>
                      <Select id="aliquota_situacao" name="aliquota_situacao" defaultValue={estado.aliquota_situacao}>
                        {Object.entries(SITUACAO_ALIQUOTA).map(([v, s]) => (
                          <option key={v} value={v}>
                            {s.rotulo}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                    <Campo rotulo="Lei e artigo" htmlFor="aliquota_base_legal" erro={e.erros?.aliquota_base_legal} className="sm:col-span-2">
                      <Input id="aliquota_base_legal" name="aliquota_base_legal" defaultValue={estado.aliquota_base_legal ?? ""} placeholder="Ex.: Lei nº 1.287/2001, art. 27, II" />
                    </Campo>
                    <Campo rotulo="Vale desde" htmlFor="aliquota_vigencia" erro={e.erros?.aliquota_vigencia}>
                      <Input id="aliquota_vigencia" name="aliquota_vigencia" type="date" defaultValue={estado.aliquota_vigencia ?? ""} />
                    </Campo>
                    <Campo rotulo="Link da fonte oficial" htmlFor="aliquota_fonte_url" erro={e.erros?.aliquota_fonte_url} className="sm:col-span-3">
                      <Input id="aliquota_fonte_url" name="aliquota_fonte_url" type="url" defaultValue={estado.aliquota_fonte_url ?? ""} placeholder="https://" />
                    </Campo>
                    <Campo rotulo="Observação da alíquota" htmlFor="aliquota_observacao" className="sm:col-span-3">
                      <Textarea id="aliquota_observacao" name="aliquota_observacao" rows={2} defaultValue={estado.aliquota_observacao ?? ""} />
                    </Campo>
                    <Campo rotulo="Observação do fundo de pobreza" htmlFor="fcp_observacao" className="sm:col-span-3">
                      <Input id="fcp_observacao" name="fcp_observacao" defaultValue={estado.fcp_observacao ?? ""} />
                    </Campo>
                  </fieldset>

                  <fieldset className="grid gap-4 sm:grid-cols-3">
                    <legend className="mb-2 text-sm font-semibold text-titulo sm:col-span-3">Vencimento do ICMS apurado (regime normal)</legend>
                    <Campo rotulo="Situação" htmlFor="vencimento_situacao" erro={e.erros?.vencimento_situacao}>
                      <Select id="vencimento_situacao" name="vencimento_situacao" value={vencSituacao} onChange={(ev) => setVencSituacao(ev.target.value)}>
                        {Object.entries(SITUACAO_VENCIMENTO).map(([v, s]) => (
                          <option key={v} value={v}>
                            {s.rotulo}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                    {vencSituacao === "conferido" ? (
                      <>
                        <Campo rotulo="Dia do mês seguinte" htmlFor="vencimento_dia" erro={e.erros?.vencimento_dia}>
                          <Input id="vencimento_dia" name="vencimento_dia" inputMode="numeric" defaultValue={estado.vencimento_dia ?? ""} placeholder="Ex.: 9" />
                        </Campo>
                        <Campo rotulo="Sem expediente bancário" htmlFor="vencimento_ajuste" erro={e.erros?.vencimento_ajuste}>
                          <Select id="vencimento_ajuste" name="vencimento_ajuste" defaultValue={estado.vencimento_ajuste ?? "postergar"}>
                            {Object.entries(AJUSTES_PRAZO).map(([v, r]) => (
                              <option key={v} value={v}>
                                {r.charAt(0).toUpperCase() + r.slice(1)}
                              </option>
                            ))}
                          </Select>
                        </Campo>
                      </>
                    ) : null}
                    <Campo rotulo="Regulamento e artigo" htmlFor="vencimento_base_legal" erro={e.erros?.vencimento_base_legal} className="sm:col-span-3">
                      <Input id="vencimento_base_legal" name="vencimento_base_legal" defaultValue={estado.vencimento_base_legal ?? ""} placeholder="Ex.: RICMS/TO (Decreto nº 2.912/2006), art. ..." />
                    </Campo>
                    <Campo rotulo="Link da fonte oficial" htmlFor="vencimento_fonte_url" erro={e.erros?.vencimento_fonte_url} className="sm:col-span-3">
                      <Input id="vencimento_fonte_url" name="vencimento_fonte_url" type="url" defaultValue={estado.vencimento_fonte_url ?? ""} placeholder="https://" />
                    </Campo>
                    <Campo rotulo="Observação do prazo" htmlFor="vencimento_observacao" className="sm:col-span-3">
                      <Textarea id="vencimento_observacao" name="vencimento_observacao" rows={2} defaultValue={estado.vencimento_observacao ?? ""} />
                    </Campo>
                  </fieldset>

                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <Campo rotulo="Fontes conferidas em" htmlFor="conferido_em" erro={e.erros?.conferido_em}>
                      <Input id="conferido_em" name="conferido_em" type="date" max={hoje} defaultValue={hoje} />
                    </Campo>
                    <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                  </div>
                </div>
              )}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export type SituacaoRegraIcms = "validada" | "proposta" | "diferente" | "nenhuma";

/** Situação da regra de vencimento no catálogo de obrigações. */
export function SituacaoRegra({ situacao }: { situacao: SituacaoRegraIcms }) {
  if (situacao === "validada") return <Badge variante="sucesso">Regra validada</Badge>;
  if (situacao === "proposta") return <Badge variante="info">Regra aguardando validação</Badge>;
  if (situacao === "diferente") return <Badge variante="alerta">Regra validada com outro prazo</Badge>;
  return null;
}

export function ProporRegraIcms({ uf, alteracao = false }: { uf: string; alteracao?: boolean }) {
  return (
    <BotaoAcao variante="contorno" tamanho="sm" acao={() => proporRegraIcms(uf)}>
      <FilePlus2 /> {alteracao ? "Propor alteração" : "Propor regra"}
    </BotaoAcao>
  );
}
