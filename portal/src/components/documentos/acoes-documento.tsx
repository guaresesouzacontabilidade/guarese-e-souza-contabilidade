"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCheck, Eye, FilePen, Loader2, RefreshCcw, Search, Trash2, Undo2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Progresso, Alerta } from "@/components/ui/feedback";
import { formatarTamanho } from "@/lib/formatos";
import { calcularSha256, enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import {
  alterarStatusDocumentos,
  avaliarAposFechamento,
  concluirEnvio,
  excluirDocumento,
  iniciarSubstituicao,
  reclassificarDocumento,
} from "@/lib/documentos/acoes";

/** Pré-visualização sob demanda (cada abertura fica registrada como visualização). */
export function Visualizador({ href, tipo, nome }: { href: string; tipo: "pdf" | "imagem"; nome: string }) {
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <Eye /> Visualizar aqui
      </Button>
    );
  }
  return tipo === "pdf" ? (
    <iframe src={href} title={`Visualização de ${nome}`} className="h-[70vh] w-full rounded-lg border border-border bg-muted" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido por link temporário
    <img src={href} alt={`Visualização de ${nome}`} className="max-h-[70vh] w-auto max-w-full rounded-lg border border-border object-contain" />
  );
}

export function AcoesConferencia({ empresaId, documentoId, status }: { empresaId: string; documentoId: string; status: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [motivo, setMotivo] = useState("");

  const mudar = (novo: string, texto = "") =>
    new Promise<void>((resolve) =>
      iniciar(async () => {
        const r = await alterarStatusDocumentos(empresaId, [documentoId], novo, texto);
        if (r.ok) {
          toast.success(r.mensagem ?? "Situação atualizada.");
          setMotivo("");
          router.refresh();
        } else toast.error(r.mensagem ?? "Não foi possível atualizar.");
        resolve();
      }),
    );

  return (
    <div className="flex flex-wrap gap-2">
      {status !== "em_analise" ? (
        <Button tamanho="sm" variante="contorno" disabled={pendente} onClick={() => mudar("em_analise")}>
          <Search /> Em análise
        </Button>
      ) : null}
      {status !== "aprovado" ? (
        <Confirmacao
          gatilho={
            <Button tamanho="sm" variante="sucesso" disabled={pendente}>
              <CheckCheck /> Aprovar
            </Button>
          }
          titulo="Aprovar este documento?"
          descricao="A aprovação registra a conferência interna do escritório. Não representa validação fiscal junto aos órgãos públicos."
          textoConfirmar="Aprovar"
          aoConfirmar={() => mudar("aprovado")}
        />
      ) : null}
      <Confirmacao
        gatilho={
          <Button tamanho="sm" variante="perigo" disabled={pendente}>
            <AlertTriangle /> Pedir correção
          </Button>
        }
        titulo="Pedir correção ao cliente"
        descricao="O cliente recebe o aviso no portal e por e-mail com a explicação abaixo."
        textoConfirmar="Enviar pedido"
        variante="perigo"
        aoConfirmar={async () => {
          if (!motivo.trim()) {
            toast.error("Explique o que precisa ser corrigido.");
            return false;
          }
          await mudar("correcao", motivo);
        }}
      >
        <Textarea aria-label="O que precisa ser corrigido" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Ex.: o comprovante está ilegível; envie uma foto mais nítida." />
      </Confirmacao>
      {status !== "recebido" ? (
        <Button tamanho="sm" variante="fantasma" disabled={pendente} onClick={() => mudar("recebido")}>
          <Undo2 /> Voltar para “Recebido”
        </Button>
      ) : null}
      {pendente ? <Loader2 className="size-4 animate-spin self-center text-muted-foreground" /> : null}
    </div>
  );
}

export function ReclassificarDocumento({
  empresaId,
  documentoId,
  categorias,
  competencias,
  itens,
  valores,
  escritorio,
}: {
  empresaId: string;
  documentoId: string;
  categorias: { codigo: string; nome: string }[];
  competencias: { valor: string; rotulo: string }[];
  itens: { id: string; titulo: string; competencia: string; categoria_codigo: string }[];
  valores: { categoria: string; competencia: string; item: string | null; observacao: string | null; titulo: string | null; vencimento: string | null; valor: string | null };
  escritorio: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [competencia, setCompetencia] = useState(valores.competencia.slice(0, 7));
  const [categoria, setCategoria] = useState(valores.categoria);
  const opcoesItens = itens.filter((i) => i.competencia.slice(0, 7) === competencia && i.categoria_codigo === categoria);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button tamanho="sm" variante="contorno">
          <FilePen /> Alterar classificação
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Alterar classificação" descricao="Corrija o tipo do documento, o mês de referência ou a pendência que ele atende.">
        <FormularioAcao acao={reclassificarDocumento.bind(null, empresaId, documentoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Tipo de documento" htmlFor="rc-categoria" obrigatorio>
                <Select id="rc-categoria" name="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                  {categorias.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Competência (mês de referência)" htmlFor="rc-competencia" obrigatorio erro={estado.erros?.competencia}>
                <Select id="rc-competencia" name="competencia" value={competencia} onChange={(e) => setCompetencia(e.target.value)}>
                  {competencias.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              {!escritorio ? (
                <Campo rotulo="Pendência atendida" htmlFor="rc-item" ajuda={opcoesItens.length ? undefined : "Não há pendência deste tipo nesta competência."}>
                  <Select id="rc-item" name="checklist_item_id" defaultValue={valores.item ?? ""} key={`${competencia}-${categoria}`}>
                    <option value="">Nenhuma</option>
                    {opcoesItens.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.titulo}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <Campo rotulo="Título (opcional)" htmlFor="rc-titulo">
                <Input id="rc-titulo" name="titulo" defaultValue={valores.titulo ?? ""} maxLength={200} />
              </Campo>
              {escritorio ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Vencimento" htmlFor="rc-venc">
                    <Input id="rc-venc" name="vencimento" type="date" defaultValue={valores.vencimento ?? ""} />
                  </Campo>
                  <Campo rotulo="Valor (R$)" htmlFor="rc-valor" erro={estado.erros?.valor}>
                    <Input id="rc-valor" name="valor" inputMode="decimal" defaultValue={valores.valor ?? ""} />
                  </Campo>
                </div>
              ) : null}
              <Campo rotulo="Observação" htmlFor="rc-obs">
                <Textarea id="rc-obs" name="observacao" defaultValue={valores.observacao ?? ""} maxLength={2000} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function SubstituirArquivo({ empresaId, documentoId, extensoes, limiteMb }: { empresaId: string; documentoId: string; extensoes: string[]; limiteMb: number }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [etapa, setEtapa] = useState<"" | "verificando" | "enviando" | "confirmando">("");
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setErro(null);
    if (!arquivo) return setErro("Escolha o novo arquivo.");
    const ext = /\.([a-z0-9]{1,8})$/i.exec(arquivo.name)?.[1]?.toLowerCase() ?? "";
    if (!extensoes.includes(ext)) return setErro(`Formato não aceito. Aceitos: ${extensoes.join(", ")}.`);
    if (arquivo.size > limiteMb * 1024 * 1024) return setErro(`Arquivo maior que ${limiteMb} MB.`);
    if (motivo.trim().length < 3) return setErro("Informe o motivo da substituição.");
    try {
      setEtapa("verificando");
      const hash = await calcularSha256(arquivo, setProgresso);
      const r = await iniciarSubstituicao(empresaId, documentoId, { nome: arquivo.name, mime: arquivo.type || "application/octet-stream", tamanho: arquivo.size, sha256: hash, motivo });
      if (!r.ok || !r.dados) throw new Error(r.mensagem ?? "Não foi possível iniciar a substituição.");
      setEtapa("enviando");
      setProgresso(0);
      await enviarParaArmazenamento(r.dados.url, arquivo, setProgresso);
      setEtapa("confirmando");
      const c = await concluirEnvio(empresaId, r.dados.versaoId);
      if (!c.ok) throw new Error(c.mensagem ?? "Falha ao confirmar o recebimento.");
      toast.success("Nova versão recebida. A versão anterior foi preservada no histórico.");
      setAberto(false);
      setArquivo(null);
      setMotivo("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha no envio.");
    } finally {
      setEtapa("");
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !etapa && setAberto(v)}>
      <DialogTrigger asChild>
        <Button tamanho="sm" variante="contorno">
          <Upload /> Substituir arquivo
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Substituir arquivo" descricao="O arquivo atual não é apagado: ele fica guardado como versão anterior, e a nova versão volta para a conferência.">
        <div className="space-y-4">
          {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
          <Campo rotulo="Novo arquivo" htmlFor="sub-arquivo" obrigatorio ajuda={`Formatos: ${extensoes.join(", ")} · até ${limiteMb} MB`}>
            <Input id="sub-arquivo" type="file" accept={extensoes.map((e) => `.${e}`).join(",")} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} disabled={Boolean(etapa)} className="h-auto py-2" />
          </Campo>
          {arquivo ? <p className="text-xs text-muted-foreground">{arquivo.name} · {formatarTamanho(arquivo.size)}</p> : null}
          <Campo rotulo="Motivo da substituição" htmlFor="sub-motivo" obrigatorio>
            <Textarea id="sub-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={1000} disabled={Boolean(etapa)} placeholder="Ex.: enviei o extrato do mês errado." />
          </Campo>
          {etapa ? <Progresso valor={Math.round(progresso * 100)} rotulo="Progresso do envio" /> : null}
          <div className="flex justify-end">
            <Button onClick={enviar} disabled={Boolean(etapa)}>
              {etapa ? <Loader2 className="animate-spin" /> : <Upload />}
              {etapa === "verificando" ? "Verificando..." : etapa === "enviando" ? "Enviando..." : etapa === "confirmando" ? "Confirmando..." : "Enviar nova versão"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ExcluirDocumento({ empresaId, documentoId, destino }: { empresaId: string; documentoId: string; destino: string }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button tamanho="sm" variante="fantasma" className="text-perigo">
          <Trash2 /> Excluir
        </Button>
      }
      titulo="Excluir este documento?"
      descricao="O documento deixa de aparecer para a empresa. O arquivo e o histórico são preservados pelo prazo de guarda definido pelo escritório."
      textoConfirmar="Excluir"
      variante="perigo"
      aoConfirmar={async () => {
        if (!motivo.trim()) {
          toast.error("Informe o motivo da exclusão.");
          return false;
        }
        const r = await excluirDocumento(empresaId, documentoId, motivo);
        if (!r.ok) {
          toast.error(r.mensagem ?? "Não foi possível excluir.");
          return false;
        }
        toast.success(r.mensagem ?? "Documento excluído.");
        router.push(destino);
      }}
    >
      <Textarea aria-label="Motivo da exclusão" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ex.: arquivo enviado por engano." />
    </Confirmacao>
  );
}

export function AvaliarAposFechamento({ empresaId, documentoId }: { empresaId: string; documentoId: string }) {
  const router = useRouter();
  const [parecer, setParecer] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button tamanho="sm" variante="secundario">
          <RefreshCcw /> Registrar avaliação
        </Button>
      }
      titulo="Avaliação do documento recebido após o fechamento"
      descricao="Registre o impacto: se exige reabrir a competência, se entra no mês seguinte ou se não altera os números publicados."
      textoConfirmar="Registrar"
      aoConfirmar={async () => {
        if (!parecer.trim()) {
          toast.error("Escreva o parecer.");
          return false;
        }
        const r = await avaliarAposFechamento(empresaId, documentoId, parecer);
        if (!r.ok) {
          toast.error(r.mensagem ?? "Não foi possível registrar.");
          return false;
        }
        toast.success(r.mensagem ?? "Avaliação registrada.");
        router.refresh();
      }}
    >
      <Textarea aria-label="Parecer" value={parecer} onChange={(e) => setParecer(e.target.value)} rows={3} />
    </Confirmacao>
  );
}
