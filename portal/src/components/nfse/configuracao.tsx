"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { salvarConfiguracao, salvarServico } from "@/lib/nfse-emissao/acoes";
import { AMBIENTE_NFSE, REGIME_APURACAO_SN, REGIME_ESPECIAL } from "@/lib/nfse-emissao/rotulos";

export interface ConfigNfse {
  ativa: boolean;
  ambiente: "homologacao" | "producao";
  codigo_municipio: string | null;
  inscricao_municipal: string | null;
  regime_apuracao_sn: number;
  regime_especial: number;
  serie: number;
  proximo_numero_homologacao: number;
  proximo_numero_producao: number;
  percentual_tributos_sn: number | null;
  percentual_tributos_federais: number | null;
  percentual_tributos_municipais: number | null;
  iss_retencao_permitida: boolean;
  aliquota_iss_retencao: number | null;
  enviar_email_tomador: boolean;
  autorizacao_texto: string | null;
}

export interface ServicoNfse {
  id: string;
  nome: string;
  codigo_tributacao_nacional: string;
  codigo_tributacao_municipal: string | null;
  codigo_nbs: string | null;
  descricao_padrao: string | null;
  ativo: boolean;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

export function FormConfiguracao({ empresaId, cfg, regime, municipioNome }: { empresaId: string; cfg: ConfigNfse; regime: string; municipioNome: string | null }) {
  const [ambiente, setAmbiente] = React.useState(cfg.ambiente);
  const [retencao, setRetencao] = React.useState(cfg.iss_retencao_permitida);
  const simples = regime === "simples_nacional";
  const mei = regime === "mei";
  return (
    <FormularioAcao acao={salvarConfiguracao.bind(null, empresaId)} className="space-y-5">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="ativa" defaultChecked={cfg.ativa} className="mt-0.5" />
              <span>
                <strong>Emissão ligada</strong>
                <span className="block text-xs text-muted-foreground">Com a emissão ligada, quem tem a permissão &quot;Emitir notas&quot; emite na hora, sem aprovação do escritório.</span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Ambiente" htmlFor="ambiente" ajuda={AMBIENTE_NFSE[ambiente].ajuda}>
                <Select id="ambiente" name="ambiente" value={ambiente} onChange={(ev) => setAmbiente(ev.target.value as typeof ambiente)}>
                  <option value="homologacao">{AMBIENTE_NFSE.homologacao.rotulo}</option>
                  <option value="producao">{AMBIENTE_NFSE.producao.rotulo}</option>
                </Select>
              </Campo>
              <Campo
                rotulo="Município emissor (código IBGE)"
                htmlFor="codigo_municipio"
                erro={e.codigo_municipio}
                ajuda={municipioNome ? `${municipioNome}. O município precisa usar o Emissor Nacional.` : "7 números. O município precisa usar o Emissor Nacional."}
              >
                <Input id="codigo_municipio" name="codigo_municipio" inputMode="numeric" maxLength={7} defaultValue={cfg.codigo_municipio ?? ""} />
              </Campo>
              <Campo
                rotulo="Inscrição municipal"
                htmlFor="inscricao_municipal"
                ajuda="Preencha só se a empresa tem cadastro complementar no Emissor Nacional (CNC) neste município; sem cadastro, deixe em branco."
              >
                <Input id="inscricao_municipal" name="inscricao_municipal" maxLength={15} defaultValue={cfg.inscricao_municipal ?? ""} />
              </Campo>
              <Campo rotulo="Regime especial do ISS" htmlFor="regime_especial" ajuda={mei || simples ? "MEI e Simples com ISS no DAS saem sempre como “Nenhum”." : undefined}>
                <Select id="regime_especial" name="regime_especial" defaultValue={String(cfg.regime_especial)}>
                  {Object.entries(REGIME_ESPECIAL).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              {simples ? (
                <Campo rotulo="Apuração no Simples Nacional" htmlFor="regime_apuracao_sn" className="sm:col-span-2">
                  <Select id="regime_apuracao_sn" name="regime_apuracao_sn" defaultValue={String(cfg.regime_apuracao_sn)}>
                    {Object.entries(REGIME_APURACAO_SN).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : (
                <input type="hidden" name="regime_apuracao_sn" value={cfg.regime_apuracao_sn} />
              )}
            </div>

            <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">Numeração da DPS</legend>
              <Campo rotulo="Série" htmlFor="serie" erro={e.serie} ajuda="1 a 49999 (aplicativo próprio). Use uma série que a empresa não usa em outro sistema.">
                <Input id="serie" name="serie" inputMode="numeric" defaultValue={String(cfg.serie)} />
              </Campo>
              <Campo rotulo="Próximo número (teste)" htmlFor="proximo_numero_homologacao" erro={e.proximo_numero_homologacao}>
                <Input id="proximo_numero_homologacao" name="proximo_numero_homologacao" inputMode="numeric" defaultValue={String(cfg.proximo_numero_homologacao)} />
              </Campo>
              <Campo rotulo="Próximo número (produção)" htmlFor="proximo_numero_producao" erro={e.proximo_numero_producao} ajuda="Só anda para a frente.">
                <Input id="proximo_numero_producao" name="proximo_numero_producao" inputMode="numeric" defaultValue={String(cfg.proximo_numero_producao)} />
              </Campo>
            </fieldset>

            <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2 sm:p-4">
              <legend className="px-1 text-sm font-medium">Tributos aproximados na nota (Lei 12.741/2012)</legend>
              {mei ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">MEI: a nota sai sem o valor aproximado dos tributos (permitido para o MEI).</p>
              ) : simples ? (
                <Campo rotulo="Alíquota do Simples Nacional (%)" htmlFor="percentual_tributos_sn" erro={e.percentual_tributos_sn} ajuda="Alíquota efetiva atual do DAS sobre os serviços (veja a previsão em Cálculos). Atualize quando mudar de faixa.">
                  <Input id="percentual_tributos_sn" name="percentual_tributos_sn" inputMode="decimal" defaultValue={num(cfg.percentual_tributos_sn)} />
                </Campo>
              ) : (
                <>
                  <Campo rotulo="Tributos federais (%)" htmlFor="percentual_tributos_federais" erro={e.percentual_tributos_federais} ajuda="Ex.: PIS, Cofins, IRPJ e CSLL do presumido.">
                    <Input id="percentual_tributos_federais" name="percentual_tributos_federais" inputMode="decimal" defaultValue={num(cfg.percentual_tributos_federais)} />
                  </Campo>
                  <Campo rotulo="Tributos municipais (%)" htmlFor="percentual_tributos_municipais" erro={e.percentual_tributos_municipais} ajuda="Alíquota do ISS.">
                    <Input id="percentual_tributos_municipais" name="percentual_tributos_municipais" inputMode="decimal" defaultValue={num(cfg.percentual_tributos_municipais)} />
                  </Campo>
                </>
              )}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="iss_retencao_permitida" checked={retencao} onChange={(ev) => setRetencao(ev.target.checked)} className="mt-0.5" disabled={mei} />
                <span>
                  Permitir ISS retido pelo tomador
                  <span className="block text-xs text-muted-foreground">O cliente marca no pedido quando o tomador retém o ISS.</span>
                </span>
              </label>
              {retencao ? (
                <Campo rotulo="Alíquota do ISS retido (%)" htmlFor="aliquota_iss_retencao" erro={e.aliquota_iss_retencao} ajuda={simples ? "No Simples, a alíquota do ISS da faixa (mínimo 2%)." : "Alíquota do ISS do município."}>
                  <Input id="aliquota_iss_retencao" name="aliquota_iss_retencao" inputMode="decimal" defaultValue={num(cfg.aliquota_iss_retencao)} />
                </Campo>
              ) : null}
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <Checkbox name="enviar_email_tomador" defaultChecked={cfg.enviar_email_tomador} className="mt-0.5" />
                <span>
                  Enviar a nota ao tomador por e-mail (produção)
                  <span className="block text-xs text-muted-foreground">PDF e XML para o e-mail informado no pedido, pelo e-mail do escritório (quando configurado).</span>
                </span>
              </label>
            </div>

            <Campo
              rotulo="Autorização do cliente"
              htmlFor="autorizacao_texto"
              ajuda={
                cfg.autorizacao_texto
                  ? `Registrada: “${cfg.autorizacao_texto}”. Preencha só para registrar uma nova.`
                  : "Como o cliente autorizou o portal a emitir notas com o certificado digital da empresa (ex.: e-mail do sócio de 20/10/2026). Obrigatório para ligar."
              }
            >
              <Textarea id="autorizacao_texto" name="autorizacao_texto" rows={2} maxLength={2000} />
            </Campo>

            {ambiente === "producao" ? (
              <Alerta tom="alerta">Em produção, as notas têm valor fiscal. Faça antes ao menos uma nota de teste e confira o PDF.</Alerta>
            ) : null}
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar configuração</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

function FormServico({ empresaId, servico, aoSalvar }: { empresaId: string; servico?: ServicoNfse; aoSalvar: () => void }) {
  return (
    <FormularioAcao acao={salvarServico.bind(null, empresaId)} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            {servico ? <input type="hidden" name="id" value={servico.id} /> : null}
            <Campo rotulo="Nome do serviço" htmlFor="sv-nome" obrigatorio erro={e.nome} ajuda="Como o cliente vai reconhecer na lista (ex.: Consultoria, Manutenção).">
              <Input id="sv-nome" name="nome" maxLength={120} defaultValue={servico?.nome ?? ""} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo
                rotulo="Código de tributação nacional"
                htmlFor="sv-nacional"
                obrigatorio
                erro={e.codigo_tributacao_nacional}
                ajuda="6 números: item, subitem e desdobro da lista nacional (ex.: 170101)."
                className="sm:col-span-2"
              >
                <Input id="sv-nacional" name="codigo_tributacao_nacional" inputMode="numeric" maxLength={8} defaultValue={servico?.codigo_tributacao_nacional ?? ""} />
              </Campo>
              <Campo rotulo="Código municipal" htmlFor="sv-municipal" erro={e.codigo_tributacao_municipal} ajuda="3 números, se o município pede.">
                <Input id="sv-municipal" name="codigo_tributacao_municipal" inputMode="numeric" maxLength={3} defaultValue={servico?.codigo_tributacao_municipal ?? ""} />
              </Campo>
            </div>
            <Campo rotulo="Código NBS" htmlFor="sv-nbs" erro={e.codigo_nbs} ajuda="Opcional, 9 números.">
              <Input id="sv-nbs" name="codigo_nbs" inputMode="numeric" maxLength={12} defaultValue={servico?.codigo_nbs ?? ""} />
            </Campo>
            <Campo rotulo="Descrição padrão" htmlFor="sv-descricao" ajuda="Sugerida no pedido; o cliente pode ajustar.">
              <Textarea id="sv-descricao" name="descricao_padrao" rows={3} maxLength={1000} defaultValue={servico?.descricao_padrao ?? ""} />
            </Campo>
            <Campo rotulo="Situação" htmlFor="sv-ativo">
              <Select id="sv-ativo" name="ativo" defaultValue={servico && !servico.ativo ? "off" : "on"}>
                <option value="on">Ativo (aparece no pedido)</option>
                <option value="off">Inativo</option>
              </Select>
            </Campo>
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>{servico ? "Salvar serviço" : "Cadastrar serviço"}</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function ServicosNfse({ empresaId, servicos }: { empresaId: string; servicos: ServicoNfse[] }) {
  const [editando, setEditando] = React.useState<ServicoNfse | "novo" | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variante="contorno" onClick={() => setEditando("novo")}>
          <Plus /> Novo serviço
        </Button>
      </div>
      {servicos.length ? (
        <Table>
          <THead>
            <Tr>
              <Th>Serviço</Th>
              <Th>Código</Th>
              <Th className="hidden sm:table-cell">Situação</Th>
              <Th className="w-12">
                <span className="sr-only">Ações</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {servicos.map((s) => (
              <Tr key={s.id}>
                <Td>{s.nome}</Td>
                <Td className="numero">
                  {s.codigo_tributacao_nacional}
                  {s.codigo_tributacao_municipal ? ` / ${s.codigo_tributacao_municipal}` : ""}
                </Td>
                <Td className="hidden sm:table-cell">{s.ativo ? <Badge variante="sucesso">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                <Td>
                  <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar o serviço ${s.nome}`} onClick={() => setEditando(s)}>
                    <Pencil />
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado. Cadastre os serviços que a empresa presta, com o código de tributação nacional.</p>
      )}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent titulo={editando && editando !== "novo" ? "Editar serviço" : "Novo serviço"} largura="lg">
          {editando !== null ? <FormServico empresaId={empresaId} servico={editando === "novo" ? undefined : editando} aoSalvar={() => setEditando(null)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
