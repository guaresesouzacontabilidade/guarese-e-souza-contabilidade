"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  CheckCheck,
  ClipboardCheck,
  FileText,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Confirmacao } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import {
  atribuirTarefa,
  concluirTarefa,
  confirmarConferencia,
  decidirSugestao,
  ligarDependencia,
  pedirSugestaoIa,
} from "@/lib/rh/acoes";
import {
  concluirEvidencia,
  excluirEvidencia,
  iniciarEvidencia,
} from "@/lib/rh/evidencias";
import { semanasProximas } from "@/lib/rh/rotulos";

/** "Confirmar conferência": registra quem conferiu e quando e conclui a tarefa do período. */
export function BotaoConferencia({
  empresaId,
  tamanho = "md",
  variante = "primario",
}: {
  empresaId: string;
  tamanho?: ButtonProps["tamanho"];
  variante?: ButtonProps["variante"];
}) {
  return (
    <BotaoAcao
      tamanho={tamanho}
      variante={variante}
      acao={() => confirmarConferencia(empresaId, "")}
      confirmar={{
        titulo: "Confirmar a conferência do estoque?",
        descricao:
          "O portal registra o seu nome, a data e a hora e conclui a tarefa de conferência deste período no quadro.",
        textoConfirmar: "Confirmar conferência",
      }}
    >
      <ClipboardCheck /> Confirmar conferência
    </BotaoAcao>
  );
}

/** Conclusão manual: pede a área, a semana de referência e o extrato quando o modelo exige. */
export function ConcluirTarefa({
  empresaId,
  tarefaId,
  periodoInicio,
  exigeArea,
  exigeSemana,
  exigeFoto,
  temFoto,
  extratos,
  bloqueio,
}: {
  empresaId: string;
  tarefaId: string;
  periodoInicio: string;
  exigeArea: boolean;
  exigeSemana: boolean;
  exigeFoto: boolean;
  temFoto: boolean;
  /** Envio do extrato: extratos enviados pelo portal naquela semana (para ligar) */
  extratos?: { id: string; nome: string }[];
  /** Por que ainda não dá para concluir (dependência aberta) */
  bloqueio?: string | null;
}) {
  const semanas = semanasProximas(periodoInicio);
  const faltaFoto = exigeFoto && !temFoto;
  return (
    <FormularioAcao
      acao={concluirTarefa.bind(null, empresaId, tarefaId)}
      className="space-y-4"
      manterAoErrar
    >
      {({ pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {exigeArea ? (
              <Campo
                rotulo="Área"
                htmlFor="area"
                obrigatorio
                ajuda="Ex.: pátio dos fundos, depósito 2."
              >
                <Input id="area" name="area" maxLength={120} required />
              </Campo>
            ) : null}
            {exigeSemana || extratos ? (
              <Campo rotulo="Semana de referência" htmlFor="semana" obrigatorio>
                <Select id="semana" name="semana" defaultValue="" required>
                  <option value="" disabled>
                    Escolha a semana
                  </option>
                  {semanas.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
            {extratos ? (
              <Campo
                rotulo="Extrato enviado pelo portal (opcional)"
                htmlFor="documento_id"
                ajuda={
                  extratos.length
                    ? undefined
                    : "Nenhum extrato enviado pelo portal nesta semana."
                }
              >
                <Select id="documento_id" name="documento_id" defaultValue="">
                  <option value="">Enviei por fora do portal</option>
                  {extratos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
          </div>
          <Campo rotulo="Observação (opcional)" htmlFor="observacao">
            <Textarea
              id="observacao"
              name="observacao"
              maxLength={1000}
              rows={2}
            />
          </Campo>
          {faltaFoto ? (
            <p className="text-sm font-medium text-perigo">
              Anexe a foto acima para concluir.
            </p>
          ) : null}
          {bloqueio ? (
            <p className="text-sm font-medium text-perigo">
              Conclua antes: {bloqueio}.
            </p>
          ) : null}
          <div className="flex justify-end">
            <BotaoEnviar
              pendente={pendente}
              disabled={faltaFoto || Boolean(bloqueio)}
            >
              <CheckCheck /> Concluir tarefa
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

const REDUZIVEIS = ["image/jpeg", "image/png", "image/webp"];

function mimeDoArquivo(f: File): string | null {
  const t = f.type.toLowerCase();
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ].includes(t)
  )
    return t;
  const ext = f.name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png" || ext === "webp" || ext === "heic" || ext === "heif")
    return `image/${ext}`;
  if (ext === "pdf") return "application/pdf";
  return null;
}

/** Foto grande do celular vira JPEG com o lado maior de 1600 px (envia rápido e continua nítida). */
async function reduzir(
  arquivo: File,
  mime: string,
): Promise<{ arquivo: File; mime: string }> {
  if (!REDUZIVEIS.includes(mime) || arquivo.size <= 1_200_000)
    return { arquivo, mime };
  try {
    const img = await createImageBitmap(arquivo, {
      imageOrientation: "from-image",
    });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(img.width * escala);
    tela.height = Math.round(img.height * escala);
    tela.getContext("2d")?.drawImage(img, 0, 0, tela.width, tela.height);
    img.close();
    const blob = await new Promise<Blob | null>((ok) =>
      tela.toBlob(ok, "image/jpeg", 0.82),
    );
    if (!blob || blob.size >= arquivo.size) return { arquivo, mime };
    return {
      arquivo: new File([blob], "foto.jpg", { type: "image/jpeg" }),
      mime: "image/jpeg",
    };
  } catch {
    return { arquivo, mime };
  }
}

export interface EvidenciaTela {
  id: string;
  mime: string;
  legenda: string | null;
  enviado_em: string;
  autor: string | null;
}

/** Evidências da tarefa: tirar foto (câmera de trás), escolher arquivo e abrir as já enviadas. */
export function EvidenciasTarefa({
  empresaId,
  tarefaId,
  evidencias,
  podeEnviar,
}: {
  empresaId: string;
  tarefaId: string;
  evidencias: EvidenciaTela[];
  podeEnviar: boolean;
}) {
  const router = useRouter();
  const camera = React.useRef<HTMLInputElement>(null);
  const arquivo = React.useRef<HTMLInputElement>(null);
  const [legenda, setLegenda] = React.useState("");
  const [enviando, setEnviando] = React.useState<string | null>(null);

  async function enviar(lista: FileList | null) {
    const arquivos = Array.from(lista ?? []).slice(0, 5);
    if (!arquivos.length) return;
    try {
      for (const [i, f] of arquivos.entries()) {
        const tipo = mimeDoArquivo(f);
        if (!tipo) throw new Error(`"${f.name}" não é uma foto nem um PDF.`);
        setEnviando(
          arquivos.length > 1
            ? `Enviando ${i + 1} de ${arquivos.length}...`
            : "Enviando...",
        );
        const { arquivo: pronto, mime } = await reduzir(f, tipo);
        const ini = await iniciarEvidencia(empresaId, tarefaId, {
          mime,
          tamanho: pronto.size,
          legenda,
        });
        if (!ini.ok || !ini.dados)
          throw new Error(ini.mensagem ?? "Não foi possível enviar o arquivo.");
        await enviarParaArmazenamento(
          ini.dados.url,
          pronto.type === mime
            ? pronto
            : new File([pronto], pronto.name, { type: mime }),
          () => undefined,
        );
        const fim = await concluirEvidencia(empresaId, ini.dados.evidenciaId);
        if (!fim.ok)
          throw new Error(fim.mensagem ?? "Não foi possível concluir o envio.");
      }
      setLegenda("");
      toast.success(
        arquivos.length > 1 ? "Arquivos anexados." : "Arquivo anexado.",
      );
      router.refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível enviar o arquivo.",
      );
    } finally {
      setEnviando(null);
      if (camera.current) camera.current.value = "";
      if (arquivo.current) arquivo.current.value = "";
    }
  }

  return (
    <div className="space-y-3" data-testid="rh-evidencias">
      {podeEnviar ? (
        <div className="flex flex-wrap items-end gap-2">
          <Campo
            rotulo="Legenda (opcional)"
            htmlFor="legenda-evidencia"
            className="min-w-48 flex-1"
          >
            <Input
              id="legenda-evidencia"
              value={legenda}
              onChange={(e) => setLegenda(e.target.value)}
              maxLength={200}
              placeholder="Ex.: pátio dos fundos organizado"
            />
          </Campo>
          <Button
            type="button"
            variante="contorno"
            onClick={() => camera.current?.click()}
            disabled={Boolean(enviando)}
          >
            <Camera /> Tirar foto
          </Button>
          <Button
            type="button"
            variante="contorno"
            onClick={() => arquivo.current?.click()}
            disabled={Boolean(enviando)}
          >
            <ImagePlus /> Escolher arquivo
          </Button>
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Tirar foto"
            onChange={(e) => void enviar(e.target.files)}
          />
          <input
            ref={arquivo}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
            multiple
            className="hidden"
            aria-label="Escolher arquivo da evidência"
            onChange={(e) => void enviar(e.target.files)}
          />
          {enviando ? (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {enviando}
            </span>
          ) : null}
        </div>
      ) : null}
      {evidencias.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {evidencias.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 rounded-xl border border-border p-2"
            >
              <a
                href={`/api/rh/${empresaId}/evidencias/${e.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
              >
                {e.mime.startsWith("image/") &&
                e.mime !== "image/heic" &&
                e.mime !== "image/heif" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/rh/${empresaId}/evidencias/${e.id}`}
                    alt={e.legenda ?? "Foto da evidência"}
                    className="size-14 rounded-lg object-cover"
                    loading="lazy"
                  />
                ) : (
                  <FileText
                    className="size-8 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">
                    {e.legenda ??
                      (e.mime.startsWith("image/") ? "Foto" : "Arquivo PDF")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {e.autor ?? "—"} · {e.enviado_em}
                  </span>
                </span>
              </a>
              {podeEnviar ? (
                <Confirmacao
                  gatilho={
                    <Button
                      variante="fantasma"
                      tamanho="iconeSm"
                      aria-label="Excluir anexo"
                    >
                      <Trash2 />
                    </Button>
                  }
                  titulo="Excluir este anexo?"
                  textoConfirmar="Excluir"
                  variante="perigo"
                  aoConfirmar={async () => {
                    const r = await excluirEvidencia(empresaId, e.id);
                    if (r.ok) {
                      toast.success(r.mensagem ?? "Anexo excluído.");
                      router.refresh();
                    } else
                      toast.error(r.mensagem ?? "Não foi possível excluir.");
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum anexo.</p>
      )}
    </div>
  );
}

export interface SugestaoTela {
  id: string;
  descricao: string;
  ia_recomendado: boolean;
  ia_explicacao: string | null;
}

/** Registro duvidoso: a pessoa confirma ou recusa (a IA, se ligada, só indica). */
export function SugestoesTarefa({
  empresaId,
  sugestoes,
  iaLigada,
}: {
  empresaId: string;
  sugestoes: SugestaoTela[];
  iaLigada: boolean;
}) {
  return (
    <ul className="space-y-2" data-testid="rh-sugestoes">
      {sugestoes.map((s) => (
        <li
          key={s.id}
          className="space-y-2 rounded-xl border border-info/40 bg-info/5 p-3"
        >
          <p className="text-sm">
            <span className="font-medium">Este registro é desta tarefa?</span>{" "}
            {s.descricao}
          </p>
          {s.ia_recomendado ? (
            <p className="text-xs text-muted-foreground">
              <Sparkles className="mr-1 inline size-3.5" aria-hidden />A IA
              indicou esta tarefa: {s.ia_explicacao}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <BotaoAcao
              tamanho="sm"
              acao={() => decidirSugestao(empresaId, s.id, true)}
            >
              <CheckCheck /> Sim, concluir com este registro
            </BotaoAcao>
            <BotaoAcao
              tamanho="sm"
              variante="contorno"
              acao={() => decidirSugestao(empresaId, s.id, false)}
            >
              <X /> Não é desta tarefa
            </BotaoAcao>
            {iaLigada ? (
              <BotaoAcao
                tamanho="sm"
                variante="fantasma"
                acao={() => pedirSugestaoIa(empresaId, s.id)}
              >
                <Sparkles /> Perguntar à IA
              </BotaoAcao>
            ) : (
              <span className="self-center text-xs text-muted-foreground">
                IA desligada: confira o período e confirme.
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Gestor: escolhe o responsável da tarefa. */
export function AtribuirTarefa({
  empresaId,
  tarefaId,
  atual,
  funcionarios,
}: {
  empresaId: string;
  tarefaId: string;
  atual: string | null;
  funcionarios: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = React.useTransition();
  return (
    <Select
      aria-label="Responsável pela tarefa"
      value={atual ?? ""}
      disabled={pendente}
      onChange={(e) => {
        const valor = e.target.value || null;
        iniciar(async () => {
          const r = await atribuirTarefa(empresaId, tarefaId, valor);
          if (r.ok) {
            toast.success(r.mensagem ?? "Responsável definido.");
            router.refresh();
          } else toast.error(r.mensagem ?? "Não foi possível atribuir.");
        });
      }}
      className="w-auto min-w-56"
    >
      <option value="">Sem responsável</option>
      {funcionarios.map((f) => (
        <option key={f.id} value={f.id}>
          {f.nome}
        </option>
      ))}
    </Select>
  );
}

/** Gestor: liga esta tarefa a outra (só conclui depois dela) ou remove a ligação. */
export function DependenciasTarefa({
  empresaId,
  tarefaId,
  dependencias,
  candidatas,
  podeEditar,
}: {
  empresaId: string;
  tarefaId: string;
  dependencias: {
    id: string;
    titulo: string;
    periodo: string;
    concluida: boolean;
  }[];
  candidatas: { id: string; titulo: string; periodo: string }[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [escolhida, setEscolhida] = React.useState("");
  const [pendente, iniciar] = React.useTransition();
  return (
    <div className="space-y-3">
      {dependencias.length ? (
        <ul className="space-y-1.5">
          {dependencias.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span>
                <a
                  href={`/e/${empresaId}/rh/tarefas/${d.id}`}
                  className="font-medium hover:underline"
                >
                  {d.titulo}
                </a>{" "}
                <span className="text-muted-foreground">· {d.periodo}</span>{" "}
                <span className={d.concluida ? "text-sucesso" : "text-perigo"}>
                  {d.concluida ? "concluída" : "ainda não concluída"}
                </span>
              </span>
              {podeEditar ? (
                <BotaoAcao
                  tamanho="sm"
                  variante="fantasma"
                  acao={() =>
                    ligarDependencia(empresaId, tarefaId, d.id, false)
                  }
                >
                  Remover
                </BotaoAcao>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Não depende de outra tarefa.
        </p>
      )}
      {podeEditar && candidatas.length ? (
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Tarefa de que esta depende"
            value={escolhida}
            onChange={(e) => setEscolhida(e.target.value)}
            className="w-auto min-w-64"
          >
            <option value="">Depende da conclusão de...</option>
            {candidatas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.titulo} · {c.periodo}
              </option>
            ))}
          </Select>
          <Button
            variante="contorno"
            disabled={!escolhida || pendente}
            onClick={() =>
              iniciar(async () => {
                const r = await ligarDependencia(
                  empresaId,
                  tarefaId,
                  escolhida,
                  true,
                );
                if (r.ok) {
                  toast.success(r.mensagem ?? "Dependência ligada.");
                  setEscolhida("");
                  router.refresh();
                } else toast.error(r.mensagem ?? "Não foi possível ligar.");
              })
            }
          >
            Ligar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
