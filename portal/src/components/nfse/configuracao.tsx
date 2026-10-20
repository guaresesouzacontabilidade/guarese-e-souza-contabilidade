"use client";

import * as React from "react";
import { Check, Pencil, Plus, Search } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarAtividades, opcoesReforma, salvarConfiguracao, salvarServico } from "@/lib/nfse-emissao/acoes";
import { ATIVIDADES_SIMPLES, atividadesSimplesDoServico, classificacaoPadrao, formatarNbs, nbsMaisParecido, type OpcaoReforma } from "@/lib/nfse-emissao/reforma";
import { buscarServicos, formatarCodigoServico, indexarServicos, type Cnae, type ServicoNacional } from "@/lib/nfse-emissao/lista-servicos";
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
  cnae: string | null;
  cind_op: string | null;
  cclass_trib: string | null;
  atividade_sn: number | null;
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
              obrigatorio={!cfg.autorizacao_texto}
              erro={e.autorizacao_texto}
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

/** Atividade (CNAE) da empresa com os códigos da lista nacional sugeridos para ela. */
export interface AtividadeEmpresa extends Cnae {
  comercio: boolean;
  sugestoes: string[];
}

interface InicialServico {
  nome: string;
  codigo: string;
  cnae: string | null;
}

const curto = (t: string, max = 110) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** Escolha do serviço na lista nacional: busca por palavras ou pelo código. */
function SeletorServicoNacional({
  lista,
  codigo,
  aoEscolher,
  erro,
}: {
  lista: ServicoNacional[];
  codigo: string;
  aoEscolher: (codigo: string) => void;
  erro?: string[];
}) {
  const indice = React.useMemo(() => indexarServicos(lista), [lista]);
  const porCodigo = React.useMemo(() => new Map(lista.map((s) => [s.codigo, s])), [lista]);
  const [busca, setBusca] = React.useState("");
  const escolhido = porCodigo.get(codigo);
  const resultados = busca.trim().length >= 2 ? buscarServicos(indice, busca, 8) : [];
  const escolher = (c: string) => {
    aoEscolher(c);
    setBusca("");
  };
  return (
    <Campo
      rotulo="Serviço da lista nacional"
      htmlFor="sv-nacional"
      obrigatorio
      erro={erro}
      ajuda="Digite o que a empresa faz (ex.: conserto, contabilidade, hospedagem) ou o código (ex.: 14.01.01)."
    >
      <input type="hidden" name="codigo_tributacao_nacional" value={escolhido ? codigo : ""} />
      {escolhido ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="min-w-0">
            <span className="numero font-medium">{formatarCodigoServico(escolhido.codigo)}</span> — {escolhido.descricao}
          </p>
          <Button type="button" variante="contorno" tamanho="sm" onClick={() => escolher("")}>
            Trocar
          </Button>
        </div>
      ) : (
        <>
          <Input
            id="sv-nacional"
            value={busca}
            autoComplete="off"
            placeholder="Buscar serviço..."
            onChange={(ev) => {
              const v = ev.target.value;
              const d = v.replace(/\D/g, "");
              // Código completo digitado: já escolhe
              if (d.length === 6 && /^[\d.\s-]+$/.test(v.trim()) && porCodigo.has(d)) escolher(d);
              else setBusca(v);
            }}
          />
          {resultados.length ? (
            <ul className="mt-1 max-h-72 overflow-auto rounded-md border border-border" aria-label="Serviços encontrados">
              {resultados.map((s) => (
                <li key={s.codigo} className="border-b border-border last:border-b-0">
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => escolher(s.codigo)}>
                    <span className="numero font-medium">{formatarCodigoServico(s.codigo)}</span> — {curto(s.descricao, 160)}
                  </button>
                </li>
              ))}
            </ul>
          ) : busca.trim().length >= 2 ? (
            <p className="mt-1 text-xs text-muted-foreground">Nada encontrado. Tente outra palavra ou o código.</p>
          ) : null}
        </>
      )}
    </Campo>
  );
}

/** NBS, indicador da operação e classificação do IBS/CBS (tabela oficial) e atividade do Simples. */
function CamposReforma({
  empresaId,
  codigo,
  texto,
  servico,
  simples,
  erros,
}: {
  empresaId: string;
  codigo: string;
  texto: string;
  servico?: ServicoNfse;
  simples: boolean;
  erros: Record<string, string[] | undefined>;
}) {
  const [carregado, setCarregado] = React.useState<{ codigo: string; opcoes: OpcaoReforma[] } | null>(null);
  React.useEffect(() => {
    if (!/^\d{6}$/.test(codigo)) return;
    let vivo = true;
    opcoesReforma(empresaId, codigo).then((r) => {
      if (vivo) setCarregado({ codigo, opcoes: r.ok ? (r.dados?.opcoes ?? []) : [] });
    });
    return () => {
      vivo = false;
    };
  }, [empresaId, codigo]);
  const opcoes = carregado?.codigo === codigo ? carregado.opcoes : null;
  // undefined: ainda não escolhido (usa o do serviço ou a sugestão); "": nenhum
  const [nbsEscolhido, setNbsEscolhido] = React.useState<string | undefined>(servico?.codigo_nbs ?? undefined);
  const [classeEscolhida, setClasseEscolhida] = React.useState<string | undefined>(
    servico?.cind_op && servico.cclass_trib ? `${servico.cind_op}|${servico.cclass_trib}` : undefined,
  );
  const [manual, setManual] = React.useState({ nbs: servico?.codigo_nbs ?? "", indOp: servico?.cind_op ?? "", classe: servico?.cclass_trib ?? "" });

  const nbsDisponiveis = [...new Map((opcoes ?? []).map((o) => [o.nbs, o.descricao_nbs])).entries()];
  const nbs =
    nbsEscolhido !== undefined && (nbsEscolhido === "" || nbsDisponiveis.some(([n]) => n === nbsEscolhido))
      ? nbsEscolhido
      : opcoes
        ? (nbsMaisParecido(opcoes, texto) ?? "")
        : "";
  const doNbs = (opcoes ?? []).filter((o) => o.nbs === nbs);
  const padrao = opcoes ? classificacaoPadrao(opcoes, nbs) : null;
  const classe =
    classeEscolhida && doNbs.some((o) => `${o.cind_op}|${o.cclass_trib}` === classeEscolhida)
      ? classeEscolhida
      : padrao
        ? `${padrao.cind_op}|${padrao.cclass_trib}`
        : "";
  const semTabela = opcoes !== null && opcoes.length === 0;
  const atividades = atividadesSimplesDoServico(codigo);

  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Reforma tributária (IBS/CBS)</legend>
      <p className="text-xs text-muted-foreground">
        Exigidos no leiaute novo da nota (NT 009), que o ambiente de teste do governo já usa. Os dados vêm da tabela oficial que liga o serviço ao NBS e à classificação do IBS/CBS.
      </p>
      {!/^\d{6}$/.test(codigo) ? (
        <p className="text-sm text-muted-foreground">Escolha o serviço da lista nacional para ver as opções.</p>
      ) : opcoes === null ? (
        <p className="text-sm text-muted-foreground">Carregando as opções da tabela oficial...</p>
      ) : semTabela ? (
        <>
          <p className="text-sm text-muted-foreground">Este serviço não está na tabela oficial de correlação. Informe os códigos (com o apoio do contador responsável).</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Código NBS" htmlFor="sv-nbs" erro={erros.codigo_nbs} ajuda="9 números.">
              <Input id="sv-nbs" name="codigo_nbs" inputMode="numeric" maxLength={12} value={manual.nbs} onChange={(ev) => setManual({ ...manual, nbs: ev.target.value })} />
            </Campo>
            <Campo rotulo="Indicador da operação" htmlFor="sv-indop" ajuda="cIndOp, 6 números.">
              <Input id="sv-indop" inputMode="numeric" maxLength={6} value={manual.indOp} onChange={(ev) => setManual({ ...manual, indOp: ev.target.value })} />
            </Campo>
            <Campo rotulo="Classificação do IBS/CBS" htmlFor="sv-class" ajuda="cClassTrib, 6 números.">
              <Input id="sv-class" inputMode="numeric" maxLength={6} value={manual.classe} onChange={(ev) => setManual({ ...manual, classe: ev.target.value })} />
            </Campo>
          </div>
          <input type="hidden" name="classificacao" value={manual.indOp && manual.classe ? `${manual.indOp.replace(/\D/g, "")}|${manual.classe.replace(/\D/g, "")}` : ""} />
        </>
      ) : (
        <>
          <input type="hidden" name="codigo_nbs" value={nbs} />
          <input type="hidden" name="classificacao" value={nbs ? classe : ""} />
          <Campo rotulo="Código NBS" htmlFor="sv-nbs" erro={erros.codigo_nbs} ajuda="Sugerido pelo nome do serviço; confira.">
            <Select id="sv-nbs" value={nbs} onChange={(ev) => setNbsEscolhido(ev.target.value)}>
              <option value="">— sem NBS —</option>
              {nbsDisponiveis.map(([n, d]) => (
                <option key={n} value={n}>
                  {formatarNbs(n)} — {d}
                </option>
              ))}
            </Select>
          </Campo>
          {nbs ? (
            <Campo
              rotulo="Classificação do IBS/CBS"
              htmlFor="sv-classe"
              ajuda="O indicador da operação termina em 01 quando o serviço é feito no estabelecimento da empresa ou para cliente no Brasil; em 02, fora dele ou para cliente no exterior."
            >
              <Select id="sv-classe" value={classe} onChange={(ev) => setClasseEscolhida(ev.target.value)}>
                {doNbs.map((o) => (
                  <option key={`${o.cind_op}|${o.cclass_trib}`} value={`${o.cind_op}|${o.cclass_trib}`}>
                    {o.cclass_trib} — {o.nome_cclass_trib} (operação {o.cind_op})
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}
        </>
      )}
      {simples ? (
        <Campo rotulo="Atividade no Simples Nacional" htmlFor="sv-atividade" erro={erros.atividade_sn} ajuda="Automática: pelo anexo dos serviços em Cálculos → Configuração (Anexo III: 07; IV: 14; V ou Fator R: 09).">
          <Select id="sv-atividade" name="atividade_sn" defaultValue={servico?.atividade_sn ? String(servico.atividade_sn) : ""}>
            <option value="">Automática</option>
            {atividades.map((a) => (
              <option key={a} value={a}>
                {ATIVIDADES_SIMPLES[a]}
              </option>
            ))}
          </Select>
        </Campo>
      ) : null}
    </fieldset>
  );
}

function FormServico({
  empresaId,
  servico,
  inicial,
  lista,
  atividades,
  simples,
  aoSalvar,
}: {
  empresaId: string;
  servico?: ServicoNfse;
  inicial?: InicialServico;
  lista: ServicoNacional[];
  atividades: AtividadeEmpresa[];
  simples: boolean;
  aoSalvar: () => void;
}) {
  const cnae = servico?.cnae ?? inicial?.cnae ?? "";
  const [codigo, setCodigo] = React.useState(servico?.codigo_tributacao_nacional ?? inicial?.codigo ?? "");
  const [nome, setNome] = React.useState(servico?.nome ?? inicial?.nome ?? "");
  return (
    <FormularioAcao acao={salvarServico.bind(null, empresaId)} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            {servico ? <input type="hidden" name="id" value={servico.id} /> : null}
            <SeletorServicoNacional lista={lista} codigo={codigo} aoEscolher={setCodigo} erro={e.codigo_tributacao_nacional} />
            <Campo rotulo="Nome do serviço" htmlFor="sv-nome" obrigatorio erro={e.nome} ajuda="Como o cliente vai reconhecer na hora de emitir (ex.: Revisão de veículos, Consultoria).">
              <Input id="sv-nome" name="nome" maxLength={120} value={nome} onChange={(ev) => setNome(ev.target.value)} />
            </Campo>
            {atividades.length || cnae ? (
              <Campo rotulo="Atividade da empresa (CNAE)" htmlFor="sv-cnae" erro={e.cnae} ajuda="Só para organizar: a nota não leva o CNAE.">
                <Select id="sv-cnae" name="cnae" defaultValue={cnae}>
                  <option value="">—</option>
                  {cnae && !atividades.some((a) => a.codigo === cnae) ? <option value={cnae}>{cnae}</option> : null}
                  {atividades.map((a) => (
                    <option key={a.codigo} value={a.codigo}>
                      {a.codigo} — {curto(a.descricao ?? "", 70)}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
            <Campo rotulo="Código municipal" htmlFor="sv-municipal" erro={e.codigo_tributacao_municipal} ajuda="3 números, só se o município pede.">
              <Input id="sv-municipal" name="codigo_tributacao_municipal" inputMode="numeric" maxLength={3} defaultValue={servico?.codigo_tributacao_municipal ?? ""} />
            </Campo>
            <CamposReforma empresaId={empresaId} codigo={codigo} texto={nome || inicial?.nome || ""} servico={servico} simples={simples} erros={e} />
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

/** Atividades (CNAE) da empresa com os serviços da lista nacional sugeridos para cada uma. */
function AtividadesEmpresa({
  empresaId,
  atividades,
  completas,
  lista,
  servicos,
  adicionar,
}: {
  empresaId: string;
  atividades: AtividadeEmpresa[];
  completas: boolean;
  lista: ServicoNacional[];
  servicos: ServicoNfse[];
  adicionar: (inicial: InicialServico) => void;
}) {
  const porCodigo = new Map(lista.map((s) => [s.codigo, s]));
  const buscar = (
    <BotaoAcao variante="contorno" tamanho="sm" acao={buscarAtividades.bind(null, empresaId)}>
      <Search /> Buscar as atividades na Receita
    </BotaoAcao>
  );
  if (!atividades.length) {
    return (
      <div className="mb-4 rounded-lg border border-dashed border-border p-3 text-sm">
        <p className="mb-2 text-muted-foreground">As atividades (CNAE) da empresa não estão no cadastro. Busque na Receita para o portal sugerir os serviços de cada uma.</p>
        {buscar}
      </div>
    );
  }
  return (
    <div className="mb-5">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Atividades da empresa (CNAE)</p>
          <p className="text-xs text-muted-foreground">A nota leva o código do serviço da lista nacional, não o CNAE. As sugestões comparam as descrições: confira antes de adicionar.</p>
        </div>
        {completas ? null : buscar}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {atividades.map((a) => (
          <li key={a.codigo} className="p-3">
            <p className="text-sm">
              <span className="numero font-medium">{a.codigo}</span> {a.descricao ?? ""}
              {a.principal ? (
                <Badge variante="contorno" className="ml-1.5 align-middle">
                  principal
                </Badge>
              ) : null}
            </p>
            {a.comercio ? (
              <p className="mt-1 text-xs text-muted-foreground">Comércio: a venda de mercadoria sai na nota de produto (NF-e), não na nota de serviço.</p>
            ) : a.sugestoes.length ? (
              <ul className="mt-2 space-y-2">
                {a.sugestoes.map((codigo) => {
                  const s = porCodigo.get(codigo);
                  if (!s) return null;
                  const cadastrado = servicos.some((x) => x.codigo_tributacao_nacional === codigo);
                  return (
                    <li key={codigo} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 text-muted-foreground">
                        <span className="numero font-medium text-foreground">{formatarCodigoServico(codigo)}</span> — {curto(s.descricao)}
                      </span>
                      {cadastrado ? (
                        <Badge variante="sucesso">
                          <Check /> Cadastrado
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          variante="contorno"
                          tamanho="sm"
                          aria-label={`Adicionar o serviço ${formatarCodigoServico(codigo)} da atividade ${a.codigo}`}
                          onClick={() => adicionar({ nome: curto(a.descricao ?? s.descricao, 120), codigo, cnae: a.codigo })}
                        >
                          <Plus /> Adicionar
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Nenhum serviço parecido na lista nacional. Se a empresa presta serviço nesta atividade, use “Novo serviço” e busque pelo nome.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ServicosNfse({
  empresaId,
  servicos,
  lista,
  atividades,
  atividadesCompletas,
  simples,
}: {
  empresaId: string;
  servicos: ServicoNfse[];
  lista: ServicoNacional[];
  atividades: AtividadeEmpresa[];
  atividadesCompletas: boolean;
  simples: boolean;
}) {
  const [editando, setEditando] = React.useState<{ servico?: ServicoNfse; inicial?: InicialServico } | null>(null);
  const porCodigo = React.useMemo(() => new Map(lista.map((s) => [s.codigo, s])), [lista]);
  return (
    <>
      <AtividadesEmpresa
        empresaId={empresaId}
        atividades={atividades}
        completas={atividadesCompletas}
        lista={lista}
        servicos={servicos}
        adicionar={(inicial) => setEditando({ inicial })}
      />
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Serviços cadastrados</p>
        <Button variante="contorno" onClick={() => setEditando({})}>
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
                <Td className="numero" title={porCodigo.get(s.codigo_tributacao_nacional)?.descricao}>
                  {formatarCodigoServico(s.codigo_tributacao_nacional)}
                  {s.codigo_tributacao_municipal ? ` / ${s.codigo_tributacao_municipal}` : ""}
                  {s.cnae ? <span className="block text-xs text-muted-foreground">CNAE {s.cnae}</span> : null}
                  {s.codigo_nbs && s.cclass_trib ? (
                    <span className="block text-xs text-muted-foreground">NBS {formatarNbs(s.codigo_nbs)}</span>
                  ) : (
                    <Badge variante="alerta" className="mt-1">
                      sem NBS / IBS-CBS
                    </Badge>
                  )}
                </Td>
                <Td className="hidden sm:table-cell">{s.ativo ? <Badge variante="sucesso">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                <Td>
                  <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar o serviço ${s.nome}`} onClick={() => setEditando({ servico: s })}>
                    <Pencil />
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado. Adicione pelas atividades acima ou use “Novo serviço” e busque pelo nome.</p>
      )}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent titulo={editando?.servico ? "Editar serviço" : "Novo serviço"} largura="lg">
          {editando !== null ? (
            <FormServico
              empresaId={empresaId}
              servico={editando.servico}
              inicial={editando.inicial}
              lista={lista}
              atividades={atividades}
              simples={simples}
              aoSalvar={() => setEditando(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
