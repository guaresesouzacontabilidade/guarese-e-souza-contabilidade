"use client";

import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { salvarConfiguracaoLoja } from "@/lib/gestao/acoes";
import { PERFIS_FISCAIS, formatarQuantidade } from "@/lib/gestao/rotulos";

export interface ConfigLoja {
  ativa: boolean;
  perfil_fiscal: string;
  permitir_estoque_negativo: boolean;
  permitir_venda_prazo: boolean;
  desconto_maximo_operador: string | null;
  validade_orcamento_dias: number;
  mensagem_comprovante: string | null;
  conta_dinheiro_id: string | null;
  conta_pix_id: string | null;
  conta_cartao_id: string | null;
}

export function FormConfigLoja({
  empresaId,
  config,
  contas,
  equipe,
}: {
  empresaId: string;
  config: ConfigLoja | null;
  contas: { id: string; nome: string; tipo: string }[];
  equipe: boolean;
}) {
  const c = config;
  const opcoesConta = (atual: string | null) => (
    <>
      {!atual ? <option value="">Criar automaticamente</option> : null}
      {contas.map((x) => (
        <option key={x.id} value={x.id}>
          {x.nome}
        </option>
      ))}
    </>
  );
  return (
    <FormularioAcao acao={salvarConfiguracaoLoja.bind(null, empresaId)} className="space-y-6">
      {({ pendente }) => (
        <>
          {equipe ? (
            <section className="space-y-4 rounded-xl border border-border p-4">
              <h2 className="font-semibold">Contratação (só o escritório altera)</h2>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="ativa" defaultChecked={c?.ativa ?? false} className="mt-0.5" />
                <span>
                  <strong>Gestão da loja ligada para esta empresa</strong>
                  <span className="block text-muted-foreground">
                    Libera o caixa, as vendas, o estoque e os orçamentos. Ao ligar, o portal cria as contas “Caixa da loja”, “Banco (PIX e transferências)” e
                    “Maquininha de cartão” no Financeiro, se ainda não existirem.
                  </span>
                </span>
              </label>
              <Campo rotulo="Como a empresa emite nota" htmlFor="perfil_fiscal">
                <Select id="perfil_fiscal" name="perfil_fiscal" defaultValue={c?.perfil_fiscal ?? "comercio"}>
                  {Object.entries(PERFIS_FISCAIS).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
            </section>
          ) : null}

          <section className="space-y-4">
            <h2 className="font-semibold">Vendas</h2>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="permitir_venda_prazo" defaultChecked={c?.permitir_venda_prazo ?? true} className="mt-0.5" />
              <span>
                Permitir venda a prazo (fiado/crediário)
                <span className="block text-muted-foreground">Cada parcela vira uma conta a receber no Financeiro, com o nome do cliente.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="permitir_estoque_negativo" defaultChecked={c?.permitir_estoque_negativo ?? false} className="mt-0.5" />
              <span>
                Permitir vender sem estoque no sistema
                <span className="block text-muted-foreground">Útil enquanto o estoque inicial ainda não foi lançado. Depois, deixe desligado.</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Desconto máximo do vendedor (%)" htmlFor="desconto_maximo_operador" ajuda="Em branco: sem limite. O gerente pode dar qualquer desconto.">
                <Input id="desconto_maximo_operador" name="desconto_maximo_operador" defaultValue={c?.desconto_maximo_operador ? formatarQuantidade(c.desconto_maximo_operador, 2) : ""} inputMode="decimal" />
              </Campo>
              <Campo rotulo="Validade do orçamento (dias)" htmlFor="validade_orcamento_dias">
                <Input id="validade_orcamento_dias" name="validade_orcamento_dias" type="number" min={1} max={180} defaultValue={c?.validade_orcamento_dias ?? 15} />
              </Campo>
            </div>
            <Campo rotulo="Mensagem no rodapé do comprovante" htmlFor="mensagem_comprovante" ajuda="Ex.: horário de funcionamento, política de troca, chave PIX.">
              <Textarea id="mensagem_comprovante" name="mensagem_comprovante" rows={3} maxLength={500} defaultValue={c?.mensagem_comprovante ?? ""} />
            </Campo>
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold">Para onde vai o dinheiro de cada venda</h2>
            <p className="text-sm text-muted-foreground">
              As vendas à vista entram como recebidas nestas contas do Financeiro (a contabilidade recebe tudo pronto). As vendas a prazo viram contas a receber.
            </p>
            {contas.length || c?.ativa ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Dinheiro" htmlFor="conta_dinheiro_id">
                  <Select id="conta_dinheiro_id" name="conta_dinheiro_id" defaultValue={c?.conta_dinheiro_id ?? ""}>
                    {opcoesConta(c?.conta_dinheiro_id ?? null)}
                  </Select>
                </Campo>
                <Campo rotulo="PIX" htmlFor="conta_pix_id">
                  <Select id="conta_pix_id" name="conta_pix_id" defaultValue={c?.conta_pix_id ?? ""}>
                    {opcoesConta(c?.conta_pix_id ?? null)}
                  </Select>
                </Campo>
                <Campo rotulo="Cartão (débito e crédito)" htmlFor="conta_cartao_id">
                  <Select id="conta_cartao_id" name="conta_cartao_id" defaultValue={c?.conta_cartao_id ?? ""}>
                    {opcoesConta(c?.conta_cartao_id ?? null)}
                  </Select>
                </Campo>
              </div>
            ) : (
              <Alerta tom="info">As contas são criadas automaticamente quando a gestão da loja for ligada.</Alerta>
            )}
          </section>

          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar configurações</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
