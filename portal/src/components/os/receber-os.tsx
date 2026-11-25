"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RotateCcw, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirmacao, Dialog, DialogContent } from "@/components/ui/dialog";
import { Alerta } from "@/components/ui/feedback";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData, formatarDataHora } from "@/lib/formatos";
import { estornarPagamentoOs, registrarPagamentoOs, resumoRecebimentoOs, type ResumoRecebimentoOs } from "@/lib/os/acoes";
import { FORMAS_PAGAMENTO_OS, ROTULO_FORMA_OS } from "@/lib/os/rotulos";

const numero = (v: string) => Number(String(v).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
const campoMoeda = (v: number) => v.toFixed(2).replace(".", ",");

/** Carrega os valores e os recebimentos da OS (e o caixa aberto de quem recebe). */
export function useResumoRecebimento(empresaId: string, osId: string) {
  const [resumo, setResumo] = React.useState<ResumoRecebimentoOs | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [versao, setVersao] = React.useState(0);
  React.useEffect(() => {
    let vivo = true;
    void resumoRecebimentoOs(empresaId, osId).then((r) => {
      if (!vivo) return;
      if (r.ok && r.dados) {
        setResumo(r.dados);
        setErro(null);
      } else setErro(r.mensagem ?? "Não foi possível carregar os valores da OS.");
    });
    return () => {
      vivo = false;
    };
  }, [empresaId, osId, versao]);
  const carregar = React.useCallback(() => setVersao((v) => v + 1), []);
  return { resumo, erro, carregar };
}

export function Valores({ r }: { r: ResumoRecebimentoOs }) {
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="os-valores">
      {[
        { rotulo: "Total", valor: r.total },
        { rotulo: "Recebido", valor: r.recebido },
        { rotulo: "A receber", valor: r.aReceber },
        { rotulo: "Falta", valor: r.falta, forte: true },
      ].map((v) => (
        <div key={v.rotulo} className={cn("rounded-lg border border-border px-2.5 py-1.5", v.forte && v.valor > 0 && "border-alerta/50 bg-alerta-bg/40")}>
          <dt className="text-[11px] text-muted-foreground">{v.rotulo}</dt>
          <dd className={cn("font-semibold", v.forte && v.valor > 0 && "text-alerta")}>{formatarMoeda(v.valor)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Formulário de recebimento (sinal, restante ou "a receber") pelo caixa aberto de quem recebe. */
export function FormRecebimento({ empresaId, osId, r, aoRegistrar }: { empresaId: string; osId: string; r: ResumoRecebimentoOs; aoRegistrar: () => void }) {
  const [forma, setForma] = React.useState<string>("pix");
  const [valor, setValor] = React.useState(campoMoeda(r.falta));
  const [entregue, setEntregue] = React.useState("");
  const [vencimento, setVencimento] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [pendente, iniciar] = React.useTransition();
  const troco = forma === "dinheiro" && entregue ? Math.max(numero(entregue) - numero(valor), 0) : 0;
  const semCaixa = forma !== "a_receber" && !r.caixa;

  if (!r.podeReceber) return <Alerta tom="info">{r.motivoSemReceber ?? "Você não pode receber por esta OS."}</Alerta>;
  if (r.falta <= 0) return <Alerta tom="sucesso">Esta OS já está paga.</Alerta>;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const res = await registrarPagamentoOs(empresaId, osId, { forma, valor: numero(valor), vencimento, observacao });
          if (res.ok) {
            toast.success(res.mensagem ?? "Recebimento registrado.");
            aoRegistrar();
          } else toast.error(res.mensagem ?? "Não foi possível registrar.");
        });
      }}
    >
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Forma de pagamento</legend>
        <div className="flex flex-wrap gap-1.5">
          {FORMAS_PAGAMENTO_OS.map((f) => (
            <Button key={f.valor} type="button" tamanho="sm" variante={forma === f.valor ? "primario" : "contorno"} aria-pressed={forma === f.valor} onClick={() => setForma(f.valor)}>
              {f.rotulo}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Campo rotulo="Valor (R$)" htmlFor="os-receber-valor" obrigatorio ajuda={`Falta ${formatarMoeda(r.falta)}.`}>
          <Input id="os-receber-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Campo>
        {forma === "dinheiro" ? (
          <Campo rotulo="Dinheiro entregue pelo cliente" htmlFor="os-receber-entregue" ajuda={troco > 0 ? `Troco: ${formatarMoeda(troco)}` : "Opcional, para calcular o troco."}>
            <Input id="os-receber-entregue" inputMode="decimal" value={entregue} onChange={(e) => setEntregue(e.target.value)} />
          </Campo>
        ) : null}
        {forma === "a_receber" ? (
          <Campo rotulo="Vencimento combinado" htmlFor="os-receber-venc" obrigatorio ajuda="Vai para Contas a receber no Financeiro.">
            <Input id="os-receber-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </Campo>
        ) : null}
        <Campo rotulo="Observação" htmlFor="os-receber-obs" className="sm:col-span-2">
          <Textarea id="os-receber-obs" rows={1} maxLength={300} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </Campo>
      </div>
      {semCaixa ? (
        <Alerta tom="alerta">
          Abra o seu caixa na Loja para receber agora (ou escolha “A receber”).{" "}
          <Link href={`/e/${empresaId}/loja/caixa`} className="font-medium underline">
            Abrir o caixa
          </Link>
        </Alerta>
      ) : forma !== "a_receber" && r.caixa ? (
        <p className="text-xs text-muted-foreground">Entra no {r.caixa.nome} (aberto por você) e no Financeiro.</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pendente || semCaixa || numero(valor) <= 0 || (forma === "a_receber" && !vencimento)}>
          {pendente ? <Loader2 className="animate-spin" /> : <Wallet />} {forma === "a_receber" ? "Deixar a receber" : "Receber"}
        </Button>
      </div>
    </form>
  );
}

/** Lista dos recebimentos com o estorno (quem recebeu, com o caixa aberto, ou o gerente). */
export function ListaRecebimentos({ empresaId, r, aoMudar }: { empresaId: string; r: ResumoRecebimentoOs; aoMudar: () => void }) {
  const [motivo, setMotivo] = React.useState("");
  if (!r.pagamentos.length) return <p className="text-sm text-muted-foreground">Nenhum recebimento ainda.</p>;
  return (
    <ul className="divide-y divide-border text-sm" data-testid="os-recebimentos">
      {r.pagamentos.map((p) => (
        <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2", p.cancelado_em && "text-muted-foreground line-through")}>
          <span className="flex flex-wrap items-center gap-1.5">
            <strong>{formatarMoeda(p.valor)}</strong> {ROTULO_FORMA_OS[p.forma] ?? p.forma}
            {p.sinal ? <Badge variante="info">Sinal</Badge> : null}
            {p.vencimento ? <span className="text-xs">vence {formatarData(p.vencimento)}</span> : null}
            <span className="text-xs text-muted-foreground">{formatarDataHora(p.created_at)}</span>
            {p.cancelado_em ? <span className="text-xs no-underline">estornado: {p.cancelado_motivo}</span> : null}
          </span>
          {p.podeEstornar ? (
            <Confirmacao
              gatilho={
                <Button tamanho="sm" variante="fantasma">
                  <RotateCcw /> Estornar
                </Button>
              }
              titulo={`Estornar ${formatarMoeda(p.valor)}?`}
              descricao="O valor sai do caixa e do Financeiro e volta a faltar na OS."
              textoConfirmar="Estornar"
              variante="perigo"
              aoConfirmar={async () => {
                if (motivo.trim().length < 3) {
                  toast.error("Explique o motivo do estorno.");
                  return false;
                }
                const res = await estornarPagamentoOs(empresaId, p.id, motivo);
                if (!res.ok) {
                  toast.error(res.mensagem ?? "Não foi possível estornar.");
                  return false;
                }
                toast.success(res.mensagem ?? "Estornado.");
                setMotivo("");
                aoMudar();
              }}
            >
              <Campo rotulo="Motivo" htmlFor={`os-estorno-${p.id}`} obrigatorio>
                <Input id={`os-estorno-${p.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
              </Campo>
            </Confirmacao>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Diálogo "Receber" da OS (esteira, página da OS e bancada). */
export function DialogoReceber({ empresaId, osId, aoFechar }: { empresaId: string; osId: string; aoFechar: () => void }) {
  const router = useRouter();
  const { resumo, erro, carregar } = useResumoRecebimento(empresaId, osId);
  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent titulo={resumo ? `Receber — OS nº ${resumo.numero}` : "Receber"} descricao={resumo ? `Cliente: ${resumo.cliente}` : undefined} largura="md">
        {erro ? <Alerta tom="perigo">{erro}</Alerta> : null}
        {!resumo && !erro ? <Loader2 className="mx-auto my-6 size-6 animate-spin text-muted-foreground" /> : null}
        {resumo ? (
          <div className="space-y-4">
            <Valores r={resumo} />
            <FormRecebimento
              key={`${resumo.recebido}-${resumo.aReceber}`}
              empresaId={empresaId}
              osId={osId}
              r={resumo}
              aoRegistrar={() => {
                router.refresh();
                aoFechar();
              }}
            />
            {resumo.pagamentos.length ? (
              <div>
                <p className="mb-1 text-sm font-medium">Recebimentos</p>
                <ListaRecebimentos
                  empresaId={empresaId}
                  r={resumo}
                  aoMudar={() => {
                    carregar();
                    router.refresh();
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Quadro "Pagamento" da página da OS: valores, recebimentos e o botão Receber. */
export function RecebimentosOs({ empresaId, osId }: { empresaId: string; osId: string }) {
  const router = useRouter();
  const { resumo, erro, carregar } = useResumoRecebimento(empresaId, osId);
  const [receber, setReceber] = React.useState(false);
  if (erro) return <Alerta tom="perigo">{erro}</Alerta>;
  if (!resumo) return <Loader2 className="mx-auto my-4 size-5 animate-spin text-muted-foreground" />;
  return (
    <div className="space-y-3">
      <Valores r={resumo} />
      {!resumo.podeReceber && resumo.falta > 0 ? <p className="text-xs text-muted-foreground">{resumo.motivoSemReceber}</p> : null}
      <ListaRecebimentos
        empresaId={empresaId}
        r={resumo}
        aoMudar={() => {
          carregar();
          router.refresh();
        }}
      />
      {resumo.podeReceber && resumo.falta > 0 ? (
        <Button variante="contorno" tamanho="sm" onClick={() => setReceber(true)}>
          <Wallet /> Receber
        </Button>
      ) : null}
      {receber ? (
        <DialogoReceber
          empresaId={empresaId}
          osId={osId}
          aoFechar={() => {
            setReceber(false);
            carregar();
          }}
        />
      ) : null}
    </div>
  );
}
