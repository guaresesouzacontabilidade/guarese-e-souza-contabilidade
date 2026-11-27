"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatarTamanho } from "@/lib/formatos";
import { calcularSha256, enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirEnvio, iniciarEnvio } from "@/lib/documentos/acoes";

export interface Anexo {
  id: string;
  nome: string;
  tamanho: number;
}

/**
 * Anexos de mensagens: cada arquivo vira um documento da empresa (com
 * verificação de segurança e registro de acesso) e é citado na mensagem.
 */
export function SeletorAnexos({
  empresaId,
  categoria,
  competencia,
  anexos,
  aoMudar,
  extensoes,
  limiteMb,
}: {
  empresaId: string;
  categoria: string;
  competencia: string;
  anexos: Anexo[];
  aoMudar: (a: Anexo[]) => void;
  extensoes: string[];
  limiteMb: number;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function anexar(arquivos: FileList) {
    setErro(null);
    const novos: Anexo[] = [];
    for (const arquivo of Array.from(arquivos)) {
      const ext = /\.([a-z0-9]{1,8})$/i.exec(arquivo.name)?.[1]?.toLowerCase() ?? "";
      if (!extensoes.includes(ext)) {
        setErro(`Formato .${ext || "?"} não aceito. Aceitos: ${extensoes.join(", ")}.`);
        continue;
      }
      if (arquivo.size > limiteMb * 1024 * 1024) {
        setErro(`${arquivo.name} é maior que ${limiteMb} MB.`);
        continue;
      }
      try {
        setEnviando(arquivo.name);
        const hash = await calcularSha256(arquivo);
        const r = await iniciarEnvio(empresaId, {
          categoria,
          competencia,
          nome: arquivo.name,
          mime: arquivo.type || "application/octet-stream",
          tamanho: arquivo.size,
          sha256: hash,
          forcarDuplicado: true,
          observacao: "Anexo de mensagem",
        });
        if (!r.ok || !r.dados || r.dados.situacao !== "pronto") throw new Error(r.mensagem ?? "Falha ao anexar.");
        await enviarParaArmazenamento(r.dados.url, arquivo, () => undefined);
        const c = await concluirEnvio(empresaId, r.dados.versaoId);
        if (!c.ok || !c.dados) throw new Error(c.mensagem ?? "Falha ao confirmar o anexo.");
        novos.push({ id: c.dados.documentoId, nome: arquivo.name, tamanho: arquivo.size });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao anexar.");
      }
    }
    setEnviando(null);
    if (novos.length) aoMudar([...anexos, ...novos]);
  }

  return (
    <div className="space-y-2">
      {anexos.length ? (
        <ul className="flex flex-wrap gap-2">
          {anexos.map((a) => (
            <li key={a.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs">
              <Paperclip className="size-3" /> {a.nome} · {formatarTamanho(a.tamanho)}
              <button type="button" aria-label={`Remover ${a.nome}`} onClick={() => aoMudar(anexos.filter((x) => x.id !== a.id))} className="ml-1 rounded-full p-0.5 hover:bg-background">
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="button" tamanho="sm" variante="fantasma" disabled={Boolean(enviando)} onClick={() => entrada.current?.click()}>
          {enviando ? <Loader2 className="animate-spin" /> : <Paperclip />} {enviando ? `Anexando ${enviando}...` : "Anexar arquivo"}
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          className="sr-only"
          aria-label="Anexar arquivos"
          accept={extensoes.map((e) => `.${e}`).join(",")}
          onChange={(e) => {
            if (e.target.files?.length) void anexar(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {erro ? <p className="text-xs text-perigo">{erro}</p> : null}
    </div>
  );
}
