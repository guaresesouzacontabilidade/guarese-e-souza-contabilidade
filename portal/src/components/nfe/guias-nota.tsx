"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Paperclip, Undo2 } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { CampoValor } from "@/components/ui/campo-valor";
import { calcularSha256, enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { concluirEnvio, iniciarEnvio } from "@/lib/documentos/acoes";
import { dispensarGuia, vincularGuia } from "@/lib/nfe-emissao/acoes";
import { SITUACAO_GUIA, TIPO_GUIA, ondeGerarGuia } from "@/lib/nfe-emissao/rotulos";
import { formatarData } from "@/lib/formatos";
import { formatarMoeda } from "@/lib/dinheiro";

export interface GuiaNota {
  id: string;
  tipo: string;
  descricao: string;
  uf: string;
  codigo_receita: string | null;
  valor: number;
  vencimento: string;
  situacao: keyof typeof SITUACAO_GUIA;
  documento_id: string | null;
  observacao: string | null;
  paga: boolean;
}

function CopiarChave({ chave }: { chave: string }) {
  return (
    <Button
      type="button"
      variante="contorno"
      tamanho="sm"
      onClick={() => {
        navigator.clipboard.writeText(chave).then(
          () => toast.success("Chave copiada."),
          () => toast.error("Não foi possível copiar."),
        );
      }}
    >
      <Copy /> Copiar a chave da nota
    </Button>
  );
}

function AnexarGuia({ empresaId, guia, numeroNota }: { empresaId: string; guia: GuiaNota; numeroNota: number }) {
  const [aberto, setAberto] = React.useState(false);
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [vencimento, setVencimento] = React.useState(guia.vencimento);
  const [valor, setValor] = React.useState(formatarMoeda(guia.valor, { semSimbolo: true }));
  const [etapa, setEtapa] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const router = useRouter();

  async function enviar() {
    if (!arquivo) {
      setErro("Escolha o PDF da guia gerada no site oficial.");
      return;
    }
    setErro(null);
    try {
      setEtapa("Preparando...");
      const sha256 = await calcularSha256(arquivo);
      const titulo = `${TIPO_GUIA[guia.tipo] ?? guia.descricao}${guia.tipo === "contribuicao" ? ` (${guia.descricao})` : ""} — NF-e ${numeroNota}`;
      const inicio = await iniciarEnvio(empresaId, {
        categoria: "esc_guia",
        competencia: vencimento.slice(0, 7),
        nome: arquivo.name,
        mime: arquivo.type || "application/pdf",
        tamanho: arquivo.size,
        sha256,
        titulo: titulo.slice(0, 200),
        vencimento,
        valor,
      });
      if (!inicio.ok || !inicio.dados) throw new Error(inicio.mensagem ?? "Não foi possível enviar a guia.");
      let documentoId: string;
      if (inicio.dados.situacao === "duplicado") documentoId = inicio.dados.duplicado.id;
      else {
        setEtapa("Enviando o PDF...");
        await enviarParaArmazenamento(inicio.dados.url, arquivo, () => undefined);
        const fim = await concluirEnvio(empresaId, inicio.dados.versaoId);
        if (!fim.ok || !fim.dados) throw new Error(fim.mensagem ?? "Não foi possível concluir o envio.");
        documentoId = fim.dados.documentoId;
      }
      setEtapa("Ligando à nota...");
      const r = await vincularGuia(empresaId, guia.id, documentoId);
      if (!r.ok) throw new Error(r.mensagem ?? "Não foi possível ligar a guia à nota.");
      toast.success(r.mensagem ?? "Guia anexada.");
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível anexar a guia.");
    } finally {
      setEtapa(null);
    }
  }

  return (
    <>
      <Button tamanho="sm" onClick={() => setAberto(true)}>
        <Paperclip /> Anexar a guia gerada
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => !etapa && setAberto(v)}>
        <DialogContent titulo="Anexar a guia" descricao="O PDF entra nos documentos da empresa como guia e aparece na agenda de pagamentos do cliente, com o “paguei”.">
          <div className="space-y-3">
            {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
            <Campo rotulo="PDF da guia" htmlFor="guia-arquivo" obrigatorio>
              <Input id="guia-arquivo" type="file" accept=".pdf,application/pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Vencimento" htmlFor="guia-venc" obrigatorio>
                <Input id="guia-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
              </Campo>
              <Campo rotulo="Valor da guia" htmlFor="guia-valor" ajuda="Confira com o valor que a SEFAZ calculou.">
                <CampoValor id="guia-valor" valorInicial={guia.valor} aoMudar={setValor} />
              </Campo>
            </div>
            <div className="flex items-center justify-end gap-2">
              {etapa ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {etapa}
                </span>
              ) : null}
              <Button onClick={enviar} disabled={Boolean(etapa)}>
                Anexar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Dispensar({ empresaId, guia }: { empresaId: string; guia: GuiaNota }) {
  const [aberto, setAberto] = React.useState(false);
  if (guia.situacao === "dispensada") {
    return (
      <FormularioAcao acao={dispensarGuia.bind(null, empresaId, guia.id)}>
        {({ pendente }) => (
          <>
            <input type="hidden" name="situacao" value="a_gerar" />
            <BotaoEnviar pendente={pendente} variante="fantasma" tamanho="sm">
              <Undo2 /> Voltar para “a gerar”
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
    );
  }
  return (
    <>
      <Button variante="fantasma" tamanho="sm" onClick={() => setAberto(true)}>
        Não se aplica
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Guia não se aplica" descricao="Por exemplo: empresa com regime especial que recolhe na apuração do mês.">
          <FormularioAcao acao={dispensarGuia.bind(null, empresaId, guia.id)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ pendente }) => (
              <>
                <input type="hidden" name="situacao" value="dispensada" />
                <Campo rotulo="Motivo" htmlFor="obs" obrigatorio>
                  <Textarea id="obs" name="observacao" rows={2} maxLength={500} />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Confirmar</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function GuiasNota({
  empresaId,
  guias,
  chave,
  ufEmitente,
  numeroNota,
  escritorio,
  teste,
}: {
  empresaId: string;
  guias: GuiaNota[];
  chave: string;
  ufEmitente: string;
  numeroNota: number;
  escritorio: boolean;
  teste: boolean;
}) {
  return (
    <div className="space-y-3">
      {teste ? <Alerta tom="info">Nota de teste (homologação): os valores servem para conferência. Não gere guias de nota de teste.</Alerta> : null}
      {guias.map((g) => {
        const s = SITUACAO_GUIA[g.situacao];
        const onde = ondeGerarGuia(g.tipo, g.uf, ufEmitente);
        return (
          <div key={g.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {TIPO_GUIA[g.tipo] ?? g.descricao}
                  {g.tipo === "contribuicao" ? ` — ${g.descricao}` : ""} <span className="text-muted-foreground">({g.uf})</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Valor calculado: <strong className="numero text-foreground">{formatarMoeda(g.valor)}</strong> — pagar até {formatarData(g.vencimento)} (antes da saída da mercadoria)
                  {g.codigo_receita ? ` — código de receita ${g.codigo_receita}` : ""}
                </p>
              </div>
              <Badge variante={g.paga ? "sucesso" : s.tom}>{g.paga ? "Paga" : teste ? "Teste" : s.rotulo}</Badge>
            </div>
            {g.situacao === "a_gerar" && !teste ? (
              <>
                <p className="text-sm">{onde.passos}</p>
                <div className="flex flex-wrap gap-2">
                  <CopiarChave chave={chave} />
                  <Button asChild variante="contorno" tamanho="sm">
                    <a href={onde.url} target="_blank" rel="noopener noreferrer">
                      {onde.rotulo} <ExternalLink />
                    </a>
                  </Button>
                  {escritorio ? <AnexarGuia empresaId={empresaId} guia={g} numeroNota={numeroNota} /> : null}
                  {escritorio ? <Dispensar empresaId={empresaId} guia={g} /> : null}
                </div>
              </>
            ) : g.situacao === "gerada" && g.documento_id ? (
              <Button asChild variante="link" tamanho="sm">
                <a href={`/e/${empresaId}/documentos/${g.documento_id}`}>Ver a guia anexada</a>
              </Button>
            ) : g.situacao === "dispensada" ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {g.observacao}
                {escritorio && !teste ? <Dispensar empresaId={empresaId} guia={g} /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
