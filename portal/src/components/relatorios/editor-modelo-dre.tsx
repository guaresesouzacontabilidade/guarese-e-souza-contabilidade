"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Sigma, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { cn } from "@/lib/utils";
import {
  definirLinhaConta,
  excluirLinhaDre,
  inserirLinhaDre,
  moverLinhaDre,
  restaurarDrePadrao,
  salvarLinhaDre,
} from "@/lib/relatorios/acoes-modelo-dre";

export interface LinhaEditor {
  id: string;
  tipo: "grupo" | "total";
  rotulo: string;
  padrao: boolean;
  resultado: boolean;
  mostrar_contas: boolean;
  oculta: boolean;
}

export interface ContaLinha {
  id: string;
  rotulo: string;
  /** A conta (ou o grupo) foi levada para esta linha. */
  explicita: boolean;
  /** Está nesta linha porque o grupo dela foi levado para cá. */
  viaGrupo?: string;
  ativa: boolean;
}

/**
 * Editor do modelo do DRE: cada linha na ordem, com subir/descer, renomear,
 * recolher contas ou esconder subtotal, contas da linha e linhas novas.
 */
export function EditorModeloDre({
  empresaId,
  linhas,
  contasPorLinha,
  opcoesConta,
  podeEditar,
}: {
  empresaId: string;
  linhas: LinhaEditor[];
  contasPorLinha: Record<string, ContaLinha[]>;
  opcoesConta: { id: string; rotulo: string; linhaId: string | null }[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<LinhaEditor | null>(null);
  const [nova, setNova] = useState<"grupo" | "total" | null>(null);
  const [pendente, iniciar] = useTransition();

  const rodar = (fn: () => Promise<{ ok: boolean; mensagem?: string }>) =>
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.mensagem) toast.success(r.mensagem);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível concluir.");
    });

  return (
    <div className="space-y-4">
      {podeEditar ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setNova("grupo")}>
              <Plus /> Linha de contas
            </Button>
            <Button variante="contorno" onClick={() => setNova("total")}>
              <Sigma /> Subtotal
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variante="contorno">
              <Link href={`/e/${empresaId}/relatorios/dre`}>Ver o DRE</Link>
            </Button>
            <BotaoAcao
              variante="fantasma"
              acao={() => restaurarDrePadrao(empresaId)}
              confirmar={{
                titulo: "Voltar ao modelo padrão?",
                descricao: "Os nomes, a ordem e as linhas próprias serão apagados e as contas voltam às linhas do padrão. Os lançamentos não mudam.",
                textoConfirmar: "Voltar ao padrão",
                perigo: true,
              }}
            >
              <RotateCcw /> Voltar ao padrão
            </BotaoAcao>
          </div>
        </div>
      ) : null}

      <ol className="space-y-2" aria-label="Linhas do DRE">
        {linhas.map((l, i) => {
          const contas = contasPorLinha[l.id] ?? [];
          const podeSubir = podeEditar && !l.resultado && i > 0;
          const podeDescer = podeEditar && !l.resultado && i < linhas.length - 2;
          return (
            <li
              key={l.id}
              className={cn("rounded-xl border border-border bg-card", l.tipo === "total" && "bg-muted/60", l.resultado && "border-primary/40 bg-bege/60")}
              aria-label={l.rotulo}
            >
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                {podeEditar ? (
                  <span className="flex shrink-0 flex-col">
                    <Button tamanho="iconeSm" variante="fantasma" aria-label={`Subir ${l.rotulo}`} disabled={!podeSubir || pendente} onClick={() => rodar(() => moverLinhaDre(empresaId, l.id, -1))}>
                      <ArrowUp />
                    </Button>
                    <Button tamanho="iconeSm" variante="fantasma" aria-label={`Descer ${l.rotulo}`} disabled={!podeDescer || pendente} onClick={() => rodar(() => moverLinhaDre(empresaId, l.id, 1))}>
                      <ArrowDown />
                    </Button>
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", l.tipo === "total" ? "font-semibold" : "font-medium", l.oculta && "text-muted-foreground line-through")}>{l.rotulo}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.tipo === "total"
                      ? l.resultado
                        ? "Resultado final: soma de todas as linhas. Fica sempre por último."
                        : l.oculta
                          ? "Subtotal escondido no relatório (o resultado não muda)."
                          : "Subtotal: soma tudo o que está acima."
                      : `${contas.length} conta(s)${l.mostrar_contas ? "" : " · contas recolhidas no relatório"}`}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {l.padrao ? <Badge variante="neutro">Padrão</Badge> : <Badge variante="info">Própria</Badge>}
                  {podeEditar ? (
                    <>
                      <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${l.rotulo}`} onClick={() => setEditando(l)}>
                        <Pencil />
                      </Button>
                      {!l.padrao ? (
                        <BotaoAcao
                          tamanho="iconeSm"
                          variante="fantasma"
                          aria-label={`Excluir ${l.rotulo}`}
                          acao={() => excluirLinhaDre(empresaId, l.id)}
                          confirmar={{
                            titulo: `Excluir “${l.rotulo}”?`,
                            descricao: l.tipo === "grupo" ? "As contas desta linha voltam para as linhas do padrão. Nenhum lançamento é apagado." : undefined,
                            textoConfirmar: "Excluir",
                            perigo: true,
                          }}
                        >
                          <Trash2 />
                        </BotaoAcao>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </div>
              {l.tipo === "grupo" ? (
                <div className="space-y-2 border-t border-border px-3 py-2">
                  {contas.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {contas.map((c) => (
                        <li key={c.id} className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs", !c.ativa && "text-muted-foreground line-through")}>
                          {c.rotulo}
                          {c.viaGrupo ? <span className="text-muted-foreground">· pelo grupo</span> : null}
                          {podeEditar && c.explicita ? (
                            <button
                              type="button"
                              className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
                              aria-label={`Tirar ${c.rotulo} desta linha`}
                              title="Devolver para a linha do padrão"
                              disabled={pendente}
                              onClick={() => rodar(() => definirLinhaConta(empresaId, c.id, null))}
                            >
                              <X className="size-3" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">Nenhuma conta nesta linha.</p>
                  )}
                  {podeEditar ? (
                    <Select
                      aria-label={`Trazer conta para ${l.rotulo}`}
                      className="h-9 w-full text-sm sm:w-80"
                      value=""
                      disabled={pendente}
                      onChange={(ev) => {
                        const id = ev.target.value;
                        if (id) rodar(() => definirLinhaConta(empresaId, id, l.id));
                      }}
                    >
                      <option value="">+ Trazer conta ou grupo para esta linha…</option>
                      {opcoesConta
                        .filter((o) => o.linhaId !== l.id && !contas.some((c) => c.id === o.id))
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.rotulo}
                          </option>
                        ))}
                    </Select>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {editando ? (
        <Dialog open onOpenChange={(v) => !v && setEditando(null)}>
          <DialogContent titulo={editando.tipo === "total" ? "Editar subtotal" : "Editar linha"}>
            <FormularioAcao acao={salvarLinhaDre.bind(null, empresaId)} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente: enviando }) => (
                <>
                  <input type="hidden" name="id" value={editando.id} />
                  <Campo rotulo="Nome da linha" htmlFor="ln-rotulo" obrigatorio erro={estado.erros?.rotulo}>
                    <Input id="ln-rotulo" name="rotulo" defaultValue={editando.rotulo} maxLength={80} autoFocus />
                  </Campo>
                  {editando.tipo === "grupo" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name="mostrar_contas" defaultChecked={editando.mostrar_contas} /> Mostrar as contas desta linha no relatório
                    </label>
                  ) : !editando.resultado ? (
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name="mostrar_subtotal" defaultChecked={!editando.oculta} /> Mostrar este subtotal no relatório
                    </label>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variante="contorno" onClick={() => setEditando(null)}>
                      Cancelar
                    </Button>
                    <BotaoEnviar pendente={enviando}>Salvar</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}

      {nova ? (
        <Dialog open onOpenChange={(v) => !v && setNova(null)}>
          <DialogContent
            titulo={nova === "total" ? "Novo subtotal" : "Nova linha de contas"}
            descricao={nova === "total" ? "O subtotal soma tudo o que está acima dele." : "Depois de criar, traga para ela as contas que quiser (ex.: salários, pró-labore e benefícios)."}
          >
            <FormularioAcao acao={inserirLinhaDre.bind(null, empresaId)} aoSucesso={() => setNova(null)} className="space-y-4">
              {({ estado, pendente: enviando }) => (
                <>
                  <input type="hidden" name="tipo" value={nova} />
                  <Campo rotulo="Nome" htmlFor="nl-rotulo" obrigatorio erro={estado.erros?.rotulo}>
                    <Input
                      id="nl-rotulo"
                      name="rotulo"
                      maxLength={80}
                      autoFocus
                      placeholder={nova === "total" ? "Ex.: Margem de contribuição" : "Ex.: (−) Despesas com pessoal"}
                    />
                  </Campo>
                  <Campo rotulo="Fica logo abaixo de" htmlFor="nl-depois">
                    <Select id="nl-depois" name="depois_de" defaultValue="">
                      <option value="">Antes do resultado líquido</option>
                      {linhas
                        .filter((l) => !l.resultado)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.rotulo}
                          </option>
                        ))}
                    </Select>
                  </Campo>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variante="contorno" onClick={() => setNova(null)}>
                      Cancelar
                    </Button>
                    <BotaoEnviar pendente={enviando}>Criar</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
