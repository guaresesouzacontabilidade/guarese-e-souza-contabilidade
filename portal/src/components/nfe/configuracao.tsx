"use client";

import * as React from "react";
import { Pencil, PlugZap, Plus, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorMunicipio } from "@/components/obrigacoes/seletor-municipio";
import { listarMunicipios } from "@/lib/obrigacoes/acoes";
import { salvarConfiguracao, salvarEmitente, salvarOperacao, salvarProduto, testarConexao } from "@/lib/nfe-emissao/acoes";
import { CSOSN, CST_IBSCBS, CST_ICMS } from "@/lib/nfe-emissao/calculo";
import {
  AMBIENTE_NFE,
  CRT,
  CST_PIS_COFINS,
  DESTINO,
  SEM_PIS_COFINS,
  FINALIDADE,
  MODO_FUNRURAL,
  ORIGENS,
  PRESENCA,
  TIPO_CONTRIBUICAO,
} from "@/lib/nfe-emissao/rotulos";
import { formatarCep } from "@/lib/formatos";

export interface ConfigNfe {
  ativa: boolean;
  ambiente: "homologacao" | "producao";
  crt: number;
  presenca: number;
  funrural_percentual: number | null;
  funrural_modo: string | null;
  enviar_email_destinatario: boolean;
  autorizar_escritorio_xml: boolean;
  informacoes_padrao: string | null;
  autorizacao_texto: string | null;
}

export interface EmitenteNfe {
  id: string;
  nome: string;
  inscricao_estadual: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio_ibge: string;
  uf: string | null;
  municipio: string | null;
  cep: string;
  telefone: string | null;
  serie: number;
  proximo_numero_homologacao: number;
  proximo_numero_producao: number;
  ativo: boolean;
}

export interface ProdutoNfe {
  id: string;
  codigo: string;
  descricao: string;
  ncm: string;
  cest: string | null;
  gtin: string | null;
  unidade: string;
  peso_kg: number | null;
  valor_unitario: number | null;
  origem: number;
  ativo: boolean;
}

export interface ContribuicaoNfe {
  nome: string;
  tipo: keyof typeof TIPO_CONTRIBUICAO;
  valor: number;
  valorUpf?: number | null;
  ncms?: string[];
  codigoReceita?: string | null;
}

export interface OperacaoNfe {
  id: string;
  nome: string;
  natureza: string;
  finalidade: number;
  destino: keyof typeof DESTINO;
  consumidor_final: boolean;
  cfop: string;
  icms_cst: string;
  icms_aliquota: number | null;
  icms_reducao: number | null;
  icms_diferimento: number | null;
  icms_credito_sn: number | null;
  icms_beneficio: string | null;
  pis_cst: string;
  pis_aliquota: number | null;
  cofins_cst: string;
  cofins_aliquota: number | null;
  excluir_icms_pis_cofins: boolean;
  ibscbs_cclass_trib: string | null;
  ibscbs_diferimento: number | null;
  difal_metodo: string | null;
  difal_codigo_receita: string | null;
  icms_por_operacao: boolean;
  icms_codigo_receita: string | null;
  frete_icms_retido: boolean;
  frete_aliquota: number | null;
  frete_reducao: number | null;
  frete_cfop: string | null;
  frete_codigo_receita: string | null;
  incide_funrural: boolean;
  contribuicoes: ContribuicaoNfe[];
  informacoes: string | null;
  ativa: boolean;
}

export interface ClasseIbsCbs {
  cclass_trib: string;
  cst: string;
  nome: string;
  p_red_ibs: number;
  p_red_cbs: number;
}

/** Alíquotas básicas do PIS e da Cofins pelo regime da empresa (null: Simples Nacional ou produtor pessoa física). */
export type PisCofinsPadrao = { pis: number; cofins: number } | null;

/** Número do banco no padrão brasileiro para os campos ("12.5" → "12,5"). */
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(v).replace(".", ","));
/** Número digitado no padrão brasileiro ("1.234,56") para o envio em JSON. */
function lerBr(t: string): number | string {
  const s = t.trim().replace(/\s|R\$|%/g, "");
  if (!s) return "";
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : s;
}

// -----------------------------------------------------------------------------
// Emissão (configuração geral)
// -----------------------------------------------------------------------------

export function FormConfiguracaoNfe({ empresaId, cfg, pessoaFisica }: { empresaId: string; cfg: ConfigNfe; pessoaFisica: boolean }) {
  const [ambiente, setAmbiente] = React.useState(cfg.ambiente);
  const [funrural, setFunrural] = React.useState(cfg.funrural_percentual != null);
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
                <span className="block text-xs text-muted-foreground">
                  Com a emissão ligada, quem tem a permissão &quot;Emitir NF-e&quot; emite na hora. O portal só liga com o certificado válido, uma inscrição, uma operação e a
                  autorização do cliente.
                </span>
              </span>
            </label>

            <div className="grid gap-4 [&>*]:min-w-0">
              <Campo rotulo="Ambiente" htmlFor="ambiente" ajuda={AMBIENTE_NFE[ambiente].ajuda}>
                <Select id="ambiente" name="ambiente" value={ambiente} onChange={(ev) => setAmbiente(ev.target.value as typeof ambiente)}>
                  <option value="homologacao">{AMBIENTE_NFE.homologacao.rotulo}</option>
                  <option value="producao">{AMBIENTE_NFE.producao.rotulo}</option>
                </Select>
              </Campo>
              <Campo rotulo="Regime tributário (CRT)" htmlFor="crt" ajuda={pessoaFisica ? "Produtor rural pessoa física: regime normal (3)." : "Define se o ICMS sai por CST (regime normal) ou CSOSN (Simples)."}>
                <Select id="crt" name="crt" defaultValue={String(cfg.crt)}>
                  {Object.entries(CRT).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Presença do comprador" htmlFor="presenca" ajuda="Venda de grãos combinada por telefone ou contrato: 9 (não presencial).">
                <Select id="presenca" name="presenca" defaultValue={String(cfg.presenca)}>
                  {Object.entries(PRESENCA).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>

            <fieldset className="space-y-3 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">FUNRURAL (produtor rural)</legend>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={funrural} onChange={(ev) => setFunrural(ev.target.checked)} className="mt-0.5" />
                <span>
                  Informar o FUNRURAL nas notas das operações marcadas
                  <span className="block text-xs text-muted-foreground">O valor sai nas informações complementares da nota (não entra no total).</span>
                </span>
              </label>
              {funrural ? (
                <div className="grid gap-4 [&>*]:min-w-0">
                  <Campo
                    rotulo="Percentual (%)"
                    htmlFor="funrural_percentual"
                    erro={e.funrural_percentual}
                    ajuda="Ex.: produtor pessoa física 1,5 (1,2 INSS + 0,1 RAT + 0,2 SENAR). Confira o enquadramento."
                  >
                    <Input id="funrural_percentual" name="funrural_percentual" inputMode="decimal" defaultValue={num(cfg.funrural_percentual)} />
                  </Campo>
                  <Campo rotulo="Quem recolhe" htmlFor="funrural_modo">
                    <Select id="funrural_modo" name="funrural_modo" defaultValue={cfg.funrural_modo ?? "retido_adquirente"}>
                      {Object.entries(MODO_FUNRURAL).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                </div>
              ) : null}
            </fieldset>

            <div className="grid gap-3">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="enviar_email_destinatario" defaultChecked={cfg.enviar_email_destinatario} className="mt-0.5" />
                <span>
                  Enviar a nota ao comprador por e-mail (produção)
                  <span className="block text-xs text-muted-foreground">DANFE em PDF e XML para o e-mail do cadastro do cliente, pelo e-mail do escritório (quando configurado).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="autorizar_escritorio_xml" defaultChecked={cfg.autorizar_escritorio_xml} className="mt-0.5" />
                <span>
                  Autorizar o escritório a baixar o XML na SEFAZ
                  <span className="block text-xs text-muted-foreground">O CNPJ do escritório vai na nota (campo autXML). A nota autorizada também entra sozinha nas notas da empresa.</span>
                </span>
              </label>
            </div>

            <Campo rotulo="Informações complementares padrão" htmlFor="informacoes_padrao" ajuda="Saem em todas as notas (ex.: regime especial, observação fixa).">
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
                  : "Como o cliente autorizou o portal a emitir notas com o certificado digital da empresa (ex.: e-mail do sócio de 20/10/2026). Obrigatório para ligar."
              }
            >
              <Textarea id="autorizacao_texto" name="autorizacao_texto" rows={2} maxLength={2000} />
            </Campo>

            {ambiente === "producao" ? (
              <Alerta tom="alerta">Em produção, as notas têm valor fiscal. Emita antes ao menos uma nota de teste (homologação) e confira o DANFE e os impostos.</Alerta>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <BotaoAcao acao={testarConexao.bind(null, empresaId)} variante="contorno" type="button">
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
// Inscrições (quem emite)
// -----------------------------------------------------------------------------

function FormEmitente({ empresaId, emitente, pessoaFisica, aoSalvar }: { empresaId: string; emitente?: EmitenteNfe; pessoaFisica: boolean; aoSalvar: () => void }) {
  const [municipios, setMunicipios] = React.useState<{ lista: { ibge: string; nome: string }[]; chave: number }>({ lista: [], chave: 0 });
  React.useEffect(() => {
    if (emitente?.uf) listarMunicipios(emitente.uf).then((lista) => setMunicipios((m) => ({ lista, chave: m.chave + 1 })));
  }, [emitente?.uf]);
  return (
    <FormularioAcao acao={salvarEmitente.bind(null, empresaId, emitente?.id ?? null)} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo
                rotulo={pessoaFisica ? "Nome da propriedade" : "Nome do estabelecimento"}
                htmlFor="em-nome"
                obrigatorio
                erro={e.nome}
                ajuda={pessoaFisica ? "Ex.: Fazenda Boa Vista. Cada propriedade tem a própria inscrição estadual." : "Ex.: Matriz, Filial Sinop."}
              >
                <Input id="em-nome" name="nome" maxLength={80} defaultValue={emitente?.nome ?? ""} />
              </Campo>
              <Campo rotulo="Inscrição estadual" htmlFor="em-ie" obrigatorio erro={e.inscricao_estadual} ajuda="Só os números.">
                <Input id="em-ie" name="inscricao_estadual" inputMode="numeric" maxLength={20} defaultValue={emitente?.inscricao_estadual ?? ""} />
              </Campo>
              <Campo rotulo="Logradouro" htmlFor="em-log" obrigatorio erro={e.logradouro} ajuda={pessoaFisica ? "Na zona rural: rodovia, estrada ou o nome da fazenda." : undefined}>
                <Input id="em-log" name="logradouro" maxLength={60} defaultValue={emitente?.logradouro ?? ""} />
              </Campo>
              <div className="grid grid-cols-[7rem_1fr] gap-3">
                <Campo rotulo="Número" htmlFor="em-num" obrigatorio erro={e.numero} ajuda="Sem número: S/N.">
                  <Input id="em-num" name="numero" maxLength={60} defaultValue={emitente?.numero ?? ""} />
                </Campo>
                <Campo rotulo="Complemento" htmlFor="em-comp">
                  <Input id="em-comp" name="complemento" maxLength={60} defaultValue={emitente?.complemento ?? ""} />
                </Campo>
              </div>
              <Campo rotulo="Bairro ou localidade" htmlFor="em-bairro" obrigatorio erro={e.bairro} ajuda={pessoaFisica ? "Na zona rural: Zona Rural." : undefined}>
                <Input id="em-bairro" name="bairro" maxLength={60} defaultValue={emitente?.bairro ?? ""} />
              </Campo>
              <Campo rotulo="CEP" htmlFor="em-cep" obrigatorio erro={e.cep}>
                <Input id="em-cep" name="cep" inputMode="numeric" maxLength={9} defaultValue={emitente?.cep ? formatarCep(emitente.cep) : ""} />
              </Campo>
              <Campo rotulo="Município" htmlFor="em-mun" obrigatorio erro={e.municipio_ibge} className="sm:col-span-2">
                <SeletorMunicipio
                  key={municipios.chave}
                  ufInicial={emitente?.uf ?? null}
                  municipioInicial={emitente?.municipio_ibge ?? null}
                  municipiosIniciais={municipios.lista}
                  idBase="em-mun"
                  nomeUf="em_uf"
                />
              </Campo>
              <Campo rotulo="Telefone" htmlFor="em-tel">
                <Input id="em-tel" name="telefone" inputMode="tel" maxLength={20} defaultValue={emitente?.telefone ?? ""} />
              </Campo>
            </div>
            <fieldset className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-3 sm:p-4 [&>*]:min-w-0">
              <legend className="px-1 text-sm font-medium">Série e numeração</legend>
              <Campo
                rotulo="Série"
                htmlFor="em-serie"
                obrigatorio
                erro={e.serie}
                ajuda={pessoaFisica ? "Produtor pessoa física: 920 a 969." : "Use uma série que a empresa não usa em outro sistema (ex.: 2)."}
              >
                <Input id="em-serie" name="serie" inputMode="numeric" maxLength={3} defaultValue={emitente ? String(emitente.serie) : pessoaFisica ? "920" : ""} />
              </Campo>
              <Campo rotulo="Próximo número (teste)" htmlFor="em-ph">
                <Input id="em-ph" name="proximo_numero_homologacao" inputMode="numeric" defaultValue={String(emitente?.proximo_numero_homologacao ?? 1)} />
              </Campo>
              <Campo rotulo="Próximo número (produção)" htmlFor="em-pp" ajuda="Se a série já foi usada em outro sistema, continue do número seguinte. Só anda para a frente.">
                <Input id="em-pp" name="proximo_numero_producao" inputMode="numeric" defaultValue={String(emitente?.proximo_numero_producao ?? 1)} />
              </Campo>
            </fieldset>
            {emitente ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="inativo" defaultChecked={!emitente.ativo} /> Inativa (não aparece na emissão)
              </label>
            ) : null}
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar inscrição</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function EmitentesNfe({ empresaId, emitentes, pessoaFisica }: { empresaId: string; emitentes: EmitenteNfe[]; pessoaFisica: boolean }) {
  const [editando, setEditando] = React.useState<EmitenteNfe | "novo" | null>(null);
  return (
    <div className="space-y-3">
      {emitentes.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {emitentes.map((em) => (
            <li key={em.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {em.nome} {!em.ativo ? <Badge variante="neutro">Inativa</Badge> : null}
                </p>
                <p className="text-muted-foreground">
                  IE {em.inscricao_estadual} — {em.municipio ?? em.municipio_ibge}/{em.uf} — série {em.serie}, próxima nº {em.proximo_numero_producao} (teste: {em.proximo_numero_homologacao})
                </p>
              </div>
              <Button variante="contorno" tamanho="sm" onClick={() => setEditando(em)}>
                <Pencil /> Editar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {pessoaFisica ? "Cadastre a inscrição estadual de cada propriedade (fazenda) que vende." : "Cadastre a inscrição estadual do estabelecimento que emite."}
        </p>
      )}
      <Button variante="contorno" onClick={() => setEditando("novo")}>
        <Plus /> {pessoaFisica ? "Nova propriedade (inscrição)" : "Nova inscrição"}
      </Button>
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent largura="lg" titulo={editando === "novo" ? "Nova inscrição estadual" : "Editar inscrição"} descricao="Endereço que sai na nota como o do emitente.">
          {editando !== null ? (
            <FormEmitente empresaId={empresaId} emitente={editando === "novo" ? undefined : editando} pessoaFisica={pessoaFisica} aoSalvar={() => setEditando(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Produtos
// -----------------------------------------------------------------------------

const MODELOS_PRODUTO = [
  { rotulo: "Milho em grão (saca de 60 kg)", codigo: "MILHO", descricao: "MILHO EM GRAOS", ncm: "10059010", unidade: "SC", peso: "60" },
  { rotulo: "Milho em grão (tonelada)", codigo: "MILHO-T", descricao: "MILHO EM GRAOS", ncm: "10059010", unidade: "TON", peso: "1000" },
  { rotulo: "Soja em grão (saca de 60 kg)", codigo: "SOJA", descricao: "SOJA EM GRAOS", ncm: "12019000", unidade: "SC", peso: "60" },
  { rotulo: "Soja em grão (tonelada)", codigo: "SOJA-T", descricao: "SOJA EM GRAOS", ncm: "12019000", unidade: "TON", peso: "1000" },
];

function FormProduto({ empresaId, produto, aoSalvar }: { empresaId: string; produto?: ProdutoNfe; aoSalvar: () => void }) {
  const [v, setV] = React.useState({
    codigo: produto?.codigo ?? "",
    descricao: produto?.descricao ?? "",
    ncm: produto?.ncm ?? "",
    unidade: produto?.unidade ?? "",
    peso: num(produto?.peso_kg),
  });
  return (
    <FormularioAcao acao={salvarProduto.bind(null, empresaId, produto?.id ?? null)} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            {!produto ? (
              <Campo rotulo="Começar de um modelo (opcional)" htmlFor="pr-modelo" ajuda="Preenche o NCM, a unidade e o peso. Confira antes de salvar.">
                <Select
                  id="pr-modelo"
                  defaultValue=""
                  onChange={(ev) => {
                    const m = MODELOS_PRODUTO[Number(ev.target.value)];
                    if (m) setV({ codigo: m.codigo, descricao: m.descricao, ncm: m.ncm, unidade: m.unidade, peso: m.peso });
                  }}
                >
                  <option value="">—</option>
                  {MODELOS_PRODUTO.map((m, i) => (
                    <option key={m.codigo} value={i}>
                      {m.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Código" htmlFor="pr-cod" obrigatorio erro={e.codigo} ajuda="Código interno do produto.">
                <Input id="pr-cod" name="codigo" maxLength={60} value={v.codigo} onChange={(ev) => setV({ ...v, codigo: ev.target.value })} />
              </Campo>
              <Campo rotulo="NCM" htmlFor="pr-ncm" obrigatorio erro={e.ncm} ajuda="8 números (milho em grão: 1005.90.10; soja: 1201.90.00).">
                <Input id="pr-ncm" name="ncm" inputMode="numeric" maxLength={10} value={v.ncm} onChange={(ev) => setV({ ...v, ncm: ev.target.value })} />
              </Campo>
              <Campo rotulo="Descrição" htmlFor="pr-desc" obrigatorio erro={e.descricao} className="sm:col-span-2">
                <Input id="pr-desc" name="descricao" maxLength={120} value={v.descricao} onChange={(ev) => setV({ ...v, descricao: ev.target.value })} />
              </Campo>
              <Campo rotulo="Unidade" htmlFor="pr-un" obrigatorio erro={e.unidade} ajuda="Ex.: SC (saca), TON, KG, UN.">
                <Input id="pr-un" name="unidade" maxLength={6} list="pr-unidades" value={v.unidade} onChange={(ev) => setV({ ...v, unidade: ev.target.value.toUpperCase() })} />
                <datalist id="pr-unidades">
                  {["SC", "TON", "KG", "UN", "CX", "LT", "M3", "CB"].map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </Campo>
              <Campo rotulo="Peso de 1 unidade (kg)" htmlFor="pr-peso" erro={e.peso_kg} ajuda="Saca de milho: 60; tonelada: 1000. Usado no peso da nota e no FETHAB.">
                <Input id="pr-peso" name="peso_kg" inputMode="decimal" value={v.peso} onChange={(ev) => setV({ ...v, peso: ev.target.value })} />
              </Campo>
              <Campo rotulo="Preço sugerido (R$)" htmlFor="pr-valor" erro={e.valor_unitario} ajuda="Opcional: quem emite pode mudar.">
                <Input id="pr-valor" name="valor_unitario" inputMode="decimal" defaultValue={num(produto?.valor_unitario)} />
              </Campo>
              <Campo rotulo="Origem da mercadoria" htmlFor="pr-origem">
                <Select id="pr-origem" name="origem" defaultValue={String(produto?.origem ?? 0)}>
                  {Object.entries(ORIGENS).map(([o, r]) => (
                    <option key={o} value={o}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="CEST" htmlFor="pr-cest" ajuda="Só para produto com substituição tributária.">
                <Input id="pr-cest" name="cest" inputMode="numeric" maxLength={9} defaultValue={produto?.cest ?? ""} />
              </Campo>
              <Campo rotulo="Código de barras (GTIN)" htmlFor="pr-gtin" ajuda="Deixe em branco se não tiver (sai SEM GTIN).">
                <Input id="pr-gtin" name="gtin" inputMode="numeric" maxLength={14} defaultValue={produto?.gtin ?? ""} />
              </Campo>
            </div>
            {produto ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="inativo" defaultChecked={!produto.ativo} /> Inativo (não aparece na emissão)
              </label>
            ) : null}
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar produto</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function ProdutosNfe({ empresaId, produtos }: { empresaId: string; produtos: ProdutoNfe[] }) {
  const [editando, setEditando] = React.useState<ProdutoNfe | "novo" | null>(null);
  return (
    <div className="space-y-3">
      {produtos.length ? (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Produto</Th>
                <Th>NCM</Th>
                <Th>Unidade</Th>
                <Th className="text-right">Ações</Th>
              </Tr>
            </THead>
            <TBody>
              {produtos.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <span className="font-medium">{p.descricao}</span> <span className="text-muted-foreground">({p.codigo})</span>{" "}
                    {!p.ativo ? <Badge variante="neutro">Inativo</Badge> : null}
                  </Td>
                  <Td className="numero">{p.ncm.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1.$2.$3")}</Td>
                  <Td>
                    {p.unidade}
                    {p.peso_kg ? <span className="text-muted-foreground"> ({num(p.peso_kg)} kg)</span> : null}
                  </Td>
                  <Td className="text-right">
                    <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(p)}>
                      <Pencil /> Editar
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <EstadoVazio titulo="Nenhum produto" descricao="Cadastre o que a empresa vende (ex.: milho em grão, com NCM e peso da saca)." />
      )}
      <Button variante="contorno" onClick={() => setEditando("novo")}>
        <Plus /> Novo produto
      </Button>
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent largura="lg" titulo={editando === "novo" ? "Novo produto" : "Editar produto"}>
          {editando !== null ? <FormProduto empresaId={empresaId} produto={editando === "novo" ? undefined : editando} aoSalvar={() => setEditando(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Operações (regras fiscais)
// -----------------------------------------------------------------------------

const CFOP_FRETE: Record<string, string> = {
  "51": "a serviço de transporte da mesma natureza",
  "52": "a estabelecimento industrial",
  "53": "a estabelecimento comercial",
  "54": "a prestador de serviço de comunicação",
  "55": "a geradora ou distribuidora de energia elétrica",
  "56": "a estabelecimento de produtor rural",
  "57": "a não contribuinte",
  "59": "com mercadoria dispensada de nota fiscal",
  "60": "a contribuinte substituto (o remetente recolhe o ICMS do frete)",
};

interface ModeloOperacao {
  rotulo: string;
  nome: string;
  natureza: string;
  destino: OperacaoNfe["destino"];
  cfop: string;
  finalidade?: number;
  consumidor_final?: boolean;
  difal_metodo?: string;
  incide_funrural?: boolean;
}

const MODELOS_OPERACAO: ModeloOperacao[] = [
  { rotulo: "Venda de produção própria para outro estado (6101)", nome: "Venda de produção - outro estado", natureza: "VENDA DE PRODUCAO DO ESTABELECIMENTO", destino: "interestadual", cfop: "6101" },
  { rotulo: "Venda de produção própria dentro do estado (5101)", nome: "Venda de produção - dentro do estado", natureza: "VENDA DE PRODUCAO DO ESTABELECIMENTO", destino: "interna", cfop: "5101" },
  {
    rotulo: "Venda de produtor rural para outro estado (6101, com FUNRURAL)",
    nome: "Venda de produção rural - outro estado",
    natureza: "VENDA DE PRODUCAO RURAL",
    destino: "interestadual",
    cfop: "6101",
    incide_funrural: true,
  },
  { rotulo: "Venda de mercadoria comprada para outro estado (6102)", nome: "Revenda - outro estado", natureza: "VENDA DE MERCADORIA ADQUIRIDA", destino: "interestadual", cfop: "6102" },
  { rotulo: "Venda de mercadoria comprada dentro do estado (5102)", nome: "Revenda - dentro do estado", natureza: "VENDA DE MERCADORIA ADQUIRIDA", destino: "interna", cfop: "5102" },
  {
    rotulo: "Venda a consumidor (não contribuinte) de outro estado, com DIFAL (6108)",
    nome: "Venda a consumidor de outro estado",
    natureza: "VENDA DE MERCADORIA A NAO CONTRIBUINTE",
    destino: "interestadual",
    cfop: "6108",
    consumidor_final: true,
    difal_metodo: "base_unica",
  },
];

/** Contribuições estaduais da operação (ex.: FETHAB em MT), enviadas como JSON no campo "contribuicoes". */
function EditorContribuicoes({ inicial }: { inicial: ContribuicaoNfe[] }) {
  const [linhas, setLinhas] = React.useState(
    inicial.map((c) => ({
      nome: c.nome,
      tipo: c.tipo,
      valor: num(c.valor),
      valorUpf: num(c.valorUpf),
      ncms: (c.ncms ?? []).join(", "),
      codigoReceita: c.codigoReceita ?? "",
    })),
  );
  const json = JSON.stringify(
    linhas.map((l) => ({
      nome: l.nome.trim(),
      tipo: l.tipo,
      valor: lerBr(l.valor),
      valorUpf: l.tipo === "upf_por_tonelada" ? lerBr(l.valorUpf) || null : null,
      ncms: l.ncms
        .split(/[,;\s]+/)
        .map((n) => n.replace(/\D/g, ""))
        .filter(Boolean),
      codigoReceita: l.codigoReceita.trim() || null,
    })),
  );
  const mudar = (i: number, campo: keyof (typeof linhas)[number], valor: string) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  return (
    <div className="space-y-3">
      <input type="hidden" name="contribuicoes" value={json} />
      {linhas.map((l, i) => (
        <div key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Campo rotulo="Nome" htmlFor={`ct-nome-${i}`}>
            <Input id={`ct-nome-${i}`} value={l.nome} maxLength={60} onChange={(ev) => mudar(i, "nome", ev.target.value)} />
          </Campo>
          <Campo rotulo="Cálculo" htmlFor={`ct-tipo-${i}`}>
            <Select id={`ct-tipo-${i}`} value={l.tipo} onChange={(ev) => mudar(i, "tipo", ev.target.value)}>
              {Object.entries(TIPO_CONTRIBUICAO).map(([t, r]) => (
                <option key={t} value={t}>
                  {r}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo={l.tipo === "valor_por_tonelada" ? "R$ por tonelada" : "Percentual (%)"} htmlFor={`ct-valor-${i}`}>
            <Input id={`ct-valor-${i}`} inputMode="decimal" value={l.valor} onChange={(ev) => mudar(i, "valor", ev.target.value)} />
          </Campo>
          {l.tipo === "upf_por_tonelada" ? (
            <Campo rotulo="Valor da UPF (R$)" htmlFor={`ct-upf-${i}`} ajuda="Atualize quando o estado publicar a UPF nova.">
              <Input id={`ct-upf-${i}`} inputMode="decimal" value={l.valorUpf} onChange={(ev) => mudar(i, "valorUpf", ev.target.value)} />
            </Campo>
          ) : null}
          <Campo rotulo="Só para os NCM" htmlFor={`ct-ncm-${i}`} ajuda="Separe por vírgula. Vazio: todos os produtos.">
            <Input id={`ct-ncm-${i}`} value={l.ncms} onChange={(ev) => mudar(i, "ncms", ev.target.value)} />
          </Campo>
          <Campo rotulo="Código de receita" htmlFor={`ct-rec-${i}`}>
            <Input id={`ct-rec-${i}`} value={l.codigoReceita} maxLength={20} onChange={(ev) => mudar(i, "codigoReceita", ev.target.value)} />
          </Campo>
          <div className="flex items-end justify-end sm:col-span-3">
            <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>
              <Trash2 /> Remover
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variante="contorno"
          tamanho="sm"
          disabled={linhas.length >= 10}
          onClick={() => setLinhas([...linhas, { nome: "", tipo: "percentual_valor", valor: "", valorUpf: "", ncms: "", codigoReceita: "" }])}
        >
          <Plus /> Contribuição
        </Button>
        <Button
          type="button"
          variante="contorno"
          tamanho="sm"
          disabled={linhas.length >= 10}
          onClick={() => setLinhas([...linhas, { nome: "FETHAB", tipo: "upf_por_tonelada", valor: "", valorUpf: "", ncms: "", codigoReceita: "" }])}
        >
          <Plus /> FETHAB (MT)
        </Button>
      </div>
    </div>
  );
}

function FormOperacao({
  empresaId,
  operacao,
  simples,
  pisCofins,
  classes,
  aoSalvar,
}: {
  empresaId: string;
  operacao?: OperacaoNfe;
  simples: boolean;
  pisCofins: PisCofinsPadrao;
  classes: ClasseIbsCbs[];
  aoSalvar: () => void;
}) {
  const [modelo, setModelo] = React.useState<ModeloOperacao | null>(null);
  // Operação nova no regime normal: a venda já vem com o PIS e a Cofins tributados (alíquota básica do regime)
  const padraoPis: Partial<OperacaoNfe> =
    !operacao && pisCofins ? { pis_cst: "01", cofins_cst: "01", pis_aliquota: pisCofins.pis, cofins_aliquota: pisCofins.cofins, excluir_icms_pis_cofins: true } : {};
  const base = { ...padraoPis, ...operacao, ...(modelo ?? {}) } as Partial<OperacaoNfe>;
  return (
    <div className="space-y-4">
      {!operacao ? (
        <Campo rotulo="Começar de um modelo (opcional)" htmlFor="op-modelo" ajuda="Preenche a natureza, o destino e o CFOP. Os impostos ficam para o escritório escolher.">
          <Select id="op-modelo" defaultValue="" onChange={(ev) => setModelo(MODELOS_OPERACAO[Number(ev.target.value)] ?? null)}>
            <option value="">—</option>
            {MODELOS_OPERACAO.map((m, i) => (
              <option key={m.cfop + m.nome} value={i}>
                {m.rotulo}
              </option>
            ))}
          </Select>
        </Campo>
      ) : null}
      <CamposOperacao
        key={modelo?.nome ?? "inicial"}
        empresaId={empresaId}
        id={operacao?.id ?? null}
        base={base}
        simples={simples}
        regimeNormal={Boolean(pisCofins)}
        classes={classes}
        aoSalvar={aoSalvar}
      />
    </div>
  );
}

function CamposOperacao({
  empresaId,
  id,
  base,
  simples,
  regimeNormal,
  classes,
  aoSalvar,
}: {
  empresaId: string;
  id: string | null;
  base: Partial<OperacaoNfe>;
  simples: boolean;
  /** Empresa do Lucro Real ou Presumido (paga PIS e Cofins sobre as vendas). */
  regimeNormal: boolean;
  classes: ClasseIbsCbs[];
  aoSalvar: () => void;
}) {
  const [destino, setDestino] = React.useState<OperacaoNfe["destino"]>(base.destino ?? "interestadual");
  const [cst, setCst] = React.useState(base.icms_cst ?? "");
  const [porOperacao, setPorOperacao] = React.useState(base.icms_por_operacao ?? false);
  const [difal, setDifal] = React.useState(base.difal_metodo ?? "");
  const [frete, setFrete] = React.useState(base.frete_icms_retido ?? false);
  const [pis, setPis] = React.useState(base.pis_cst ?? "");
  const [cofins, setCofins] = React.useState(base.cofins_cst ?? "");
  const [classe, setClasse] = React.useState(base.ibscbs_cclass_trib ?? "");
  const csts = simples ? CSOSN : CST_ICMS;
  const temAliquota = ["00", "20", "51", "90", "900"].includes(cst);
  const temReducao = ["20", "51", "90", "900"].includes(cst);
  const prefixo = destino === "interna" ? "5" : "6";
  const escolhida = classes.find((c) => c.cclass_trib === classe);
  const porCst = React.useMemo(() => {
    const m = new Map<string, ClasseIbsCbs[]>();
    for (const c of classes) m.set(c.cst, [...(m.get(c.cst) ?? []), c]);
    return [...m.entries()];
  }, [classes]);

  return (
    <FormularioAcao acao={salvarOperacao.bind(null, empresaId, id)} aoSucesso={aoSalvar} className="space-y-5">
      {({ estado, pendente }) => {
        const e = estado.erros ?? {};
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Nome da operação" htmlFor="op-nome" obrigatorio erro={e.nome} ajuda="Como aparece para quem emite (ex.: Venda de milho para GO).">
                <Input id="op-nome" name="nome" maxLength={80} defaultValue={base.nome ?? ""} />
              </Campo>
              <Campo rotulo="Natureza da operação" htmlFor="op-nat" obrigatorio erro={e.natureza} ajuda="Texto que sai na nota.">
                <Input id="op-nat" name="natureza" maxLength={60} defaultValue={base.natureza ?? ""} />
              </Campo>
              <Campo rotulo="Destino" htmlFor="op-dest" obrigatorio>
                <Select id="op-dest" name="destino" value={destino} onChange={(ev) => setDestino(ev.target.value as OperacaoNfe["destino"])}>
                  {Object.entries(DESTINO).map(([d, r]) => (
                    <option key={d} value={d}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="CFOP" htmlFor="op-cfop" obrigatorio erro={e.cfop} ajuda={`4 números começando com ${destino === "interna" ? 5 : destino === "interestadual" ? 6 : 7}.`}>
                <Input id="op-cfop" name="cfop" inputMode="numeric" maxLength={5} defaultValue={base.cfop ?? ""} />
              </Campo>
              <Campo rotulo="Finalidade" htmlFor="op-fin">
                <Select id="op-fin" name="finalidade" defaultValue={String(base.finalidade ?? 1)}>
                  {Object.entries(FINALIDADE).map(([f, r]) => (
                    <option key={f} value={f}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <label className="flex items-start gap-2 self-end text-sm">
                <Checkbox name="consumidor_final" defaultChecked={base.consumidor_final ?? false} className="mt-0.5" />
                <span>
                  Comprador é consumidor final
                  <span className="block text-xs text-muted-foreground">Ex.: pessoa física ou empresa que usa a mercadoria (não revende).</span>
                </span>
              </label>
            </div>

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">ICMS</legend>
              <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
                <Campo rotulo={simples ? "CSOSN" : "CST"} htmlFor="op-cst" obrigatorio erro={e.icms_cst} className="sm:col-span-3">
                  <Select id="op-cst" name="icms_cst" value={cst} onChange={(ev) => setCst(ev.target.value)}>
                    <option value="">Escolha</option>
                    {Object.entries(csts).map(([c, r]) => (
                      <option key={c} value={c}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {temAliquota ? (
                  <Campo
                    rotulo="Alíquota (%)"
                    htmlFor="op-aliq"
                    obrigatorio={cst !== "90" && cst !== "900"}
                    erro={e.icms_aliquota}
                    ajuda={destino === "interestadual" ? "Para outro estado: 12% (7% quando sai do Sul/Sudeste, exceto ES, para N, NE, CO ou ES; 4% importados)." : "Alíquota interna do estado."}
                  >
                    <Input id="op-aliq" name="icms_aliquota" inputMode="decimal" defaultValue={num(base.icms_aliquota)} />
                  </Campo>
                ) : null}
                {temReducao ? (
                  <Campo rotulo="Redução da base (%)" htmlFor="op-red" obrigatorio={cst === "20"} erro={e.icms_reducao}>
                    <Input id="op-red" name="icms_reducao" inputMode="decimal" defaultValue={num(base.icms_reducao)} />
                  </Campo>
                ) : null}
                {cst === "51" ? (
                  <Campo rotulo="Diferimento (%)" htmlFor="op-dif" erro={e.icms_diferimento} ajuda="Vazio: 100% diferido.">
                    <Input id="op-dif" name="icms_diferimento" inputMode="decimal" defaultValue={num(base.icms_diferimento)} />
                  </Campo>
                ) : null}
                {cst === "101" ? (
                  <Campo rotulo="Crédito do Simples (%)" htmlFor="op-cred" obrigatorio erro={e.icms_credito_sn} ajuda="Alíquota do ICMS da faixa do Simples.">
                    <Input id="op-cred" name="icms_credito_sn" inputMode="decimal" defaultValue={num(base.icms_credito_sn)} />
                  </Campo>
                ) : null}
                {!simples ? (
                  <Campo rotulo="Código do benefício (cBenef)" htmlFor="op-benef" erro={e.icms_beneficio} ajuda="Só nos estados que exigem (8 ou 10 caracteres).">
                    <Input id="op-benef" name="icms_beneficio" maxLength={10} defaultValue={base.icms_beneficio ?? ""} />
                  </Campo>
                ) : null}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="icms_por_operacao" checked={porOperacao} onChange={(ev) => setPorOperacao(ev.target.checked)} className="mt-0.5" />
                <span>
                  O ICMS é pago a cada nota, antes da saída da mercadoria
                  <span className="block text-xs text-muted-foreground">
                    Ex.: em MT, a venda para outro estado de quem não tem regime especial. O portal cria a guia do ICMS da nota para o escritório gerar e anexar.
                  </span>
                </span>
              </label>
              {porOperacao ? (
                <Campo rotulo="Código de receita do ICMS" htmlFor="op-rec" ajuda="Código da guia na SEFAZ do estado (opcional; ajuda a gerar a guia)." className="sm:max-w-xs">
                  <Input id="op-rec" name="icms_codigo_receita" maxLength={20} defaultValue={base.icms_codigo_receita ?? ""} />
                </Campo>
              ) : null}
            </fieldset>

            {destino === "interestadual" ? (
              <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
                <legend className="px-1 text-sm font-medium">DIFAL (complementação de alíquota)</legend>
                <p className="text-xs text-muted-foreground">
                  Na venda a consumidor final (não contribuinte) de outro estado, o vendedor paga a diferença entre a alíquota interna do destino e a interestadual, com o FCP. As
                  alíquotas internas vêm da tabela de ICMS por estado do portal.
                </p>
                <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                  <Campo rotulo="Cálculo" htmlFor="op-difal">
                    <Select id="op-difal" name="difal_metodo" value={difal} onChange={(ev) => setDifal(ev.target.value)}>
                      <option value="">Não calcular DIFAL</option>
                      <option value="base_unica">Base única</option>
                      <option value="base_dupla">Base dupla (estados que exigem)</option>
                    </Select>
                  </Campo>
                  {difal ? (
                    <Campo rotulo="Código de receita (GNRE)" htmlFor="op-difal-rec" ajuda="Normalmente 100102 (ICMS consumidor final).">
                      <Input id="op-difal-rec" name="difal_codigo_receita" maxLength={20} defaultValue={base.difal_codigo_receita ?? ""} />
                    </Campo>
                  ) : null}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">ICMS do frete</legend>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="frete_icms_retido" checked={frete} onChange={(ev) => setFrete(ev.target.checked)} className="mt-0.5" />
                <span>
                  O vendedor recolhe o ICMS do frete no lugar do transportador
                  <span className="block text-xs text-muted-foreground">
                    Ex.: frete pago a caminhoneiro autônomo ou a transportadora de outro estado, quando a lei do estado manda o remetente recolher. Na emissão, quem emite informa
                    o valor do frete contratado; o imposto sai na nota (retenção do transporte) e vira uma guia.
                  </span>
                </span>
              </label>
              {frete ? (
                <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                  <Campo rotulo="Alíquota (%)" htmlFor="op-fr-aliq" obrigatorio erro={e.frete_aliquota}>
                    <Input id="op-fr-aliq" name="frete_aliquota" inputMode="decimal" defaultValue={num(base.frete_aliquota)} />
                  </Campo>
                  <Campo rotulo="Redução da base (%)" htmlFor="op-fr-red" erro={e.frete_reducao} ajuda="Se a lei do estado reduz a base do frete.">
                    <Input id="op-fr-red" name="frete_reducao" inputMode="decimal" defaultValue={num(base.frete_reducao)} />
                  </Campo>
                  <Campo rotulo="CFOP do frete" htmlFor="op-fr-cfop" obrigatorio erro={e.frete_cfop}>
                    <Select id="op-fr-cfop" name="frete_cfop" defaultValue={base.frete_cfop ?? ""}>
                      <option value="">Escolha</option>
                      {Object.entries(CFOP_FRETE).map(([f, r]) => (
                        <option key={f} value={`${prefixo}3${f}`}>
                          {prefixo}.3{f} — Transporte {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Código de receita do frete" htmlFor="op-fr-rec">
                    <Input id="op-fr-rec" name="frete_codigo_receita" maxLength={20} defaultValue={base.frete_codigo_receita ?? ""} />
                  </Campo>
                </div>
              ) : null}
            </fieldset>

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">PIS e Cofins</legend>
              <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="CST do PIS" htmlFor="op-pis" obrigatorio erro={e.pis_cst}>
                  <Select id="op-pis" name="pis_cst" value={pis} onChange={(ev) => setPis(ev.target.value)}>
                    <option value="">Escolha</option>
                    {Object.entries(CST_PIS_COFINS).map(([c, r]) => (
                      <option key={c} value={c}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Alíquota do PIS (%)" htmlFor="op-pis-aliq" obrigatorio={["01", "02"].includes(pis)} erro={e.pis_aliquota} ajuda="Ex.: 0,65 (cumulativo) ou 1,65 (não cumulativo).">
                  <Input id="op-pis-aliq" name="pis_aliquota" inputMode="decimal" defaultValue={num(base.pis_aliquota)} />
                </Campo>
                <Campo rotulo="CST da Cofins" htmlFor="op-cofins" obrigatorio erro={e.cofins_cst}>
                  <Select id="op-cofins" name="cofins_cst" value={cofins} onChange={(ev) => setCofins(ev.target.value)}>
                    <option value="">Escolha</option>
                    {Object.entries(CST_PIS_COFINS).map(([c, r]) => (
                      <option key={c} value={c}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Alíquota da Cofins (%)" htmlFor="op-cofins-aliq" obrigatorio={["01", "02"].includes(cofins)} erro={e.cofins_aliquota} ajuda="Ex.: 3 (cumulativo) ou 7,6 (não cumulativo).">
                  <Input id="op-cofins-aliq" name="cofins_aliquota" inputMode="decimal" defaultValue={num(base.cofins_aliquota)} />
                </Campo>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="excluir_icms_pis_cofins" defaultChecked={base.excluir_icms_pis_cofins ?? true} /> Tirar o ICMS da base do PIS e da Cofins (Tema 69 do STF)
              </label>
              {regimeNormal && (SEM_PIS_COFINS.includes(pis) || SEM_PIS_COFINS.includes(cofins)) ? (
                <Alerta tom="alerta">
                  Com este CST a nota sai <strong>sem PIS e Cofins</strong>. Use só quando a venda for de fato isenta, com alíquota zero, suspensa ou sem incidência (ex.:
                  suspensão da Lei 10.925/2004 na venda de cerealista para agroindústria). A venda comum de milho e soja em grão por empresa do Lucro Real ou Presumido é
                  tributada: CST 01 com a alíquota do regime.
                </Alerta>
              ) : null}
            </fieldset>

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">IBS e CBS (reforma tributária)</legend>
              <p className="text-xs text-muted-foreground">
                Obrigatórios na nota do regime normal desde 03/08/2026. Em 2026 as alíquotas são de teste (CBS 0,9% e IBS 0,1%) e não entram no total da nota.
              </p>
              <Campo rotulo="Classificação tributária (cClassTrib)" htmlFor="op-class" obrigatorio={!simples} erro={e.ibscbs_cclass_trib}>
                <Select id="op-class" name="ibscbs_cclass_trib" value={classe} onChange={(ev) => setClasse(ev.target.value)}>
                  <option value="">{simples ? "Não informar (Simples Nacional)" : "Escolha"}</option>
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
            </fieldset>

            <fieldset className="space-y-4 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">Produtor rural e contribuições estaduais</legend>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="incide_funrural" defaultChecked={base.incide_funrural ?? false} className="mt-0.5" />
                <span>
                  Informar o FUNRURAL nesta operação
                  <span className="block text-xs text-muted-foreground">Usa o percentual da configuração da emissão.</span>
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                Contribuições pagas por nota, como o FETHAB em MT (percentual da UPF por tonelada). Confira o percentual e o valor da UPF vigentes; o portal calcula pelo peso dos
                produtos e cria a guia.
              </p>
              <EditorContribuicoes inicial={base.contribuicoes ?? []} />
            </fieldset>

            <Campo rotulo="Informações complementares desta operação" htmlFor="op-info" ajuda="Ex.: base legal de redução, diferimento ou isenção.">
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

export function OperacoesNfe({
  empresaId,
  operacoes,
  simples,
  pisCofins = null,
  classes,
}: {
  empresaId: string;
  operacoes: OperacaoNfe[];
  simples: boolean;
  /** Alíquotas básicas do PIS e da Cofins do regime (operações novas já vêm tributadas). */
  pisCofins?: PisCofinsPadrao;
  classes: ClasseIbsCbs[];
}) {
  const [editando, setEditando] = React.useState<OperacaoNfe | "novo" | null>(null);
  return (
    <div className="space-y-3">
      {operacoes.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {operacoes.map((o) => {
            const guias = [
              o.icms_por_operacao ? "ICMS por nota" : null,
              o.difal_metodo ? "DIFAL" : null,
              o.frete_icms_retido ? "ICMS do frete" : null,
              ...o.contribuicoes.map((c) => c.nome),
            ].filter(Boolean);
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {o.nome} {!o.ativa ? <Badge variante="neutro">Inativa</Badge> : null}
                  </p>
                  <p className="text-muted-foreground">
                    CFOP {o.cfop} — ICMS {o.icms_cst}
                    {o.icms_aliquota != null ? ` ${num(o.icms_aliquota)}%` : ""} — PIS {o.pis_cst}
                    {o.pis_aliquota != null && !SEM_PIS_COFINS.includes(o.pis_cst) ? ` ${num(o.pis_aliquota)}%` : ""} / Cofins {o.cofins_cst}
                    {o.cofins_aliquota != null && !SEM_PIS_COFINS.includes(o.cofins_cst) ? ` ${num(o.cofins_aliquota)}%` : ""}
                    {o.ibscbs_cclass_trib ? ` — IBS/CBS ${o.ibscbs_cclass_trib}` : ""}
                    {o.incide_funrural ? " — FUNRURAL" : ""}
                  </p>
                  {guias.length ? <p className="text-xs text-muted-foreground">Guias por nota: {guias.join(", ")}</p> : null}
                </div>
                <Button variante="contorno" tamanho="sm" onClick={() => setEditando(o)}>
                  <Pencil /> Editar
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EstadoVazio titulo="Nenhuma operação" descricao="A operação guarda as regras fiscais (CFOP, ICMS, PIS/Cofins, IBS/CBS e guias). Quem emite só escolhe a operação." />
      )}
      <Button variante="contorno" onClick={() => setEditando("novo")}>
        <Plus /> Nova operação
      </Button>
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent largura="xl" titulo={editando === "novo" ? "Nova operação" : "Editar operação"} descricao="Regras fiscais aplicadas em toda nota emitida com esta operação.">
          {editando !== null ? (
            <FormOperacao
              empresaId={empresaId}
              operacao={editando === "novo" ? undefined : editando}
              simples={simples}
              pisCofins={pisCofins}
              classes={classes}
              aoSalvar={() => setEditando(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
