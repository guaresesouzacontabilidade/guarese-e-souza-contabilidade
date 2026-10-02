"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CornerUpLeft, Hourglass, Loader2, Paperclip, Play, RotateCcw, Save, Send, UserRoundCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta, Progresso } from "@/components/ui/feedback";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { calcularSha256, enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirEnvio, iniciarEnvio } from "@/lib/documentos/acoes";
import { atribuirTarefas, atualizarTarefa, type DadosTarefa } from "@/lib/obrigacoes/acoes";
import type { ResultadoAcao } from "@/lib/acoes";

export interface DocumentoOpcao {
  id: string;
  nome: string;
  categoria: string;
  competencia: string;
  enviado_em: string | null;
  direcao: string;
}

interface Props {
  tarefa: {
    id: string;
    etapa: string;
    status: string;
    responsavel_id: string | null;
    revisor_id: string | null;
    concluida_por: string | null;
    protocolo: string | null;
    valor: number | null;
    comprovante_documento_id: string | null;
    guia_documento_id: string | null;
  };
  empresaId: string;
  competencia: string;
  documentos: DocumentoOpcao[];
  nomesCategorias: Record<string, string>;
  equipe: { id: string; nome: string }[];
  usuarioId: string;
  admin: boolean;
}

const ROTULO_CONCLUIR: Record<string, string> = {
  apuracao: "Concluir apuração",
  entrega: "Marcar como transmitida",
  pagamento: "Marcar como paga",
};

/** Ações da tarefa: situação, comprovante (do portal ou enviado aqui), revisão e responsáveis. */
export function AcoesTarefa({ tarefa, empresaId, competencia, documentos, nomesCategorias, equipe, usuarioId, admin }: Props) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [comentario, setComentario] = useState("");
  const [comprovante, setComprovante] = useState(tarefa.comprovante_documento_id ?? "");
  const [protocolo, setProtocolo] = useState(tarefa.protocolo ?? "");
  const [valor, setValor] = useState(tarefa.valor != null ? tarefa.valor.toFixed(2).replace(".", ",") : "");
  const [motivo, setMotivo] = useState("");
  const [modo, setModo] = useState<"" | "cliente" | "dispensa" | "devolver">("");
  const [envio, setEnvio] = useState<{ progresso: number; nome: string } | null>(null);
  const [lista, setLista] = useState(documentos);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [tipoArquivo, setTipoArquivo] = useState(tarefa.etapa === "pagamento" ? "comprovante" : "esc_protocolo");

  const exigeComprovante = tarefa.etapa !== "apuracao";
  const aberta = !["concluida", "dispensada"].includes(tarefa.status);
  const souRevisor = tarefa.revisor_id === usuarioId;
  const temRevisor = Boolean(tarefa.revisor_id);
  const podeConcluir = !temRevisor || souRevisor || admin;
  const podeReabrir = tarefa.status === "dispensada" || admin || tarefa.concluida_por === usuarioId;

  const executar = (dados: DadosTarefa, aoConcluir?: () => void) =>
    iniciar(async () => {
      const r: ResultadoAcao = await atualizarTarefa(tarefa.id, dados);
      if (r.ok) {
        toast.success(r.mensagem ?? "Tarefa atualizada.");
        setComentario("");
        setMotivo("");
        setModo("");
        aoConcluir?.();
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível atualizar a tarefa.");
    });

  const dadosComprovante = (): DadosTarefa => ({
    comprovanteId: comprovante || undefined,
    protocolo: protocolo || undefined,
    valor: tarefa.etapa === "pagamento" && valor ? valor : undefined,
    comentario: comentario || undefined,
  });

  const concluir = () => {
    if (exigeComprovante && !comprovante) {
      toast.error(tarefa.etapa === "entrega" ? "Escolha ou envie o recibo de entrega antes de concluir." : "Escolha ou envie o comprovante de pagamento antes de concluir.");
      return;
    }
    executar({ ...dadosComprovante(), status: "concluida" });
  };

  // Envio do arquivo direto ao armazenamento privado (mesmo fluxo do portal)
  const enviarArquivo = async (arquivo: File) => {
    setEnvio({ progresso: 0, nome: arquivo.name });
    try {
      const sha256 = await calcularSha256(arquivo, (f) => setEnvio({ progresso: Math.round(f * 30), nome: arquivo.name }));
      const inicio = await iniciarEnvio(empresaId, {
        categoria: tipoArquivo,
        competencia: competencia.slice(0, 7),
        nome: arquivo.name,
        mime: arquivo.type || "application/octet-stream",
        tamanho: arquivo.size,
        sha256,
        origem: "upload",
      });
      if (!inicio.ok || !inicio.dados) throw new Error(inicio.mensagem ?? "Não foi possível preparar o envio.");
      let documentoId: string;
      if (inicio.dados.situacao === "duplicado") {
        documentoId = inicio.dados.duplicado.id;
        toast.info("Este arquivo já estava no portal: o documento existente foi usado.");
      } else {
        await enviarParaArmazenamento(inicio.dados.url, arquivo, (f) => setEnvio({ progresso: 30 + Math.round(f * 65), nome: arquivo.name }));
        const fim = await concluirEnvio(empresaId, inicio.dados.versaoId);
        if (!fim.ok || !fim.dados) throw new Error(fim.mensagem ?? "Não foi possível confirmar o envio.");
        documentoId = fim.dados.documentoId;
      }
      const ehGuia = tipoArquivo === "esc_guia";
      const r = await atualizarTarefa(tarefa.id, ehGuia ? { guiaId: documentoId } : { comprovanteId: documentoId });
      if (!r.ok) throw new Error(r.mensagem ?? "O arquivo foi enviado, mas não foi possível ligá-lo à tarefa.");
      setLista((l) => [{ id: documentoId, nome: arquivo.name, categoria: tipoArquivo, competencia, enviado_em: new Date().toISOString(), direcao: "escritorio" }, ...l]);
      if (!ehGuia) setComprovante(documentoId);
      toast.success(ehGuia ? "Guia publicada no portal e ligada à tarefa." : "Arquivo enviado e ligado à tarefa.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio do arquivo.");
    } finally {
      setEnvio(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  const categoriasEnvio =
    tarefa.etapa === "pagamento"
      ? [
          { valor: "comprovante", rotulo: "Comprovante de pagamento" },
          { valor: "esc_guia", rotulo: "Guia de pagamento (publicada à empresa)" },
        ]
      : [{ valor: "esc_protocolo", rotulo: "Recibo ou protocolo (publicado à empresa)" }];

  if (!aberta) {
    return (
      <div className="space-y-3">
        <Alerta tom={tarefa.status === "concluida" ? "sucesso" : "info"}>
          {tarefa.status === "concluida" ? "Tarefa concluída." : "Tarefa dispensada."} Para alterar, reabra a tarefa (fica registrado no histórico).
        </Alerta>
        {podeReabrir ? (
          <div className="space-y-2">
            <Textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Motivo da reabertura (opcional)" aria-label="Motivo da reabertura" />
            <Button variante="contorno" disabled={pendente} onClick={() => executar({ status: "pendente", comentario })}>
              {pendente ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reabrir tarefa
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Só quem concluiu ou um administrador pode reabrir.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {tarefa.status === "em_revisao" ? (
        <Alerta tom="info" titulo="Em revisão">
          {souRevisor || admin ? "Confira o trabalho e o comprovante. Aprove para concluir ou devolva com o ajuste necessário." : "Aguardando a revisão. Quem revisa conclui a tarefa."}
        </Alerta>
      ) : null}

      {exigeComprovante || tarefa.etapa === "pagamento" ? (
        <section className="space-y-3 rounded-lg border border-border p-3 sm:p-4">
          <h3 className="text-sm font-semibold text-titulo">{tarefa.etapa === "entrega" ? "Recibo de entrega" : "Comprovante de pagamento"}</h3>
          <Campo rotulo="Documento do portal" htmlFor="comprovante" ajuda="Documentos desta empresa enviados pelo cliente ou publicados pelo escritório (competência da tarefa e meses seguintes).">
            <Select id="comprovante" value={comprovante} onChange={(e) => setComprovante(e.target.value)}>
              <option value="">Selecione o documento</option>
              {lista.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome} — {nomesCategorias[d.categoria] ?? d.categoria} ({formatarCompetencia(d.competencia)}
                  {d.enviado_em ? `, enviado em ${formatarData(d.enviado_em)}` : ""})
                </option>
              ))}
            </Select>
          </Campo>
          <div className="flex flex-wrap items-end gap-2">
            <Campo rotulo="Ou envie o arquivo agora" htmlFor="tipo-arquivo" className="min-w-[14rem] flex-1">
              <Select id="tipo-arquivo" value={tipoArquivo} onChange={(e) => setTipoArquivo(e.target.value)}>
                {categoriasEnvio.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <input
              ref={arquivoRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.xml,.txt,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void enviarArquivo(f);
              }}
            />
            <Button variante="contorno" disabled={Boolean(envio)} onClick={() => arquivoRef.current?.click()}>
              <Paperclip /> Escolher arquivo
            </Button>
          </div>
          {envio ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Enviando {envio.nome}...</p>
              <Progresso valor={envio.progresso} rotulo="Progresso do envio" />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo={tarefa.etapa === "entrega" ? "Número do recibo/protocolo" : "Autenticação / identificação"} htmlFor="protocolo">
              <Input id="protocolo" value={protocolo} onChange={(e) => setProtocolo(e.target.value)} />
            </Campo>
            {tarefa.etapa === "pagamento" ? (
              <Campo rotulo="Valor (R$)" htmlFor="valor">
                <Input id="valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
              </Campo>
            ) : null}
          </div>
        </section>
      ) : null}

      <Campo rotulo="Comentário" htmlFor="comentario" ajuda="Fica no histórico da tarefa.">
        <Textarea id="comentario" value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} />
      </Campo>

      {modo === "cliente" || modo === "dispensa" || modo === "devolver" ? (
        <div className="space-y-2 rounded-lg border border-alerta/40 bg-alerta-bg/40 p-3">
          <Campo
            rotulo={modo === "dispensa" ? "Motivo da dispensa" : modo === "devolver" ? "O que precisa ser ajustado" : "O que falta do cliente"}
            htmlFor="motivo"
            obrigatorio
          >
            <Textarea id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
          </Campo>
          <div className="flex gap-2">
            <Button variante="fantasma" onClick={() => setModo("")}>
              Cancelar
            </Button>
            <Button
              disabled={pendente || motivo.trim().length < 5}
              onClick={() =>
                modo === "dispensa"
                  ? executar({ status: "dispensada", dispensaMotivo: motivo, comentario: comentario || undefined })
                  : modo === "devolver"
                    ? executar({ status: "em_andamento", comentario: `Devolvida na revisão: ${motivo}` })
                    : executar({ status: "aguardando_cliente", comentario: motivo })
              }
            >
              {pendente ? <Loader2 className="animate-spin" /> : null} Confirmar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tarefa.status === "pendente" || tarefa.status === "aguardando_cliente" ? (
          <Button variante="contorno" disabled={pendente} onClick={() => executar({ status: "em_andamento", comentario: comentario || undefined })}>
            <Play /> {tarefa.status === "pendente" ? "Iniciar" : "Retomar"}
          </Button>
        ) : null}
        {tarefa.status === "em_revisao" && (souRevisor || admin) ? (
          <>
            <Button disabled={pendente} onClick={concluir}>
              {pendente ? <Loader2 className="animate-spin" /> : <UserRoundCheck />} Aprovar e concluir
            </Button>
            <Button variante="contorno" disabled={pendente} onClick={() => setModo("devolver")}>
              <CornerUpLeft /> Devolver para ajuste
            </Button>
          </>
        ) : null}
        {tarefa.status !== "em_revisao" && podeConcluir ? (
          <Button disabled={pendente} onClick={concluir}>
            {pendente ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {ROTULO_CONCLUIR[tarefa.etapa] ?? "Concluir"}
          </Button>
        ) : null}
        {tarefa.status !== "em_revisao" && temRevisor ? (
          <Button variante={podeConcluir ? "contorno" : "primario"} disabled={pendente} onClick={() => executar({ ...dadosComprovante(), status: "em_revisao" })}>
            <Send /> Enviar para revisão
          </Button>
        ) : null}
        {tarefa.status !== "aguardando_cliente" && tarefa.status !== "em_revisao" ? (
          <Button variante="fantasma" disabled={pendente} onClick={() => setModo("cliente")}>
            <Hourglass /> Aguardando cliente
          </Button>
        ) : null}
        {tarefa.status !== "em_revisao" ? (
          <Button variante="fantasma" disabled={pendente} onClick={() => setModo("dispensa")}>
            <XCircle /> Dispensar
          </Button>
        ) : null}
        {comprovante !== (tarefa.comprovante_documento_id ?? "") || protocolo !== (tarefa.protocolo ?? "") ? (
          <Button variante="fantasma" disabled={pendente} onClick={() => executar(dadosComprovante())}>
            <Save /> Salvar sem mudar a situação
          </Button>
        ) : null}
      </div>
      {temRevisor && !podeConcluir ? (
        <p className="text-xs text-muted-foreground">Esta tarefa tem revisor: envie para revisão; quem revisa conclui.</p>
      ) : null}
      <Responsaveis tarefaId={tarefa.id} responsavelId={tarefa.responsavel_id} revisorId={tarefa.revisor_id} equipe={equipe} />
    </div>
  );
}

function Responsaveis({ tarefaId, responsavelId, revisorId, equipe }: { tarefaId: string; responsavelId: string | null; revisorId: string | null; equipe: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [resp, setResp] = useState(responsavelId ?? "");
  const [rev, setRev] = useState(revisorId ?? "");
  const [pendente, iniciar] = useTransition();
  const mudou = resp !== (responsavelId ?? "") || rev !== (revisorId ?? "");
  return (
    <section className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Campo rotulo="Responsável" htmlFor="t-resp">
        <Select id="t-resp" value={resp} onChange={(e) => setResp(e.target.value)}>
          <option value="">Sem responsável</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
      </Campo>
      <Campo rotulo="Revisor" htmlFor="t-rev">
        <Select id="t-rev" value={rev} onChange={(e) => setRev(e.target.value)}>
          <option value="">Sem revisão</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
      </Campo>
      <Button
        variante="contorno"
        disabled={!mudou || pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await atribuirTarefas([tarefaId], resp, rev, !rev);
            if (r.ok) {
              toast.success("Responsáveis atualizados.");
              router.refresh();
            } else toast.error(r.mensagem ?? "Não foi possível atualizar.");
          })
        }
      >
        {pendente ? <Loader2 className="animate-spin" /> : null} Salvar
      </Button>
    </section>
  );
}
