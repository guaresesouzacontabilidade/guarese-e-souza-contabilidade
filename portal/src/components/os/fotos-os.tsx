"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ImageIcon, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Confirmacao } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirFotoOs, excluirFotoOs, iniciarFotoOs } from "@/lib/os/fotos";
import { MOMENTOS_FOTO } from "@/lib/os/rotulos";

export interface FotoOs {
  id: string;
  momento: string;
  legenda: string | null;
  mime: string;
  podeExcluir: boolean;
}

const ROTULO_MOMENTO: Record<string, string> = Object.fromEntries(MOMENTOS_FOTO.map((m) => [m.valor, m.rotulo]));
const REDUZIVEIS = ["image/jpeg", "image/png", "image/webp"];

function mimeDaFoto(f: File): string | null {
  const t = f.type.toLowerCase();
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(t)) return t;
  const ext = f.name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png" || ext === "webp" || ext === "heic" || ext === "heif") return `image/${ext}`;
  return null;
}

/** Foto grande do celular vira JPEG com o lado maior de 1600 px (envia rápido e continua nítida). */
async function reduzir(arquivo: File, mime: string): Promise<{ arquivo: File; mime: string }> {
  if (!REDUZIVEIS.includes(mime) || arquivo.size <= 1_200_000) return { arquivo, mime };
  try {
    const img = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(img.width * escala);
    tela.height = Math.round(img.height * escala);
    tela.getContext("2d")?.drawImage(img, 0, 0, tela.width, tela.height);
    img.close();
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", 0.82));
    if (!blob || blob.size >= arquivo.size) return { arquivo, mime };
    return { arquivo: new File([blob], "foto.jpg", { type: "image/jpeg" }), mime: "image/jpeg" };
  } catch {
    return { arquivo, mime };
  }
}

const momentoDaEtapa = (etapa: string) => (etapa === "fila" ? "entrada" : etapa === "execucao" ? "execucao" : etapa === "pronta" ? "pronta" : etapa === "entregue" ? "retirada" : "outro");

/** Fotos da OS: tirar na hora (câmera de trás) ou escolher, e a galeria. */
export function FotosOs({ empresaId, osId, etapa, fotos, podeEnviar, compacto }: { empresaId: string; osId: string; etapa: string; fotos: FotoOs[]; podeEnviar: boolean; compacto?: boolean }) {
  const router = useRouter();
  const camera = React.useRef<HTMLInputElement>(null);
  const galeria = React.useRef<HTMLInputElement>(null);
  const [momento, setMomento] = React.useState(momentoDaEtapa(etapa));
  const [enviando, setEnviando] = React.useState<string | null>(null);

  async function enviar(lista: FileList | null) {
    const arquivos = Array.from(lista ?? []).slice(0, 10);
    if (!arquivos.length) return;
    try {
      for (const [i, f] of arquivos.entries()) {
        const tipo = mimeDaFoto(f);
        if (!tipo) throw new Error(`"${f.name}" não é uma foto.`);
        setEnviando(arquivos.length > 1 ? `Enviando ${i + 1} de ${arquivos.length}...` : "Enviando a foto...");
        const { arquivo, mime } = await reduzir(f, tipo);
        const ini = await iniciarFotoOs(empresaId, osId, { mime, tamanho: arquivo.size, momento });
        if (!ini.ok || !ini.dados) throw new Error(ini.mensagem ?? "Não foi possível enviar a foto.");
        await enviarParaArmazenamento(ini.dados.url, arquivo.type === mime ? arquivo : new File([arquivo], arquivo.name, { type: mime }), () => undefined);
        const fim = await concluirFotoOs(empresaId, ini.dados.fotoId);
        if (!fim.ok) throw new Error(fim.mensagem ?? "Não foi possível concluir o envio.");
      }
      toast.success(arquivos.length > 1 ? "Fotos anexadas." : "Foto anexada.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="os-fotos">
      {podeEnviar ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Momento da foto" value={momento} onChange={(e) => setMomento(e.target.value)} className="w-auto">
            {MOMENTOS_FOTO.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </Select>
          <Button type="button" variante="contorno" tamanho={compacto ? "lg" : "md"} onClick={() => camera.current?.click()} disabled={Boolean(enviando) || fotos.length >= 20}>
            <Camera /> Tirar foto
          </Button>
          <Button type="button" variante="fantasma" tamanho={compacto ? "lg" : "md"} onClick={() => galeria.current?.click()} disabled={Boolean(enviando) || fotos.length >= 20}>
            <ImagePlus /> Escolher
          </Button>
          {enviando ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {enviando}
            </span>
          ) : null}
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-label="Tirar foto da OS"
            onChange={(e) => {
              void enviar(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={galeria}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Escolher fotos da OS"
            onChange={(e) => {
              void enviar(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : null}
      {fotos.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {fotos.map((f) => (
            <li key={f.id} className="group relative overflow-hidden rounded-lg border border-border bg-muted/40">
              <a href={`/api/os/${empresaId}/fotos/${f.id}`} target="_blank" rel="noopener noreferrer" className="block">
                {REDUZIVEIS.includes(f.mime) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto privada por link temporário (redirecionamento)
                  <img src={`/api/os/${empresaId}/fotos/${f.id}`} alt={`Foto: ${ROTULO_MOMENTO[f.momento] ?? f.momento}`} className="aspect-square w-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex aspect-square w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                    <ImageIcon className="size-6" /> HEIC (baixar)
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-[10px] text-white">{ROTULO_MOMENTO[f.momento] ?? f.momento}</span>
              </a>
              {f.podeExcluir ? (
                <Confirmacao
                  gatilho={
                    <button type="button" className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-80 hover:opacity-100" aria-label="Excluir a foto">
                      <Trash2 className="size-3.5" />
                    </button>
                  }
                  titulo="Excluir esta foto?"
                  textoConfirmar="Excluir"
                  variante="perigo"
                  aoConfirmar={async () => {
                    const r = await excluirFotoOs(empresaId, f.id);
                    if (!r.ok) {
                      toast.error(r.mensagem ?? "Não foi possível excluir.");
                      return false;
                    }
                    toast.success("Foto excluída.");
                    router.refresh();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma foto ainda. Fotografe o material que o cliente trouxe e o serviço pronto: fica de prova se houver reclamação.</p>
      )}
    </div>
  );
}
