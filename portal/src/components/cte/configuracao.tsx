"use client";

import * as React from "react";
import { Pencil, PlugZap, Plus } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import type { ClasseIbsCbs } from "@/components/nfe/configuracao";
import { salvarConfiguracaoCte, salvarOperacaoCte, testarConexaoCte } from "@/lib/cte-emissao/acoes";
import { CST_IBSCBS } from "@/lib/nfe-emissao/calculo";
import { CRT } from "@/lib/nfe-emissao/rotulos";
import { AMBIENTE_CTE, CFOP_FRETE, CST_ICMS_CTE, DESTINO_CTE } from "@/lib/cte-emissao/rotulos";

export interface ConfigCte {
  ativa: boolean;
  ambiente: "homologacao" | "producao";
  crt: number;
  emitente_id: string | null;
  serie: number;
  proximo_numero_homologacao: number;
  proximo_numero_producao: number;
  rntrc: string | null;
  autorizar_escritorio_xml: boolean;
  informacoes_padrao: string | null;
  autorizacao_texto: string | null;
}

export interface OpcaoEstabelecimento {
  id: string;
  nome: string;
  inscricao_estadual: string;
  municipio: string | null;
  uf: string | null;
}

export interface OperacaoCte {
  id: string;
  nome: string;
  natureza: string;
  destino: keyof typeof DESTINO_CTE;
  cfop: string;
  icms_cst: string;
  icms_aliquota: number | null;
  icms_reducao: number | null;
  icms_credito_presumido: number | null;
  icms_beneficio: string | null;
  ibscbs_cclass_trib: string | null;
  ibscbs_diferimento: number | null;
  excluir_icms_base_ibscbs: boolean;
  informacoes: string | null;
  ativa: boolean;
}

/** Número do banco no padrão brasileiro para os campos ("12.5" → "12,5"). */
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));

// -----------------------------------------------------------------------------
// Emissão (configuração geral)
// -----------------------------------------------------------------------------

export function FormConfiguracaoCte({ empresaId, cfg, estabelecimentos }: { empresaId: string; cfg: ConfigCte; estabelecimentos: OpcaoEstabelecimento[] }) {
  const [ambiente, setAmbiente] = React.useState(cfg.ambiente);
  return (
    <FormularioAcao acao={salvarConfiguracaoCte.bind(null, empresaId)} className="space-y-5">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="ativa" defaultChecked={cfg.ativa} className="mt-0.5" />
              <span>
                <strong>Emissão de CT-e ligada</strong>
                <span className="block text-xs text-muted-foreground">
                  Com a emissão ligada, quem tem a permissão &quot;Emitir CT-e&quot; emite na hora. O portal só liga com o certificado válido, o estabelecimento, o RNTRC, uma
                  operação do frete e a autorização do cliente.
                </span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Ambiente" htmlFor="ambiente" ajuda={AMBIENTE_CTE[ambiente].ajuda}>
                <Select id="ambiente" name="ambiente" value={ambiente} onChange={(ev) => setAmbiente(ev.target.value as typeof ambiente)}>
                  <option value="homologacao">{AMBIENTE_CTE.homologacao.rotulo}</option>
                  <option value="producao">{AMBIENTE_CTE.producao.rotulo}</option>
                </Select>
              </Campo>
              <Campo rotulo="Regime tributário (CRT)" htmlFor="crt" ajuda="No Simples Nacional, o ICMS do frete vai no DAS.">
                <Select id="crt" name="crt" defaultValue={String(cfg.crt)}>
                  {Object.entries(CRT).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo
                rotulo="Estabelecimento que emite"
                htmlFor="emitente_id"
                className="sm:col-span-2"
                ajuda="Inscrição estadual e endereço que saem no CT-e (o mesmo cadastro da NF-e). A prestação começa no estado deste estabelecimento."
              >
                <Select id="emitente_id" name="emitente_id" defaultValue={cfg.emitente_id ?? ""}>
                  <option value="">Escolha...</option>
                  {estabelecimentos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome} — IE {x.inscricao_estadual} — {x.municipio}/{x.uf}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="RNTRC (registro na ANTT)" htmlFor="rntrc" obrigatorio erro={e.rntrc} ajuda="8 números do Registro Nacional de Transportadores Rodoviários de Cargas.">
                <Input id="rntrc" name="rntrc" inputMode="numeric" maxLength={8} defaultValue={cfg.rntrc ?? ""} />
              </Campo>
              <Campo rotulo="Série do CT-e" htmlFor="serie" erro={e.serie} ajuda="Normalmente 1 (de 0 a 889).">
                <Input id="serie" name="serie" inputMode="numeric" maxLength={3} defaultValue={String(cfg.serie)} />
              </Campo>
              <Campo
                rotulo="Próximo número (produção)"
                htmlFor="proximo_numero_producao"
                erro={e.proximo_numero_producao}
                ajuda="Se a empresa já emitia CT-e em outro programa, informe o número seguinte ao último emitido nesta série. A numeração só anda para a frente."
              >
                <Input id="proximo_numero_producao" name="proximo_numero_producao" inputMode="numeric" maxLength={9} defaultValue={String(cfg.proximo_numero_producao)} />
              </Campo>
              <Campo rotulo="Próximo número (teste)" htmlFor="proximo_numero_homologacao" erro={e.proximo_numero_homologacao}>
                <Input id="proximo_numero_homologacao" name="proximo_numero_homologacao" inputMode="numeric" maxLength={9} defaultValue={String(cfg.proximo_numero_homologacao)} />
              </Campo>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="autorizar_escritorio_xml" defaultChecked={cfg.autorizar_escritorio_xml} className="mt-0.5" />
              <span>
                Autorizar o escritório a baixar o XML na SEFAZ
                <span className="block text-xs text-muted-foreground">O CNPJ do escritório vai no CT-e (campo autXML). O CT-e autorizado também entra sozinho nos documentos da empresa.</span>
              </span>
            </label>

            <Campo rotulo="Observações padrão" htmlFor="informacoes_padrao" ajuda="Saem em todos os CT-e (ex.: seguro da carga, observação fixa).">
              <Textarea id="informacoes_padrao" name="informacoes_padrao" rows={2} maxLength={2000} defaultValue={cfg.informacoes_padrao ?? ""} />
            </Campo>

            <Campo
              rotulo="Autorização do cliente"
              htmlFor="autorizacao_texto"
              obrigatorio={!cfg.autorizacao_texto}
              erro={e.autorizacao_texto}
              ajuda={
                cfg.autorizacao_texto
                  ? `Registrada: “${cfg.autorizacao_texto}”. Preencha só para registrar uma nova.`
                  : "Como o cliente autorizou o portal a emitir CT-e com o certificado digital da empresa (ex.: e-mail do sócio de 22/10/2026). Obrigatório para ligar."
              }
            >
              <Textarea id="autorizacao_texto" name="autorizacao_texto" rows={2} maxLength={2000} />
            </Campo>

            {ambiente === "producao" ? (
              <Alerta tom="alerta">Em produção, o CT-e tem valor fiscal. Emita antes ao menos um CT-e de teste (homologação) e confira o DACTE e o ICMS.</Alerta>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <BotaoAcao acao={testarConexaoCte.bind(null, empresaId)} variante="contorno" type="button">
                <PlugZap /> Testar conexão com a SEFAZ
              </BotaoAcao>
              <BotaoEnviar pendente={pendente}>Salvar configuração</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

// -----------------------------------------------------------------------------
// Operações do frete (regras fiscais)
// -----------------------------------------------------------------------------

interface ModeloOperacao {
  rotulo: string;
  nome: string;
  destino: OperacaoCte["destino"];
  cfop: string;
}

const MODELOS_OPERACAO: ModeloOperacao[] = [
  { rotulo: "Frete para outro estado, a estabelecimento comercial (6.353)", nome: "Frete para outro estado", destino: "interestadual", cfop: "6353" },
  { rotulo: "Frete dentro do estado, a estabelecimento comercial (5.353)", nome: "Frete dentro do estado", destino: "interna", cfop: "5353" },
  { rotulo: "Frete para outro estado, a estabelecimento industrial (6.352)", nome: "Frete para indústria de outro estado", destino: "interestadual", cfop: "6352" },
  { rotulo: "Frete para outro estado, a produtor rural (6.356)", nome: "Frete de produtor rural - outro estado", destino: "interestadual", cfop: "6356" },
  { rotulo: "Frete dentro do estado, a produtor rural (5.356)", nome: "Frete de produtor rural - dentro do estado", destino: "interna", cfop: "5356" },
  { rotulo: "Subcontratação de outra transportadora (6.351)", nome: "Subcontratação - outro estado", destino: "interestadual", cfop: "6351" },
];

function FormOperacao({ empresaId, operacao, simples, classes, aoSalvar }: { empresaId: string; operacao?: OperacaoCte; simples: boolean; classes: ClasseIbsCbs[]; aoSalvar: () => void }) {
  const [modelo, setModelo] = React.useState<ModeloOperacao | null>(null);
  const base = { natureza: "PRESTACAO DE SERVICO DE TRANSPORTE", ...operacao, ...(modelo ?? {}) } as Partial<OperacaoCte>;
  return (
    <div className="space-y-4">
      {!operacao ? (
        <Campo rotulo="Começar de um modelo (opcional)" htmlFor="op-modelo" ajuda="Preenche o nome, o destino e o CFOP. O ICMS e o IBS/CBS ficam para o escritório escolher.">
          <Select id="op-modelo" defaultValue="" onChange={(ev) => setModelo(MODELOS_OPERACAO[Number(ev.target.value)] ?? null)}>
            <option value="">—</option>
            {MODELOS_OPERACAO.map((m, i) => (
              <option key={m.cfop} value={i}>
                {m.rotulo}
              </option>
            ))}
          </Select>
        </Campo>
      ) : null}
      <CamposOperacao key={modelo?.cfop ?? "inicial"} empresaId={empresaId} id={operacao?.id ?? null} base={base} simples={simples} classes={classes} aoSalvar={aoSalvar} />
    </div>
  );
}

function CamposOperacao({
  empresaId,
  id,
  base,
  simples,
  classes,
  aoSalvar,
}: {
  empresaId: string;
  id: string | null;
  base: Partial<OperacaoCte>;
  simples: boolean;
  classes: ClasseIbsCbs[];
  aoSalvar: () => void;
}) {
  const [destino, setDestino] = React.useState<OperacaoCte["destino"]>(base.destino ?? "interestadual");
  const [cst, setCst] = React.useState(base.icms_cst ?? (simples ? "sn" : ""));
  const [classe, setClasse] = React.useState(base.ibscbs_cclass_trib ?? "");
  const prefixo = destino === "interna" ? "5" : "6";
  const escolhida = classes.find((c) => c.cclass_trib === classe);
  const porCst = React.useMemo(() => {
    const m = new Map<string, ClasseIbsCbs[]>();
    for (const c of classes) m.set(c.cst, [...(m.get(c.cst) ?? []), c]);
    return [...m.entries()];
  }, [classes]);
  const csts = Object.entries(CST_ICMS_CTE).filter(([c]) => (simples ? c === "sn" : c !== "sn"));

  return (
    <FormularioAcao acao={salvarOperacaoCte.bind(null, empresaId, id)} aoSucesso={aoSalvar} className="space-y-5">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Nome da operação" htmlFor="op-nome" obrigatorio erro={e.nome} ajuda="Como aparece para quem emite (ex.: Frete de grãos para GO).">
                <Input id="op-nome" name="nome" maxLength={80} defaultValue={base.nome ?? ""} />
              </Campo>
              <Campo rotulo="Natureza da prestação" htmlFor="op-nat" obrigatorio erro={e.natureza} ajuda="Texto que sai no CT-e.">
                <Input id="op-nat" name="natureza" maxLength={60} defaultValue={base.natureza ?? ""} />
              </Campo>
              <Campo rotulo="Destino" htmlFor="op-dest" obrigatorio>
                <Select id="op-dest" name="destino" value={destino} onChange={(ev) => setDestino(ev.target.value as OperacaoCte["destino"])}>
                  {Object.entries(DESTINO_CTE).map(([d, r]) => (
                    <option key={d} value={d}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="CFOP" htmlFor="op-cfop" obrigatorio erro={e.cfop}>
                <Select key={prefixo} id="op-cfop" name="cfop" defaultValue={base.cfop?.startsWith(prefixo) ? base.cfop : ""}>
                  <option value="">Escolha</option>
                  {Object.entries(CFOP_FRETE).map(([f, r]) => (
                    <option key={f} value={`${prefixo}${f}`}>
                      {prefixo}.{f} — {r}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">ICMS do frete</legend>
              <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
                <Campo rotulo="Situação tributária (CST)" htmlFor="op-cst" obrigatorio erro={e.icms_cst} className="sm:col-span-3">
                  <Select id="op-cst" name="icms_cst" value={cst} onChange={(ev) => setCst(ev.target.value)}>
                    {simples ? null : <option value="">Escolha</option>}
                    {csts.map(([c, r]) => (
                      <option key={c} value={c}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {["00", "20", "60", "90"].includes(cst) ? (
                  <Campo
                    rotulo="Alíquota (%)"
                    htmlFor="op-aliq"
                    obrigatorio
                    erro={e.icms_aliquota}
                    ajuda={destino === "interestadual" ? "Para outro estado: 12% (7% quando sai do Sul/Sudeste, exceto ES, para N, NE, CO ou ES)." : "Alíquota interna do estado para o transporte."}
                  >
                    <Input id="op-aliq" name="icms_aliquota" inputMode="decimal" defaultValue={num(base.icms_aliquota)} />
                  </Campo>
                ) : null}
                {cst === "20" ? (
                  <Campo rotulo="Redução da base (%)" htmlFor="op-red" obrigatorio erro={e.icms_reducao}>
                    <Input id="op-red" name="icms_reducao" inputMode="decimal" defaultValue={num(base.icms_reducao)} />
                  </Campo>
                ) : null}
                {cst === "60" || cst === "90" ? (
                  <Campo rotulo="Crédito presumido (%)" htmlFor="op-cred" erro={e.icms_credito_presumido} ajuda="Percentual sobre o ICMS, quando a lei do estado concede (ex.: 20%).">
                    <Input id="op-cred" name="icms_credito_presumido" inputMode="decimal" defaultValue={num(base.icms_credito_presumido)} />
                  </Campo>
                ) : null}
                {!simples ? (
                  <Campo rotulo="Código do benefício (cBenef)" htmlFor="op-benef" erro={e.icms_beneficio} ajuda="Só nos estados que exigem (8 ou 10 caracteres).">
                    <Input id="op-benef" name="icms_beneficio" maxLength={10} defaultValue={base.icms_beneficio ?? ""} />
                  </Campo>
                ) : null}
              </div>
              {cst === "60" ? (
                <p className="text-xs text-muted-foreground">
                  CST 60: o ICMS do frete é recolhido pelo tomador (substituição tributária), quando a lei do estado manda. O valor sai no CT-e só como informação.
                </p>
              ) : null}
            </fieldset>

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">IBS e CBS (reforma tributária)</legend>
              <p className="text-xs text-muted-foreground">
                O ambiente de teste da SEFAZ já exige o grupo do IBS/CBS no CT-e, em qualquer regime. Em 2026 as alíquotas são de teste (CBS 0,9% e IBS 0,1%) e não entram no
                valor do frete.
              </p>
              <Campo rotulo="Classificação tributária (cClassTrib)" htmlFor="op-class" obrigatorio erro={e.ibscbs_cclass_trib} ajuda="Transporte de cargas com tributação normal: 000001.">
                <Select id="op-class" name="ibscbs_cclass_trib" value={classe} onChange={(ev) => setClasse(ev.target.value)}>
                  <option value="">Escolha</option>
                  {porCst.map(([c, lista]) => (
                    <optgroup key={c} label={`CST ${c} — ${CST_IBSCBS[c]?.descricao ?? lista[0]?.nome ?? ""}`}>
                      {lista.map((l) => (
                        <option key={l.cclass_trib} value={l.cclass_trib}>
                          {l.cclass_trib} — {l.nome.length > 110 ? `${l.nome.slice(0, 109)}…` : l.nome}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Campo>
              {escolhida ? (
                <p className="text-xs text-muted-foreground">
                  CST {escolhida.cst}
                  {Number(escolhida.p_red_ibs) || Number(escolhida.p_red_cbs) ? ` — redução de ${num(escolhida.p_red_ibs)}% no IBS e ${num(escolhida.p_red_cbs)}% na CBS` : " — sem redução"}.
                </p>
              ) : null}
              {escolhida && CST_IBSCBS[escolhida.cst]?.diferimento ? (
                <Campo rotulo="Diferimento do IBS/CBS (%)" htmlFor="op-ibs-dif" erro={e.ibscbs_diferimento} className="sm:max-w-xs">
                  <Input id="op-ibs-dif" name="ibscbs_diferimento" inputMode="decimal" defaultValue={num(base.ibscbs_diferimento)} />
                </Campo>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="excluir_icms_base_ibscbs" defaultChecked={base.excluir_icms_base_ibscbs ?? true} /> Tirar o ICMS do frete da base do IBS/CBS
              </label>
            </fieldset>

            <Campo rotulo="Observações desta operação" htmlFor="op-info" ajuda="Ex.: base legal da redução, isenção ou crédito presumido.">
              <Textarea id="op-info" name="informacoes" rows={2} maxLength={2000} defaultValue={base.informacoes ?? ""} />
            </Campo>
            {id ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="inativa" defaultChecked={base.ativa === false} /> Inativa (não aparece na emissão)
              </label>
            ) : null}
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar operação</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function OperacoesCte({ empresaId, operacoes, simples, classes }: { empresaId: string; operacoes: OperacaoCte[]; simples: boolean; classes: ClasseIbsCbs[] }) {
  const [editando, setEditando] = React.useState<OperacaoCte | "novo" | null>(null);
  return (
    <div className="space-y-3">
      {operacoes.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {operacoes.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {o.nome} {!o.ativa ? <Badge variante="neutro">Inativa</Badge> : null}
                </p>
                <p className="text-muted-foreground">
                  CFOP {o.cfop} — ICMS {CST_ICMS_CTE[o.icms_cst] ?? o.icms_cst}
                  {o.icms_aliquota != null ? ` ${num(o.icms_aliquota)}%` : ""}
                  {o.icms_credito_presumido != null ? ` (crédito presumido ${num(o.icms_credito_presumido)}%)` : ""}
                  {o.ibscbs_cclass_trib ? ` — IBS/CBS ${o.ibscbs_cclass_trib}` : ""}
                </p>
              </div>
              <Button variante="contorno" tamanho="sm" onClick={() => setEditando(o)}>
                <Pencil /> Editar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EstadoVazio titulo="Nenhuma operação do frete" descricao="A operação guarda as regras fiscais do frete (CFOP, ICMS e IBS/CBS). Quem emite só escolhe a operação." />
      )}
      <Button variante="contorno" onClick={() => setEditando("novo")}>
        <Plus /> Nova operação do frete
      </Button>
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent largura="xl" titulo={editando === "novo" ? "Nova operação do frete" : "Editar operação do frete"} descricao="Regras fiscais aplicadas em todo CT-e emitido com esta operação.">
          {editando !== null ? (
            <FormOperacao empresaId={empresaId} operacao={editando === "novo" ? undefined : editando} simples={simples} classes={classes} aoSalvar={() => setEditando(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
