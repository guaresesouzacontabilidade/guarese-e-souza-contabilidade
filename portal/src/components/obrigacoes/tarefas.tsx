"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Calculator, ChevronRight, FileCheck2, Loader2, Receipt, Send, UserRoundCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { atribuirTarefas } from "@/lib/obrigacoes/acoes";
import { urgencia } from "@/lib/obrigacoes/regras";
import { ETAPAS, STATUS_TAREFA } from "@/lib/obrigacoes/rotulos";
import { cn } from "@/lib/utils";

export interface TarefaLinha {
  id: string;
  empresa: string;
  obrigacao: string;
  competencia: string;
  etapa: string;
  status: string;
  prazo_legal: string | null;
  prazo_interno: string;
  responsavel: string | null;
  revisor: string | null;
  guia: boolean;
  comprovante: boolean;
  concluida_em: string | null;
}

export const ICONE_ETAPA = { apuracao: Calculator, entrega: Send, pagamento: Banknote } as const;

export function EtapaBadge({ etapa }: { etapa: string }) {
  const Icone = ICONE_ETAPA[etapa as keyof typeof ICONE_ETAPA] ?? Calculator;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Icone className="size-3.5" /> {ETAPAS[etapa]?.rotulo ?? etapa}
    </span>
  );
}

function iniciais(nome: string | null) {
  if (!nome) return "—";
  const p = nome.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

export function TabelaTarefas({ linhas, equipe, hoje }: { linhas: TarefaLinha[]; equipe: { id: string; nome: string }[]; hoje: string }) {
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [atribuindo, setAtribuindo] = useState(false);
  const [responsavel, setResponsavel] = useState("");
  const [revisor, setRevisor] = useState("");
  const [semRevisor, setSemRevisor] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const abertas = linhas.filter((l) => l.status !== "concluida" && l.status !== "dispensada");
  const todas = abertas.length > 0 && abertas.every((l) => selecionadas.has(l.id));

  const alternar = (id: string) =>
    setSelecionadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirmar = () =>
    iniciar(async () => {
      const r = await atribuirTarefas([...selecionadas], responsavel, revisor, semRevisor);
      if (r.ok) {
        toast.success(r.mensagem ?? "Tarefas atualizadas.");
        setAtribuindo(false);
        setSelecionadas(new Set());
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível atribuir.");
    });

  return (
    <div className="space-y-3">
      {selecionadas.size ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-bege/70 px-3 py-2 text-sm shadow-sm backdrop-blur">
          <span>
            <strong>{selecionadas.size}</strong> tarefa(s) selecionada(s)
          </span>
          <div className="flex gap-2">
            <Button tamanho="sm" variante="fantasma" onClick={() => setSelecionadas(new Set())}>
              Limpar
            </Button>
            <Button tamanho="sm" onClick={() => setAtribuindo(true)}>
              <UserRoundCog /> Atribuir responsável ou revisor
            </Button>
          </div>
        </div>
      ) : null}
      <Table>
        <THead>
          <tr>
            <Th className="w-8">
              <Checkbox
                aria-label="Selecionar todas as abertas"
                checked={todas}
                onChange={() => setSelecionadas(todas ? new Set() : new Set(abertas.map((l) => l.id)))}
                disabled={!abertas.length}
              />
            </Th>
            <Th>Prazo</Th>
            <Th>Obrigação</Th>
            <Th>Etapa</Th>
            <Th>Situação</Th>
            <Th className="hidden lg:table-cell">Responsável</Th>
            <Th className="hidden md:table-cell">Portal</Th>
            <Th className="w-8" />
          </tr>
        </THead>
        <TBody>
          {linhas.map((l) => {
            const aberta = l.status !== "concluida" && l.status !== "dispensada";
            const efetivo = l.prazo_legal && l.prazo_legal < l.prazo_interno ? l.prazo_legal : l.prazo_interno;
            const u = urgencia(aberta ? (l.prazo_legal && l.prazo_legal < hoje ? l.prazo_legal : efetivo) : null, hoje);
            const st = STATUS_TAREFA[l.status] ?? { rotulo: l.status, tom: "neutro" as const };
            return (
              <Tr key={l.id} className={cn(selecionadas.has(l.id) && "bg-bege/40")}>
                <Td>
                  <Checkbox aria-label="Selecionar tarefa" checked={selecionadas.has(l.id)} onChange={() => alternar(l.id)} disabled={!aberta} />
                </Td>
                <Td className="whitespace-nowrap">
                  {aberta ? (
                    <>
                      <p className="font-medium numero">{formatarData(l.prazo_interno)}</p>
                      <p className={cn("text-xs", u.tom === "perigo" ? "font-medium text-perigo" : u.tom === "alerta" ? "text-alerta-fg" : "text-muted-foreground")}>
                        {u.rotulo}
                      </p>
                      {l.prazo_legal ? <p className="text-xs text-muted-foreground">Legal: {formatarData(l.prazo_legal)}</p> : null}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground numero">{formatarData(l.prazo_legal ?? l.prazo_interno)}</p>
                      {l.concluida_em ? <p className="text-xs text-sucesso">feita em {formatarData(l.concluida_em)}</p> : null}
                    </>
                  )}
                </Td>
                <Td className="min-w-[14rem]">
                  <Link href={`/escritorio/obrigacoes/tarefas/${l.id}`} className="font-medium text-titulo hover:underline">
                    {l.obrigacao}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {l.empresa} · {formatarCompetencia(l.competencia)}
                  </p>
                </Td>
                <Td>
                  <EtapaBadge etapa={l.etapa} />
                </Td>
                <Td>
                  <Badge variante={st.tom}>{st.rotulo}</Badge>
                </Td>
                <Td className="hidden lg:table-cell">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground" title={l.responsavel ?? "Sem responsável"}>
                      {iniciais(l.responsavel)}
                    </span>
                    <div className="min-w-0 text-xs">
                      <p className="truncate">{l.responsavel ?? "Sem responsável"}</p>
                      {l.revisor ? <p className="truncate text-muted-foreground">Revisão: {l.revisor}</p> : null}
                    </div>
                  </div>
                </Td>
                <Td className="hidden md:table-cell">
                  <div className="flex gap-1.5 text-muted-foreground">
                    {l.guia ? (
                      <span title="Guia publicada no portal" className="text-info-fg">
                        <Receipt className="size-4" />
                      </span>
                    ) : null}
                    {l.comprovante ? (
                      <span title="Comprovante anexado" className="text-sucesso">
                        <FileCheck2 className="size-4" />
                      </span>
                    ) : null}
                    {!l.guia && !l.comprovante ? <span className="text-xs">—</span> : null}
                  </div>
                </Td>
                <Td>
                  <Link href={`/escritorio/obrigacoes/tarefas/${l.id}`} aria-label="Abrir tarefa" className="text-muted-foreground hover:text-foreground">
                    <ChevronRight className="size-4" />
                  </Link>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      <Dialog open={atribuindo} onOpenChange={setAtribuindo}>
        {atribuindo ? (
          <DialogContent titulo="Atribuir tarefas" descricao={`${selecionadas.size} tarefa(s) aberta(s) selecionada(s). Tarefas concluídas não mudam.`}>
            <div className="space-y-4">
              <Campo rotulo="Responsável" htmlFor="resp">
                <Select id="resp" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
                  <option value="">Manter o atual</option>
                  {equipe.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Revisor" htmlFor="rev">
                <Select id="rev" value={revisor} onChange={(e) => setRevisor(e.target.value)} disabled={semRevisor}>
                  <option value="">Manter o atual</option>
                  {equipe.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={semRevisor} onChange={(e) => setSemRevisor(e.target.checked)} /> Remover o revisor (concluir sem revisão)
              </label>
              <div className="flex justify-end gap-2">
                <Button variante="contorno" onClick={() => setAtribuindo(false)}>
                  Cancelar
                </Button>
                <Button onClick={confirmar} disabled={pendente}>
                  {pendente ? <Loader2 className="animate-spin" /> : null} Aplicar
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
