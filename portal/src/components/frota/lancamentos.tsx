"use client";

import * as React from "react";
import { Fuel, Pencil, Plus, Route, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { excluirLancamentoFrota, lancarDespesa, lancarViagem, salvarVeiculo } from "@/lib/frota/acoes";
import { GRUPOS_DESPESA } from "@/lib/frota/rentabilidade";

export interface VeiculoOpcao {
  id: string;
  placa: string;
  descricao: string;
}

const placaFormatada = (p: string) => `${p.slice(0, 3)}-${p.slice(3)}`;

function SeletorVeiculo({ veiculos, padrao, erro }: { veiculos: VeiculoOpcao[]; padrao?: string | null; erro?: string[] }) {
  return (
    <Campo rotulo="Caminhão" htmlFor="fr-veiculo" obrigatorio erro={erro}>
      <Select id="fr-veiculo" name="veiculo_id" defaultValue={padrao ?? (veiculos.length === 1 ? veiculos[0].id : "")}>
        <option value="">Escolha...</option>
        {veiculos.map((v) => (
          <option key={v.id} value={v.id}>
            {placaFormatada(v.placa)} — {v.descricao}
          </option>
        ))}
      </Select>
    </Campo>
  );
}

/** Lançar o frete de uma viagem (um CT-e). */
export function NovaViagem({ empresaId, veiculos, veiculoPadrao, hoje }: { empresaId: string; veiculos: VeiculoOpcao[]; veiculoPadrao?: string | null; hoje: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button disabled={!veiculos.length}>
          <Route /> Lançar viagem
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Lançar viagem (frete)" descricao="Um lançamento por CT-e. A comissão do motorista e o ICMS saem do frete no resultado." largura="lg">
        <FormularioAcao acao={lancarViagem.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <SeletorVeiculo veiculos={veiculos} padrao={veiculoPadrao} erro={estado.erros?.veiculo_id} />
                <Campo rotulo="Data" htmlFor="fv-data" obrigatorio erro={estado.erros?.data}>
                  <Input id="fv-data" name="data" type="date" defaultValue={hoje} />
                </Campo>
                <Campo rotulo="CT-e nº" htmlFor="fv-cte">
                  <Input id="fv-cte" name="cte_numero" maxLength={20} inputMode="numeric" />
                </Campo>
                <Campo rotulo="Motorista" htmlFor="fv-mot">
                  <Input id="fv-mot" name="motorista" maxLength={120} />
                </Campo>
                <Campo rotulo="Origem (cidade/UF)" htmlFor="fv-orig">
                  <Input id="fv-orig" name="origem" maxLength={80} placeholder="Querência/MT" />
                </Campo>
                <Campo rotulo="Destino (cidade/UF)" htmlFor="fv-dest">
                  <Input id="fv-dest" name="destino" maxLength={80} placeholder="Barcarena/PA" />
                </Campo>
                <Campo rotulo="Cliente (remetente)" htmlFor="fv-rem">
                  <Input id="fv-rem" name="remetente" maxLength={120} />
                </Campo>
                <Campo rotulo="Mercadoria" htmlFor="fv-merc">
                  <Input id="fv-merc" name="mercadoria" maxLength={80} placeholder="Milho em grãos" />
                </Campo>
              </div>
              <div className="grid gap-4 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-3">
                <Campo rotulo="Valor do frete" htmlFor="fv-frete" obrigatorio erro={estado.erros?.valor_frete}>
                  <CampoValor id="fv-frete" name="valor_frete" />
                </Campo>
                <Campo rotulo="Comissão do motorista" htmlFor="fv-com" erro={estado.erros?.comissao_motorista}>
                  <CampoValor id="fv-com" name="comissao_motorista" />
                </Campo>
                <Campo rotulo="ICMS do frete" htmlFor="fv-icms" erro={estado.erros?.icms}>
                  <CampoValor id="fv-icms" name="icms" />
                </Campo>
                <Campo rotulo="Quebra (desconto)" htmlFor="fv-quebra" erro={estado.erros?.quebra}>
                  <CampoValor id="fv-quebra" name="quebra" />
                </Campo>
                <Campo rotulo="Carga/descarga e outros" htmlFor="fv-outras" erro={estado.erros?.outras_deducoes}>
                  <CampoValor id="fv-outras" name="outras_deducoes" />
                </Campo>
                <Campo rotulo="Peso (kg)" htmlFor="fv-peso" erro={estado.erros?.peso_kg}>
                  <Input id="fv-peso" name="peso_kg" inputMode="decimal" />
                </Campo>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Lançar viagem</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Lançar uma despesa do caminhão (abastecimento pede litros e km do hodômetro). */
export function NovaDespesa({ empresaId, veiculos, veiculoPadrao, hoje }: { empresaId: string; veiculos: VeiculoOpcao[]; veiculoPadrao?: string | null; hoje: string }) {
  const [aberto, setAberto] = React.useState(false);
  const [grupo, setGrupo] = React.useState("combustivel");
  const abastecimento = grupo === "combustivel" || grupo === "arla";
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" disabled={!veiculos.length}>
          <Fuel /> Lançar despesa
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo="Lançar despesa do caminhão"
        descricao="No abastecimento, informe os litros e o km do hodômetro: o portal confere o km (não deixa voltar nem dar salto impossível) e calcula a média."
        largura="lg"
      >
        <FormularioAcao acao={lancarDespesa.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <SeletorVeiculo veiculos={veiculos} padrao={veiculoPadrao} erro={estado.erros?.veiculo_id} />
                <Campo rotulo="Data" htmlFor="fd-data" obrigatorio erro={estado.erros?.data}>
                  <Input id="fd-data" name="data" type="date" defaultValue={hoje} />
                </Campo>
                <Campo rotulo="Tipo" htmlFor="fd-grupo" obrigatorio erro={estado.erros?.grupo}>
                  <Select id="fd-grupo" name="grupo" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                    {Object.entries(GRUPOS_DESPESA).map(([g, r]) => (
                      <option key={g} value={g}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Descrição" htmlFor="fd-desc" ajuda={abastecimento ? "Ex.: Óleo diesel S10" : "Ex.: Troca de 2 pneus, revisão"}>
                  <Input id="fd-desc" name="descricao" maxLength={120} placeholder={grupo === "combustivel" ? "Óleo diesel S10" : ""} />
                </Campo>
                <Campo rotulo="Fornecedor (posto, oficina)" htmlFor="fd-forn">
                  <Input id="fd-forn" name="fornecedor" maxLength={120} />
                </Campo>
                <Campo rotulo="Nota/cupom nº" htmlFor="fd-doc">
                  <Input id="fd-doc" name="documento" maxLength={30} />
                </Campo>
              </div>
              <div className="grid gap-4 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-3">
                <Campo rotulo="Valor total" htmlFor="fd-valor" obrigatorio erro={estado.erros?.valor}>
                  <CampoValor id="fd-valor" name="valor" />
                </Campo>
                {abastecimento ? (
                  <Campo rotulo="Litros" htmlFor="fd-litros" obrigatorio={grupo === "combustivel"} erro={estado.erros?.litros}>
                    <Input id="fd-litros" name="litros" inputMode="decimal" />
                  </Campo>
                ) : null}
                <Campo rotulo="Km do hodômetro" htmlFor="fd-km" obrigatorio={grupo === "combustivel"} erro={estado.erros?.km}>
                  <Input id="fd-km" name="km" inputMode="numeric" placeholder="Ex.: 344.057" />
                </Campo>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Lançar despesa</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export interface VeiculoEdicao extends VeiculoOpcao {
  tipo: string;
  km_inicial: number | string | null;
  custo_motorista_mensal: number | string;
  depreciacao_mensal: number | string;
  financiamento_mensal: number | string;
  seguro_mensal: number | string;
  outros_fixos_mensal: number | string;
  ativo: boolean;
}

/** Cadastrar ou editar um caminhão, com os custos fixos do mês. */
export function DialogoVeiculo({ empresaId, veiculo }: { empresaId: string; veiculo?: VeiculoEdicao }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {veiculo ? (
          <Button variante="fantasma" tamanho="sm">
            <Pencil /> Editar
          </Button>
        ) : (
          <Button>
            <Plus /> Cadastrar caminhão
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={veiculo ? `Caminhão ${placaFormatada(veiculo.placa)}` : "Cadastrar caminhão"}
        descricao="Os custos fixos do mês entram no lucro de verdade, mesmo nos meses sem viagem."
        largura="lg"
      >
        <FormularioAcao acao={salvarVeiculo.bind(null, empresaId, veiculo?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Placa" htmlFor="fve-placa" obrigatorio erro={estado.erros?.placa}>
                  <Input id="fve-placa" name="placa" defaultValue={veiculo?.placa ?? ""} maxLength={8} className="uppercase" />
                </Campo>
                <Campo rotulo="Descrição" htmlFor="fve-desc" obrigatorio erro={estado.erros?.descricao} className="sm:col-span-2">
                  <Input id="fve-desc" name="descricao" defaultValue={veiculo?.descricao ?? ""} maxLength={120} placeholder="Volvo FH 540 — bitrem graneleiro" />
                </Campo>
                <Campo rotulo="Tipo" htmlFor="fve-tipo">
                  <Select id="fve-tipo" name="tipo" defaultValue={veiculo?.tipo ?? "cavalo"}>
                    <option value="cavalo">Cavalo mecânico</option>
                    <option value="truck">Truck</option>
                    <option value="toco">Toco</option>
                    <option value="carreta">Carreta</option>
                    <option value="utilitario">Utilitário</option>
                    <option value="outro">Outro</option>
                  </Select>
                </Campo>
                <Campo rotulo="Km atual do hodômetro" htmlFor="fve-km" erro={estado.erros?.km_inicial} ajuda="Ponto de partida do km rodado.">
                  <Input id="fve-km" name="km_inicial" inputMode="numeric" defaultValue={veiculo?.km_inicial ?? ""} />
                </Campo>
              </div>
              <fieldset className="grid gap-4 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-3">
                <legend className="px-1 text-sm font-medium">Custos fixos do mês</legend>
                <Campo rotulo="Motorista (salário + encargos)" htmlFor="fve-mot" erro={estado.erros?.custo_motorista_mensal}>
                  <CampoValor id="fve-mot" name="custo_motorista_mensal" valorInicial={veiculo?.custo_motorista_mensal ?? null} />
                </Campo>
                <Campo rotulo="Parcela do financiamento" htmlFor="fve-fin" erro={estado.erros?.financiamento_mensal}>
                  <CampoValor id="fve-fin" name="financiamento_mensal" valorInicial={veiculo?.financiamento_mensal ?? null} />
                </Campo>
                <Campo rotulo="Depreciação" htmlFor="fve-dep" erro={estado.erros?.depreciacao_mensal} ajuda="Desgaste do caminhão no mês.">
                  <CampoValor id="fve-dep" name="depreciacao_mensal" valorInicial={veiculo?.depreciacao_mensal ?? null} />
                </Campo>
                <Campo rotulo="Seguro" htmlFor="fve-seg" erro={estado.erros?.seguro_mensal}>
                  <CampoValor id="fve-seg" name="seguro_mensal" valorInicial={veiculo?.seguro_mensal ?? null} />
                </Campo>
                <Campo rotulo="Outros (rastreador, IPVA)" htmlFor="fve-out" erro={estado.erros?.outros_fixos_mensal}>
                  <CampoValor id="fve-out" name="outros_fixos_mensal" valorInicial={veiculo?.outros_fixos_mensal ?? null} />
                </Campo>
              </fieldset>
              {veiculo ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativo" value="off" />
                  <Checkbox name="ativo" value="on" defaultChecked={veiculo.ativo} /> Caminhão em uso (desmarque quando for vendido)
                </label>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{veiculo ? "Salvar" : "Cadastrar"}</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function ExcluirLancamento({ empresaId, tipo, id }: { empresaId: string; tipo: "viagem" | "despesa"; id: string }) {
  return (
    <BotaoAcao
      acao={() => excluirLancamentoFrota(empresaId, tipo, id)}
      confirmar={{ titulo: tipo === "viagem" ? "Excluir esta viagem?" : "Excluir esta despesa?", descricao: "O resultado do caminhão é recalculado na hora." }}
      variante="fantasma"
      tamanho="iconeSm"
      aria-label="Excluir"
    >
      <Trash2 />
    </BotaoAcao>
  );
}

export const IconeCaminhao = Truck;
