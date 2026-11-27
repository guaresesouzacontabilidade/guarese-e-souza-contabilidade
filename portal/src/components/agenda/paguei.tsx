"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { calcularSha256, enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirEnvio, iniciarEnvio } from "@/lib/documentos/acoes";
import { desfazerPagamento, informarPagamento } from "@/lib/agenda/acoes";
import { formatarMoeda } from "@/lib/dinheiro";

export interface GuiaAgenda {
  id: string;
  titulo: string;
  competencia: string;
  vencimento: string;
  valor: number | null;
}

function hojeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Paguei": data, valor e comprovante (enviado pelo portal, ligado à guia). */
export function BotaoPaguei({
  empresaId,
  guia,
  itemComprovanteId,
  tamanho = "sm",
}: {
  empresaId: string;
  guia: GuiaAgenda;
  itemComprovanteId?: string | null;
  tamanho?: "sm" | "md";
}) {
  const [aberto, setAberto] = React.useState(false);
  const [data, setData] = React.useState(hojeLocal());
  const [valor, setValor] = React.useState(guia.valor != null ? formatarMoeda(guia.valor, { semSimbolo: true }) : "");
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [observacao, setObservacao] = React.useState("");
  const [etapa, setEtapa] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const router = useRouter();

  const enviar = async () => {
    setErro(null);
    try {
      let comprovanteId: string | null = null;
      if (arquivo) {
        setEtapa("Preparando o comprovante...");
        const sha256 = await calcularSha256(arquivo);
        const inicio = await iniciarEnvio(empresaId, {
          categoria: "guia_imposto",
          competencia: guia.competencia.slice(0, 7),
          nome: arquivo.name,
          mime: arquivo.type || "application/octet-stream",
          tamanho: arquivo.size,
          sha256,
          itemId: itemComprovanteId ?? null,
          titulo: `Comprovante — ${guia.titulo}`.slice(0, 200),
        });
        if (!inicio.ok || !inicio.dados) throw new Error(inicio.mensagem ?? "Não foi possível enviar o comprovante.");
        if (inicio.dados.situacao === "duplicado") {
          comprovanteId = inicio.dados.duplicado.id;
        } else {
          setEtapa("Enviando o comprovante...");
          await enviarParaArmazenamento(inicio.dados.url, arquivo, () => undefined);
          const fim = await concluirEnvio(empresaId, inicio.dados.versaoId);
          if (!fim.ok || !fim.dados) throw new Error(fim.mensagem ?? "Não foi possível concluir o envio do comprovante.");
          comprovanteId = fim.dados.documentoId;
        }
      }
      setEtapa("Registrando o pagamento...");
      const r = await informarPagamento(empresaId, guia.id, { pagoEm: data, valor: valor || null, comprovanteId, observacao: observacao || null });
      if (!r.ok) throw new Error(r.mensagem ?? "Não foi possível registrar o pagamento.");
      toast.success(r.mensagem ?? "Pagamento informado.");
      setAberto(false);
      setArquivo(null);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar o pagamento.");
    } finally {
      setEtapa(null);
    }
  };

  return (
    <>
      <Button tamanho={tamanho} onClick={() => setAberto(true)}>
        <CheckCircle2 /> Paguei
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => !etapa && setAberto(v)}>
        <DialogContent titulo={`Informar pagamento: ${guia.titulo}`} descricao="O escritório é avisado. Anexe o comprovante para dar baixa mais rápido.">
          <div className="space-y-3">
            {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Data do pagamento" htmlFor="pg-data" obrigatorio>
                <Input id="pg-data" type="date" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} />
              </Campo>
              <Campo rotulo="Valor pago" htmlFor="pg-valor" ajuda="Com juros e multa, se houver.">
                <CampoValor id="pg-valor" valorInicial={guia.valor} aoMudar={setValor} />
              </Campo>
            </div>
            <Campo rotulo="Comprovante (PDF ou foto)" htmlFor="pg-arquivo" ajuda="Opcional, mas recomendado.">
              <Input
                id="pg-arquivo"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,image/*,application/pdf"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              />
            </Campo>
            <Campo rotulo="Observação" htmlFor="pg-obs">
              <Textarea id="pg-obs" rows={2} maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </Campo>
            <div className="flex items-center justify-end gap-2">
              {etapa ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {etapa}
                </span>
              ) : null}
              <Button onClick={enviar} disabled={Boolean(etapa) || !data}>
                Confirmar pagamento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DesfazerPagamento({ empresaId, guiaId }: { empresaId: string; guiaId: string }) {
  const [pendente, iniciar] = React.useTransition();
  const router = useRouter();
  return (
    <Button
      variante="fantasma"
      tamanho="sm"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await desfazerPagamento(empresaId, guiaId);
          if (r.ok) {
            toast.success(r.mensagem ?? "Desfeito.");
            router.refresh();
          } else toast.error(r.mensagem ?? "Não foi possível desfazer.");
        })
      }
    >
      <Undo2 /> Desfazer
    </Button>
  );
}
