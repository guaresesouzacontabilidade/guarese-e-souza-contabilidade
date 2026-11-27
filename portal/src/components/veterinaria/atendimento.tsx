"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FilePlus2, Loader2, Paperclip, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { enviarParaArmazenamento } from "@/lib/documentos/envio-navegador";
import { confirmarAnexo, finalizarAtendimento, iniciarAnexo, registrarAdendo, salvarAtendimento } from "@/lib/veterinaria/acoes";
import { TIPOS_ATENDIMENTO } from "@/lib/veterinaria/rotulos";

export interface ProntuarioForm {
  tipo: string;
  local: string | null;
  relato: string | null;
  anamnese: string | null;
  peso_kg: number | string | null;
  temperatura: number | string | null;
  frequencia_cardiaca: number | null;
  frequencia_respiratoria: number | null;
  tpc: number | string | null;
  mucosas: string | null;
  hidratacao: string | null;
  estado_geral: string | null;
  exame_fisico: string | null;
  diagnostico_presuntivo: string | null;
  diagnostico_conclusivo: string | null;
  procedimentos: string | null;
  tratamento: string | null;
  orientacoes: string | null;
  retorno_em: string | null;
  retorno_motivo: string | null;
}

const virgula = (v: number | string | null) => (v == null ? "" : String(v).replace(".", ","));

/** Prontuário do atendimento aberto (Res. CFMV nº 1.321/2020, art. 9º). Salva quantas vezes precisar até finalizar. */
export function FormularioProntuario({ empresaId, atendimentoId, p }: { empresaId: string; atendimentoId: string; p: ProntuarioForm }) {
  return (
    <FormularioAcao acao={salvarAtendimento.bind(null, empresaId, atendimentoId)} className="space-y-5">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Tipo" htmlFor="pr-tipo">
              <Select id="pr-tipo" name="tipo" defaultValue={p.tipo}>
                {Object.entries(TIPOS_ATENDIMENTO).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Local" htmlFor="pr-local" className="sm:col-span-2" ajuda="Vazio = na clínica. Ex.: atendimento domiciliar, fazenda.">
              <Input id="pr-local" name="local" maxLength={120} defaultValue={p.local ?? ""} />
            </Campo>
          </div>

          <section className="space-y-3">
            <h3 className="font-semibold">Relato do responsável e histórico</h3>
            <Campo rotulo="Queixa e relato do responsável" htmlFor="pr-relato">
              <Textarea id="pr-relato" name="relato" rows={3} maxLength={5000} defaultValue={p.relato ?? ""} />
            </Campo>
            <Campo rotulo="Anamnese" htmlFor="pr-anamnese" ajuda="Histórico, alimentação, ambiente, vermifugação, medicamentos em uso...">
              <Textarea id="pr-anamnese" name="anamnese" rows={4} maxLength={10000} defaultValue={p.anamnese ?? ""} />
            </Campo>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">Exame físico</h3>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Campo rotulo="Peso (kg)" htmlFor="pr-peso" erro={estado.erros?.peso_kg}>
                <Input id="pr-peso" name="peso_kg" inputMode="decimal" maxLength={10} defaultValue={virgula(p.peso_kg)} />
              </Campo>
              <Campo rotulo="Temp. (°C)" htmlFor="pr-temp" erro={estado.erros?.temperatura}>
                <Input id="pr-temp" name="temperatura" inputMode="decimal" maxLength={5} defaultValue={virgula(p.temperatura)} />
              </Campo>
              <Campo rotulo="FC (bpm)" htmlFor="pr-fc" erro={estado.erros?.frequencia_cardiaca}>
                <Input id="pr-fc" name="frequencia_cardiaca" inputMode="numeric" maxLength={3} defaultValue={p.frequencia_cardiaca ?? ""} />
              </Campo>
              <Campo rotulo="FR (mpm)" htmlFor="pr-fr" erro={estado.erros?.frequencia_respiratoria}>
                <Input id="pr-fr" name="frequencia_respiratoria" inputMode="numeric" maxLength={3} defaultValue={p.frequencia_respiratoria ?? ""} />
              </Campo>
              <Campo rotulo="TPC (s)" htmlFor="pr-tpc" erro={estado.erros?.tpc}>
                <Input id="pr-tpc" name="tpc" inputMode="decimal" maxLength={4} defaultValue={virgula(p.tpc)} />
              </Campo>
              <Campo rotulo="Mucosas" htmlFor="pr-mucosas">
                <Input id="pr-mucosas" name="mucosas" maxLength={60} defaultValue={p.mucosas ?? ""} placeholder="Normocoradas" />
              </Campo>
              <Campo rotulo="Hidratação" htmlFor="pr-hidratacao" className="sm:col-span-1 lg:col-span-2">
                <Input id="pr-hidratacao" name="hidratacao" maxLength={60} defaultValue={p.hidratacao ?? ""} placeholder="Hidratado" />
              </Campo>
              <Campo rotulo="Estado geral" htmlFor="pr-estado" className="sm:col-span-2 lg:col-span-4">
                <Input id="pr-estado" name="estado_geral" maxLength={300} defaultValue={p.estado_geral ?? ""} placeholder="Alerta, bom estado corporal" />
              </Campo>
            </div>
            <Campo rotulo="Achados do exame clínico e laboratorial" htmlFor="pr-exame">
              <Textarea id="pr-exame" name="exame_fisico" rows={4} maxLength={10000} defaultValue={p.exame_fisico ?? ""} />
            </Campo>
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">Diagnóstico e conduta</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Diagnóstico presuntivo" htmlFor="pr-dp">
                <Textarea id="pr-dp" name="diagnostico_presuntivo" rows={2} maxLength={2000} defaultValue={p.diagnostico_presuntivo ?? ""} />
              </Campo>
              <Campo rotulo="Diagnóstico conclusivo (quando houver)" htmlFor="pr-dc">
                <Textarea id="pr-dc" name="diagnostico_conclusivo" rows={2} maxLength={2000} defaultValue={p.diagnostico_conclusivo ?? ""} />
              </Campo>
            </div>
            <Campo rotulo="Procedimentos realizados" htmlFor="pr-proc" ajuda="Com o que foi feito e quem fez.">
              <Textarea id="pr-proc" name="procedimentos" rows={3} maxLength={5000} defaultValue={p.procedimentos ?? ""} />
            </Campo>
            <Campo rotulo="Tratamento" htmlFor="pr-trat" ajuda="Medicamentos aplicados e o que foi prescrito (a receita sai em “Nova receita”).">
              <Textarea id="pr-trat" name="tratamento" rows={3} maxLength={5000} defaultValue={p.tratamento ?? ""} />
            </Campo>
            <Campo rotulo="Orientações ao responsável" htmlFor="pr-orient">
              <Textarea id="pr-orient" name="orientacoes" rows={3} maxLength={5000} defaultValue={p.orientacoes ?? ""} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Retorno em" htmlFor="pr-retorno" erro={estado.erros?.retorno_em} ajuda="Entra nos lembretes da recepção.">
                <Input id="pr-retorno" name="retorno_em" type="date" defaultValue={p.retorno_em ?? ""} />
              </Campo>
              <Campo rotulo="Motivo do retorno" htmlFor="pr-retorno-motivo" className="sm:col-span-2">
                <Input id="pr-retorno-motivo" name="retorno_motivo" maxLength={200} defaultValue={p.retorno_motivo ?? ""} placeholder="Ex.: reavaliar a pele" />
              </Campo>
            </div>
          </section>

          <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-border bg-card/95 px-1 py-3 backdrop-blur">
            <BotaoEnviar pendente={pendente} variante="secundario">
              <Save /> Salvar prontuário
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function BotaoFinalizarAtendimento({ empresaId, atendimentoId }: { empresaId: string; atendimentoId: string }) {
  return (
    <BotaoAcao
      acao={finalizarAtendimento.bind(null, empresaId, atendimentoId)}
      confirmar={{
        titulo: "Finalizar o atendimento?",
        descricao: "Salve o prontuário antes. Depois de finalizado, o atendimento não pode mais ser alterado: correções entram como adendo datado e assinado (sem rasuras).",
        textoConfirmar: "Finalizar",
      }}
    >
      <CheckCircle2 /> Finalizar atendimento
    </BotaoAcao>
  );
}

export function DialogoAdendo({ empresaId, atendimentoId }: { empresaId: string; atendimentoId: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          <FilePlus2 /> Adendo
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Adendo ao prontuário" descricao="Correção ou informação nova (ex.: resultado de exame). Fica com a data, a hora e o seu nome e não pode ser apagado.">
        <FormularioAcao acao={registrarAdendo.bind(null, empresaId, atendimentoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Texto" htmlFor="ad-texto" obrigatorio erro={estado.erros?.texto}>
                <Textarea id="ad-texto" name="texto" rows={5} maxLength={5000} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar adendo</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

const TIPOS_ANEXO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const LIMITE_ANEXO = 15 * 1024 * 1024;

/** Laudo de exame ou imagem anexado ao prontuário (art. 9º, X). */
export function EnvioAnexo({ empresaId, atendimentoId }: { empresaId: string; atendimentoId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = React.useState(false);
  const [descricao, setDescricao] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);

  const enviar = async (arquivo: File) => {
    if (!TIPOS_ANEXO[arquivo.type]) {
      toast.error("Envie um PDF ou uma imagem (JPG, PNG ou WEBP).");
      return;
    }
    if (arquivo.size > LIMITE_ANEXO) {
      toast.error("O arquivo precisa ter até 15 MB.");
      return;
    }
    setEnviando(true);
    try {
      const inicio = await iniciarAnexo(empresaId, atendimentoId, { nome: arquivo.name, mime: arquivo.type, tamanho: arquivo.size, descricao });
      if (!inicio.ok || !inicio.dados) throw new Error(inicio.mensagem ?? "Não foi possível enviar o arquivo.");
      await enviarParaArmazenamento(inicio.dados.url, arquivo, () => undefined);
      const fim = await confirmarAnexo(empresaId, inicio.dados.id);
      if (!fim.ok) throw new Error(fim.mensagem ?? "Não foi possível concluir o envio.");
      toast.success("Anexo guardado no prontuário.");
      setDescricao("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o arquivo.");
    } finally {
      setEnviando(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Campo rotulo="Descrição do anexo" htmlFor="an-desc" className="flex-1">
        <Input id="an-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={200} placeholder="Ex.: hemograma completo, raio-x do tórax" />
      </Campo>
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void enviar(f);
        }}
      />
      <Button type="button" variante="contorno" disabled={enviando} onClick={() => ref.current?.click()}>
        {enviando ? <Loader2 className="animate-spin" /> : <Paperclip />} {enviando ? "Enviando..." : "Anexar laudo ou imagem"}
      </Button>
    </div>
  );
}
