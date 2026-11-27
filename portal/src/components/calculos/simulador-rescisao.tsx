"use client";

import * as React from "react";
import Decimal from "decimal.js";
import { ExternalLink, Printer } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CampoValor } from "@/components/ui/campo-valor";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Table, TBody, TFoot, THead, Td, Th, Tr } from "@/components/ui/table";
import { simularRescisao, TIPOS_RESCISAO, type ModoAviso, type ResultadoRescisao, type TipoFolha, type TipoRescisao } from "@/lib/calculos/rescisao";
import { RESCISAO } from "@/lib/calculos/tabelas";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export interface ColaboradorSimulacao {
  id: string;
  nome: string;
  cargo: string | null;
  admissao: string;
  contrato: "indeterminado" | "experiencia" | "determinado";
  fim_contrato: string | null;
  salario: number;
  adicionais: number;
  dependentes_ir: number;
  ferias_vencidas: number;
  saldo_fgts: number | null;
}

const AVISOS: Record<TipoRescisao, { valor: ModoAviso; rotulo: string }[]> = {
  sem_justa_causa: [
    { valor: "indenizado", rotulo: "Indenizado (pago sem trabalhar)" },
    { valor: "trabalhado", rotulo: "Trabalhado (cumprido)" },
  ],
  acordo: [
    { valor: "indenizado", rotulo: "Indenizado (metade)" },
    { valor: "trabalhado", rotulo: "Trabalhado (cumprido)" },
  ],
  pedido_demissao: [
    { valor: "trabalhado", rotulo: "Cumprido pelo empregado" },
    { valor: "descontado", rotulo: "Não cumprido (descontado)" },
    { valor: "dispensado", rotulo: "Dispensado pela empresa" },
  ],
  justa_causa: [],
  fim_experiencia: [],
  antecipada_experiencia: [],
};

const ZERO = new Decimal(0);

function Detalhe({ r }: { r: ResultadoRescisao }) {
  if (!r.valido) return <Alerta tom="alerta">{r.erro}</Alerta>;
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Verbas do empregado</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {r.proventos.map((v) => (
              <li key={v.chave} className="flex justify-between gap-3 p-2">
                <span>
                  {v.descricao}
                  {v.detalhe ? <span className="block text-xs text-muted-foreground">{v.detalhe}</span> : null}
                </span>
                <span className="numero">{formatarMoeda(v.valor)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 bg-muted/50 p-2 font-semibold">
              <span>Total bruto</span>
              <span className="numero">{formatarMoeda(r.totalProventos)}</span>
            </li>
          </ul>
        </div>
        {r.descontos.length ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descontos</p>
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {r.descontos.map((v) => (
                <li key={v.chave} className="flex justify-between gap-3 p-2">
                  <span>{v.descricao}</span>
                  <span className="numero">− {formatarMoeda(v.valor)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 bg-muted/50 p-2 font-semibold">
                <span>Líquido aproximado ao empregado</span>
                <span className="numero">{formatarMoeda(r.liquidoEmpregado)}</span>
              </li>
            </ul>
          </div>
        ) : null}
      </div>
      <div className="space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custo para a empresa</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            <li className="flex justify-between gap-3 p-2">
              <span>Verbas rescisórias (bruto)</span>
              <span className="numero">{formatarMoeda(r.totalProventos)}</span>
            </li>
            {r.descontos
              .filter((d) => d.chave === "aviso_descontado" || d.chave === "adiantamento13")
              .map((d) => (
                <li key={d.chave} className="flex justify-between gap-3 p-2">
                  <span>(−) {d.descricao}</span>
                  <span className="numero">− {formatarMoeda(d.valor)}</span>
                </li>
              ))}
            <li className="flex justify-between gap-3 p-2">
              <span>
                FGTS do mês da rescisão (8%)
                <span className="block text-xs text-muted-foreground">Sobre saldo de salário, aviso indenizado e 13º</span>
              </span>
              <span className="numero">{formatarMoeda(r.fgtsMes)}</span>
            </li>
            {r.multaFgts.gt(0) ? (
              <li className="flex justify-between gap-3 p-2">
                <span>
                  Multa do FGTS
                  <span className="block text-xs text-muted-foreground">
                    Sobre o saldo de {formatarMoeda(r.saldoFgts)}
                    {r.saldoFgtsEstimado ? " (estimado)" : ""} + depósito do mês
                  </span>
                </span>
                <span className="numero">{formatarMoeda(r.multaFgts)}</span>
              </li>
            ) : null}
            <li className="flex justify-between gap-3 p-2">
              <span>
                Encargos da empresa
                <span className="block text-xs text-muted-foreground">{r.encargosDetalhe}</span>
              </span>
              <span className="numero">{formatarMoeda(r.encargos)}</span>
            </li>
            <li className="flex justify-between gap-3 bg-primary/10 p-2 font-bold text-titulo">
              <span>Custo total estimado</span>
              <span className="numero">{formatarMoeda(r.custoTotal)}</span>
            </li>
          </ul>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {r.diasAviso > 0 ? (
            <li>
              Aviso prévio de {r.diasAviso} dias{r.diasIndenizados > 0 ? `; data projetada do término: ${formatarData(r.dataProjetada)}` : ""}.
            </li>
          ) : null}
          <li>{r.saqueFgts}</li>
          {r.observacoes.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function SimuladorRescisao({
  colaboradores,
  tipoFolha,
  rat,
  fap,
  terceiros,
  hoje,
}: {
  colaboradores: ColaboradorSimulacao[];
  tipoFolha: TipoFolha;
  rat: number;
  fap: number;
  terceiros: number;
  hoje: string;
}) {
  const [modo, setModo] = React.useState<"cadastrados" | "avulsa">(colaboradores.length ? "cadastrados" : "avulsa");
  const [selecionados, setSelecionados] = React.useState<Set<string>>(new Set(colaboradores.length === 1 ? [colaboradores[0].id] : []));
  const [tipo, setTipo] = React.useState<TipoRescisao>("sem_justa_causa");
  const [aviso, setAviso] = React.useState<ModoAviso>("indenizado");
  const [data, setData] = React.useState(hoje);
  const [aberto, setAberto] = React.useState<string | null>(null);
  // Simulação avulsa
  const [salario, setSalario] = React.useState("");
  const [adicionais, setAdicionais] = React.useState("");
  const [admissao, setAdmissao] = React.useState("");
  const [fimContrato, setFimContrato] = React.useState("");
  const [ferias, setFerias] = React.useState(0);
  const [saldo, setSaldo] = React.useState("");

  const opcoesAviso = AVISOS[tipo];
  const avisoEfetivo: ModoAviso = opcoesAviso.some((o) => o.valor === aviso) ? aviso : (opcoesAviso[0]?.valor ?? "indenizado");
  const experiencia = tipo === "fim_experiencia" || tipo === "antecipada_experiencia";
  const resultados = React.useMemo(() => {
    const comum = { tipo, aviso: avisoEfetivo, tipoFolha, rat, fap, terceiros };
    if (modo === "avulsa") {
      const s = lerValorBR(salario);
      if (!s || !admissao) return [];
      return [
        {
          id: "avulsa",
          nome: "Simulação avulsa",
          r: simularRescisao({
            ...comum,
            salario: s,
            adicionais: lerValorBR(adicionais) ?? 0,
            admissao,
            desligamento: tipo === "fim_experiencia" && fimContrato ? fimContrato : data,
            feriasVencidas: ferias,
            saldoFgts: lerValorBR(saldo),
            fimContrato: fimContrato || null,
          }),
        },
      ];
    }
    return colaboradores
      .filter((c) => selecionados.has(c.id))
      .map((c) => ({
        id: c.id,
        nome: c.nome,
        r: simularRescisao({
          ...comum,
          salario: c.salario,
          adicionais: c.adicionais,
          admissao: c.admissao,
          desligamento: tipo === "fim_experiencia" && c.fim_contrato ? c.fim_contrato : data,
          feriasVencidas: c.ferias_vencidas,
          saldoFgts: c.saldo_fgts,
          fimContrato: c.fim_contrato,
          dependentes: c.dependentes_ir,
        }),
      }));
  }, [modo, salario, adicionais, admissao, fimContrato, ferias, saldo, colaboradores, selecionados, tipo, avisoEfetivo, data, tipoFolha, rat, fap, terceiros]);

  const validos = resultados.filter((x) => x.r.valido);
  const soma = (f: (r: ResultadoRescisao) => Decimal) => validos.reduce((s, x) => s.plus(f(x.r)), ZERO);
  const todos = colaboradores.length > 0 && selecionados.size === colaboradores.length;

  return (
    <div className="space-y-4">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Quem e como</CardTitle>
          <CardDescription>O resultado aparece abaixo na hora, conforme você escolhe.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Quem simular">
            <label className="flex items-center gap-2">
              <input type="radio" name="modo" checked={modo === "cadastrados"} onChange={() => setModo("cadastrados")} disabled={!colaboradores.length} />
              Colaboradores cadastrados{colaboradores.length ? ` (${colaboradores.length})` : " (nenhum)"}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="modo" checked={modo === "avulsa"} onChange={() => setModo("avulsa")} />
              Simulação avulsa (sem cadastro)
            </label>
          </div>

          {modo === "cadastrados" ? (
            <div className="rounded-lg border border-border">
              <label className="flex items-center gap-2 border-b border-border bg-muted/40 p-2 text-sm font-medium">
                <Checkbox checked={todos} onChange={(e) => setSelecionados(new Set(e.target.checked ? colaboradores.map((c) => c.id) : []))} />
                Todos os colaboradores
              </label>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                {colaboradores.map((c) => (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 p-2 text-sm">
                      <Checkbox
                        checked={selecionados.has(c.id)}
                        onChange={(e) => {
                          const n = new Set(selecionados);
                          if (e.target.checked) n.add(c.id);
                          else n.delete(c.id);
                          setSelecionados(n);
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        {c.nome}
                        <span className="block text-xs text-muted-foreground">
                          {c.cargo ? `${c.cargo} · ` : ""}admissão {formatarData(c.admissao)}
                          {c.contrato !== "indeterminado" && c.fim_contrato ? ` · contrato até ${formatarData(c.fim_contrato)}` : ""}
                        </span>
                      </span>
                      <span className="numero text-xs">{formatarMoeda(c.salario + c.adicionais)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
              <Campo rotulo="Salário mensal" htmlFor="rs-sal">
                <CampoValor id="rs-sal" aoMudar={setSalario} />
              </Campo>
              <Campo rotulo="Adicionais fixos" htmlFor="rs-adic">
                <CampoValor id="rs-adic" aoMudar={setAdicionais} />
              </Campo>
              <Campo rotulo="Admissão" htmlFor="rs-adm">
                <Input id="rs-adm" type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
              </Campo>
              <Campo rotulo="Férias vencidas não tiradas" htmlFor="rs-ferias">
                <Select id="rs-ferias" value={String(ferias)} onChange={(e) => setFerias(Number(e.target.value))}>
                  <option value="0">Nenhuma</option>
                  <option value="1">1 período</option>
                  <option value="2">2 períodos</option>
                </Select>
              </Campo>
              <Campo rotulo="Saldo do FGTS (opcional)" htmlFor="rs-fgts" ajuda="Sem ele, a multa é estimada.">
                <CampoValor id="rs-fgts" aoMudar={setSaldo} />
              </Campo>
              {experiencia ? (
                <Campo rotulo="Fim previsto do contrato" htmlFor="rs-fim">
                  <Input id="rs-fim" type="date" value={fimContrato} onChange={(e) => setFimContrato(e.target.value)} />
                </Campo>
              ) : null}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Tipo de desligamento" htmlFor="rs-tipo" ajuda={TIPOS_RESCISAO[tipo].descricao}>
              <Select id="rs-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoRescisao)}>
                {Object.entries(TIPOS_RESCISAO).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo
              rotulo={tipo === "fim_experiencia" ? "Data do término" : "Data do desligamento"}
              htmlFor="rs-data"
              ajuda={tipo === "fim_experiencia" ? "Para cadastrados, usa a data prevista do contrato." : "Último dia trabalhado (ou dia do aviso, se indenizado)."}
            >
              <Input id="rs-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
            {opcoesAviso.length ? (
              <Campo rotulo="Aviso prévio" htmlFor="rs-aviso">
                <Select id="rs-aviso" value={avisoEfetivo} onChange={(e) => setAviso(e.target.value as ModoAviso)}>
                  {opcoesAviso.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {resultados.length === 0 ? (
        <Alerta tom="info">{modo === "avulsa" ? "Informe o salário e a data de admissão." : "Escolha um ou mais colaboradores."}</Alerta>
      ) : resultados.length === 1 ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>{resultados[0].nome}</CardTitle>
              <CardDescription>
                {TIPOS_RESCISAO[tipo].rotulo} · {formatarData(data)}
              </CardDescription>
            </div>
            <Button variante="contorno" tamanho="sm" onClick={() => window.print()} className="print:hidden">
              <Printer /> Imprimir
            </Button>
          </CardHeader>
          <CardContent>
            <Detalhe r={resultados[0].r} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>
                {resultados.length} colaboradores · {TIPOS_RESCISAO[tipo].rotulo}
              </CardTitle>
              <CardDescription>Toque em um nome para ver o cálculo.</CardDescription>
            </div>
            <Button variante="contorno" tamanho="sm" onClick={() => window.print()} className="print:hidden">
              <Printer /> Imprimir
            </Button>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <Table>
              <THead>
                <Tr>
                  <Th>Colaborador</Th>
                  <Th className="hidden text-right sm:table-cell">Verbas</Th>
                  <Th className="hidden text-right md:table-cell">FGTS + multa</Th>
                  <Th className="hidden text-right md:table-cell">Encargos</Th>
                  <Th className="text-right">Custo total</Th>
                </Tr>
              </THead>
              <TBody>
                {resultados.map((x) => (
                  <React.Fragment key={x.id}>
                    <Tr>
                      <Td>
                        <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => setAberto(aberto === x.id ? null : x.id)}>
                          {x.nome}
                        </button>
                        {!x.r.valido ? <Badge variante="alerta" className="ml-2">{x.r.erro}</Badge> : null}
                      </Td>
                      <Td className="hidden text-right numero sm:table-cell">{formatarMoeda(x.r.totalProventos)}</Td>
                      <Td className="hidden text-right numero md:table-cell">{formatarMoeda(x.r.fgtsMes.plus(x.r.multaFgts))}</Td>
                      <Td className="hidden text-right numero md:table-cell">{formatarMoeda(x.r.encargos)}</Td>
                      <Td className="text-right numero font-semibold">{formatarMoeda(x.r.custoTotal)}</Td>
                    </Tr>
                    {aberto === x.id ? (
                      <Tr>
                        <Td colSpan={5} className="bg-muted/30">
                          <Detalhe r={x.r} />
                        </Td>
                      </Tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </TBody>
              <TFoot>
                <Tr>
                  <Td className="font-semibold">Total</Td>
                  <Td className="hidden text-right numero sm:table-cell">{formatarMoeda(soma((r) => r.totalProventos))}</Td>
                  <Td className="hidden text-right numero md:table-cell">{formatarMoeda(soma((r) => r.fgtsMes.plus(r.multaFgts)))}</Td>
                  <Td className="hidden text-right numero md:table-cell">{formatarMoeda(soma((r) => r.encargos))}</Td>
                  <Td className="text-right numero font-bold text-titulo">{formatarMoeda(soma((r) => r.custoTotal))}</Td>
                </Tr>
              </TFoot>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground">
        <p>
          Simulação para planejamento, com as regras da CLT e as tabelas de INSS/IRRF vigentes. O valor exato sai do termo de rescisão calculado pelo escritório
          (médias, faltas, banco de horas e convenção coletiva).
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3">
          {[RESCISAO.fonteClt, RESCISAO.fonteAviso, RESCISAO.fonteMulta].map((f) => (
            <a key={f.titulo} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              {f.titulo} <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        </p>
      </div>
    </div>
  );
}
