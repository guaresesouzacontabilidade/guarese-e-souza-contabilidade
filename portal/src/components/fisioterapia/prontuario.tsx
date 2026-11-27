"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardPlus, FilePlus2, LogOut, Loader2, MessageSquarePlus, Stethoscope, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { abrirAvaliacao, abrirEvolucao, cancelarRegistro, emitirDocumento, registrarAdendo, salvarAvaliacao, salvarEvolucao } from "@/lib/fisioterapia/acoes";
import { CONDUTAS, MOTIVOS_ALTA, TIPOS_DOCUMENTO } from "@/lib/fisioterapia/rotulos";
import { DialogoMotivo } from "./comuns";

/** Botões do fisioterapeuta na ficha do paciente: nova avaliação, nova evolução (sem agenda) e alta. */
export function BotoesProntuario({ empresaId, pacienteId, temAvaliacao }: { empresaId: string; pacienteId: string; temAvaliacao: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = React.useTransition();
  const abrir = (tipo: "avaliacao" | "reavaliacao" | "sessao" | "alta") =>
    iniciar(async () => {
      const r =
        tipo === "avaliacao" || tipo === "reavaliacao"
          ? await abrirAvaliacao(empresaId, { paciente_id: pacienteId, tipo })
          : await abrirEvolucao(empresaId, { paciente_id: pacienteId, tipo });
      if (!r.ok) {
        toast.error(r.mensagem ?? "Não foi possível abrir o registro.");
        return;
      }
      const id = (r.dados as { id: string }).id;
      router.push(`/e/${empresaId}/fisioterapia/${tipo === "avaliacao" || tipo === "reavaliacao" ? "avaliacoes" : "evolucoes"}/${id}`);
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button tamanho="sm" disabled={pendente} onClick={() => abrir(temAvaliacao ? "reavaliacao" : "avaliacao")}>
        {pendente ? <Loader2 className="animate-spin" /> : <Stethoscope />} {temAvaliacao ? "Reavaliação" : "Avaliação inicial"}
      </Button>
      <Button tamanho="sm" variante="contorno" disabled={pendente} onClick={() => abrir("sessao")}>
        <ClipboardPlus /> Evolução sem agenda
      </Button>
      {temAvaliacao ? (
        <Button tamanho="sm" variante="contorno" disabled={pendente} onClick={() => abrir("alta")}>
          <LogOut /> Dar alta
        </Button>
      ) : null}
    </div>
  );
}

export interface AvaliacaoForm {
  id: string;
  queixa_principal: string | null;
  historia_atual: string | null;
  historia_pregressa: string | null;
  antecedentes: string | null;
  habitos: string | null;
  medicamentos: string | null;
  tratamentos_anteriores: string | null;
  dor_eva: number | null;
  dor_local: string | null;
  exame_fisico: string | null;
  amplitude_movimento: string | null;
  forca_muscular: string | null;
  testes_especiais: string | null;
  exames_complementares: string | null;
  diagnostico: string | null;
  cid: string | null;
  prognostico: string | null;
  objetivos: string | null;
  condutas: string | null;
  frequencia_semanal: number | null;
  sessoes_previstas: number | null;
}

function Texto({ nome, rotulo, valor, linhas = 3, max, ajuda, obrigatorio }: { nome: string; rotulo: string; valor: string | null; linhas?: number; max: number; ajuda?: string; obrigatorio?: boolean }) {
  return (
    <Campo rotulo={rotulo} htmlFor={`f-${nome}`} ajuda={ajuda} obrigatorio={obrigatorio}>
      <Textarea id={`f-${nome}`} name={nome} rows={linhas} maxLength={max} defaultValue={valor ?? ""} />
    </Campo>
  );
}

/** Escala de dor de 0 a 10 (escala visual analógica). */
function EscalaDor({ nome, rotulo, valor }: { nome: string; rotulo: string; valor: number | null }) {
  const [v, setV] = React.useState<string>(valor === null ? "" : String(valor));
  const n = v === "" ? null : Number(v);
  const cor = n === null ? "text-muted-foreground" : n >= 7 ? "text-perigo" : n >= 4 ? "text-alerta" : "text-sucesso";
  return (
    <Campo rotulo={rotulo} htmlFor={`f-${nome}`}>
      <div className="flex items-center gap-3">
        <input
          id={`f-${nome}`}
          type="range"
          min={0}
          max={10}
          step={1}
          value={v === "" ? 0 : v}
          onChange={(e) => setV(e.target.value)}
          className="w-full accent-primary"
          aria-valuetext={v === "" ? "não informada" : `${v} de 10`}
        />
        <input type="hidden" name={nome} value={v} />
        <span className={`numero w-14 shrink-0 text-right text-lg font-semibold ${cor}`}>{v === "" ? "—" : `${v}/10`}</span>
        {v !== "" ? (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setV("")}>
            limpar
          </button>
        ) : null}
      </div>
    </Campo>
  );
}

/** Avaliação fisioterapêutica (itens II a VI da Res. COFFITO nº 414/2012). */
export function FormAvaliacao({ empresaId, avaliacao }: { empresaId: string; avaliacao: AvaliacaoForm }) {
  const a = avaliacao;
  const finalizar = React.useRef<HTMLInputElement>(null);
  return (
    <FormularioAcao acao={salvarAvaliacao.bind(null, empresaId, a.id)} className="space-y-6" atualizarAoSucesso>
      {({ pendente }) => (
        <>
          <input ref={finalizar} type="hidden" name="finalizar" defaultValue="0" />
          <section className="space-y-4">
            <h2 className="font-semibold">História clínica</h2>
            <Texto nome="queixa_principal" rotulo="Queixa principal" valor={a.queixa_principal} linhas={2} max={2000} obrigatorio />
            <div className="grid gap-4 md:grid-cols-2">
              <Texto nome="historia_atual" rotulo="História da doença atual" valor={a.historia_atual} max={5000} />
              <Texto nome="historia_pregressa" rotulo="História pregressa" valor={a.historia_pregressa} max={5000} />
              <Texto nome="antecedentes" rotulo="Antecedentes pessoais e familiares" valor={a.antecedentes} max={3000} />
              <Texto nome="habitos" rotulo="Hábitos de vida" valor={a.habitos} max={2000} ajuda="Atividade física, trabalho, sono, tabagismo" />
              <Texto nome="medicamentos" rotulo="Medicamentos em uso" valor={a.medicamentos} max={2000} />
              <Texto nome="tratamentos_anteriores" rotulo="Tratamentos já realizados" valor={a.tratamentos_anteriores} max={2000} />
            </div>
          </section>
          <section className="space-y-4">
            <h2 className="font-semibold">Exame físico-funcional</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <EscalaDor nome="dor_eva" rotulo="Dor (EVA 0 a 10)" valor={a.dor_eva} />
              <Campo rotulo="Local da dor" htmlFor="f-dor_local">
                <Input id="f-dor_local" name="dor_local" maxLength={300} defaultValue={a.dor_local ?? ""} />
              </Campo>
            </div>
            <Texto nome="exame_fisico" rotulo="Inspeção, palpação e postura" valor={a.exame_fisico} linhas={4} max={10000} />
            <div className="grid gap-4 md:grid-cols-3">
              <Texto nome="amplitude_movimento" rotulo="Amplitude de movimento (goniometria)" valor={a.amplitude_movimento} max={3000} />
              <Texto nome="forca_muscular" rotulo="Força muscular (0 a 5)" valor={a.forca_muscular} max={3000} />
              <Texto nome="testes_especiais" rotulo="Testes especiais" valor={a.testes_especiais} max={3000} />
            </div>
            <Texto nome="exames_complementares" rotulo="Exames complementares (já feitos e pedidos)" valor={a.exames_complementares} linhas={2} max={3000} />
          </section>
          <section className="space-y-4">
            <h2 className="font-semibold">Diagnóstico e prognóstico fisioterapêuticos</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <Texto nome="diagnostico" rotulo="Diagnóstico fisioterapêutico (cinético-funcional)" valor={a.diagnostico} linhas={2} max={3000} obrigatorio />
              </div>
              <Campo rotulo="CID do pedido médico" htmlFor="f-cid" ajuda="Opcional (ex.: M54.5)">
                <Input id="f-cid" name="cid" maxLength={8} defaultValue={a.cid ?? ""} className="uppercase" />
              </Campo>
            </div>
            <Texto nome="prognostico" rotulo="Prognóstico" valor={a.prognostico} linhas={2} max={2000} />
          </section>
          <section className="space-y-4">
            <h2 className="font-semibold">Plano terapêutico</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Texto nome="objetivos" rotulo="Objetivos terapêuticos" valor={a.objetivos} max={3000} obrigatorio />
              <Texto nome="condutas" rotulo="Recursos, métodos e técnicas" valor={a.condutas} max={5000} obrigatorio />
              <Campo rotulo="Frequência (vezes por semana)" htmlFor="f-freq">
                <Input id="f-freq" name="frequencia_semanal" type="number" min={1} max={14} defaultValue={a.frequencia_semanal ?? ""} />
              </Campo>
              <Campo rotulo="Número provável de sessões" htmlFor="f-sessoes">
                <Input id="f-sessoes" name="sessoes_previstas" type="number" min={1} max={500} defaultValue={a.sessoes_previstas ?? ""} />
              </Campo>
            </div>
          </section>
          <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
            <BotaoEnviar pendente={pendente} variante="contorno" onClick={() => finalizar.current && (finalizar.current.value = "0")}>
              Salvar rascunho
            </BotaoEnviar>
            <BotaoEnviar pendente={pendente} textoPendente="Finalizando..." onClick={() => finalizar.current && (finalizar.current.value = "1")}>
              Finalizar e assinar
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export interface EvolucaoForm {
  id: string;
  tipo: string;
  subjetivo: string | null;
  objetivo: string | null;
  analise: string | null;
  plano: string | null;
  condutas: string[];
  dor_antes: number | null;
  dor_depois: number | null;
  intercorrencias: string | null;
  orientacoes: string | null;
  alta_motivo: string | null;
}

/** Evolução da sessão (SOAP) ou alta (item VII da Res. COFFITO nº 414/2012). */
export function FormEvolucao({ empresaId, evolucao, plano }: { empresaId: string; evolucao: EvolucaoForm; plano?: string | null }) {
  const e = evolucao;
  const alta = e.tipo === "alta";
  const finalizar = React.useRef<HTMLInputElement>(null);
  const outras = e.condutas.filter((c) => !CONDUTAS.includes(c));
  return (
    <FormularioAcao acao={salvarEvolucao.bind(null, empresaId, e.id)} className="space-y-6" atualizarAoSucesso>
      {({ pendente }) => (
        <>
          <input ref={finalizar} type="hidden" name="finalizar" defaultValue="0" />
          {plano ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">Plano terapêutico:</span> {plano}
            </p>
          ) : null}
          {alta ? (
            <Campo rotulo="Motivo da alta" htmlFor="f-alta" obrigatorio>
              <Select id="f-alta" name="alta_motivo" defaultValue={e.alta_motivo ?? "objetivos_alcancados"}>
                {Object.entries(MOTIVOS_ALTA).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <EscalaDor nome="dor_antes" rotulo="Dor antes da sessão" valor={e.dor_antes} />
              <EscalaDor nome="dor_depois" rotulo="Dor depois da sessão" valor={e.dor_depois} />
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Texto nome="subjetivo" rotulo={alta ? "Como o paciente está" : "S — Subjetivo (o que o paciente relata)"} valor={e.subjetivo} max={5000} />
            <Texto nome="objetivo" rotulo={alta ? "Reavaliação final (achados)" : "O — Objetivo (o que foi medido e observado)"} valor={e.objetivo} max={5000} />
            <Texto nome="analise" rotulo={alta ? "Resultado do tratamento" : "A — Avaliação (evolução e análise)"} valor={e.analise} max={5000} />
            <Texto nome="plano" rotulo={alta ? "Recomendações e encaminhamentos" : "P — Plano (próximos passos)"} valor={e.plano} max={5000} />
          </div>
          {!alta ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Recursos usados na sessão</legend>
              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {CONDUTAS.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm">
                    <Checkbox name="condutas" value={c} defaultChecked={e.condutas.includes(c)} /> {c}
                  </label>
                ))}
              </div>
              <Input name="outras_condutas" maxLength={300} defaultValue={outras.join(", ")} placeholder="Outros recursos (separe por vírgula)" aria-label="Outros recursos" />
            </fieldset>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Texto nome="intercorrencias" rotulo="Intercorrências" valor={e.intercorrencias} linhas={2} max={3000} />
            <Texto nome="orientacoes" rotulo="Orientações ao paciente" valor={e.orientacoes} linhas={2} max={3000} />
          </div>
          <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
            <BotaoEnviar pendente={pendente} variante="contorno" onClick={() => finalizar.current && (finalizar.current.value = "0")}>
              Salvar rascunho
            </BotaoEnviar>
            <BotaoEnviar pendente={pendente} textoPendente="Finalizando..." onClick={() => finalizar.current && (finalizar.current.value = "1")}>
              {alta ? "Finalizar a alta" : "Finalizar e assinar"}
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Adendo (correção ou complemento datado) de um registro finalizado. */
export function DialogoAdendo({ empresaId, tipo, id }: { empresaId: string; tipo: "avaliacao" | "evolucao"; id: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          <MessageSquarePlus /> Adendo
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Registrar adendo" descricao="O registro finalizado não muda. O adendo fica abaixo dele, com data, hora e o seu CREFITO.">
        <FormularioAcao acao={registrarAdendo.bind(null, empresaId, tipo, id)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ pendente }) => (
            <>
              <Campo rotulo="Texto" htmlFor="ad-texto" obrigatorio>
                <Textarea id="ad-texto" name="texto" rows={4} maxLength={5000} required minLength={3} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar adendo</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function CancelarRegistro({ empresaId, tipo, id }: { empresaId: string; tipo: "avaliacao" | "evolucao"; id: string }) {
  return (
    <DialogoMotivo
      acao={cancelarRegistro.bind(null, empresaId, tipo, id)}
      titulo="Cancelar este registro?"
      descricao="Só o rascunho pode ser cancelado. Ele fica no prontuário como cancelado, com o motivo."
      rotuloBotao="Cancelar rascunho"
      textoConfirmar="Cancelar registro"
      icone={<X />}
    />
  );
}

/** Documento do fisioterapeuta (declaração de comparecimento, relatório, encaminhamento, orientações). */
export function DialogoDocumento({ empresaId, pacienteId, paciente, hoje, hora }: { empresaId: string; pacienteId: string; paciente: string; hoje: string; hora: string }) {
  const [aberto, setAberto] = React.useState(false);
  const [tipo, setTipo] = React.useState("comparecimento");
  const router = useRouter();
  const data = `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`;
  const modelo = TIPOS_DOCUMENTO[tipo]?.modelo({ paciente, data, hora }) ?? "";
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          <FilePlus2 /> Documento
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Emitir documento" largura="lg">
        <FormularioAcao
          acao={emitirDocumento.bind(null, empresaId, pacienteId)}
          aoSucesso={(r) => {
            setAberto(false);
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (id) router.push(`/e/${empresaId}/fisioterapia/documentos/${id}`);
          }}
          className="space-y-4"
        >
          {({ pendente }) => (
            <>
              <Campo rotulo="Tipo" htmlFor="doc-tipo">
                <Select id="doc-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {Object.entries(TIPOS_DOCUMENTO).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Texto" htmlFor="doc-texto" ajuda="Revise antes de emitir: o documento emitido não muda (pode ser cancelado).">
                <Textarea key={tipo} id="doc-texto" name="texto" rows={9} maxLength={10000} defaultValue={modelo} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Emitir</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
