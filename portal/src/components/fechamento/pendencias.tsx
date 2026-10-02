"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CircleSlash, Eye, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Label, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarDataHora } from "@/lib/formatos";
import { ETAPAS_FECHAMENTO, STATUS_PENDENCIA_FECHAMENTO } from "@/lib/rotulos";
import { registrarPendencia, resolverPendencia } from "@/lib/fechamento/acoes";

export interface PendenciaFechamento {
  id: string;
  etapa: string | null;
  descricao: string;
  impeditiva: boolean;
  visivel_cliente: boolean;
  status: string;
  criada_por: string | null;
  criada_em: string;
  resolvida_por: string | null;
  resolvida_em: string | null;
  resolucao: string | null;
}

/** Diálogo de confirmação com um campo de texto. */
function AcaoComTexto({
  gatilho,
  titulo,
  descricao,
  rotulo,
  obrigatorio,
  textoConfirmar,
  executar,
}: {
  gatilho: React.ReactNode;
  titulo: string;
  descricao?: string;
  rotulo: string;
  obrigatorio: boolean;
  textoConfirmar: string;
  executar: (texto: string) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState("");
  return (
    <Confirmacao
      gatilho={gatilho}
      titulo={titulo}
      descricao={descricao}
      textoConfirmar={textoConfirmar}
      aoConfirmar={async () => {
        if (obrigatorio && !texto.trim()) {
          toast.error("Preencha o campo para continuar.");
          return false;
        }
        const ok = await executar(texto.trim());
        if (ok) setTexto("");
        return ok;
      }}
    >
      <Textarea aria-label={rotulo} placeholder={rotulo} value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={2000} />
    </Confirmacao>
  );
}

export function PendenciasFechamento({
  empresaId,
  competenciaId,
  pendencias,
  fechada,
}: {
  empresaId: string;
  competenciaId: string;
  pendencias: PendenciaFechamento[];
  fechada: boolean;
}) {
  const router = useRouter();
  const [novo, setNovo] = useState(false);
  const [verResolvidas, setVerResolvidas] = useState(false);

  const executar = async (pendenciaId: string, status: string, texto: string) => {
    const r = await resolverPendencia(empresaId, pendenciaId, status, texto);
    if (r.ok) {
      toast.success(r.mensagem ?? "Pendência atualizada.");
      router.refresh();
      return true;
    }
    toast.error(r.mensagem ?? "Não foi possível atualizar a pendência.");
    return false;
  };

  const abertas = pendencias.filter((p) => p.status === "aberta");
  const encerradas = pendencias.filter((p) => p.status !== "aberta");
  const visiveis = verResolvidas ? [...abertas, ...encerradas] : abertas;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {abertas.length ? `${abertas.length} pendência(s) aberta(s)` : "Nenhuma pendência aberta."}
          {encerradas.length ? (
            <>
              {" · "}
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setVerResolvidas((v) => !v)}>
                {verResolvidas ? "ocultar encerradas" : `ver ${encerradas.length} encerrada(s)`}
              </button>
            </>
          ) : null}
        </p>
        <Button variante="contorno" onClick={() => setNovo(true)}>
          <Plus /> Registrar pendência
        </Button>
      </div>

      {visiveis.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visiveis.map((p) => {
            const st = STATUS_PENDENCIA_FECHAMENTO[p.status] ?? { rotulo: p.status, tom: "neutro" as const };
            return (
              <li key={p.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variante={st.tom}>{st.rotulo}</Badge>
                    {p.impeditiva ? <Badge variante={p.status === "aberta" ? "perigo" : "neutro"}>Impeditiva</Badge> : <Badge variante="neutro">Não impede o fechamento</Badge>}
                    <Badge variante="contorno">{p.etapa ? (ETAPAS_FECHAMENTO[p.etapa] ?? p.etapa) : "Geral"}</Badge>
                    {p.visivel_cliente ? (
                      <Badge variante="info">
                        <Eye /> Visível ao cliente
                      </Badge>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-line text-sm">{p.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    Registrada em {formatarDataHora(p.criada_em)}
                    {p.criada_por ? ` por ${p.criada_por}` : ""}
                    {p.resolvida_em ? ` · ${st.rotulo.toLowerCase()} em ${formatarDataHora(p.resolvida_em)}${p.resolvida_por ? ` por ${p.resolvida_por}` : ""}` : ""}
                  </p>
                  {p.resolucao ? <p className="whitespace-pre-line text-xs text-muted-foreground">Resolução: {p.resolucao}</p> : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {p.status === "aberta" ? (
                    <>
                      <AcaoComTexto
                        gatilho={
                          <Button tamanho="sm" variante="sucesso">
                            <CheckCircle2 /> Resolver
                          </Button>
                        }
                        titulo="Resolver pendência"
                        descricao={p.descricao}
                        rotulo="Como foi resolvida (opcional)"
                        obrigatorio={false}
                        textoConfirmar="Marcar como resolvida"
                        executar={(t) => executar(p.id, "resolvida", t)}
                      />
                      <AcaoComTexto
                        gatilho={
                          <Button tamanho="sm" variante="contorno">
                            <CircleSlash /> Dispensar
                          </Button>
                        }
                        titulo="Dispensar pendência"
                        descricao="A dispensa libera o fechamento sem resolver o problema. Justifique para o histórico."
                        rotulo="Justificativa da dispensa"
                        obrigatorio
                        textoConfirmar="Dispensar"
                        executar={(t) => executar(p.id, "dispensada", t)}
                      />
                    </>
                  ) : !fechada ? (
                    <AcaoComTexto
                      gatilho={
                        <Button tamanho="sm" variante="fantasma">
                          <RotateCcw /> Reabrir
                        </Button>
                      }
                      titulo="Reabrir pendência"
                      descricao="A pendência volta a ficar aberta e, se for impeditiva, bloqueia o fechamento."
                      rotulo="Motivo (opcional)"
                      obrigatorio={false}
                      textoConfirmar="Reabrir"
                      executar={(t) => executar(p.id, "aberta", t)}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent titulo="Registrar pendência do fechamento" descricao="Pendências impeditivas bloqueiam a conclusão da etapa e o fechamento da competência até serem resolvidas ou dispensadas.">
          <FormularioAcao acao={registrarPendencia.bind(null, empresaId, competenciaId)} aoSucesso={() => setNovo(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Etapa" htmlFor="pendencia-etapa" erro={estado.erros?.etapa}>
                  <Select id="pendencia-etapa" name="etapa" defaultValue="">
                    <option value="">Geral (não vinculada a uma etapa)</option>
                    {Object.entries(ETAPAS_FECHAMENTO).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Descrição" htmlFor="pendencia-descricao" erro={estado.erros?.descricao} obrigatorio>
                  <Textarea id="pendencia-descricao" name="descricao" rows={3} maxLength={2000} placeholder="Ex.: falta o extrato da conta poupança de setembro" />
                </Campo>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox name="impeditiva" defaultChecked /> Impede o fechamento da competência
                  </Label>
                  <Label className="flex items-center gap-2 font-normal">
                    <Checkbox name="visivel_cliente" /> Mostrar ao cliente e avisá-lo (portal e e-mail)
                  </Label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variante="contorno" onClick={() => setNovo(false)}>
                    Cancelar
                  </Button>
                  <BotaoEnviar pendente={pendente} textoPendente="Registrando...">
                    Registrar
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </div>
  );
}
