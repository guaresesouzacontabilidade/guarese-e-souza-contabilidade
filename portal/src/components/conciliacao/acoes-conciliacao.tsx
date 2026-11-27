"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RotateCcw, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { buscarSugestoes, desfazerConciliacao, excluirSaldoExtrato, informarSaldoExtrato, reativarMovimento } from "@/lib/conciliacao/acoes";

export function BotaoBuscarSugestoes({ empresaId }: { empresaId: string }) {
  return (
    <BotaoAcao variante="contorno" acao={() => buscarSugestoes(empresaId)}>
      <Sparkles /> Buscar sugestões agora
    </BotaoAcao>
  );
}

export function DesfazerConciliacao({ empresaId, conciliacaoId }: { empresaId: string; conciliacaoId: string }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  return (
    <Confirmacao
      gatilho={
        <Button tamanho="sm" variante="contorno">
          <Undo2 /> Desfazer
        </Button>
      }
      titulo="Desfazer esta conciliação?"
      descricao="As movimentações voltam para as pendentes e os pagamentos, transferências ou lançamentos criados por ela são removidos. Fica registrado no histórico."
      textoConfirmar="Desfazer"
      variante="perigo"
      aoConfirmar={async () => {
        if (motivo.trim().length < 3) {
          toast.error("Informe o motivo.");
          return false;
        }
        const r = await desfazerConciliacao(empresaId, conciliacaoId, motivo);
        if (r.ok) {
          toast.success(r.mensagem ?? "Desfeita.");
          router.refresh();
          return true;
        }
        toast.error(r.mensagem ?? "Não foi possível desfazer.");
        return false;
      }}
    >
      <Campo rotulo="Motivo" htmlFor={`motivo-${conciliacaoId}`} obrigatorio>
        <Textarea id={`motivo-${conciliacaoId}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} rows={2} />
      </Campo>
    </Confirmacao>
  );
}

export function BotaoReativar({ empresaId, movimentoId }: { empresaId: string; movimentoId: string }) {
  return (
    <BotaoAcao tamanho="sm" variante="contorno" acao={() => reativarMovimento(empresaId, movimentoId)}>
      <RotateCcw /> Reativar
    </BotaoAcao>
  );
}

export function InformarSaldo({ empresaId, contas, hoje }: { empresaId: string; contas: { id: string; nome: string }[]; hoje: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          <Plus /> Informar saldo do extrato
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo="Saldo mostrado pelo banco"
        descricao="Digite o saldo final que aparece no extrato (ou no aplicativo do banco) em uma data. O portal compara com o saldo calculado pelos lançamentos."
      >
        <FormularioAcao acao={informarSaldoExtrato.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Conta" htmlFor="saldo-conta" erro={estado.erros?.conta_financeira_id} obrigatorio>
                <Select id="saldo-conta" name="conta_financeira_id" defaultValue="" required>
                  <option value="">Selecione...</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Data do saldo" htmlFor="saldo-data" erro={estado.erros?.data} obrigatorio>
                  <Input id="saldo-data" name="data" type="date" defaultValue={hoje} max={hoje} required />
                </Campo>
                <Campo rotulo="Saldo final (R$)" htmlFor="saldo-valor" erro={estado.erros?.saldo} ajuda="Use o sinal de menos se estiver negativo." obrigatorio>
                  <CampoValor id="saldo-valor" name="saldo" permitirNegativo />
                </Campo>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar saldo</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function ExcluirSaldo({ empresaId, saldoId }: { empresaId: string; saldoId: string }) {
  return (
    <BotaoAcao
      tamanho="iconeSm"
      variante="fantasma"
      aria-label="Excluir saldo informado"
      acao={() => excluirSaldoExtrato(empresaId, saldoId)}
      confirmar={{ titulo: "Excluir este saldo informado?", textoConfirmar: "Excluir", perigo: true }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}
