"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Check, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { aplicarProposta, pedirAssistente, type PropostaIaTela } from "@/lib/escalas/acoes";
import { conferirEscala } from "@/lib/escalas/conferencia";
import { MODELO_POR_CHAVE } from "@/lib/escalas/modelos";
import type { Historico } from "@/lib/escalas/tipos";
import { GradeEscala } from "./grade";
import { ResumoConferencia } from "./conferencia";

const EXEMPLOS_SUGESTAO = [
  "Padaria aberta de segunda a domingo, das 6h às 20h. Preciso de 2 pessoas no balcão de manhã e 2 à tarde, e 1 no domingo à tarde.",
  "Clínica que funciona 24 horas: quero plantões de 12 horas com 1 pessoa por plantão de dia e 1 à noite.",
  "Loja de segunda a sábado, das 8h às 18h, sábado até 13h. Quero que todos folguem domingo.",
];
const EXEMPLOS_AJUSTE = [
  "Troque a folga da primeira pessoa do dia 10 para o dia 12.",
  "Ninguém pode folgar no dia 24; compense com folga no dia 26.",
  "Quem está com 7 dias seguidos ganha folga no dia mais tranquilo da semana.",
];

export interface SituacaoIa {
  ligada: boolean;
  limite: number;
  usados: number;
}

export function Assistente({
  empresaId,
  escalaId,
  competencia,
  historico,
  situacao,
  alteracoesPendentes,
  admin,
}: {
  empresaId: string;
  escalaId: string;
  competencia: string;
  historico: Historico;
  situacao: SituacaoIa;
  alteracoesPendentes: boolean;
  admin: boolean;
}) {
  const router = useRouter();
  const [tipo, setTipo] = React.useState<"sugestao" | "ajuste">("sugestao");
  const [pedido, setPedido] = React.useState("");
  const [pendente, iniciar] = React.useTransition();
  const [aplicando, iniciarAplicar] = React.useTransition();
  const [proposta, setProposta] = React.useState<PropostaIaTela | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [usados, setUsados] = React.useState(situacao.usados);

  if (!situacao.ligada) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4" /> Assistente de IA
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Alerta tom="info" titulo="Desconectado até a ativação">
            O assistente usa a inteligência artificial Claude, da Anthropic, e só funciona depois que o administrador do escritório cadastra a chave da Anthropic em
            Configurações → Integrações. {admin ? "Você é administrador: a configuração está lá." : "Enquanto isso, monte a escala pelos modelos e pela grade — a conferência da CLT funciona normalmente."}
          </Alerta>
        </CardContent>
      </Card>
    );
  }

  const pedir = () => {
    setErro(null);
    setProposta(null);
    iniciar(async () => {
      const r = await pedirAssistente(empresaId, escalaId, tipo, pedido);
      setUsados((u) => u + 1);
      if (r.ok && r.dados) setProposta(r.dados);
      else setErro(r.mensagem ?? "Não foi possível concluir o pedido.");
    });
  };

  const aplicar = () => {
    if (!proposta) return;
    iniciarAplicar(async () => {
      const r = await aplicarProposta(empresaId, escalaId, proposta.tipo, JSON.stringify(proposta.config), JSON.stringify(proposta.grade), proposta.resumo);
      if (r.ok) {
        toast.success(r.mensagem ?? "Aplicado.");
        setProposta(null);
        setPedido("");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível aplicar.");
    });
  };

  const exemplos = tipo === "sugestao" ? EXEMPLOS_SUGESTAO : EXEMPLOS_AJUSTE;
  const semLimite = usados >= situacao.limite;
  const conferenciaProposta = proposta ? conferirEscala(proposta.config, competencia, proposta.grade, historico) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" /> Assistente de IA
          </CardTitle>
          <CardDescription>
            Descreva o que precisa em palavras simples. O assistente propõe, o portal confere com a CLT e nada muda na escala até você clicar em “Aplicar”.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="inline-flex rounded-lg border border-border p-1" role="tablist" aria-label="Tipo de pedido">
            {(
              [
                ["sugestao", "Montar uma proposta"],
                ["ajuste", "Ajustar a grade"],
              ] as const
            ).map(([v, r]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={tipo === v}
                onClick={() => setTipo(v)}
                className={cn("min-h-9 rounded-md px-3 text-sm", tipo === v ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pedido-ia">{tipo === "sugestao" ? "Como funciona a empresa e do que você precisa?" : "O que você quer mudar na grade?"}</Label>
            <Textarea
              id="pedido-ia"
              rows={4}
              maxLength={1500}
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              placeholder={exemplos[0]}
              disabled={pendente}
            />
            <div className="flex flex-wrap gap-1.5">
              {exemplos.map((e) => (
                <button key={e} type="button" onClick={() => setPedido(e)} className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
                  {e.length > 70 ? `${e.slice(0, 68)}…` : e}
                </button>
              ))}
            </div>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" />
            Os nomes não saem do portal: o assistente recebe apelidos (P1, P2...), cargo, jornada, restrições e horários. Não escreva CPF, telefone, salário ou dados de saúde. O
            serviço da Anthropic não usa esses dados para treinar a IA.
          </p>
          {alteracoesPendentes ? <Alerta tom="alerta">Salve as alterações da escala antes de pedir ajuda ao assistente (ele trabalha com a versão salva).</Alerta> : null}
          {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={pedir} disabled={pendente || alteracoesPendentes || semLimite || (tipo === "ajuste" && pedido.trim().length < 5)}>
              {pendente ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {pendente ? "Pensando... (pode levar até 1 minuto)" : "Pedir ao assistente"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {usados} de {situacao.limite} pedidos hoje nesta empresa
            </span>
          </div>
        </CardContent>
      </Card>

      {proposta && conferenciaProposta ? (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">{proposta.tipo === "sugestao" ? "Proposta do assistente" : "Ajuste proposto"}</CardTitle>
            <CardDescription>
              <ResumoConferencia r={conferenciaProposta} />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="whitespace-pre-line">{proposta.resumo}</p>
            {proposta.tipo === "sugestao" ? (
              <ul className="flex flex-wrap gap-2">
                {proposta.config.pessoas.map((p) => (
                  <li key={p.id} className="rounded-lg border border-border px-2.5 py-1 text-xs">
                    <span className="font-medium">{p.nome}</span>: {MODELO_POR_CHAVE[p.modelo].nome} ·{" "}
                    {p.turnos.map((t) => proposta.config.turnos.find((x) => x.id === t)?.nome ?? t).join(" / ")}
                  </li>
                ))}
              </ul>
            ) : null}
            {proposta.alertas.length ? (
              <div>
                <p className="font-medium">Providências</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {proposta.alertas.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {proposta.alternativas.length ? (
              <div>
                <p className="font-medium">Outras opções</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {proposta.alternativas.map((a, i) => (
                    <li key={i}>
                      <span className="font-medium text-foreground">{a.nome}</span>: {a.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {proposta.ignorados.length ? (
              <p className="text-xs text-muted-foreground">Partes da resposta ignoradas por não fazerem sentido nesta escala: {proposta.ignorados.slice(0, 6).join("; ")}.</p>
            ) : null}
            <GradeEscala config={proposta.config} competencia={competencia} grade={proposta.grade} conferencia={conferenciaProposta} compacta />
            <div className="flex flex-wrap gap-2">
              <Button onClick={aplicar} disabled={aplicando}>
                {aplicando ? <Loader2 className="animate-spin" /> : <Check />} Aplicar na escala
              </Button>
              <Button variante="contorno" onClick={() => setProposta(null)} disabled={aplicando}>
                <X /> Descartar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Sugestão gerada por inteligência artificial (Claude, da Anthropic). Confira antes de aplicar e de publicar.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
