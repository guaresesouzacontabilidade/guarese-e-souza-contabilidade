"use client";

import * as React from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { aparelhoDeToque, ehIOS, linkDeArquivoDoPortal, podeCompartilhar, prepararArquivo, salvarNoAparelho } from "@/lib/arquivos/baixar-no-aparelho";

/**
 * No celular, os links de arquivo do portal (PDF e XML das notas, documentos,
 * relatórios...) não abrem outra tela: o arquivo é preparado aqui mesmo e
 * entregue ao aparelho (Android: Downloads, com a opção de compartilhar;
 * iPhone: folha de compartilhar, com "Salvar em Arquivos"). No computador os
 * links continuam como são (o PDF abre em aba nova).
 */
export function BaixarNoCelular() {
  const [pronto, setPronto] = React.useState<File | null>(null);

  React.useEffect(() => {
    if (!aparelhoDeToque()) return;
    let ocupado = false;
    const aoClicar = async (e: MouseEvent) => {
      const a = linkDeArquivoDoPortal(e);
      if (!a) return;
      e.preventDefault();
      if (ocupado) return;
      ocupado = true;
      const aviso = toast.loading("Preparando o arquivo...");
      try {
        const arquivo = await prepararArquivo(a.href, a.getAttribute("download"));
        if (ehIOS() && podeCompartilhar(arquivo)) {
          // O iPhone só abre a folha de compartilhar com um toque: mostra o botão
          toast.dismiss(aviso);
          setPronto(arquivo);
        } else {
          salvarNoAparelho(arquivo);
          toast.success(`Arquivo baixado: ${arquivo.name}`, {
            id: aviso,
            description: "Fica na pasta Downloads do celular.",
            action: podeCompartilhar(arquivo)
              ? { label: "Compartilhar", onClick: () => void navigator.share({ files: [arquivo], title: arquivo.name }).catch(() => undefined) }
              : undefined,
          });
        }
      } catch (erro) {
        toast.error(erro instanceof Error ? erro.message : "Não foi possível baixar o arquivo.", { id: aviso });
      } finally {
        ocupado = false;
      }
    };
    document.addEventListener("click", aoClicar);
    return () => document.removeEventListener("click", aoClicar);
  }, []);

  return (
    <Dialog open={Boolean(pronto)} onOpenChange={(aberto) => (aberto ? null : setPronto(null))}>
      <DialogContent titulo="Arquivo pronto" descricao={pronto ? pronto.name : undefined}>
        <p className="text-sm text-muted-foreground">Toque em Salvar ou compartilhar e escolha “Salvar em Arquivos”, o WhatsApp ou o e-mail.</p>
        <div className="mt-4 grid gap-2">
          <Button
            onClick={() => {
              const arquivo = pronto;
              if (!arquivo) return;
              void navigator
                .share({ files: [arquivo], title: arquivo.name })
                .then(() => setPronto(null))
                .catch((e: unknown) => {
                  if (e instanceof Error && e.name === "AbortError") return;
                  salvarNoAparelho(arquivo);
                  setPronto(null);
                });
            }}
          >
            <Share2 /> Salvar ou compartilhar
          </Button>
          <Button
            variante="contorno"
            onClick={() => {
              if (pronto) salvarNoAparelho(pronto);
              setPronto(null);
            }}
          >
            <Download /> Baixar
          </Button>
          <Button variante="fantasma" onClick={() => setPronto(null)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
