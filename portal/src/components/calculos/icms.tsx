"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import {
  adicionarLancamentoIcms,
  conferirIcms,
  definirDestinacao,
  definirDestinacaoPadrao,
  informarSaldoAnterior,
  reabrirIcms,
  relerNotasIcms,
  removerLancamentoIcms,
} from "@/lib/calculos/icms-acoes";
import { DESTINACOES, TIPOS_LANCAMENTO_ICMS, type Destinacao, type TipoLancamentoIcms } from "@/lib/calculos/icms";
import type { ResultadoAcao } from "@/lib/acoes";
import { formatarMoeda } from "@/lib/dinheiro";

const OPCOES: Destinacao[] = ["revenda", "uso_consumo", "ativo", "nao_se_aplica"];

function useAcaoImediata() {
  const router = useRouter();
  const [pendente, iniciar] = React.useTransition();
  const executar = (acao: () => Promise<ResultadoAcao>) =>
    iniciar(async () => {
      const r = await acao();
      if (r.ok) {
        if (r.mensagem) toast.success(r.mensagem);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível salvar.");
    });
  return { pendente, executar };
}

/**
 * Destinação de uma nota, de um item ou de um fornecedor. A primeira opção
 * ("como …") remove a escolha e volta ao nível de cima.
 */
export function SeletorDestinacao({
  empresaId,
  alvo,
  valor,
  herdada,
  rotulo,
  desabilitado,
}: {
  empresaId: string;
  alvo: { notaId?: string; item?: number; fornecedor?: string };
  valor: Destinacao | null;
  /** Texto da primeira opção (ex.: "Como a nota: revenda"). */
  herdada: string;
  rotulo: string;
  desabilitado?: boolean;
}) {
  const { pendente, executar } = useAcaoImediata();
  return (
    <span className="inline-flex items-center gap-1">
      <Select
        aria-label={rotulo}
        value={valor ?? ""}
        disabled={desabilitado || pendente}
        className="h-8 w-full min-w-0 py-0 text-xs sm:w-64"
        onChange={(e) => executar(() => definirDestinacao(empresaId, alvo, e.target.value || null))}
      >
        <option value="">{herdada}</option>
        {OPCOES.map((d) => (
          <option key={d} value={d}>
            {DESTINACOES[d].rotulo}
          </option>
        ))}
      </Select>
      {pendente ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Salvando" /> : null}
    </span>
  );
}

/** Destinação padrão das compras da empresa (quando a nota, o item e o fornecedor não têm escolha). */
export function DestinacaoPadrao({ empresaId, valor, desabilitado }: { empresaId: string; valor: "revenda" | "uso_consumo"; desabilitado?: boolean }) {
  const { pendente, executar } = useAcaoImediata();
  return (
    <span className="inline-flex items-center gap-2">
      <Select
        id="icms-destinacao-padrao"
        value={valor}
        disabled={desabilitado || pendente}
        className="h-9 w-full sm:w-72"
        onChange={(e) => executar(() => definirDestinacaoPadrao(empresaId, e.target.value))}
      >
        <option value="revenda">{DESTINACOES.revenda.rotulo}</option>
        <option value="uso_consumo">{DESTINACOES.uso_consumo.rotulo}</option>
      </Select>
      {pendente ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Salvando" /> : null}
    </span>
  );
}

/** Lançamentos do escritório (E110 no regime normal; outras guias em qualquer regime). */
export function LancamentosIcms({
  empresaId,
  competencia,
  lancamentos,
  regimeNormal,
  bloqueado,
}: {
  empresaId: string;
  competencia: string;
  lancamentos: { id: string; tipo: TipoLancamentoIcms; descricao: string; valor: number | string | null | undefined; observacao: string | null }[];
  regimeNormal: boolean;
  bloqueado: boolean;
}) {
  const tipos = (Object.keys(TIPOS_LANCAMENTO_ICMS) as TipoLancamentoIcms[]).filter((t) => regimeNormal || !TIPOS_LANCAMENTO_ICMS[t].regimeNormal);
  const [tipo, setTipo] = React.useState<TipoLancamentoIcms>(regimeNormal ? "outro_credito" : "guia_extra");
  return (
    <div className="space-y-3">
      {lancamentos.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lancamentos.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{l.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {TIPOS_LANCAMENTO_ICMS[l.tipo].rotulo}
                  {l.observacao ? ` · ${l.observacao}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="numero font-semibold">{formatarMoeda(l.valor)}</span>
                {!bloqueado ? (
                  <BotaoAcao
                    variante="fantasma"
                    tamanho="iconeSm"
                    aria-label={`Remover ${l.descricao}`}
                    acao={() => removerLancamentoIcms(empresaId, l.id)}
                    confirmar={{ titulo: "Remover este valor da apuração?", textoConfirmar: "Remover", perigo: true }}
                  >
                    <Trash2 />
                  </BotaoAcao>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum valor lançado neste mês.</p>
      )}
      {!bloqueado ? (
        <FormularioAcao acao={adicionarLancamentoIcms.bind(null, empresaId, competencia)} resetarAoSucesso className="space-y-3">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-3 sm:grid-cols-[14rem_1fr_10rem] [&>*]:min-w-0">
                <Campo rotulo="Tipo" htmlFor="icms-lanc-tipo" erro={estado.erros?.tipo} ajuda={TIPOS_LANCAMENTO_ICMS[tipo].ajuda}>
                  <Select id="icms-lanc-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoLancamentoIcms)}>
                    {tipos.map((t) => (
                      <option key={t} value={t}>
                        {TIPOS_LANCAMENTO_ICMS[t].rotulo}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Descrição" htmlFor="icms-lanc-desc" erro={estado.erros?.descricao}>
                  <Input id="icms-lanc-desc" name="descricao" maxLength={120} placeholder="Ex.: CIAP 1/48 — câmara fria" />
                </Campo>
                <Campo rotulo="Valor" htmlFor="icms-lanc-valor" erro={estado.erros?.valor}>
                  <CampoValor id="icms-lanc-valor" name="valor" />
                </Campo>
              </div>
              <Campo rotulo="Observação" htmlFor="icms-lanc-obs" erro={estado.erros?.observacao}>
                <Input id="icms-lanc-obs" name="observacao" maxLength={500} placeholder="Opcional (ex.: número da nota, base legal)" />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>
                  <Plus /> Lançar
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      ) : null}
    </div>
  );
}

/** Saldo credor do mês anterior: automático (conferência anterior) ou informado. */
export function SaldoAnteriorIcms({
  empresaId,
  competencia,
  valor,
  observacao,
}: {
  empresaId: string;
  competencia: string;
  valor: number | string | null;
  observacao: string | null;
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="link" tamanho="sm" className="h-auto p-0 text-xs" onClick={() => setAberto(true)}>
        {valor != null ? "mudar" : "informar"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo="Saldo credor do mês anterior"
          descricao="Use no primeiro mês apurado no portal (copie o saldo credor a transportar da última EFD ou do livro) ou para corrigir. Deixe em branco para usar o saldo da conferência do mês anterior."
        >
          <FormularioAcao acao={informarSaldoAnterior.bind(null, empresaId, competencia)} aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Saldo credor" htmlFor="icms-saldo" erro={estado.erros?.saldo} ajuda="Em branco = automático.">
                  <CampoValor id="icms-saldo" name="saldo" valorInicial={valor} />
                </Campo>
                <Campo rotulo="Origem do valor" htmlFor="icms-saldo-obs">
                  <Input id="icms-saldo-obs" name="observacao" maxLength={300} defaultValue={observacao ?? ""} placeholder="Ex.: EFD de agosto/2026, registro E110" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BotaoConferirIcms({ empresaId, competencia, mes, total }: { empresaId: string; competencia: string; mes: string; total: string }) {
  return (
    <BotaoAcao
      acao={() => conferirIcms(empresaId, competencia)}
      confirmar={{
        titulo: `Conferir a apuração do ICMS de ${mes}?`,
        descricao: `Os valores de agora (guias: ${total}) ficam guardados, o saldo credor passa para o mês seguinte e a previsão do cliente passa a usá-los. Para mudar depois, reabra o mês.`,
        textoConfirmar: "Conferir",
      }}
    >
      <CheckCircle2 /> Conferir o mês
    </BotaoAcao>
  );
}

export function ReabrirIcms({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <RotateCcw /> Reabrir
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Reabrir a apuração do mês?" descricao="Os valores guardados deixam de valer até a nova conferência. A reabertura fica registrada na auditoria.">
          <FormularioAcao acao={reabrirIcms.bind(null, empresaId, competencia)} aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Motivo" htmlFor="icms-reabrir-motivo" erro={estado.erros?.motivo} obrigatorio>
                  <Textarea id="icms-reabrir-motivo" name="motivo" rows={2} maxLength={300} placeholder="Ex.: nota de entrada recebida depois" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Reabrindo...">
                    <RotateCcw /> Reabrir
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

export function BotaoRelerIcms({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  return (
    <BotaoAcao variante="contorno" tamanho="sm" acao={() => relerNotasIcms(empresaId, competencia)}>
      <RefreshCw /> Atualizar a leitura das notas
    </BotaoAcao>
  );
}
