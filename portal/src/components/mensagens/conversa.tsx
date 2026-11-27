"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Lock, MessageSquarePlus, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { alterarStatusConversa, criarConversa, enviarMensagem } from "@/lib/mensagens/acoes";
import { SeletorAnexos, type Anexo } from "./anexos";

interface ConfigAnexos {
  categoria: string;
  competencia: string;
  extensoes: string[];
  limiteMb: number;
}

export function NovaConversa({
  empresaId,
  equipe,
  competencias,
  anexos: cfg,
  base,
}: {
  empresaId: string;
  equipe: boolean;
  competencias: { valor: string; rotulo: string }[];
  anexos: ConfigAnexos;
  base: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [tipo, setTipo] = useState<"mensagem" | "solicitacao">("mensagem");
  const [competencia, setCompetencia] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar() {
    setErro(null);
    iniciar(async () => {
      const r = await criarConversa(empresaId, { assunto, corpo, tipo, competencia: competencia || null, anexos: anexos.map((a) => a.id) });
      if (!r.ok || !r.dados) {
        setErro(r.mensagem ?? "Não foi possível enviar.");
        return;
      }
      toast.success("Mensagem enviada.");
      setAberto(false);
      setAssunto("");
      setCorpo("");
      setAnexos([]);
      router.push(`${base}/${r.dados.id}`);
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button>
          <MessageSquarePlus /> Nova conversa
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Nova conversa" descricao={equipe ? "A empresa é avisada no portal e por e-mail." : "A equipe do escritório recebe sua mensagem e responde por aqui."} largura="lg">
        <div className="space-y-4">
          {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
          {equipe ? (
            <Campo rotulo="Tipo" htmlFor="nc-tipo">
              <Select id="nc-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "mensagem" | "solicitacao")}>
                <option value="mensagem">Mensagem</option>
                <option value="solicitacao">Solicitação (pede uma ação ou documento ao cliente)</option>
              </Select>
            </Campo>
          ) : null}
          <Campo rotulo="Assunto" htmlFor="nc-assunto" obrigatorio>
            <Input id="nc-assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={200} placeholder="Ex.: dúvida sobre a guia do Simples" />
          </Campo>
          <Campo rotulo="Mensagem" htmlFor="nc-corpo" obrigatorio>
            <Textarea id="nc-corpo" value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={6} maxLength={10000} />
          </Campo>
          <Campo rotulo="Competência relacionada (opcional)" htmlFor="nc-comp">
            <Select id="nc-comp" value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
              <option value="">Nenhuma</option>
              {competencias.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <SeletorAnexos empresaId={empresaId} anexos={anexos} aoMudar={setAnexos} {...cfg} />
          <div className="flex justify-end">
            <Button onClick={enviar} disabled={pendente || !assunto.trim() || !corpo.trim()}>
              {pendente ? <Loader2 className="animate-spin" /> : <Send />} Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResponderConversa({
  empresaId,
  conversaId,
  equipe,
  status,
  anexos: cfg,
}: {
  empresaId: string;
  conversaId: string;
  equipe: boolean;
  status: string;
  anexos: ConfigAnexos;
}) {
  const router = useRouter();
  const [corpo, setCorpo] = useState("");
  const [interna, setInterna] = useState(false);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [pendente, iniciar] = useTransition();

  function enviar() {
    iniciar(async () => {
      const r = await enviarMensagem(empresaId, conversaId, corpo, interna, anexos.map((a) => a.id));
      if (r.ok) {
        toast.success(r.mensagem ?? "Enviado.");
        setCorpo("");
        setAnexos([]);
        setInterna(false);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível enviar.");
    });
  }

  function mudarStatus(novo: "aberta" | "resolvida") {
    iniciar(async () => {
      const r = await alterarStatusConversa(empresaId, conversaId, novo);
      if (r.ok) {
        toast.success(r.mensagem ?? "Atualizado.");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível atualizar.");
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <Textarea
        aria-label="Sua resposta"
        value={corpo}
        onChange={(e) => setCorpo(e.target.value)}
        rows={4}
        maxLength={10000}
        placeholder={interna ? "Nota interna (visível somente para a equipe do escritório)" : "Escreva sua resposta"}
        className={interna ? "border-alerta bg-alerta-bg/40" : undefined}
      />
      {interna ? (
        <p className="text-xs text-muted-foreground">Notas internas não aceitam anexos (o arquivo ficaria visível para a empresa).</p>
      ) : (
        <SeletorAnexos empresaId={empresaId} anexos={anexos} aoMudar={setAnexos} {...cfg} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {equipe ? (
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={interna}
                disabled={anexos.length > 0}
                onChange={(e) => setInterna(e.target.checked)}
              />
              <Lock className="size-3.5" /> Nota interna
            </label>
          ) : null}
          {status === "aberta" ? (
            <Button tamanho="sm" variante="fantasma" disabled={pendente} onClick={() => mudarStatus("resolvida")}>
              <CheckCircle2 /> Marcar como resolvida
            </Button>
          ) : (
            <Button tamanho="sm" variante="fantasma" disabled={pendente} onClick={() => mudarStatus("aberta")}>
              <RotateCcw /> Reabrir
            </Button>
          )}
        </div>
        <Button onClick={enviar} disabled={pendente || !corpo.trim()}>
          {pendente ? <Loader2 className="animate-spin" /> : <Send />} {interna ? "Registrar nota" : "Enviar"}
        </Button>
      </div>
    </div>
  );
}
