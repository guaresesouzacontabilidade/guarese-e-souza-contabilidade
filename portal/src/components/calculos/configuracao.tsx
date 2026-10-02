"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { adicionarAjuste, removerAjuste, salvarMes, salvarParametros } from "@/lib/calculos/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia } from "@/lib/formatos";

export interface ParametrosForm {
  inicio_atividade: string | null;
  mei_atividade: string | null;
  anexo_mercadorias: string;
  anexo_servicos: string;
  fator_r: boolean;
  presuncao_irpj_mercadorias: number;
  presuncao_irpj_servicos: number;
  presuncao_csll_mercadorias: number;
  presuncao_csll_servicos: number;
  acrescimo_lc224: boolean;
  creditos_pis_cofins: boolean;
  aliquota_iss: number | null;
  calcular_icms: boolean;
  calcular_ipi: boolean;
  rat: number;
  fap: number;
  terceiros: number;
  pro_labore: number;
  socios_pro_labore: number;
}

export const PARAMETROS_PADRAO: ParametrosForm = {
  inicio_atividade: null,
  mei_atividade: null,
  anexo_mercadorias: "I",
  anexo_servicos: "III",
  fator_r: false,
  presuncao_irpj_mercadorias: 8,
  presuncao_irpj_servicos: 32,
  presuncao_csll_mercadorias: 12,
  presuncao_csll_servicos: 32,
  acrescimo_lc224: true,
  creditos_pis_cofins: true,
  aliquota_iss: null,
  calcular_icms: true,
  calcular_ipi: false,
  rat: 2,
  fap: 1,
  terceiros: 5.8,
  pro_labore: 0,
  socios_pro_labore: 1,
};

const num = (v: number | null | undefined, casas = 2) => (v == null ? "" : String(Number(v.toFixed(casas))).replace(".", ","));

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-titulo">{titulo}</legend>
      {descricao ? <p className="text-xs text-muted-foreground">{descricao}</p> : null}
      {children}
    </fieldset>
  );
}

function Marcar({ nome, marcado, children, ajuda }: { nome: string; marcado: boolean; children: React.ReactNode; ajuda?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox name={nome} defaultChecked={marcado} className="mt-0.5" />
      <span>
        {children}
        {ajuda ? <span className="block text-xs text-muted-foreground">{ajuda}</span> : null}
      </span>
    </label>
  );
}

/** Parâmetros dos cálculos (somente a equipe do escritório). */
export function FormParametros({ empresaId, regime, parametros }: { empresaId: string; regime: string | null; parametros: ParametrosForm | null }) {
  const p = parametros ?? PARAMETROS_PADRAO;
  const acao = salvarParametros.bind(null, empresaId);
  const mei = regime === "mei";
  const simples = regime === "simples_nacional";
  const lucro = regime === "lucro_presumido" || regime === "lucro_real";

  const secaoMei = (
    <Secao titulo="MEI" descricao="O DAS-MEI tem valor fixo: INSS (5% do salário mínimo) mais R$ 1,00 de ICMS e/ou R$ 5,00 de ISS.">
      <Campo rotulo="Atividade do MEI" htmlFor="cp-mei">
        <Select id="cp-mei" name="mei_atividade" defaultValue={p.mei_atividade ?? ""} className="max-w-sm">
          <option value="">Selecione</option>
          <option value="comercio_industria">Comércio ou indústria (ICMS)</option>
          <option value="servicos">Serviços (ISS)</option>
          <option value="comercio_servicos">Comércio e serviços (ICMS e ISS)</option>
          <option value="caminhoneiro">MEI caminhoneiro (INSS de 12%)</option>
        </Select>
      </Campo>
    </Secao>
  );
  const secaoSimples = (
    <Secao titulo="Simples Nacional" descricao="A alíquota efetiva sai da receita dos 12 meses anteriores (RBT12) e do anexo de cada tipo de receita.">
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Campo rotulo="Vendas (notas fiscais de produtos)" htmlFor="cp-am">
          <Select id="cp-am" name="anexo_mercadorias" defaultValue={p.anexo_mercadorias}>
            <option value="I">Anexo I — comércio</option>
            <option value="II">Anexo II — indústria</option>
          </Select>
        </Campo>
        <Campo rotulo="Serviços (notas fiscais de serviço)" htmlFor="cp-as">
          <Select id="cp-as" name="anexo_servicos" defaultValue={p.anexo_servicos}>
            <option value="III">Anexo III</option>
            <option value="IV">Anexo IV (INSS patronal fora do DAS)</option>
            <option value="V">Anexo V</option>
          </Select>
        </Campo>
      </div>
      <Marcar nome="fator_r" marcado={p.fator_r} ajuda="Com folha de 12 meses igual ou maior que 28% da receita, os serviços do Anexo V são tributados pelo Anexo III.">
        Serviços sujeitos ao Fator R
      </Marcar>
    </Secao>
  );
  const secaoLucro = (
    <Secao
      titulo="Lucro Presumido e Lucro Real"
      descricao="Percentuais de presunção do IRPJ e da CSLL (também usados na estimativa mensal do Lucro Real). Padrão: 8% e 12% nas vendas, 32% nos serviços."
    >
      <div className="grid gap-3 sm:grid-cols-4 [&>*]:min-w-0">
        <Campo rotulo="IRPJ — vendas (%)" htmlFor="cp-pim">
          <Input id="cp-pim" name="presuncao_irpj_mercadorias" inputMode="decimal" defaultValue={num(p.presuncao_irpj_mercadorias)} />
        </Campo>
        <Campo rotulo="IRPJ — serviços (%)" htmlFor="cp-pis">
          <Input id="cp-pis" name="presuncao_irpj_servicos" inputMode="decimal" defaultValue={num(p.presuncao_irpj_servicos)} />
        </Campo>
        <Campo rotulo="CSLL — vendas (%)" htmlFor="cp-pcm">
          <Input id="cp-pcm" name="presuncao_csll_mercadorias" inputMode="decimal" defaultValue={num(p.presuncao_csll_mercadorias)} />
        </Campo>
        <Campo rotulo="CSLL — serviços (%)" htmlFor="cp-pcs">
          <Input id="cp-pcs" name="presuncao_csll_servicos" inputMode="decimal" defaultValue={num(p.presuncao_csll_servicos)} />
        </Campo>
      </div>
      <Marcar
        nome="acrescimo_lc224"
        marcado={p.acrescimo_lc224}
        ajuda="Presunção 10% maior sobre a receita acima de R$ 5 milhões no ano (R$ 1,25 milhão por trimestre). Desmarque se a empresa tiver decisão judicial afastando o acréscimo."
      >
        Aplicar o acréscimo da LC 224/2025 (Lucro Presumido)
      </Marcar>
      <Marcar nome="creditos_pis_cofins" marcado={p.creditos_pis_cofins} ajuda="Lucro Real: descontar créditos de PIS/Cofins sobre as compras das notas de entrada.">
        Créditos de PIS/Cofins sobre compras
      </Marcar>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Campo rotulo="Alíquota do ISS do município (%)" htmlFor="cp-iss" ajuda="De 2% a 5%, conforme o serviço. Usada quando a nota não traz o valor do ISS.">
          <Input id="cp-iss" name="aliquota_iss" inputMode="decimal" defaultValue={num(p.aliquota_iss)} className="max-w-32" />
        </Campo>
        <div className="space-y-2 pt-6">
          <Marcar nome="calcular_icms" marcado={p.calcular_icms}>
            Calcular o ICMS pelas notas (débitos − créditos)
          </Marcar>
          <Marcar nome="calcular_ipi" marcado={p.calcular_ipi}>
            Calcular o IPI pelas notas (indústria)
          </Marcar>
        </div>
      </div>
    </Secao>
  );
  const outros = [!mei && secaoMei, !simples && secaoSimples, !lucro && secaoLucro].filter(Boolean);

  return (
    <FormularioAcao acao={acao} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          {mei ? secaoMei : null}
          {simples ? secaoSimples : null}
          {lucro ? secaoLucro : null}
          <Secao titulo="Folha e pró-labore" descricao="Os salários vêm do cadastro de colaboradores. Fora do Simples (e no Anexo IV) entram também o INSS patronal, o RAT e terceiros.">
            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Campo rotulo="Pró-labore mensal (total)" htmlFor="cp-pl" erro={estado.erros?.pro_labore}>
                <CampoValor id="cp-pl" name="pro_labore" valorInicial={p.pro_labore} />
              </Campo>
              <Campo rotulo="Sócios que recebem" htmlFor="cp-socios" erro={estado.erros?.socios_pro_labore}>
                <Input id="cp-socios" name="socios_pro_labore" type="number" min={1} max={50} defaultValue={p.socios_pro_labore} />
              </Campo>
              <Campo rotulo="Início das atividades" htmlFor="cp-inicio" erro={estado.erros?.inicio_atividade} ajuda="Para empresas com menos de 12 meses.">
                <Input id="cp-inicio" name="inicio_atividade" type="date" defaultValue={p.inicio_atividade ?? ""} />
              </Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Campo rotulo="RAT (%)" htmlFor="cp-rat" erro={estado.erros?.rat}>
                <Select id="cp-rat" name="rat" defaultValue={String(p.rat)}>
                  <option value="1">1% — risco leve</option>
                  <option value="2">2% — risco médio</option>
                  <option value="3">3% — risco grave</option>
                </Select>
              </Campo>
              <Campo rotulo="FAP" htmlFor="cp-fap" erro={estado.erros?.fap} ajuda="De 0,5000 a 2,0000.">
                <Input id="cp-fap" name="fap" inputMode="decimal" defaultValue={num(p.fap, 4)} />
              </Campo>
              <Campo rotulo="Terceiros (%)" htmlFor="cp-terc" erro={estado.erros?.terceiros} ajuda="Outras entidades; 5,8% na maioria das empresas.">
                <Input id="cp-terc" name="terceiros" inputMode="decimal" defaultValue={num(p.terceiros)} />
              </Campo>
            </div>
          </Secao>
          {outros.length ? (
            <details className="rounded-lg border border-dashed border-border p-3">
              <summary className="cursor-pointer text-sm text-muted-foreground">Parâmetros de outros regimes (usados se a empresa mudar de regime)</summary>
              <div className="mt-3 space-y-4">{outros}</div>
            </details>
          ) : null}
          {Object.entries(estado.erros ?? {}).filter(([k]) => k.startsWith("presuncao") || k === "aliquota_iss" || k === "mei_atividade").length ? (
            <p className="text-sm text-perigo">Revise os percentuais informados.</p>
          ) : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar configuração</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export interface MesConfig {
  competencia: string;
  vendas: number;
  servicos: number;
  notas: number;
  informado: { receita_mercadorias: number | null; receita_servicos: number | null; folha_fator_r: number | null; observacao: string | null } | null;
}

function DialogMes({ empresaId, mes }: { empresaId: string; mes: MesConfig }) {
  const [aberto, setAberto] = React.useState(false);
  const acao = salvarMes.bind(null, empresaId, mes.competencia);
  const inf = mes.informado;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="sm" aria-label={`Informar valores de ${formatarCompetencia(mes.competencia)}`}>
          <Pencil /> Informar
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo={`Valores de ${formatarCompetencia(mes.competencia, true)}`}
        descricao="A receita informada substitui a das notas fiscais neste mês. Deixe tudo em branco para voltar a usar as notas."
      >
        <FormularioAcao acao={acao} aoSucesso={() => setAberto(false)} className="space-y-3">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="Receita de vendas" htmlFor="cm-merc" erro={estado.erros?.receita_mercadorias}>
                  <CampoValor id="cm-merc" name="receita_mercadorias" valorInicial={inf?.receita_mercadorias ?? null} />
                </Campo>
                <Campo rotulo="Receita de serviços" htmlFor="cm-serv" erro={estado.erros?.receita_servicos}>
                  <CampoValor id="cm-serv" name="receita_servicos" valorInicial={inf?.receita_servicos ?? null} />
                </Campo>
              </div>
              <Campo rotulo="Folha com encargos (Fator R)" htmlFor="cm-folha" erro={estado.erros?.folha_fator_r} ajuda="Salários, pró-labore, FGTS e INSS patronal do mês.">
                <CampoValor id="cm-folha" name="folha_fator_r" valorInicial={inf?.folha_fator_r ?? null} />
              </Campo>
              <Campo rotulo="Observação" htmlFor="cm-obs">
                <Textarea id="cm-obs" name="observacao" rows={2} maxLength={500} defaultValue={inf?.observacao ?? ""} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Receita (notas × informada) e folha dos 12 meses anteriores e do mês. */
export function TabelaMeses({ empresaId, meses }: { empresaId: string; meses: MesConfig[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Competência</Th>
          <Th className="text-right">Notas fiscais</Th>
          <Th className="text-right">Informado</Th>
          <Th className="hidden text-right md:table-cell">Folha (Fator R)</Th>
          <Th className="w-24" />
        </Tr>
      </THead>
      <TBody>
        {[...meses].reverse().map((m) => {
          const inf = m.informado;
          const informado = inf && (inf.receita_mercadorias != null || inf.receita_servicos != null);
          return (
            <Tr key={m.competencia}>
              <Td>{formatarCompetencia(m.competencia)}</Td>
              <Td className={`text-right numero ${informado ? "text-muted-foreground line-through" : ""}`}>
                {m.notas ? formatarMoeda(m.vendas + m.servicos) : <span className="text-muted-foreground no-underline">sem notas</span>}
              </Td>
              <Td className="text-right numero">{informado ? formatarMoeda((inf?.receita_mercadorias ?? 0) + (inf?.receita_servicos ?? 0)) : "—"}</Td>
              <Td className="hidden text-right numero md:table-cell">{inf?.folha_fator_r != null ? formatarMoeda(inf.folha_fator_r) : "—"}</Td>
              <Td className="text-right">
                <DialogMes empresaId={empresaId} mes={m} />
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/** Valores lançados pelo escritório na previsão do mês. */
export function Ajustes({
  empresaId,
  competencia,
  ajustes,
}: {
  empresaId: string;
  competencia: string;
  ajustes: { id: string; descricao: string; valor: number; observacao: string | null }[];
}) {
  const acao = adicionarAjuste.bind(null, empresaId, competencia);
  return (
    <div className="space-y-3">
      {ajustes.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ajustes.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{a.descricao}</p>
                {a.observacao ? <p className="text-xs text-muted-foreground">{a.observacao}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="numero font-semibold">{formatarMoeda(a.valor)}</span>
                <BotaoAcao
                  variante="fantasma"
                  tamanho="iconeSm"
                  aria-label={`Remover ${a.descricao}`}
                  acao={() => removerAjuste(empresaId, a.id)}
                  confirmar={{ titulo: "Remover este valor da previsão?", textoConfirmar: "Remover", perigo: true }}
                >
                  <Trash2 />
                </BotaoAcao>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum valor lançado neste mês.</p>
      )}
      <FormularioAcao acao={acao} resetarAoSucesso className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end [&>*]:min-w-0">
        {({ estado, pendente }) => (
          <>
            <Campo rotulo="Descrição" htmlFor="aj-desc" erro={estado.erros?.descricao}>
              <Input id="aj-desc" name="descricao" maxLength={120} placeholder="Ex.: ICMS-ST, DIFAL, parcelamento, IRPJ por balancete" />
            </Campo>
            <Campo rotulo="Valor" htmlFor="aj-valor" erro={estado.erros?.valor}>
              <CampoValor id="aj-valor" name="valor" permitirNegativo />
            </Campo>
            <BotaoEnviar pendente={pendente}>
              <Plus /> Lançar
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
    </div>
  );
}
