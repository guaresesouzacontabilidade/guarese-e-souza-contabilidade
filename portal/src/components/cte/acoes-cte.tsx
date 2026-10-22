"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, FilePenLine, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { cancelarCte, cartaCorrecaoCte } from "@/lib/cte-emissao/acoes";
import { CAMPOS_CCE_CTE } from "@/lib/cte-emissao/rotulos";

export function CancelarCte({ empresaId, id, numero, autorizadaEm }: { empresaId: string; id: string; numero: number; autorizadaEm: string | null }) {
  const [aberto, setAberto] = React.useState(false);
  // Horas desde a autorização, medidas ao abrir o pedido de cancelamento
  const [horas, setHoras] = React.useState(0);
  return (
    <>
      <Button
        variante="contorno"
        onClick={() => {
          setHoras(autorizadaEm ? (Date.now() - new Date(autorizadaEm).getTime()) / 3_600_000 : 0);
          setAberto(true);
        }}
      >
        <Ban /> Cancelar CT-e
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={`Cancelar o CT-e nº ${numero}`} descricao="O pedido de cancelamento vai para a SEFAZ com o certificado da empresa.">
          <FormularioAcao acao={cancelarCte.bind(null, empresaId, id)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                {horas > 168 ? (
                  <Alerta tom="alerta">
                    O CT-e foi autorizado há mais de 7 dias (168 horas). Depois desse prazo a SEFAZ costuma recusar o cancelamento; pode ser preciso um CT-e de anulação ou
                    substituto. Fale com o escritório.
                  </Alerta>
                ) : (
                  <Alerta tom="info">Só cancele se o transporte não começou. Se a carga já saiu, fale com o escritório antes.</Alerta>
                )}
                <Campo rotulo="Motivo do cancelamento" htmlFor="justificativa" obrigatorio erro={estado.erros?.justificativa} ajuda="De 15 a 255 caracteres.">
                  <Textarea id="justificativa" name="justificativa" rows={3} maxLength={255} minLength={15} />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Enviando...">
                    Cancelar o CT-e
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface Linha {
  chave: number;
  campo: string;
  valor: string;
}

export function CartaCorrecaoCte({ empresaId, id, numero }: { empresaId: string; id: string; numero: number }) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const seq = React.useRef(2);
  const [linhas, setLinhas] = React.useState<Linha[]>([{ chave: 1, campo: "", valor: "" }]);
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  async function enviar() {
    setErro(null);
    const correcoes = [];
    for (const l of linhas) {
      const c = CAMPOS_CCE_CTE.find((x) => `${x.grupo}/${x.campo}` === l.campo);
      if (!c) return setErro("Escolha o campo de cada correção.");
      if (!l.valor.trim()) return setErro(`Informe o valor certo de “${c.rotulo}”.`);
      correcoes.push({ grupo: c.grupo, campo: c.campo, valor: l.valor.trim() });
    }
    setEnviando(true);
    const r = await cartaCorrecaoCte(empresaId, id, correcoes);
    setEnviando(false);
    if (!r.ok) return setErro(r.mensagem ?? "Não foi possível enviar a carta de correção.");
    toast.success(r.mensagem ?? "Carta de correção enviada.");
    setAberto(false);
    setLinhas([{ chave: 1, campo: "", valor: "" }]);
    router.refresh();
  }

  return (
    <>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <FilePenLine /> Carta de correção
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={`Carta de correção do CT-e nº ${numero}`} descricao="No CT-e, a carta corrige campo a campo. A última carta substitui as anteriores: inclua todas as correções juntas.">
          <div className="space-y-3">
            <Alerta tom="info">
              A carta de correção não pode mudar valores, impostos, o tomador, o remetente, o destinatário nem as datas (Convênio SINIEF 06/89, art. 58-B).
            </Alerta>
            {linhas.map((l) => {
              const c = CAMPOS_CCE_CTE.find((x) => `${x.grupo}/${x.campo}` === l.campo);
              return (
                <div key={l.chave} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end [&>*]:min-w-0">
                  <Campo rotulo="Campo" htmlFor={`cce-c-${l.chave}`}>
                    <Select id={`cce-c-${l.chave}`} value={l.campo} onChange={(e) => setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, campo: e.target.value } : x)))}>
                      <option value="">Escolha...</option>
                      {CAMPOS_CCE_CTE.map((x) => (
                        <option key={`${x.grupo}/${x.campo}`} value={`${x.grupo}/${x.campo}`}>
                          {x.rotulo}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Valor certo" htmlFor={`cce-v-${l.chave}`}>
                    {c?.campo === "xObs" ? (
                      <Textarea id={`cce-v-${l.chave}`} rows={2} maxLength={c.max} value={l.valor} onChange={(e) => setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, valor: e.target.value } : x)))} />
                    ) : (
                      <Input id={`cce-v-${l.chave}`} maxLength={c?.max ?? 60} value={l.valor} onChange={(e) => setLinhas((ls) => ls.map((x) => (x.chave === l.chave ? { ...x, valor: e.target.value } : x)))} />
                    )}
                  </Campo>
                  <Button type="button" variante="fantasma" tamanho="sm" title="Remover" disabled={linhas.length === 1} onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variante="contorno" tamanho="sm" onClick={() => setLinhas((ls) => [...ls, { chave: seq.current++, campo: "", valor: "" }])} disabled={linhas.length >= 20}>
              <Plus /> Outra correção
            </Button>
            {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
            <div className="flex justify-end">
              <Button type="button" onClick={enviar} disabled={enviando}>
                {enviando ? <Loader2 className="animate-spin" /> : <Send />} Enviar carta de correção
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
