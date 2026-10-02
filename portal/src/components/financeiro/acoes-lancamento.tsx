"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCheck, HandCoins, Link2, Loader2, RotateCcw, Trash2, Undo2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { dec, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import type { ResultadoAcao } from "@/lib/acoes";
import {
  cancelarLancamento,
  confirmarLancamentos,
  desvincularDocumento,
  estornarBaixa,
  excluirLancamento,
  reativarLancamento,
  registrarBaixa,
  vincularDocumento,
} from "@/lib/financeiro/acoes-lancamentos";

function useExecutar() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const executar = (fn: () => Promise<ResultadoAcao>, depois?: () => void) =>
    new Promise<boolean>((resolve) =>
      iniciar(async () => {
        const r = await fn();
        if (r.ok) {
          toast.success(r.mensagem ?? "Feito.");
          depois?.();
          router.refresh();
        } else toast.error(r.mensagem ?? "Não foi possível concluir.");
        resolve(r.ok);
      }),
    );
  return { executar, pendente };
}

export function RegistrarBaixa({
  empresaId,
  lancamentoId,
  tipo,
  aberto,
  contas,
  hoje,
}: {
  empresaId: string;
  lancamentoId: string;
  tipo: "receber" | "pagar";
  aberto: string;
  contas: { id: string; nome: string }[];
  hoje: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [v, setV] = useState({ principal: aberto, juros: "", multa: "", desconto: "", taxas: "" });
  const total = useMemo(() => {
    const n = (s: string) => lerValorBR(s) ?? dec(0);
    const base = n(v.principal).plus(n(v.juros)).plus(n(v.multa)).minus(n(v.desconto));
    return tipo === "pagar" ? base.plus(n(v.taxas)) : base.minus(n(v.taxas));
  }, [v, tipo]);
  const parcial = (lerValorBR(v.principal) ?? dec(0)).lessThan(dec(aberto));
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger asChild>
        <Button variante="sucesso">
          <HandCoins /> Registrar {tipo === "receber" ? "recebimento" : "pagamento"}
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo={tipo === "receber" ? "Registrar recebimento" : "Registrar pagamento"}
        descricao={`Em aberto: ${formatarMoeda(aberto)}. Pagamentos parciais são permitidos; juros, multa, desconto e taxas ficam separados do principal.`}
        largura="lg"
      >
        <FormularioAcao acao={registrarBaixa.bind(null, empresaId, lancamentoId)} aoSucesso={() => setAberta(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Data" htmlFor="b-data" obrigatorio erro={estado.erros?.data_pagamento}>
                  <Input id="b-data" name="data_pagamento" type="date" defaultValue={hoje} />
                </Campo>
                <Campo rotulo="Conta" htmlFor="b-conta" obrigatorio erro={estado.erros?.conta_financeira_id}>
                  <Select id="b-conta" name="conta_financeira_id" defaultValue="">
                    <option value="">Selecione...</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Valor principal" htmlFor="b-principal" obrigatorio erro={estado.erros?.valor_principal} ajuda={parcial ? "Pagamento parcial: o restante continua em aberto." : "Quita o lançamento."}>
                  <CampoValor id="b-principal" name="valor_principal" valorInicial={aberto} aoMudar={(t) => setV((x) => ({ ...x, principal: t }))} />
                </Campo>
                <Campo rotulo="Forma" htmlFor="b-forma">
                  <Select id="b-forma" name="forma_pagamento" defaultValue="">
                    <option value="">—</option>
                    <option value="pix">PIX</option>
                    <option value="boleto">Boleto</option>
                    <option value="transferencia">Transferência (TED/DOC)</option>
                    <option value="cartao_debito">Cartão de débito</option>
                    <option value="cartao_credito">Cartão de crédito</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="cheque">Cheque</option>
                    <option value="debito_automatico">Débito automático</option>
                    <option value="outro">Outro</option>
                  </Select>
                </Campo>
                <Campo rotulo="Juros" htmlFor="b-juros" erro={estado.erros?.juros}>
                  <CampoValor id="b-juros" name="juros" aoMudar={(t) => setV((x) => ({ ...x, juros: t }))} />
                </Campo>
                <Campo rotulo="Multa" htmlFor="b-multa" erro={estado.erros?.multa}>
                  <CampoValor id="b-multa" name="multa" aoMudar={(t) => setV((x) => ({ ...x, multa: t }))} />
                </Campo>
                <Campo rotulo="Desconto" htmlFor="b-desconto" erro={estado.erros?.desconto}>
                  <CampoValor id="b-desconto" name="desconto" aoMudar={(t) => setV((x) => ({ ...x, desconto: t }))} />
                </Campo>
                <Campo rotulo={tipo === "receber" ? "Taxas descontadas (tarifa, maquininha)" : "Taxas/tarifas pagas"} htmlFor="b-taxas" erro={estado.erros?.taxas}>
                  <CampoValor id="b-taxas" name="taxas" aoMudar={(t) => setV((x) => ({ ...x, taxas: t }))} />
                </Campo>
                <Campo rotulo="Observação" htmlFor="b-obs" className="sm:col-span-2">
                  <Textarea id="b-obs" name="observacao" rows={2} />
                </Campo>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm">
                <span>{tipo === "receber" ? "Valor que entra na conta" : "Valor que sai da conta"}</span>
                <span className="text-lg font-bold numero">{formatarMoeda(total)}</span>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function BotaoEstornar({ empresaId, baixaId }: { empresaId: string; baixaId: string }) {
  const { executar } = useExecutar();
  return (
    <Confirmacao
      gatilho={
        <Button tamanho="iconeSm" variante="fantasma" aria-label="Estornar">
          <Undo2 />
        </Button>
      }
      titulo="Estornar este pagamento/recebimento?"
      descricao="O valor deixa de constar como pago e o lançamento volta a ficar em aberto. A operação fica registrada na auditoria."
      textoConfirmar="Estornar"
      variante="perigo"
      aoConfirmar={() => executar(() => estornarBaixa(empresaId, baixaId)).then(() => undefined)}
    />
  );
}

export function AcoesLancamento({
  empresaId,
  lancamentoId,
  situacao,
  revisao,
  temCategoria,
  temBaixas,
  base,
}: {
  empresaId: string;
  lancamentoId: string;
  situacao: string;
  revisao: string;
  temCategoria: boolean;
  temBaixas: boolean;
  base: string;
}) {
  const router = useRouter();
  const { executar, pendente } = useExecutar();
  const [motivo, setMotivo] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      {revisao === "sugerido" ? (
        <Button
          variante="sucesso"
          disabled={pendente || !temCategoria}
          title={!temCategoria ? "Defina a categoria (Editar) antes de confirmar" : undefined}
          onClick={() => executar(() => confirmarLancamentos(empresaId, [lancamentoId]))}
        >
          {pendente ? <Loader2 className="animate-spin" /> : <CheckCheck />} Confirmar lançamento
        </Button>
      ) : null}
      {situacao === "cancelado" ? (
        <Button variante="contorno" disabled={pendente} onClick={() => executar(() => reativarLancamento(empresaId, lancamentoId))}>
          <RotateCcw /> Reativar
        </Button>
      ) : !temBaixas ? (
        <Confirmacao
          gatilho={
            <Button variante="contorno">
              <Ban /> Cancelar
            </Button>
          }
          titulo="Cancelar este lançamento?"
          descricao="Ele deixa de valer nos relatórios, mas fica no histórico."
          textoConfirmar="Cancelar lançamento"
          variante="perigo"
          aoConfirmar={async () => {
            if (!motivo.trim()) {
              toast.error("Informe o motivo.");
              return false;
            }
            await executar(() => cancelarLancamento(empresaId, lancamentoId, motivo));
          }}
        >
          <Textarea aria-label="Motivo" placeholder="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
        </Confirmacao>
      ) : null}
      {!temBaixas ? (
        <Confirmacao
          gatilho={
            <Button variante="fantasma" className="text-perigo">
              <Trash2 /> Excluir
            </Button>
          }
          titulo="Excluir definitivamente?"
          descricao="Prefira cancelar para manter o histórico. A exclusão também fica registrada na auditoria."
          textoConfirmar="Excluir"
          variante="perigo"
          aoConfirmar={async () => {
            const ok = await executar(() => excluirLancamento(empresaId, lancamentoId));
            if (ok) router.push(base);
          }}
        />
      ) : null}
    </div>
  );
}

export function VincularDocumento({
  empresaId,
  lancamentoId,
  documentos,
}: {
  empresaId: string;
  lancamentoId: string;
  documentos: { id: string; nome: string }[];
}) {
  const { executar, pendente } = useExecutar();
  const [doc, setDoc] = useState("");
  const [tipo, setTipo] = useState("comprovante");
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select aria-label="Documento" value={doc} onChange={(e) => setDoc(e.target.value)} className="h-9 sm:flex-1">
        <option value="">Selecione um documento da empresa...</option>
        {documentos.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nome}
          </option>
        ))}
      </Select>
      <Select aria-label="Tipo de vínculo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="h-9 sm:w-44">
        <option value="comprovante">Comprovante</option>
        <option value="nota_fiscal">Nota fiscal</option>
        <option value="boleto">Boleto</option>
        <option value="contrato">Contrato</option>
        <option value="outro">Outro</option>
      </Select>
      <Button tamanho="sm" className="h-9" disabled={!doc || pendente} onClick={() => executar(() => vincularDocumento(empresaId, lancamentoId, doc, tipo), () => setDoc(""))}>
        <Link2 /> Vincular
      </Button>
    </div>
  );
}

export function BotaoDesvincular({ empresaId, lancamentoId, documentoId }: { empresaId: string; lancamentoId: string; documentoId: string }) {
  const { executar, pendente } = useExecutar();
  return (
    <Button tamanho="iconeSm" variante="fantasma" aria-label="Remover vínculo" disabled={pendente} onClick={() => executar(() => desvincularDocumento(empresaId, lancamentoId, documentoId))}>
      <Unlink />
    </Button>
  );
}
