"use client";

import { useState } from "react";
import { History, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { REGIMES } from "@/lib/rotulos";
import { formatarCompetencia } from "@/lib/formatos";
import {
  editarPeriodoRegime,
  excluirConfiguracao,
  excluirPeriodoRegime,
  registrarRegime,
  salvarConfiguracao,
  salvarDadosOperacionais,
} from "@/lib/obrigacoes/acoes";
import { LUCRO_REAL_APURACAO, MODOS_CONFIG } from "@/lib/obrigacoes/rotulos";
import { SeletorMunicipio } from "./seletor-municipio";

export interface Opcao {
  id: string;
  nome: string;
}

// -----------------------------------------------------------------------------
// Cadastro operacional
// -----------------------------------------------------------------------------

export function FormCadastroOperacional({
  empresaId,
  inicial,
  municipiosIniciais,
}: {
  empresaId: string;
  inicial: {
    uf: string | null;
    municipio_ibge: string | null;
    contribuinte_icms: boolean;
    contribuinte_iss: boolean;
    tem_empregados: boolean;
    tem_pro_labore: boolean;
  };
  municipiosIniciais: { ibge: string; nome: string }[];
}) {
  const marcadores = [
    { nome: "contribuinte_icms", rotulo: "Contribuinte do ICMS", ajuda: "Tem inscrição estadual e opera mercadorias", valor: inicial.contribuinte_icms },
    { nome: "contribuinte_iss", rotulo: "Contribuinte do ISS", ajuda: "Presta serviços com inscrição municipal", valor: inicial.contribuinte_iss },
    { nome: "tem_empregados", rotulo: "Tem empregados", ajuda: "Folha com FGTS (CLT)", valor: inicial.tem_empregados },
    { nome: "tem_pro_labore", rotulo: "Tem pró-labore", ajuda: "Retirada mensal dos sócios", valor: inicial.tem_pro_labore },
  ];
  return (
    <FormularioAcao acao={salvarDadosOperacionais.bind(null, empresaId)}>
      {({ pendente }) => (
        <div className="space-y-4">
          <Campo rotulo="Município do estabelecimento" htmlFor="municipio" ajuda="Define feriados locais e as regras estaduais e municipais (ICMS, ISS).">
            <SeletorMunicipio ufInicial={inicial.uf} municipioInicial={inicial.municipio_ibge} municipiosIniciais={municipiosIniciais} nomeUf="uf_municipio" />
          </Campo>
          <div className="grid gap-2 sm:grid-cols-2">
            {marcadores.map((m) => (
              <label key={m.nome} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-primary/50 has-[:checked]:bg-bege/40">
                <Checkbox name={m.nome} defaultChecked={m.valor} className="mt-0.5" />
                <span>
                  <span className="block text-sm font-medium">{m.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">{m.ajuda}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar e atualizar tarefas</BotaoEnviar>
          </div>
        </div>
      )}
    </FormularioAcao>
  );
}

// -----------------------------------------------------------------------------
// Histórico de regimes
// -----------------------------------------------------------------------------

export interface PeriodoRegime {
  id: string;
  regime: string;
  inicio: string;
  fim: string | null;
  lucro_real_apuracao: string | null;
  observacao: string | null;
}

function CamposRegime({ inicial, erros }: { inicial?: Partial<PeriodoRegime>; erros?: Record<string, string[] | undefined> }) {
  const [regime, setRegime] = useState(inicial?.regime ?? "");
  return (
    <>
      <Campo rotulo="Regime tributário" htmlFor="regime" obrigatorio erro={erros?.regime}>
        <Select id="regime" name="regime" value={regime} onChange={(e) => setRegime(e.target.value)}>
          <option value="">Selecione</option>
          {Object.entries(REGIMES).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
      </Campo>
      {regime === "lucro_real" ? (
        <Campo rotulo="Apuração do IRPJ e da CSLL" htmlFor="lucro_real_apuracao" obrigatorio erro={erros?.lucro_real_apuracao}>
          <Select id="lucro_real_apuracao" name="lucro_real_apuracao" defaultValue={inicial?.lucro_real_apuracao ?? ""}>
            <option value="">Selecione</option>
            {Object.entries(LUCRO_REAL_APURACAO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </Campo>
      ) : (
        <input type="hidden" name="lucro_real_apuracao" value="" />
      )}
    </>
  );
}

export function HistoricoRegimes({ empresaId, periodos, competenciaAtual }: { empresaId: string; periodos: PeriodoRegime[]; competenciaAtual: string }) {
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<PeriodoRegime | null>(null);
  return (
    <div className="space-y-3">
      <Table>
        <THead>
          <tr>
            <Th>Período (competências)</Th>
            <Th>Regime</Th>
            <Th className="hidden md:table-cell">Observação</Th>
            <Th className="w-20" />
          </tr>
        </THead>
        <TBody>
          {periodos.map((p) => {
            const vigente = p.inicio <= competenciaAtual && (!p.fim || p.fim >= competenciaAtual);
            return (
              <Tr key={p.id}>
                <Td className="whitespace-nowrap text-sm">
                  {formatarCompetencia(p.inicio)} a {p.fim ? formatarCompetencia(p.fim) : "atual"}
                  {vigente ? (
                    <Badge variante="sucesso" className="ml-2">
                      vigente
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <span className="font-medium">{REGIMES[p.regime] ?? p.regime}</span>
                  {p.lucro_real_apuracao ? <span className="block text-xs text-muted-foreground">{LUCRO_REAL_APURACAO[p.lucro_real_apuracao]}</span> : null}
                  {p.regime === "lucro_real" && !p.lucro_real_apuracao ? <span className="block text-xs text-alerta-fg">Informe se é trimestral ou anual</span> : null}
                </Td>
                <Td className="hidden max-w-xs truncate text-sm text-muted-foreground md:table-cell" title={p.observacao ?? undefined}>
                  {p.observacao ?? "—"}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variante="fantasma" tamanho="iconeSm" aria-label="Editar período" onClick={() => setEditando(p)}>
                      <Pencil />
                    </Button>
                    {periodos.length > 1 ? (
                      <BotaoAcao
                        variante="fantasma"
                        tamanho="iconeSm"
                        aria-label="Excluir período"
                        acao={() => excluirPeriodoRegime(p.id, empresaId)}
                        confirmar={{
                          titulo: "Excluir este período?",
                          descricao: "As tarefas abertas das competências afetadas serão recalculadas. Tarefas concluídas não mudam.",
                          textoConfirmar: "Excluir",
                          perigo: true,
                        }}
                      >
                        <Trash2 />
                      </BotaoAcao>
                    ) : null}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <History className="size-3.5" /> Cada competência usa o regime vigente nela; competências antigas mantêm o regime da época.
        </p>
        <Button variante="contorno" onClick={() => setNovo(true)}>
          <Plus /> Registrar mudança de regime
        </Button>
      </div>

      <Dialog open={novo} onOpenChange={setNovo}>
        {novo ? (
          <DialogContent titulo="Mudança de regime" descricao="O período anterior é encerrado no mês anterior à competência informada.">
            <FormularioAcao acao={registrarRegime.bind(null, empresaId)} aoSucesso={() => setNovo(false)}>
              {({ estado, pendente }) => (
                <div className="space-y-4">
                  <CamposRegime erros={estado.erros} />
                  <Campo rotulo="A partir da competência" htmlFor="inicio" obrigatorio erro={estado.erros?.inicio}>
                    <Input id="inicio" name="inicio" type="month" defaultValue={competenciaAtual.slice(0, 7)} />
                  </Campo>
                  <Campo rotulo="Observação" htmlFor="observacao" ajuda="Ex.: exclusão do Simples Nacional por excesso de receita.">
                    <Textarea id="observacao" name="observacao" rows={2} />
                  </Campo>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Registrar</BotaoEnviar>
                  </div>
                </div>
              )}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando ? (
          <DialogContent titulo="Editar período de regime" descricao={`Início em ${formatarCompetencia(editando.inicio)}.`}>
            <FormularioAcao acao={editarPeriodoRegime.bind(null, editando.id, empresaId)} aoSucesso={() => setEditando(null)}>
              {({ estado, pendente }) => (
                <div className="space-y-4">
                  <CamposRegime inicial={editando} erros={estado.erros} />
                  <Campo rotulo="Última competência (deixe vazio se continua valendo)" htmlFor="fim">
                    <Input id="fim" name="fim" type="month" defaultValue={editando.fim?.slice(0, 7) ?? ""} />
                  </Campo>
                  <Campo rotulo="Observação" htmlFor="observacao">
                    <Textarea id="observacao" name="observacao" rows={2} defaultValue={editando.observacao ?? ""} />
                  </Campo>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                  </div>
                </div>
              )}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Calendário: configuração da obrigação para a empresa (por vigência)
// -----------------------------------------------------------------------------

export interface ConfigObrigacao {
  id: string;
  obrigacao_id: string;
  modo: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  responsavel_id: string | null;
  revisor_id: string | null;
  prazo_interno_dias_uteis: number | null;
  motivo: string | null;
}

export function ConfigurarObrigacao({
  empresaId,
  obrigacoes,
  equipe,
  config,
  obrigacaoId,
  competencia,
  rotulo = "Configurar",
  variante = "fantasma",
}: {
  empresaId: string;
  obrigacoes: Opcao[];
  equipe: Opcao[];
  config?: ConfigObrigacao | null;
  obrigacaoId?: string;
  competencia: string;
  rotulo?: string;
  variante?: "fantasma" | "contorno" | "primario";
}) {
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState(config?.modo ?? "automatico");
  return (
    <>
      <Button variante={variante} tamanho="sm" onClick={() => setAberto(true)}>
        {variante === "fantasma" ? <Settings2 /> : <Plus />} {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto ? (
          <DialogContent
            largura="lg"
            titulo={config ? "Editar configuração da obrigação" : "Configurar obrigação para a empresa"}
            descricao="Vale para as competências da vigência informada. Inclusões e exclusões exigem motivo e ficam registradas na auditoria."
          >
            <FormularioAcao acao={salvarConfiguracao.bind(null, empresaId, config?.id ?? null)} aoSucesso={() => setAberto(false)}>
              {({ estado, pendente }) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Obrigação" htmlFor="obrigacao_id" obrigatorio erro={estado.erros?.obrigacao_id} className="sm:col-span-2">
                    <Select id="obrigacao_id" name="obrigacao_id" defaultValue={config?.obrigacao_id ?? obrigacaoId ?? ""} disabled={Boolean(config)}>
                      <option value="">Selecione</option>
                      {obrigacoes.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.nome}
                        </option>
                      ))}
                    </Select>
                    {config ? <input type="hidden" name="obrigacao_id" value={config.obrigacao_id} /> : null}
                  </Campo>
                  <Campo rotulo="Aplicação" htmlFor="modo" className="sm:col-span-2">
                    <Select id="modo" name="modo" value={modo} onChange={(e) => setModo(e.target.value)}>
                      {Object.entries(MODOS_CONFIG).map(([v, m]) => (
                        <option key={v} value={v}>
                          {m.rotulo}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Vigência: da competência" htmlFor="vigencia_inicio" obrigatorio erro={estado.erros?.vigencia_inicio}>
                    <Input id="vigencia_inicio" name="vigencia_inicio" type="month" defaultValue={(config?.vigencia_inicio ?? competencia).slice(0, 7)} />
                  </Campo>
                  <Campo rotulo="até a competência (opcional)" htmlFor="vigencia_fim" erro={estado.erros?.vigencia_fim}>
                    <Input id="vigencia_fim" name="vigencia_fim" type="month" defaultValue={config?.vigencia_fim?.slice(0, 7) ?? ""} />
                  </Campo>
                  <Campo rotulo="Responsável" htmlFor="responsavel_id" ajuda="Vazio: contador responsável da empresa.">
                    <Select id="responsavel_id" name="responsavel_id" defaultValue={config?.responsavel_id ?? ""}>
                      <option value="">Contador da empresa</option>
                      {equipe.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Revisor" htmlFor="revisor_id" ajuda="Com revisor, a conclusão exige revisão.">
                    <Select id="revisor_id" name="revisor_id" defaultValue={config?.revisor_id ?? ""}>
                      <option value="">Sem revisão</option>
                      {equipe.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo
                    rotulo="Prazo interno (dias úteis antes do legal)"
                    htmlFor="prazo_interno_dias_uteis"
                    ajuda="Vazio: o padrão da regra."
                    erro={estado.erros?.prazo_interno_dias_uteis}
                  >
                    <Input id="prazo_interno_dias_uteis" name="prazo_interno_dias_uteis" inputMode="numeric" defaultValue={config?.prazo_interno_dias_uteis ?? ""} />
                  </Campo>
                  <Campo
                    rotulo={modo === "automatico" ? "Observação" : "Motivo"}
                    htmlFor="motivo"
                    obrigatorio={modo !== "automatico"}
                    erro={estado.erros?.motivo}
                    className="sm:col-span-2"
                    ajuda={modo === "excluida" ? "Ex.: empresa sem movimento com dispensa prevista na norma." : modo === "incluida" ? "Ex.: Lucro Presumido que distribui lucros acima da presunção (ECD)." : undefined}
                  >
                    <Textarea id="motivo" name="motivo" rows={2} defaultValue={config?.motivo ?? ""} />
                  </Campo>
                  <div className="flex justify-end sm:col-span-2">
                    <BotaoEnviar pendente={pendente}>Salvar configuração</BotaoEnviar>
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

export function RemoverConfiguracao({ configId, empresaId }: { configId: string; empresaId: string }) {
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="iconeSm"
      aria-label="Remover configuração"
      acao={() => excluirConfiguracao(configId, empresaId)}
      confirmar={{
        titulo: "Remover esta configuração?",
        descricao: "A obrigação volta a seguir só a regra geral (regime e cadastro). As tarefas abertas são ajustadas.",
        textoConfirmar: "Remover",
        perigo: true,
      }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}
