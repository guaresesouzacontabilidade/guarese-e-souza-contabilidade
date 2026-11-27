"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarSearch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { REGIMES, SERVICOS } from "@/lib/rotulos";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import type { ResultadoAcao } from "@/lib/acoes";
import { simularRegra, type LinhaSimulacao } from "@/lib/obrigacoes/acoes";
import { descreverPrazo, estadoDoPrazo, montarPrazo, problemaPrazo, PRAZO_VAZIO, type EstadoPrazo, type RegraObrigacao, type RegraPrazo } from "@/lib/obrigacoes/regras";
import { LUCRO_REAL_APURACAO, UFS } from "@/lib/obrigacoes/rotulos";
import { SeletorMunicipio } from "./seletor-municipio";

type AcaoFormulario = (anterior: ResultadoAcao, fd: FormData) => Promise<ResultadoAcao>;

const ETAPAS_PRAZO = [
  { chave: "entrega", rotulo: "Prazo de entrega (declaração/escrituração)", etapa: "entrega" },
  { chave: "pagamento", rotulo: "Vencimento do pagamento", etapa: "pagamento" },
  { chave: "apuracao", rotulo: "Meta interna da apuração (opcional)", etapa: "apuracao" },
] as const;

function EditorPrazo({ prefixo, rotulo, valor, aoMudar, periodicidade, erro }: { prefixo: string; rotulo: string; valor: EstadoPrazo; aoMudar: (v: EstadoPrazo) => void; periodicidade: string; erro?: string[] }) {
  const set = (campo: keyof EstadoPrazo, v: string) => aoMudar({ ...valor, [campo]: v });
  const problema = problemaPrazo(valor);
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-titulo">{rotulo}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Regra" htmlFor={`${prefixo}_tipo`} erro={erro}>
          <Select id={`${prefixo}_tipo`} name={`${prefixo}_tipo`} value={valor.tipo} onChange={(e) => set("tipo", e.target.value)}>
            <option value="">Sem prazo</option>
            <option value="dia_fixo">Dia fixo do mês</option>
            <option value="dia_util">N-ésimo dia útil</option>
            <option value="ultimo_dia_util">Último dia útil</option>
          </Select>
        </Campo>
        {valor.tipo && valor.tipo !== "ultimo_dia_util" ? (
          <Campo rotulo={valor.tipo === "dia_util" ? "Qual dia útil" : "Dia do mês"} htmlFor={`${prefixo}_dia`}>
            <Input id={`${prefixo}_dia`} name={`${prefixo}_dia`} inputMode="numeric" value={valor.dia} onChange={(e) => set("dia", e.target.value)} />
          </Campo>
        ) : (
          <input type="hidden" name={`${prefixo}_dia`} value="" />
        )}
        {valor.tipo ? (
          <Campo rotulo="Mês do prazo" htmlFor={`${prefixo}_meses`}>
            <Select id={`${prefixo}_meses`} name={`${prefixo}_meses`} value={valor.meses} onChange={(e) => set("meses", e.target.value)}>
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  {periodicidade === "anual"
                    ? i === 0
                      ? "Dezembro do ano-base"
                      : `${i} mês(es) após dezembro`
                    : i === 0
                      ? "Mesmo mês da competência"
                      : i === 1
                        ? "Mês seguinte"
                        : `${i}º mês seguinte`}
                </option>
              ))}
            </Select>
          </Campo>
        ) : (
          <input type="hidden" name={`${prefixo}_meses`} value="" />
        )}
      </div>
      {valor.tipo ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {valor.tipo === "dia_fixo" ? (
            <Campo rotulo="Se não for dia útil" htmlFor={`${prefixo}_ajuste`}>
              <Select id={`${prefixo}_ajuste`} name={`${prefixo}_ajuste`} value={valor.ajuste} onChange={(e) => set("ajuste", e.target.value)}>
                <option value="postergar">Passa para o dia útil seguinte</option>
                <option value="antecipar">Antecipa para o dia útil anterior</option>
                <option value="manter">Mantém a data</option>
              </Select>
            </Campo>
          ) : (
            <input type="hidden" name={`${prefixo}_ajuste`} value="" />
          )}
          <Campo rotulo="Dia útil considerado" htmlFor={`${prefixo}_calendario`}>
            <Select id={`${prefixo}_calendario`} name={`${prefixo}_calendario`} value={valor.calendario} onChange={(e) => set("calendario", e.target.value)}>
              <option value="dia_util">Dia útil</option>
              <option value="expediente_bancario">Dia com expediente bancário</option>
            </Select>
          </Campo>
          <Campo rotulo="Feriados considerados" htmlFor={`${prefixo}_feriados`}>
            <Select id={`${prefixo}_feriados`} name={`${prefixo}_feriados`} value={valor.feriados} onChange={(e) => set("feriados", e.target.value)}>
              <option value="nacional">Somente nacionais</option>
              <option value="estadual">Nacionais e estaduais</option>
              <option value="municipal">Nacionais, estaduais e municipais</option>
            </Select>
          </Campo>
        </div>
      ) : (
        <>
          <input type="hidden" name={`${prefixo}_ajuste`} value="" />
          <input type="hidden" name={`${prefixo}_calendario`} value="" />
          <input type="hidden" name={`${prefixo}_feriados`} value="" />
        </>
      )}
      {valor.tipo ? (
        <p className={problema ? "text-xs text-perigo" : "text-xs text-muted-foreground"}>{problema ?? descreverPrazo(montarPrazo(valor), periodicidade)}</p>
      ) : null}
    </fieldset>
  );
}

export interface DadosFormRegra {
  titulo?: string;
  resumo?: string | null;
  fonte_titulo?: string;
  fonte_url?: string | null;
  fonte_publicada_em?: string | null;
  fonte_consultada_em?: string;
  regra?: Partial<RegraObrigacao> | null;
}

export function FormRegra({
  acao,
  obrigacao,
  inicial,
  hoje,
  empresas,
  local,
  destino,
}: {
  acao: AcaoFormulario;
  obrigacao: { nome: string; periodicidade: string; etapas: string[]; esfera: string };
  inicial: DadosFormRegra;
  hoje: string;
  empresas: { id: string; nome: string }[];
  local: { uf: string | null; municipio: string | null; municipios: { ibge: string; nome: string }[] };
  destino: string;
}) {
  const router = useRouter();
  const r = inicial.regra ?? {};
  const [regimes, setRegimes] = useState<string[]>(r.regimes ?? []);
  const [abrangencia, setAbrangencia] = useState(r.empresa_id ? "empresa" : r.municipios?.length ? "municipio" : r.ufs?.length ? "uf" : obrigacao.esfera === "federal" || obrigacao.esfera === "nacional" ? "pais" : obrigacao.esfera === "estadual" ? "uf" : "municipio");
  const [prazos, setPrazos] = useState<Record<string, EstadoPrazo>>({
    entrega: estadoDoPrazo(r.prazo_entrega ?? null),
    pagamento: estadoDoPrazo(r.prazo_pagamento ?? null),
    apuracao: r.prazo_apuracao ? estadoDoPrazo(r.prazo_apuracao) : { ...PRAZO_VAZIO, feriados: "municipal" },
  });
  const [inicio, setInicio] = useState((r.vigencia_inicio ?? hoje).slice(0, 7));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <FormularioAcao acao={acao} aoSucesso={() => router.push(destino)} atualizarAoSucesso={false}>
        {({ estado, pendente }) => (
          <div className="space-y-5">
            <section className="space-y-4">
              <h2 className="text-base font-semibold text-titulo">Proposta</h2>
              <Campo rotulo="Título" htmlFor="titulo" obrigatorio erro={estado.erros?.titulo} ajuda="Ex.: ISS de Porto Nacional até o dia 10 do mês seguinte.">
                <Input id="titulo" name="titulo" defaultValue={inicial.titulo ?? ""} />
              </Campo>
              <Campo rotulo="Resumo da mudança" htmlFor="resumo">
                <Textarea id="resumo" name="resumo" rows={2} defaultValue={inicial.resumo ?? ""} />
              </Campo>
            </section>

            <section className="space-y-4">
              <h2 className="text-base font-semibold text-titulo">Vigência e aplicabilidade</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Vale a partir da competência" htmlFor="vigencia_inicio" obrigatorio erro={estado.erros?.vigencia_inicio}>
                  <Input id="vigencia_inicio" name="vigencia_inicio" type="month" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </Campo>
                <Campo rotulo="Até a competência (opcional)" htmlFor="vigencia_fim" erro={estado.erros?.vigencia_fim} ajuda="Ex.: PIS/Cofins até 12/2026.">
                  <Input id="vigencia_fim" name="vigencia_fim" type="month" defaultValue={r.vigencia_fim?.slice(0, 7) ?? ""} />
                </Campo>
              </div>
              <Campo rotulo="Regimes em que se aplica" obrigatorio erro={estado.erros?.regimes}>
                <div className="grid gap-2 sm:grid-cols-3">
                  {Object.entries(REGIMES).map(([v, rotulo]) => (
                    <label key={v} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-bege/40">
                      <Checkbox
                        name="regimes"
                        value={v}
                        checked={regimes.includes(v)}
                        onChange={(e) => setRegimes((x) => (e.target.checked ? [...x, v] : x.filter((y) => y !== v)))}
                      />
                      {rotulo}
                    </label>
                  ))}
                </div>
              </Campo>
              {regimes.includes("lucro_real") ? (
                <Campo rotulo="No Lucro Real, vale para" htmlFor="lucro_real_apuracao">
                  <Select id="lucro_real_apuracao" name="lucro_real_apuracao" defaultValue={r.lucro_real_apuracao ?? ""}>
                    <option value="">Qualquer forma de apuração</option>
                    {Object.entries(LUCRO_REAL_APURACAO).map(([v, x]) => (
                      <option key={v} value={v}>
                        Somente {x.toLowerCase()}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : (
                <input type="hidden" name="lucro_real_apuracao" value="" />
              )}
              <Campo rotulo="Onde vale" htmlFor="abrangencia">
                <Select id="abrangencia" name="abrangencia" value={abrangencia} onChange={(e) => setAbrangencia(e.target.value)}>
                  <option value="pais">Todo o país</option>
                  <option value="uf">Um estado</option>
                  <option value="municipio">Um município</option>
                  <option value="empresa">Só para uma empresa (regra própria)</option>
                </Select>
              </Campo>
              {abrangencia === "uf" ? (
                <Campo rotulo="Estado" htmlFor="uf" erro={estado.erros?.uf}>
                  <Select id="uf" name="uf" defaultValue={r.ufs?.[0] ?? local.uf ?? ""} className="w-32">
                    <option value="">UF</option>
                    {UFS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              {abrangencia === "municipio" ? (
                <Campo rotulo="Município" htmlFor="municipio" erro={estado.erros?.municipio}>
                  <SeletorMunicipio
                    ufInicial={r.ufs?.[0] ?? local.uf}
                    municipioInicial={r.municipios?.[0] ?? local.municipio}
                    municipiosIniciais={local.municipios}
                    nomeCampo="municipio"
                    nomeUf="uf"
                  />
                </Campo>
              ) : null}
              {abrangencia === "empresa" ? (
                <Campo rotulo="Empresa" htmlFor="empresa_id">
                  <Select id="empresa_id" name="empresa_id" defaultValue={r.empresa_id ?? ""}>
                    <option value="">Selecione</option>
                    {empresas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <Campo rotulo="Exigências do cadastro da empresa">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { n: "exige_folha", r: "Tem folha (empregados ou pró-labore)", v: r.exige_folha },
                    { n: "exige_empregados", r: "Tem empregados", v: r.exige_empregados },
                    { n: "exige_icms", r: "Contribuinte do ICMS", v: r.exige_icms },
                    { n: "exige_iss", r: "Contribuinte do ISS", v: r.exige_iss },
                  ].map((x) => (
                    <label key={x.n} className="flex items-center gap-2 text-sm">
                      <Checkbox name={x.n} defaultChecked={Boolean(x.v)} /> {x.r}
                    </label>
                  ))}
                </div>
              </Campo>
              <Campo rotulo="Somente quando o escritório presta o serviço" htmlFor="servico" ajuda="Assim a tarefa só é criada para empresas atendidas naquele serviço.">
                <Select id="servico" name="servico" defaultValue={r.servico ?? ""}>
                  <option value="">Qualquer serviço</option>
                  {Object.entries(SERVICOS).map(([v, x]) => (
                    <option key={v} value={v}>
                      {x}
                    </option>
                  ))}
                </Select>
              </Campo>
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-semibold text-titulo">Prazos e feriados</h2>
              {ETAPAS_PRAZO.filter((e) => e.etapa === "apuracao" || obrigacao.etapas.includes(e.etapa)).map((e) => (
                <EditorPrazo
                  key={e.chave}
                  prefixo={e.chave}
                  rotulo={e.rotulo}
                  valor={prazos[e.chave]}
                  aoMudar={(v) => setPrazos((p) => ({ ...p, [e.chave]: v }))}
                  periodicidade={obrigacao.periodicidade}
                  erro={estado.erros?.[`${e.chave}_tipo`]}
                />
              ))}
              {ETAPAS_PRAZO.filter((e) => e.etapa !== "apuracao" && !obrigacao.etapas.includes(e.etapa)).map((e) => (
                <span key={e.chave}>
                  <input type="hidden" name={`${e.chave}_tipo`} value="" />
                </span>
              ))}
              <Campo
                rotulo="Prazo interno (dias úteis antes do prazo legal)"
                htmlFor="prazo_interno_dias_uteis"
                erro={estado.erros?.prazo_interno_dias_uteis}
                ajuda="Contado no calendário do escritório. Na apuração, usa 2 dias a mais."
              >
                <Input id="prazo_interno_dias_uteis" name="prazo_interno_dias_uteis" inputMode="numeric" defaultValue={r.prazo_interno_dias_uteis ?? 2} className="w-28" />
              </Campo>
              <Campo rotulo="Observação" htmlFor="observacao">
                <Textarea id="observacao" name="observacao" rows={2} defaultValue={r.observacao ?? ""} />
              </Campo>
            </section>

            <section className="space-y-4">
              <h2 className="text-base font-semibold text-titulo">Fonte oficial</h2>
              <Campo rotulo="Norma" htmlFor="fonte_titulo" obrigatorio erro={estado.erros?.fonte_titulo} ajuda="Ex.: Lei Complementar Municipal nº 123/2020, art. 45.">
                <Input id="fonte_titulo" name="fonte_titulo" defaultValue={inicial.fonte_titulo ?? ""} />
              </Campo>
              <Campo rotulo="Endereço (link oficial)" htmlFor="fonte_url" erro={estado.erros?.fonte_url}>
                <Input id="fonte_url" name="fonte_url" type="url" placeholder="https://" defaultValue={inicial.fonte_url ?? ""} />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Publicada em" htmlFor="fonte_publicada_em" erro={estado.erros?.fonte_publicada_em}>
                  <Input id="fonte_publicada_em" name="fonte_publicada_em" type="date" defaultValue={inicial.fonte_publicada_em ?? ""} />
                </Campo>
                <Campo rotulo="Consultada em" htmlFor="fonte_consultada_em" obrigatorio erro={estado.erros?.fonte_consultada_em}>
                  <Input id="fonte_consultada_em" name="fonte_consultada_em" type="date" defaultValue={inicial.fonte_consultada_em ?? hoje} />
                </Campo>
              </div>
            </section>

            <Alerta tom="info">A proposta não muda nenhum prazo. Ela passa a valer depois que um administrador conferir a fonte, validar e aplicar.</Alerta>
            <div className="flex justify-end gap-2">
              <Button type="button" variante="contorno" onClick={() => router.push(destino)}>
                Cancelar
              </Button>
              <BotaoEnviar pendente={pendente}>Registrar proposta</BotaoEnviar>
            </div>
          </div>
        )}
      </FormularioAcao>

      <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
        <SimuladorPrazos
          prazos={{ prazo_entrega: montarPrazo(prazos.entrega), prazo_pagamento: montarPrazo(prazos.pagamento), prazo_apuracao: montarPrazo(prazos.apuracao) }}
          periodicidade={obrigacao.periodicidade}
          etapas={obrigacao.etapas}
          inicio={inicio}
          empresas={empresas}
          local={local}
        />
      </aside>
    </div>
  );
}

/** Simulação das próximas datas de uma regra (salva ou em edição) para um local ou uma empresa. */
export function SimuladorPrazos({
  prazos,
  periodicidade,
  etapas,
  inicio,
  empresas,
  local,
}: {
  prazos: { prazo_entrega: RegraPrazo | null; prazo_pagamento: RegraPrazo | null; prazo_apuracao: RegraPrazo | null };
  periodicidade: string;
  etapas: string[];
  inicio: string;
  empresas: { id: string; nome: string }[];
  local: { uf: string | null; municipio: string | null; municipios: { ibge: string; nome: string }[] };
}) {
  const [simLocal, setSimLocal] = useState({ uf: local.uf ?? "", municipio: local.municipio ?? "" });
  const [simEmpresa, setSimEmpresa] = useState("");
  const [simulacao, setSimulacao] = useState<LinhaSimulacao[] | null>(null);
  const [simulando, iniciar] = useTransition();

  const simular = () =>
    iniciar(async () => {
      const res = await simularRegra(prazos, periodicidade, inicio, simEmpresa ? { empresaId: simEmpresa } : simLocal);
      if (res.ok) setSimulacao(res.dados ?? []);
      else toast.error(res.mensagem ?? "Não foi possível simular.");
    });

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-titulo">
        <CalendarSearch className="size-4" /> Simular prazos
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Veja as próximas datas com os feriados de um local ou de uma empresa.</p>
      <div className="mt-3 space-y-3">
        <Campo rotulo="Empresa (opcional)" htmlFor="sim-empresa">
          <Select id="sim-empresa" value={simEmpresa} onChange={(e) => setSimEmpresa(e.target.value)}>
            <option value="">Usar o local abaixo</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
        </Campo>
        {!simEmpresa ? (
          <Campo rotulo="Local" htmlFor="sim-municipio">
            <SeletorMunicipio
              ufInicial={local.uf}
              municipioInicial={local.municipio}
              municipiosIniciais={local.municipios}
              nomeCampo="sim_municipio"
              nomeUf="sim_uf"
              idBase="sim-municipio"
              aoMudar={setSimLocal}
            />
          </Campo>
        ) : null}
        <Button variante="contorno" onClick={simular} disabled={simulando} className="w-full">
          {simulando ? <Loader2 className="animate-spin" /> : <CalendarSearch />} Simular a partir de {formatarCompetencia(`${inicio}-01`)}
        </Button>
      </div>
      {simulacao ? (
        simulacao.length ? (
          <div className="mt-3">
            <Table>
              <THead>
                <tr>
                  <Th>Comp.</Th>
                  {etapas.includes("entrega") ? <Th>Entrega</Th> : null}
                  {etapas.includes("pagamento") ? <Th>Pagamento</Th> : null}
                  <Th>Meta</Th>
                </tr>
              </THead>
              <TBody>
                {simulacao.map((l) => (
                  <Tr key={l.competencia}>
                    <Td className="numero">{formatarCompetencia(l.competencia)}</Td>
                    {etapas.includes("entrega") ? <Td className="numero">{l.prazo_entrega ? formatarData(l.prazo_entrega) : "—"}</Td> : null}
                    {etapas.includes("pagamento") ? <Td className="numero">{l.prazo_pagamento ? formatarData(l.prazo_pagamento) : "—"}</Td> : null}
                    <Td className="numero">{l.prazo_apuracao ? formatarData(l.prazo_apuracao) : "—"}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma competência no período simulado.</p>
        )
      ) : null}
    </div>
  );
}
