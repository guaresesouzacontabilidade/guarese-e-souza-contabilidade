"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Loader2, Lock, LockOpen, Play, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { cn } from "@/lib/utils";
import type { ResultadoAcao } from "@/lib/acoes";
import { ETAPAS_FECHAMENTO, STATUS_ETAPA } from "@/lib/rotulos";
import { atualizarEtapa, fecharCompetencia, iniciarFechamento, reabrirCompetencia, registrarPendencia, resolverPendencia } from "@/lib/fechamento/acoes";
import type { Verificacao } from "@/lib/fechamento/verificacoes";

function useAcao() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const executar = (fn: () => Promise<ResultadoAcao>) =>
    new Promise<boolean>((resolve) =>
      iniciar(async () => {
        const r = await fn();
        if (r.ok) {
          toast.success(r.mensagem ?? "Feito.");
          router.refresh();
        } else toast.error(r.mensagem ?? "Não foi possível concluir.");
        resolve(r.ok);
      }),
    );
  return { executar, pendente };
}

export function BotaoIniciar({ empresaId, comp }: { empresaId: string; comp: string }) {
  const { executar, pendente } = useAcao();
  return (
    <Button onClick={() => executar(() => iniciarFechamento(empresaId, comp))} disabled={pendente}>
      {pendente ? <Loader2 className="animate-spin" /> : <Play />} Iniciar fechamento
    </Button>
  );
}

function IconeVerificacao({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-sucesso" aria-label="ok" />;
  if (ok === false) return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" aria-label="pendente" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-info" aria-label="informação" />;
}

export interface EtapaVisual {
  id: string;
  etapa: string;
  ordem: number;
  status: string;
  responsavel_id: string | null;
  responsavel: string | null;
  observacao: string | null;
  concluida_em: string | null;
  pendenciasAbertas: number;
}

export function CartaoEtapa({
  empresaId,
  etapa,
  verificacoes,
  equipe,
  podeGerenciar,
  bloqueada,
}: {
  empresaId: string;
  etapa: EtapaVisual;
  verificacoes: Verificacao[];
  equipe: { id: string; nome: string }[];
  podeGerenciar: boolean;
  bloqueada: boolean;
}) {
  const { executar, pendente } = useAcao();
  const [status, setStatus] = useState(etapa.status);
  const [responsavel, setResponsavel] = useState(etapa.responsavel_id ?? "");
  const [obs, setObs] = useState(etapa.observacao ?? "");
  const st = STATUS_ETAPA[etapa.status] ?? { rotulo: etapa.status, tom: "neutro" as const };
  const tudoOk = verificacoes.length > 0 && verificacoes.every((v) => v.ok !== false);
  const alterado = status !== etapa.status || responsavel !== (etapa.responsavel_id ?? "") || obs !== (etapa.observacao ?? "");

  return (
    <li className={cn("rounded-xl border bg-card shadow-sm", etapa.status === "concluida" ? "border-sucesso/40" : "border-border")}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-sm font-bold",
            etapa.status === "concluida" ? "bg-sucesso text-white" : etapa.status === "em_andamento" ? "bg-alerta-bg text-alerta-fg" : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {etapa.status === "concluida" ? "✓" : etapa.ordem}
        </span>
        <h3 className="font-semibold">{ETAPAS_FECHAMENTO[etapa.etapa] ?? etapa.etapa}</h3>
        <Badge variante={st.tom}>{st.rotulo}</Badge>
        {etapa.pendenciasAbertas ? <Badge variante="perigo">{etapa.pendenciasAbertas} pendência(s) impeditiva(s)</Badge> : null}
        {etapa.responsavel ? <span className="text-xs text-muted-foreground">Responsável: {etapa.responsavel}</span> : null}
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <ul className="space-y-1.5">
          {verificacoes.map((v, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <IconeVerificacao ok={v.ok} />
              {v.href ? (
                <Link href={v.href} className="group inline-flex items-start gap-1 hover:underline">
                  {v.texto}
                  <ChevronRight className="mt-0.5 size-3.5 opacity-50 group-hover:opacity-100" aria-hidden />
                </Link>
              ) : (
                <span>{v.texto}</span>
              )}
            </li>
          ))}
          {tudoOk && etapa.status !== "concluida" ? <li className="pt-1 text-xs font-medium text-sucesso">Verificações automáticas em ordem — a etapa pode ser concluída.</li> : null}
          {etapa.observacao && !podeGerenciar ? <li className="pt-1 text-sm text-muted-foreground">Observação: {etapa.observacao}</li> : null}
        </ul>
        {podeGerenciar && !bloqueada ? (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <Select aria-label="Situação da etapa" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9">
                <option value="nao_iniciada">Não iniciada</option>
                <option value="em_andamento">Em andamento</option>
                <option value="concluida">Concluída</option>
              </Select>
              <Select aria-label="Responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="h-9">
                <option value="">Sem responsável</option>
                {equipe.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
            </div>
            <Input aria-label="Observação" placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} className="h-9" />
            <Button
              tamanho="sm"
              className="w-full"
              disabled={!alterado || pendente}
              onClick={() => executar(() => atualizarEtapa(empresaId, etapa.id, { status: status as "nao_iniciada" | "em_andamento" | "concluida", responsavel_id: responsavel || null, observacao: obs || null }))}
            >
              {pendente ? <Loader2 className="animate-spin" /> : null} Salvar etapa
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function NovaPendencia({ empresaId, competenciaId }: { empresaId: string; competenciaId: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button tamanho="sm" variante="contorno">
          <Plus /> Registrar pendência
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Nova pendência do fechamento" descricao="Algo que precisa ser resolvido antes de fechar o mês.">
        <FormularioAcao acao={registrarPendencia.bind(null, empresaId, competenciaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Etapa" htmlFor="pd-etapa" erro={estado.erros?.etapa} obrigatorio>
                <Select id="pd-etapa" name="etapa" defaultValue="coleta">
                  {Object.entries(ETAPAS_FECHAMENTO).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Descrição" htmlFor="pd-desc" erro={estado.erros?.descricao} obrigatorio>
                <Textarea id="pd-desc" name="descricao" rows={3} maxLength={1000} placeholder="Ex.: falta o extrato da conta poupança de setembro" />
              </Campo>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="impeditiva" defaultChecked className="mt-0.5" />
                <span>
                  <strong>Impede o fechamento</strong> — o mês só pode ser fechado depois de resolvida ou dispensada.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="visivel_cliente" className="mt-0.5" />
                <span>
                  <strong>Mostrar ao cliente</strong> — aparece nas pendências da empresa e o cliente recebe um aviso.
                </span>
              </label>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function AcoesPendencia({ empresaId, pendenciaId, status }: { empresaId: string; pendenciaId: string; status: string }) {
  const { executar, pendente } = useAcao();
  const [texto, setTexto] = useState("");
  if (status !== "aberta") {
    return (
      <Button tamanho="sm" variante="fantasma" disabled={pendente} onClick={() => executar(() => resolverPendencia(empresaId, pendenciaId, "aberta", ""))}>
        Reabrir
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button tamanho="sm" variante="sucesso" disabled={pendente} onClick={() => executar(() => resolverPendencia(empresaId, pendenciaId, "resolvida", ""))}>
        Resolvida
      </Button>
      <Confirmacao
        gatilho={
          <Button tamanho="sm" variante="contorno" disabled={pendente}>
            Dispensar
          </Button>
        }
        titulo="Dispensar pendência?"
        descricao="Use quando a pendência não precisar mais ser resolvida. A justificativa fica no histórico."
        textoConfirmar="Dispensar"
        aoConfirmar={async () => {
          if (texto.trim().length < 3) {
            toast.error("Escreva a justificativa.");
            return false;
          }
          return executar(() => resolverPendencia(empresaId, pendenciaId, "dispensada", texto));
        }}
      >
        <Campo rotulo="Justificativa" htmlFor={`just-${pendenciaId}`} obrigatorio>
          <Textarea id={`just-${pendenciaId}`} value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={1000} />
        </Campo>
      </Confirmacao>
    </div>
  );
}

export function FecharMes({ empresaId, comp, rotulo, liberado, motivo }: { empresaId: string; comp: string; rotulo: string; liberado: boolean; motivo: string | null }) {
  const { executar } = useAcao();
  const [obs, setObs] = useState("");
  return (
    <div className="flex flex-col items-start gap-1">
      <Confirmacao
        gatilho={
          <Button variante="sucesso" disabled={!liberado}>
            <Lock /> Fechar {rotulo}
          </Button>
        }
        titulo={`Fechar ${rotulo}?`}
        descricao="Depois de fechado, lançamentos, pagamentos, conciliações e documentos do mês ficam protegidos. Para alterar, será preciso reabrir com justificativa. Relatórios publicados a partir daí saem como revisados."
        textoConfirmar="Fechar o mês"
        aoConfirmar={() => executar(() => fecharCompetencia(empresaId, comp, obs))}
      >
        <Campo rotulo="Observação (opcional)" htmlFor="obs-fechar">
          <Textarea id="obs-fechar" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} maxLength={1000} />
        </Campo>
      </Confirmacao>
      {!liberado && motivo ? <p className="text-xs text-muted-foreground">{motivo}</p> : null}
    </div>
  );
}

export function ReabrirMes({ empresaId, comp, rotulo }: { empresaId: string; comp: string; rotulo: string }) {
  const { executar } = useAcao();
  const [just, setJust] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno">
          <LockOpen /> Reabrir {rotulo}
        </Button>
      }
      titulo={`Reabrir ${rotulo}?`}
      descricao="Use só quando for realmente necessário (ex.: documento recebido depois do fechamento). A justificativa fica registrada e a equipe é avisada; as etapas de revisão e publicação voltam a ficar em andamento."
      textoConfirmar="Reabrir"
      variante="perigo"
      aoConfirmar={async () => {
        if (just.trim().length < 10) {
          toast.error("Explique o motivo (mínimo de 10 caracteres).");
          return false;
        }
        return executar(() => reabrirCompetencia(empresaId, comp, just));
      }}
    >
      <Campo rotulo="Justificativa" htmlFor="just-reabrir" obrigatorio>
        <Textarea id="just-reabrir" value={just} onChange={(e) => setJust(e.target.value)} rows={3} maxLength={1000} />
      </Campo>
    </Confirmacao>
  );
}
