"use client";

import * as React from "react";
import { ArrowDownToLine, ArrowUpFromLine, Lock, LockOpen } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { abrirCaixa, fecharCaixa, movimentarCaixa } from "@/lib/gestao/acoes";

/** Abertura do caixa com o troco inicial da gaveta (no hotel, o caixa do turno, com o nome do turno). */
export function AbrirCaixa({ empresaId, sugestaoNome, turno = false }: { empresaId: string; sugestaoNome: string; turno?: boolean }) {
  return (
    <FormularioAcao acao={abrirCaixa.bind(null, empresaId)} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              rotulo={turno ? "Nome do turno" : "Nome do caixa"}
              htmlFor="caixa_nome"
              ajuda={turno ? "Ex.: Manhã — Ana, Noite, Plantão. Sai no relatório do turno." : "Ex.: Caixa 1, Balcão, Pátio."}
              erro={estado.erros?.caixa_nome}
            >
              <Input id="caixa_nome" name="caixa_nome" defaultValue={sugestaoNome} maxLength={40} />
            </Campo>
            <Campo rotulo="Troco inicial na gaveta" htmlFor="valor_abertura" ajuda="Quanto dinheiro já tem na gaveta agora." erro={estado.erros?.valor_abertura}>
              <CampoValor id="valor_abertura" name="valor_abertura" valorInicial="0" />
            </Campo>
          </div>
          <BotaoEnviar pendente={pendente} textoPendente="Abrindo..." tamanho="lg">
            <LockOpen /> {turno ? "Abrir o turno" : "Abrir o caixa"}
          </BotaoEnviar>
        </>
      )}
    </FormularioAcao>
  );
}

export interface ContaOpcao {
  id: string;
  nome: string;
}

/** Sangria (retirada de dinheiro) ou suprimento (reforço de troco). */
export function MovimentoCaixa({
  empresaId,
  sessaoId,
  tipo,
  contas,
  esperado,
}: {
  empresaId: string;
  sessaoId: string;
  tipo: "sangria" | "suprimento";
  contas: ContaOpcao[];
  esperado: number;
}) {
  const [aberto, setAberto] = React.useState(false);
  const sangria = tipo === "sangria";
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={sangria ? "contorno" : "secundario"}>
          {sangria ? <ArrowUpFromLine /> : <ArrowDownToLine />}
          {sangria ? "Sangria (retirar)" : "Suprimento (colocar)"}
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo={sangria ? "Sangria: retirar dinheiro da gaveta" : "Suprimento: colocar dinheiro na gaveta"}
        descricao={
          sangria
            ? `Na gaveta deveria ter ${formatarMoeda(esperado)} agora. Registre cada retirada para o caixa fechar certinho.`
            : "Use quando colocar mais troco na gaveta durante o dia."
        }
      >
        <FormularioAcao acao={movimentarCaixa.bind(null, empresaId, sessaoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <input type="hidden" name="tipo" value={tipo} />
              <Campo rotulo="Valor" htmlFor={`valor-${tipo}`} obrigatorio erro={estado.erros?.valor}>
                <CampoValor id={`valor-${tipo}`} name="valor" autoFocus />
              </Campo>
              <Campo rotulo="Motivo" htmlFor={`motivo-${tipo}`} obrigatorio ajuda={sangria ? "Ex.: depósito no banco, pagamento de frete, cofre." : "Ex.: troco trazido do cofre."}>
                <Input id={`motivo-${tipo}`} name="motivo" maxLength={300} required />
              </Campo>
              {contas.length ? (
                <Campo
                  rotulo={sangria ? "Para onde foi o dinheiro? (opcional)" : "De onde veio o dinheiro? (opcional)"}
                  htmlFor={`conta-${tipo}`}
                  ajuda="Escolhendo uma conta, o Financeiro registra a transferência sozinho. Deixe em branco se o dinheiro foi usado para pagar uma despesa (lance a despesa no Financeiro)."
                >
                  <Select id={`conta-${tipo}`} name="conta_id" defaultValue="">
                    <option value="">Não transferir para conta</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante={sangria ? "perigo" : "primario"}>
                  {sangria ? "Registrar sangria" : "Registrar suprimento"}
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Fechamento: conta o dinheiro da gaveta e compara com o esperado. */
export function FecharCaixa({
  empresaId,
  sessaoId,
  esperado,
  semComprovante = 0,
}: {
  empresaId: string;
  sessaoId: string;
  esperado: number;
  /** Recebimentos do hotel em PIX, cartão ou transferência sem o comprovante anexado */
  semComprovante?: number;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [contado, setContado] = React.useState("");
  const valor = lerValorBR(contado);
  const diferenca = valor ? valor.minus(esperado) : null;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button>
          <Lock /> Fechar o caixa
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Fechar o caixa" descricao="Conte o dinheiro da gaveta (cédulas e moedas) e informe o total. O sistema compara com o que deveria ter.">
        <FormularioAcao acao={fecharCaixa.bind(null, empresaId, sessaoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                Deveria ter na gaveta: <strong className="numero">{formatarMoeda(esperado)}</strong>
              </div>
              {semComprovante ? (
                <Alerta tom="alerta">
                  {semComprovante === 1 ? "1 recebimento do hotel" : `${semComprovante} recebimentos do hotel`} em PIX, cartão ou transferência sem comprovante. Dá para fechar
                  assim, mas o ideal é anexar antes (clipe na conta do hóspede).
                </Alerta>
              ) : null}
              <Campo rotulo="Dinheiro contado" htmlFor="valor_contado" obrigatorio erro={estado.erros?.valor_contado}>
                <CampoValor id="valor_contado" name="valor_contado" aoMudar={setContado} autoFocus />
              </Campo>
              {diferenca ? (
                diferenca.isZero() ? (
                  <Alerta tom="sucesso">Conferiu certinho.</Alerta>
                ) : (
                  <Alerta tom={diferenca.gt(0) ? "alerta" : "perigo"}>
                    {diferenca.gt(0) ? "Sobra" : "Falta"} de <strong>{formatarMoeda(diferenca.abs())}</strong>. Confira de novo antes de fechar; se continuar, explique na observação.
                  </Alerta>
                )
              ) : null}
              <Campo rotulo="Observação (opcional)" htmlFor="observacao">
                <Textarea id="observacao" name="observacao" rows={2} maxLength={1000} />
              </Campo>
              <Alerta tom="info">Depois de fechado, o caixa não recebe mais vendas, e o relatório do dia fica pronto para imprimir.</Alerta>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} textoPendente="Fechando...">
                  Fechar o caixa
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
