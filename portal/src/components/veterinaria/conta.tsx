"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, Loader2, Percent, Plus, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarMoeda } from "@/lib/dinheiro";
import { abrirConta, aplicarDescontoConta, fecharConta, lancarItemConta, registrarPagamento } from "@/lib/veterinaria/acoes";
import { FORMAS_PAGAMENTO_CLINICA } from "@/lib/veterinaria/rotulos";

/** Abre (ou reabre) a conta do atendimento / do animal e vai para ela. */
export function BotaoAbrirConta({
  empresaId,
  dados,
  rotulo = "Cobrar",
  variante = "contorno",
}: {
  empresaId: string;
  dados: { tutor_id?: string; paciente_id?: string; atendimento_id?: string };
  rotulo?: string;
  variante?: "contorno" | "primario" | "secundario";
}) {
  const router = useRouter();
  const [pendente, iniciar] = React.useTransition();
  return (
    <Button
      variante={variante}
      tamanho="sm"
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          const r = await abrirConta(empresaId, dados);
          if (!r.ok || !r.dados) {
            toast.error(r.mensagem ?? "Não foi possível abrir a conta.");
            return;
          }
          router.push(`/e/${empresaId}/veterinaria/contas/${r.dados.id}`);
        })
      }
    >
      {pendente ? <Loader2 className="animate-spin" /> : <ReceiptText />} {rotulo}
    </Button>
  );
}

/** Lança serviço do catálogo (preço da tabela) ou item avulso na conta. */
export function FormularioItemConta({ empresaId, contaId, servicos }: { empresaId: string; contaId: string; servicos: { id: string; nome: string; preco: number | string }[] }) {
  const [servico, setServico] = React.useState(servicos[0]?.id ?? "");
  return (
    <FormularioAcao acao={lancarItemConta.bind(null, empresaId, contaId)} resetarAoSucesso className="grid gap-3 sm:grid-cols-[1fr_90px_130px_auto] sm:items-end">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Serviço" htmlFor="ci-servico" erro={estado.erros?.servico_id ?? estado.erros?.descricao}>
            <Select id="ci-servico" name="servico_id" value={servico} onChange={(e) => setServico(e.target.value)}>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} — {formatarMoeda(s.preco)}
                </option>
              ))}
              <option value="">Outro (escrever)</option>
            </Select>
            {!servico ? <Input name="descricao" maxLength={120} placeholder="Descrição" className="mt-2" aria-label="Descrição do item" /> : null}
          </Campo>
          <Campo rotulo="Qtd." htmlFor="ci-qtd" erro={estado.erros?.quantidade}>
            <Input id="ci-qtd" name="quantidade" inputMode="decimal" defaultValue="1" maxLength={8} />
          </Campo>
          <Campo rotulo={servico ? "Valor (opcional)" : "Valor"} htmlFor="ci-valor" erro={estado.erros?.valor_unitario} ajuda={servico ? "Vazio = preço da tabela." : undefined}>
            <Input id="ci-valor" name="valor_unitario" inputMode="decimal" maxLength={14} placeholder="0,00" />
          </Campo>
          <BotaoEnviar pendente={pendente} textoPendente="Lançando...">
            <Plus /> Lançar
          </BotaoEnviar>
        </>
      )}
    </FormularioAcao>
  );
}

export function DialogoDesconto({ empresaId, contaId, desconto }: { empresaId: string; contaId: string; desconto: number }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="sm">
          <Percent /> Desconto
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Desconto na conta" descricao="Acima do limite da recepção (Gestão da loja), só o responsável aplica.">
        <FormularioAcao acao={aplicarDescontoConta.bind(null, empresaId, contaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Desconto (R$)" htmlFor="cd-valor" erro={estado.erros?.desconto}>
                <Input id="cd-valor" name="desconto" inputMode="decimal" defaultValue={desconto ? String(desconto).replace(".", ",") : ""} placeholder="0,00" />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Aplicar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Recebe o pagamento (vira lançamento no Financeiro e entra no caixa aberto de quem recebe). */
export function DialogoPagamento({ empresaId, contaId, saldo, hoje, caixaAberto }: { empresaId: string; contaId: string; saldo: number; hoje: string; caixaAberto: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  const [forma, setForma] = React.useState("pix");
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button disabled={saldo <= 0}>
          <HandCoins /> Receber
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Receber pagamento" descricao={`Falta receber ${formatarMoeda(saldo)}.`}>
        <FormularioAcao acao={registrarPagamento.bind(null, empresaId, contaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Forma" htmlFor="cp-forma" erro={estado.erros?.forma}>
                  <Select id="cp-forma" name="forma" value={forma} onChange={(e) => setForma(e.target.value)}>
                    {Object.entries(FORMAS_PAGAMENTO_CLINICA).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Valor" htmlFor="cp-valor" erro={estado.erros?.valor}>
                  <Input id="cp-valor" name="valor" inputMode="decimal" defaultValue={saldo.toFixed(2).replace(".", ",")} />
                </Campo>
                {forma === "a_receber" ? (
                  <Campo rotulo="Vencimento combinado" htmlFor="cp-venc" erro={estado.erros?.vencimento}>
                    <Input id="cp-venc" name="vencimento" type="date" min={hoje} />
                  </Campo>
                ) : null}
              </div>
              {forma === "dinheiro" && !caixaAberto ? (
                <p className="text-sm text-alerta">Você não está com o caixa aberto: o dinheiro entra no Financeiro, mas não na conferência de um caixa.</p>
              ) : null}
              <Campo rotulo="Observação" htmlFor="cp-obs">
                <Textarea id="cp-obs" name="observacao" rows={2} maxLength={300} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} textoPendente="Registrando...">
                  Confirmar
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function BotaoFecharConta({ empresaId, contaId, desabilitado }: { empresaId: string; contaId: string; desabilitado: boolean }) {
  return (
    <BotaoAcao variante="secundario" disabled={desabilitado} acao={fecharConta.bind(null, empresaId, contaId)} confirmar={{ titulo: "Fechar a conta?", textoConfirmar: "Fechar conta" }}>
      Fechar conta
    </BotaoAcao>
  );
}
