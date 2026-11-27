"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Loader2, Pencil, Plus, ShieldCheck, Stamp, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Confirmacao } from "@/components/ui/dialog";
import { aplicarNorma, proporRevogacao, rejeitarNorma, salvarObrigacao, validarEAplicarNormas, validarNorma } from "@/lib/obrigacoes/acoes";
import { AREAS, ESFERAS, PERIODICIDADES, TRIBUTOS } from "@/lib/obrigacoes/rotulos";
import type { ResultadoAcao } from "@/lib/acoes";

// -----------------------------------------------------------------------------
// Obrigação (cadastro no catálogo — administrador)
// -----------------------------------------------------------------------------

export interface ObrigacaoForm {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  esfera: string;
  area: string;
  periodicidade: string;
  etapas: string[];
  tributos: string[];
  categorias_documento: string[];
  observacao: string | null;
  ativa: boolean;
}

export function EditarObrigacao({ obrigacao, categorias }: { obrigacao: ObrigacaoForm | null; categorias: { codigo: string; nome: string }[] }) {
  const [aberto, setAberto] = useState(false);
  const router = useRouter();
  const novo = !obrigacao;
  return (
    <>
      <Button variante={novo ? "primario" : "contorno"} onClick={() => setAberto(true)}>
        {novo ? <Plus /> : <Pencil />} {novo ? "Nova obrigação" : "Editar"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto ? (
          <DialogContent
            largura="lg"
            titulo={novo ? "Nova obrigação no catálogo" : "Editar obrigação"}
            descricao={novo ? "Depois de cadastrar, proponha a regra de prazo com a fonte oficial." : "Esfera, periodicidade e etapas não mudam depois do cadastro (mantêm o histórico das tarefas)."}
          >
            <FormularioAcao
              acao={salvarObrigacao.bind(null, obrigacao?.id ?? null)}
              aoSucesso={(r: ResultadoAcao) => {
                setAberto(false);
                const id = (r.dados as { id?: string } | undefined)?.id;
                if (novo && id) router.push(`/escritorio/obrigacoes/catalogo/${id}`);
              }}
            >
              {({ estado, pendente }) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  {obrigacao ? (
                    <>
                      {/* Campos fixos depois do cadastro (enviados para validação) */}
                      <input type="hidden" name="codigo" value={obrigacao.codigo} />
                      <input type="hidden" name="esfera" value={obrigacao.esfera} />
                      <input type="hidden" name="area" value={obrigacao.area} />
                      <input type="hidden" name="periodicidade" value={obrigacao.periodicidade} />
                      {obrigacao.etapas.map((e) => (
                        <input key={e} type="hidden" name="etapas" value={e} />
                      ))}
                    </>
                  ) : null}
                  <Campo rotulo="Nome" htmlFor="nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                    <Input id="nome" name="nome" defaultValue={obrigacao?.nome ?? ""} />
                  </Campo>
                  <Campo rotulo="Código" htmlFor="codigo" obrigatorio erro={estado.erros?.codigo} ajuda="Ex.: ISS_PORTO_NACIONAL">
                    <Input id="codigo" name="codigo" defaultValue={obrigacao?.codigo ?? ""} disabled={!novo} className="uppercase" />
                  </Campo>
                  <Campo rotulo="Esfera" htmlFor="esfera">
                    <Select id="esfera" name="esfera" defaultValue={obrigacao?.esfera ?? "municipal"} disabled={!novo}>
                      {Object.entries(ESFERAS).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Área" htmlFor="area">
                    <Select id="area" name="area" defaultValue={obrigacao?.area ?? "fiscal"} disabled={!novo}>
                      {Object.entries(AREAS).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Periodicidade" htmlFor="periodicidade">
                    <Select id="periodicidade" name="periodicidade" defaultValue={obrigacao?.periodicidade ?? "mensal"} disabled={!novo}>
                      {Object.entries(PERIODICIDADES).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Etapas" erro={estado.erros?.etapas} className="sm:col-span-2" ajuda="Cada etapa vira uma tarefa separada.">
                    <div className="flex flex-wrap gap-4">
                      {[
                        ["apuracao", "Apuração"],
                        ["entrega", "Entrega"],
                        ["pagamento", "Pagamento"],
                      ].map(([v, r]) => (
                        <label key={v} className="flex items-center gap-2 text-sm">
                          <Checkbox name="etapas" value={v} defaultChecked={obrigacao ? obrigacao.etapas.includes(v) : v !== "entrega"} disabled={!novo} /> {r}
                        </label>
                      ))}
                    </div>
                  </Campo>
                  <Campo rotulo="Tributos" className="sm:col-span-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {TRIBUTOS.map((t) => (
                        <label key={t} className="flex items-center gap-1.5 text-sm">
                          <Checkbox name="tributos" value={t} defaultChecked={obrigacao?.tributos.includes(t)} /> {t}
                        </label>
                      ))}
                    </div>
                  </Campo>
                  <Campo rotulo="Documentos do portal ligados" className="sm:col-span-2" ajuda="Guias publicadas nestas categorias são ligadas à tarefa de pagamento.">
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {categorias.map((c) => (
                        <label key={c.codigo} className="flex items-center gap-2 text-sm">
                          <Checkbox name="categorias" value={c.codigo} defaultChecked={obrigacao?.categorias_documento.includes(c.codigo)} /> {c.nome}
                        </label>
                      ))}
                    </div>
                  </Campo>
                  <Campo rotulo="Descrição" htmlFor="descricao" className="sm:col-span-2">
                    <Textarea id="descricao" name="descricao" rows={3} defaultValue={obrigacao?.descricao ?? ""} />
                  </Campo>
                  <Campo rotulo="Observação interna" htmlFor="observacao" className="sm:col-span-2">
                    <Textarea id="observacao" name="observacao" rows={2} defaultValue={obrigacao?.observacao ?? ""} />
                  </Campo>
                  {!novo ? (
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <Checkbox name="ativa" defaultChecked={obrigacao.ativa} /> Ativa (desmarque para parar de gerar tarefas; o histórico é mantido)
                    </label>
                  ) : null}
                  <div className="flex justify-end sm:col-span-2">
                    <BotaoEnviar pendente={pendente}>{novo ? "Cadastrar" : "Salvar"}</BotaoEnviar>
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

// -----------------------------------------------------------------------------
// Encerramento de regra (revogação)
// -----------------------------------------------------------------------------

export function ProporEncerramento({ regraId, hoje }: { regraId: string; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variante="fantasma" tamanho="sm" onClick={() => setAberto(true)}>
        <XCircle /> Propor encerramento
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        {aberto ? (
          <DialogContent titulo="Propor o encerramento da regra" descricao="Depois de validado e aplicado, as tarefas abertas a partir da competência informada são dispensadas com o motivo. As anteriores continuam no histórico.">
            <FormularioAcao acao={proporRevogacao.bind(null, regraId)} aoSucesso={() => setAberto(false)}>
              {({ estado, pendente }) => (
                <div className="space-y-4">
                  <Campo rotulo="Título" htmlFor="titulo" obrigatorio erro={estado.erros?.titulo}>
                    <Input id="titulo" name="titulo" placeholder="Ex.: Obrigação extinta pela norma X" />
                  </Campo>
                  <Campo rotulo="Deixa de valer a partir da competência" htmlFor="vigencia_inicio" obrigatorio erro={estado.erros?.vigencia_inicio}>
                    <Input id="vigencia_inicio" name="vigencia_inicio" type="month" />
                  </Campo>
                  <Campo rotulo="Resumo" htmlFor="resumo">
                    <Textarea id="resumo" name="resumo" rows={2} />
                  </Campo>
                  <Campo rotulo="Norma (fonte oficial)" htmlFor="fonte_titulo" obrigatorio erro={estado.erros?.fonte_titulo}>
                    <Input id="fonte_titulo" name="fonte_titulo" />
                  </Campo>
                  <Campo rotulo="Endereço (link oficial)" htmlFor="fonte_url">
                    <Input id="fonte_url" name="fonte_url" type="url" placeholder="https://" />
                  </Campo>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo rotulo="Publicada em" htmlFor="fonte_publicada_em">
                      <Input id="fonte_publicada_em" name="fonte_publicada_em" type="date" />
                    </Campo>
                    <Campo rotulo="Consultada em" htmlFor="fonte_consultada_em" obrigatorio erro={estado.erros?.fonte_consultada_em}>
                      <Input id="fonte_consultada_em" name="fonte_consultada_em" type="date" defaultValue={hoje} />
                    </Campo>
                  </div>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Registrar proposta</BotaoEnviar>
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

// -----------------------------------------------------------------------------
// Atualizações normativas: validar, aplicar, rejeitar (administrador)
// -----------------------------------------------------------------------------

function useExecutar() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const executar = (fn: () => Promise<ResultadoAcao>, aoOk?: () => void) =>
    new Promise<boolean>((resolve) =>
      iniciar(async () => {
        const r = await fn();
        if (r.ok) {
          toast.success(r.mensagem ?? "Feito.");
          aoOk?.();
          router.refresh();
          resolve(true);
        } else {
          toast.error(r.mensagem ?? "Não foi possível concluir.");
          resolve(false);
        }
      }),
    );
  return { pendente, executar };
}

export function AcoesNorma({ id, status, fonteUrl }: { id: string; status: string; fonteUrl: string | null }) {
  const { pendente, executar } = useExecutar();
  const [observacao, setObservacao] = useState("");
  const [motivo, setMotivo] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      {status === "proposta" ? (
        <Confirmacao
          gatilho={
            <Button tamanho="sm" disabled={pendente}>
              <ShieldCheck /> Validar
            </Button>
          }
          titulo="Validar a proposta?"
          descricao={
            <>
              Confirme que você conferiu a norma na fonte oficial{fonteUrl ? " (o link abre em outra aba)" : ""} e que a regra corresponde ao texto. Nada muda no calendário até aplicar.
            </>
          }
          textoConfirmar="Conferi a fonte e valido"
          aoConfirmar={() => executar(() => validarNorma(id, observacao))}
        >
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Observação da conferência (opcional)" aria-label="Observação" />
        </Confirmacao>
      ) : null}
      {status === "validada" ? (
        <Confirmacao
          gatilho={
            <Button tamanho="sm" disabled={pendente}>
              <Stamp /> Aplicar
            </Button>
          }
          titulo="Aplicar a regra validada?"
          descricao="A regra passa a valer na vigência informada: a anterior é encerrada, as tarefas abertas são recalculadas e as novas tarefas são geradas."
          textoConfirmar="Aplicar"
          aoConfirmar={() => executar(() => aplicarNorma(id))}
        />
      ) : null}
      {status === "proposta" || status === "validada" ? (
        <Confirmacao
          gatilho={
            <Button tamanho="sm" variante="fantasma" disabled={pendente}>
              <XCircle /> Rejeitar
            </Button>
          }
          titulo="Rejeitar a proposta?"
          descricao="A regra proposta não será aplicada. Informe o motivo (fica registrado)."
          textoConfirmar="Rejeitar"
          variante="perigo"
          aoConfirmar={async () => {
            if (motivo.trim().length < 5) {
              toast.error("Explique o motivo da rejeição.");
              return false;
            }
            return executar(() => rejeitarNorma(id, motivo));
          }}
        >
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo da rejeição" aria-label="Motivo" />
        </Confirmacao>
      ) : null}
    </div>
  );
}

export function ValidarEmLote({ ids }: { ids: string[] }) {
  const { pendente, executar } = useExecutar();
  const [observacao, setObservacao] = useState("");
  if (!ids.length) return null;
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno" disabled={pendente}>
          {pendente ? <Loader2 className="animate-spin" /> : <CheckCheck />} Validar e aplicar todas ({ids.length})
        </Button>
      }
      titulo={`Validar e aplicar ${ids.length} proposta(s)?`}
      descricao="Use somente depois de conferir cada fonte oficial. Cada proposta é validada e aplicada em sequência; as que falharem continuam pendentes."
      textoConfirmar="Conferi as fontes; validar e aplicar"
      aoConfirmar={() => executar(() => validarEAplicarNormas(ids, observacao))}
    >
      <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} placeholder="Observação da conferência (opcional)" aria-label="Observação" />
    </Confirmacao>
  );
}
