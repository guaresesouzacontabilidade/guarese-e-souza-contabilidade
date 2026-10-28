"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, FileText, ImageIcon, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao } from "@/components/ui/acao";
import { enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirComprovante, excluirComprovante, iniciarComprovante } from "@/lib/hotel/comprovantes";
import { LIMITE_COMPROVANTE, MAX_COMPROVANTES, mimeDoComprovante } from "@/lib/hotel/comprovante-arquivo";

export interface ComprovanteEscolhido {
  arquivo: File;
  origem: "camera" | "arquivo";
  previa: string | null;
}

export interface ComprovanteSalvo {
  id: string;
  nome: string;
  mime: string;
  /** Quem enviou (com o caixa aberto) ou o gerente; o banco confere de novo */
  podeExcluir: boolean;
}

const FOTOS_REDUZIVEIS = ["image/jpeg", "image/png", "image/webp"];

/** Foto grande (celular) vira JPEG com o lado maior de 1600 px: envia rápido e continua legível. PDF e HEIC vão como estão. */
async function reduzirFoto(arquivo: File, mime: string): Promise<{ arquivo: File; mime: string }> {
  if (!FOTOS_REDUZIVEIS.includes(mime) || arquivo.size <= 1_200_000) return { arquivo, mime };
  try {
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, 1600 / Math.max(imagem.width, imagem.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(imagem.width * escala);
    tela.height = Math.round(imagem.height * escala);
    const g = tela.getContext("2d");
    if (!g) return { arquivo, mime };
    g.drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close();
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", 0.82));
    if (!blob || blob.size >= arquivo.size) return { arquivo, mime };
    return { arquivo: new File([blob], `${arquivo.name.replace(/\.[^.]+$/, "") || "comprovante"}.jpg`, { type: "image/jpeg" }), mime: "image/jpeg" };
  } catch {
    return { arquivo, mime };
  }
}

/** Envia os comprovantes de um recebimento: registra no banco, grava no armazenamento privado e confirma. */
export async function enviarComprovantes(empresaId: string, pagamentoId: string, itens: ComprovanteEscolhido[], aoEtapa?: (texto: string) => void) {
  for (const [i, item] of itens.entries()) {
    const ordem = itens.length > 1 ? ` ${i + 1} de ${itens.length}` : "";
    const tipo = mimeDoComprovante(item.arquivo.type, item.arquivo.name);
    if (!tipo) throw new Error(`"${item.arquivo.name}" não é foto nem PDF.`);
    aoEtapa?.(`Preparando o comprovante${ordem}...`);
    const { arquivo, mime } = await reduzirFoto(item.arquivo, tipo);
    if (arquivo.size > LIMITE_COMPROVANTE) throw new Error(`"${item.arquivo.name}" passa de 10 MB.`);
    const inicio = await iniciarComprovante(empresaId, pagamentoId, { nome: arquivo.name, mime, tamanho: arquivo.size, origem: item.origem });
    if (!inicio.ok || !inicio.dados) throw new Error(inicio.mensagem ?? "Não foi possível enviar o comprovante.");
    aoEtapa?.(`Enviando o comprovante${ordem}...`);
    // O armazenamento só aceita o arquivo com o tipo certo (a foto HEIC às vezes vem sem tipo)
    await enviarParaArmazenamento(inicio.dados.url, arquivo.type === mime ? arquivo : new File([arquivo], arquivo.name, { type: mime }), () => undefined);
    const fim = await concluirComprovante(empresaId, inicio.dados.anexoId);
    if (!fim.ok) throw new Error(fim.mensagem ?? "Não foi possível concluir o envio do comprovante.");
  }
}

/** Tirar a foto na hora (câmera de trás do celular) ou escolher a foto/PDF já salvo. */
export function SeletorComprovante({
  itens,
  aoMudar,
  desabilitado,
  jaSalvos = 0,
}: {
  itens: ComprovanteEscolhido[];
  aoMudar: (itens: ComprovanteEscolhido[]) => void;
  desabilitado?: boolean;
  jaSalvos?: number;
}) {
  const camera = React.useRef<HTMLInputElement>(null);
  const arquivos = React.useRef<HTMLInputElement>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const cabem = MAX_COMPROVANTES - jaSalvos - itens.length;

  const adicionar = (lista: FileList | null, origem: ComprovanteEscolhido["origem"]) => {
    setErro(null);
    const novos: ComprovanteEscolhido[] = [];
    for (const f of Array.from(lista ?? [])) {
      const mime = mimeDoComprovante(f.type, f.name);
      if (!mime) {
        setErro(`"${f.name}" não é foto nem PDF.`);
        continue;
      }
      if (f.size > LIMITE_COMPROVANTE && !FOTOS_REDUZIVEIS.includes(mime)) {
        setErro(`"${f.name}" passa de 10 MB.`);
        continue;
      }
      novos.push({ arquivo: f, origem, previa: FOTOS_REDUZIVEIS.includes(mime) ? URL.createObjectURL(f) : null });
    }
    if (novos.length > cabem) setErro(`Cada recebimento aceita até ${MAX_COMPROVANTES} comprovantes.`);
    aoMudar([...itens, ...novos.slice(0, Math.max(cabem, 0))]);
  };

  const remover = (i: number) => {
    const it = itens[i];
    if (it?.previa) URL.revokeObjectURL(it.previa);
    aoMudar(itens.filter((_, j) => j !== i));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variante="contorno" tamanho="sm" onClick={() => camera.current?.click()} disabled={desabilitado || cabem <= 0}>
          <Camera /> Tirar foto
        </Button>
        <Button type="button" variante="contorno" tamanho="sm" onClick={() => arquivos.current?.click()} disabled={desabilitado || cabem <= 0}>
          <Paperclip /> Escolher arquivo
        </Button>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Tirar foto do comprovante"
        onChange={(e) => {
          adicionar(e.target.files, "camera");
          e.target.value = "";
        }}
      />
      <input
        ref={arquivos}
        type="file"
        accept="image/*,application/pdf,.pdf,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Escolher arquivo do comprovante"
        onChange={(e) => {
          adicionar(e.target.files, "arquivo");
          e.target.value = "";
        }}
      />
      {itens.length ? (
        <ul className="flex flex-wrap gap-2">
          {itens.map((it, i) => (
            <li key={`${it.arquivo.name}-${i}`} className="relative flex w-28 flex-col items-center gap-1 rounded-lg border border-border p-1.5 text-center">
              {it.previa ? (
                // eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) do arquivo escolhido
                <img src={it.previa} alt="" className="h-16 w-full rounded object-cover" />
              ) : (
                <FileText className="h-16 w-8 text-muted-foreground" aria-hidden />
              )}
              <span className="w-full truncate text-[11px] text-muted-foreground">{it.arquivo.name}</span>
              <button
                type="button"
                onClick={() => remover(i)}
                disabled={desabilitado}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-perigo"
                aria-label={`Tirar ${it.arquivo.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Foto do PIX, do comprovante do cartão ou da transferência (ou o PDF). Fica guardado para a conferência do caixa.</p>
      )}
      {erro ? <p className="text-xs text-perigo">{erro}</p> : null}
    </div>
  );
}

/** Anexar o comprovante depois (pelo clipe na lista de pagamentos). */
export function AnexarComprovante({ empresaId, pagamentoId, descricao, jaSalvos }: { empresaId: string; pagamentoId: string; descricao: string; jaSalvos: number }) {
  const [aberto, setAberto] = React.useState(false);
  const [itens, setItens] = React.useState<ComprovanteEscolhido[]>([]);
  const [etapa, setEtapa] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const router = useRouter();

  const limpar = () => {
    itens.forEach((i) => i.previa && URL.revokeObjectURL(i.previa));
    setItens([]);
    setErro(null);
  };
  const enviar = async () => {
    setErro(null);
    try {
      await enviarComprovantes(empresaId, pagamentoId, itens, setEtapa);
      toast.success(itens.length > 1 ? "Comprovantes anexados." : "Comprovante anexado.");
      limpar();
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o comprovante.");
      router.refresh();
    } finally {
      setEtapa(null);
    }
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (etapa) return;
        if (!v) limpar();
        setAberto(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="iconeSm" aria-label={`Anexar comprovante: ${descricao}`} title="Anexar comprovante" disabled={jaSalvos >= MAX_COMPROVANTES}>
          <Paperclip />
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Anexar comprovante" descricao={`${descricao}. A foto ou o PDF fica guardado para a conferência do caixa.`}>
        <div className="space-y-4">
          {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
          <SeletorComprovante itens={itens} aoMudar={setItens} desabilitado={Boolean(etapa)} jaSalvos={jaSalvos} />
          <div className="flex items-center justify-end gap-2">
            {etapa ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {etapa}
              </span>
            ) : null}
            <Button onClick={enviar} disabled={Boolean(etapa) || !itens.length}>
              Enviar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Comprovantes já anexados: abrem em outra aba; quem enviou (caixa aberto) ou o gerente exclui. */
export function ComprovantesDoPagamento({ empresaId, comprovantes }: { empresaId: string; comprovantes: ComprovanteSalvo[] }) {
  if (!comprovantes.length) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {comprovantes.map((c, i) => (
        <span key={c.id} className="inline-flex items-center">
          <a
            href={`/api/hotel/${empresaId}/comprovantes/${c.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-primary no-underline hover:bg-muted"
            title={c.nome}
          >
            {c.mime === "application/pdf" ? <FileText className="size-3.5" /> : <ImageIcon className="size-3.5" />}
            Comprovante{comprovantes.length > 1 ? ` ${i + 1}` : ""}
          </a>
          {c.podeExcluir ? (
            <BotaoAcao
              acao={excluirComprovante.bind(null, empresaId, c.id)}
              variante="fantasma"
              tamanho="iconeSm"
              aria-label={`Excluir o comprovante ${i + 1}`}
              confirmar={{ titulo: "Excluir o comprovante?", descricao: "O arquivo é apagado. Dá para anexar outro depois.", textoConfirmar: "Excluir", perigo: true }}
            >
              <Trash2 />
            </BotaoAcao>
          ) : null}
        </span>
      ))}
    </span>
  );
}
