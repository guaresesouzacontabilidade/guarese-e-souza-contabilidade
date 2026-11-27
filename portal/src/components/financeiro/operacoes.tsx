"use client";

import { useState } from "react";
import { ArrowLeftRight, CreditCard, Landmark, Store, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import {
  registrarCompraCartao,
  registrarEstoque,
  registrarParcelaEmprestimo,
  registrarVendaMaquininha,
  salvarTransferencia,
} from "@/lib/financeiro/acoes-lancamentos";
import type { OpcoesLancamento } from "./formulario-lancamento";

function CartaoOperacao({
  icone: Icone,
  titulo,
  descricao,
  children,
}: {
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  descricao: string;
  children: (fechar: () => void) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="rounded-lg bg-bege p-2 text-primary">
            <Icone className="size-5" />
          </span>
          <span>
            <span className="block font-semibold text-titulo">{titulo}</span>
            <span className="block text-sm text-muted-foreground">{descricao}</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent titulo={titulo} descricao={descricao} largura="lg">
        {children(() => setAberto(false))}
      </DialogContent>
    </Dialog>
  );
}

export function Operacoes({ empresaId, opcoes, hoje }: { empresaId: string; opcoes: OpcoesLancamento; hoje: string }) {
  const cartoes = opcoes.contas.filter((c) => c.tipo === "cartao_credito");
  const bancarias = opcoes.contas.filter((c) => !["cartao_credito", "adquirente"].includes(c.tipo));
  const despesas = opcoes.categorias.filter((c) => c.natureza === "despesa");
  const receitas = opcoes.categorias.filter((c) => c.natureza === "receita" && c.tipo === "receita_operacional");
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <CartaoOperacao icone={ArrowLeftRight} titulo="Transferência entre contas" descricao="Entre bancos, aplicações, pagamento de fatura de cartão. Não é receita nem despesa.">
        {(fechar) => (
          <FormularioAcao acao={salvarTransferencia.bind(null, empresaId)} aoSucesso={fechar} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Tipo" htmlFor="t-tipo">
                    <Select id="t-tipo" name="tipo" defaultValue="transferencia">
                      <option value="transferencia">Transferência entre contas</option>
                      <option value="pagamento_fatura_cartao">Pagamento de fatura do cartão</option>
                      <option value="aplicacao">Aplicação financeira</option>
                      <option value="resgate">Resgate de aplicação</option>
                      <option value="repasse_adquirente">Repasse da maquininha para o banco</option>
                    </Select>
                  </Campo>
                  <Campo rotulo="Data" htmlFor="t-data" obrigatorio erro={estado.erros?.data}>
                    <Input id="t-data" name="data" type="date" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Sai da conta" htmlFor="t-orig" obrigatorio erro={estado.erros?.conta_origem_id}>
                    <Select id="t-orig" name="conta_origem_id" defaultValue="">
                      <option value="">Selecione...</option>
                      {opcoes.contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Entra na conta" htmlFor="t-dest" obrigatorio erro={estado.erros?.conta_destino_id} ajuda="Para pagar a fatura, escolha a conta do cartão.">
                    <Select id="t-dest" name="conta_destino_id" defaultValue="">
                      <option value="">Selecione...</option>
                      {opcoes.contas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Valor" htmlFor="t-valor" obrigatorio erro={estado.erros?.valor}>
                    <CampoValor id="t-valor" name="valor" />
                  </Campo>
                  <Campo rotulo="Descrição" htmlFor="t-desc">
                    <Input id="t-desc" name="descricao" />
                  </Campo>
                </div>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Registrar transferência</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        )}
      </CartaoOperacao>

      <CartaoOperacao icone={CreditCard} titulo="Compra no cartão de crédito" descricao="A despesa conta na data da compra; a fatura paga depois é uma transferência (sem duplicar).">
        {(fechar) =>
          cartoes.length ? (
            <FormularioAcao acao={registrarCompraCartao.bind(null, empresaId)} aoSucesso={fechar} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Cartão" htmlFor="c-cartao" obrigatorio>
                      <Select id="c-cartao" name="conta_cartao_id">
                        {cartoes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                    <Campo rotulo="Data da compra" htmlFor="c-data" obrigatorio>
                      <Input id="c-data" name="data_compra" type="date" defaultValue={hoje} />
                    </Campo>
                    <Campo rotulo="Descrição" htmlFor="c-desc" obrigatorio className="sm:col-span-2">
                      <Input id="c-desc" name="descricao" placeholder="Ex.: material de limpeza" />
                    </Campo>
                    <Campo rotulo="Valor total" htmlFor="c-valor" obrigatorio erro={estado.erros?.valor}>
                      <CampoValor id="c-valor" name="valor" />
                    </Campo>
                    <Campo rotulo="Parcelas no cartão" htmlFor="c-parc" ajuda="Informativo: a despesa é reconhecida integralmente na compra.">
                      <Input id="c-parc" name="parcelas" type="number" min={1} max={48} defaultValue={1} />
                    </Campo>
                    <Campo rotulo="Categoria da despesa" htmlFor="c-cat" obrigatorio className="sm:col-span-2">
                      <Select id="c-cat" name="categoria_id" defaultValue="">
                        <option value="">Selecione...</option>
                        {despesas.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.codigo} {c.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  </div>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Registrar compra</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          ) : (
            <p className="text-sm text-muted-foreground">Cadastre um cartão de crédito em “Contas e saldos” primeiro.</p>
          )
        }
      </CartaoOperacao>

      <CartaoOperacao icone={Store} titulo="Vendas em maquininha / plataforma" descricao="Separa venda bruta (receita), taxa (despesa financeira) e valor líquido recebido.">
        {(fechar) => (
          <FormularioAcao acao={registrarVendaMaquininha.bind(null, empresaId)} aoSucesso={fechar} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Descrição" htmlFor="m-desc" className="sm:col-span-2">
                    <Input id="m-desc" name="descricao" defaultValue="Vendas no cartão" />
                  </Campo>
                  <Campo rotulo="Data das vendas" htmlFor="m-dv" obrigatorio>
                    <Input id="m-dv" name="data_venda" type="date" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Data do recebimento" htmlFor="m-dr">
                    <Input id="m-dr" name="data_recebimento" type="date" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Valor bruto vendido" htmlFor="m-bruto" obrigatorio erro={estado.erros?.valor_bruto}>
                    <CampoValor id="m-bruto" name="valor_bruto" />
                  </Campo>
                  <Campo rotulo="Taxa cobrada" htmlFor="m-taxa" erro={estado.erros?.taxa}>
                    <CampoValor id="m-taxa" name="taxa" />
                  </Campo>
                  <Campo rotulo="Conta que recebe" htmlFor="m-conta" obrigatorio ajuda="Conta da maquininha (se houver repasse depois) ou o banco.">
                    <Select id="m-conta" name="conta_recebimento_id" defaultValue="">
                      <option value="">Selecione...</option>
                      {opcoes.contas
                        .filter((c) => c.tipo !== "cartao_credito")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                          </option>
                        ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Categoria da receita" htmlFor="m-cat" obrigatorio>
                    <Select id="m-cat" name="categoria_id" defaultValue={receitas[0]?.id ?? ""}>
                      {receitas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} {c.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="hidden" name="recebido" value="false" />
                    <Checkbox name="recebido" defaultChecked /> Valor já recebido (registra a baixa com a taxa)
                  </label>
                </div>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Registrar vendas</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        )}
      </CartaoOperacao>

      <CartaoOperacao icone={Landmark} titulo="Parcela de empréstimo ou financiamento" descricao="Separa a amortização do principal (fora do resultado) dos juros (despesa financeira).">
        {(fechar) => (
          <FormularioAcao acao={registrarParcelaEmprestimo.bind(null, empresaId)} aoSucesso={fechar} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Descrição" htmlFor="e-desc" className="sm:col-span-2">
                    <Input id="e-desc" name="descricao" placeholder="Ex.: Capital de giro Banco X — parcela 3/24" />
                  </Campo>
                  <Campo rotulo="Vencimento" htmlFor="e-venc" obrigatorio>
                    <Input id="e-venc" name="data_vencimento" type="date" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Conta de débito" htmlFor="e-conta" obrigatorio>
                    <Select id="e-conta" name="conta_id" defaultValue="">
                      <option value="">Selecione...</option>
                      {bancarias.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Amortização do principal" htmlFor="e-princ" obrigatorio erro={estado.erros?.valor_principal}>
                    <CampoValor id="e-princ" name="valor_principal" />
                  </Campo>
                  <Campo rotulo="Juros da parcela" htmlFor="e-juros" erro={estado.erros?.valor_juros}>
                    <CampoValor id="e-juros" name="valor_juros" />
                  </Campo>
                  <Campo rotulo="Já foi paga em (opcional)" htmlFor="e-pago">
                    <Input id="e-pago" name="pago_em" type="date" />
                  </Campo>
                </div>
                <p className="text-xs text-muted-foreground">
                  O valor recebido na contratação do empréstimo deve ser lançado como “Empréstimos e financiamentos recebidos” — não é faturamento.
                </p>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Registrar parcela</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        )}
      </CartaoOperacao>

      <CartaoOperacao icone={Package} titulo="Estoque no fim do mês" descricao="Valor do estoque final (custo), usado no cálculo do custo das mercadorias vendidas.">
        {(fechar) => (
          <FormularioAcao acao={registrarEstoque.bind(null, empresaId)} aoSucesso={fechar} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Competência" htmlFor="s-comp" obrigatorio>
                    <Input id="s-comp" name="competencia" type="month" defaultValue={hoje.slice(0, 7)} />
                  </Campo>
                  <Campo rotulo="Valor do estoque final" htmlFor="s-valor" obrigatorio erro={estado.erros?.valor}>
                    <CampoValor id="s-valor" name="valor" />
                  </Campo>
                  <Campo rotulo="Fonte da informação" htmlFor="s-fonte" className="sm:col-span-2">
                    <Input id="s-fonte" name="fonte" placeholder="Ex.: inventário físico, relatório do sistema de vendas" />
                  </Campo>
                  <Campo rotulo="Observação" htmlFor="s-obs" className="sm:col-span-2">
                    <Textarea id="s-obs" name="observacao" rows={2} />
                  </Campo>
                </div>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        )}
      </CartaoOperacao>
      <div className="rounded-xl border border-dashed border-bege-forte p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Aportes e retiradas dos sócios</p>
        <p className="mt-1">
          Use “Novo lançamento” com as categorias “Aporte de capital dos sócios” (entrada) ou “Distribuição de lucros e retiradas” e “Despesas pessoais dos sócios” (saída).
          Elas ficam fora do resultado e não distorcem a DRE.
        </p>
        <Button asChild variante="link" className="mt-1">
          <a href={`/e/${empresaId}/financeiro/lancamentos/novo`}>Novo lançamento</a>
        </Button>
      </div>
    </div>
  );
}
