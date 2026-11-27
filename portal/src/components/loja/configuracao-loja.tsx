"use client";

import * as React from "react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { salvarConfiguracaoLoja } from "@/lib/gestao/acoes";
import { DOCUMENTO_FISCAL, FORMAS_COM_REGRA_DE_NOTA, FORMAS_PAGAMENTO, PERFIS_FISCAIS, formatarQuantidade } from "@/lib/gestao/rotulos";
import { MODALIDADES_GESTAO } from "@/lib/gestao/carregamentos";

export interface ConfigLoja {
  ativa: boolean;
  modalidade: "loja" | "notas" | "hotel" | "veterinaria" | "fisioterapia";
  perfil_fiscal: string;
  permitir_estoque_negativo: boolean;
  permitir_venda_prazo: boolean;
  desconto_maximo_operador: string | null;
  validade_orcamento_dias: number;
  mensagem_comprovante: string | null;
  conta_dinheiro_id: string | null;
  conta_pix_id: string | null;
  conta_cartao_id: string | null;
  nfe_operacao_id: string | null;
  nfe_emitente_id: string | null;
  nfe_marcada_padrao: boolean;
  nfce_operacao_id?: string | null;
  documento_padrao?: "nfe" | "nfce";
  /** Regra do escritório: formas de pagamento em que a venda sai com nota fiscal */
  nota_obrigatoria_formas?: string[];
  balanca_etiqueta?: string | null;
  balanca_digitos_codigo?: number;
}

export interface OpcoesNfeLoja {
  /** modelos: para quais notas a operação serve ("nfe" e/ou "nfce") */
  operacoes: { id: string; nome: string; cfop: string; modelos: string[] }[];
  emitentes: { id: string; nome: string; inscricao: string; serie: number; nfceSerie: number | null }[];
  ativa: boolean;
  /** Cupom fiscal (NFC-e) ligado pelo escritório */
  nfceAtiva: boolean;
}

export function FormConfigLoja({
  empresaId,
  config,
  contas,
  equipe,
  nfe,
}: {
  empresaId: string;
  config: ConfigLoja | null;
  contas: { id: string; nome: string; tipo: string }[];
  equipe: boolean;
  /** Opções da NF-e da empresa (null quando a empresa não tem a emissão de NF-e configurada). */
  nfe: OpcoesNfeLoja | null;
}) {
  const c = config;
  const [modalidade, setModalidade] = React.useState<"loja" | "notas" | "hotel" | "veterinaria" | "fisioterapia">(c?.modalidade ?? "loja");
  const notas = modalidade === "notas";
  const hotel = modalidade === "hotel";
  const clinica = modalidade === "veterinaria";
  const fisio = modalidade === "fisioterapia";
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
                  <strong>Gestão ligada para esta empresa</strong>
                  <span className="block text-muted-foreground">
                    {notas
                      ? "Libera as ordens de carregamento ligadas à NF-e. Não cria caixa nem contas da loja."
                      : hotel
                        ? "Libera reservas, quartos, check-in e check-out, a conta do hóspede e o restaurante e bar (caixa, produtos e estoque). Ao ligar, o portal cria as contas “Caixa da recepção”, “Banco (PIX e transferências)” e “Maquininha de cartão” no Financeiro, se ainda não existirem."
                        : fisio
                          ? "Libera a agenda dos fisioterapeutas, os pacientes, o prontuário (avaliação, evolução de cada sessão e alta, que só os fisioterapeutas leem), os pacotes de sessões, os recebimentos e o repasse. Ao ligar, o portal cria as contas “Caixa da clínica”, “Banco (PIX e transferências)” e “Maquininha de cartão” no Financeiro, se ainda não existirem."
                          : clinica
                          ? "Libera a agenda, os tutores e animais, o prontuário, as receitas, as vacinas com lembretes, os atestados e as contas da clínica, além do pet shop (caixa, produtos e estoque). Ao ligar, o portal cria as contas “Caixa da clínica”, “Banco (PIX e transferências)” e “Maquininha de cartão” no Financeiro, se ainda não existirem."
                          : "Libera o caixa, as vendas, o estoque e os orçamentos. Ao ligar, o portal cria as contas “Caixa da loja”, “Banco (PIX e transferências)” e “Maquininha de cartão” no Financeiro, se ainda não existirem."}
                  </span>
                </span>
              </label>
              <Campo
                rotulo="Modalidade"
                htmlFor="modalidade"
                ajuda="Notas e transporte: para quem vende grãos e só precisa das notas e dos carregamentos. Hotel: para hotéis e pousadas (reservas, quartos, conta do hóspede e restaurante). Clínica veterinária: agenda, prontuário, receitas, vacinas e contas. Clínica de fisioterapia: agenda, pacientes, avaliação e evolução, pacotes e recebimentos."
              >
                <Select
                  id="modalidade"
                  name="modalidade"
                  value={modalidade}
                  onChange={(e) =>
                    setModalidade(
                      e.target.value === "notas" || e.target.value === "hotel" || e.target.value === "veterinaria" || e.target.value === "fisioterapia" ? e.target.value : "loja",
                    )
                  }
                >
                  {Object.entries(MODALIDADES_GESTAO).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
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

          {notas ? (
            <section className="space-y-4">
              <h2 className="font-semibold">Ordem de carregamento</h2>
              <Campo rotulo="Mensagem no rodapé da ordem impressa" htmlFor="mensagem_comprovante" ajuda="Ex.: horário do armazém, uso obrigatório de lona, telefone da balança.">
                <Textarea id="mensagem_comprovante" name="mensagem_comprovante" rows={3} maxLength={500} defaultValue={c?.mensagem_comprovante ?? ""} />
              </Campo>
            </section>
          ) : (
            <>
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo
                    rotulo="Etiqueta da balança"
                    htmlFor="balanca_etiqueta"
                    ajuda="Para balança que imprime etiqueta com código de barras (começa com 2): o caixa lê a etiqueta e já põe o produto com o peso ou o preço."
                  >
                    <Select id="balanca_etiqueta" name="balanca_etiqueta" defaultValue={c?.balanca_etiqueta ?? ""}>
                      <option value="">Não uso etiqueta da balança</option>
                      <option value="preco">A etiqueta traz o preço total</option>
                      <option value="peso">A etiqueta traz o peso</option>
                    </Select>
                  </Campo>
                  <Campo rotulo="Dígitos do código do produto na etiqueta" htmlFor="balanca_digitos_codigo" ajuda="Veja na configuração da balança (o mais comum é 4).">
                    <Select id="balanca_digitos_codigo" name="balanca_digitos_codigo" defaultValue={String(c?.balanca_digitos_codigo ?? 4)}>
                      <option value="4">4 dígitos</option>
                      <option value="5">5 dígitos</option>
                      <option value="6">6 dígitos</option>
                    </Select>
                  </Campo>
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="font-semibold">{hotel ? "Para onde vai o dinheiro (hospedagens e restaurante)" : clinica ? "Para onde vai o dinheiro (atendimentos e pet shop)" : "Para onde vai o dinheiro de cada venda"}</h2>
                <p className="text-sm text-muted-foreground">
                  {hotel
                    ? "Os pagamentos das hospedagens e as vendas do restaurante entram como recebidos nestas contas do Financeiro (a contabilidade recebe tudo pronto). O faturado para empresas vira conta a receber."
                    : "As vendas à vista entram como recebidas nestas contas do Financeiro (a contabilidade recebe tudo pronto). As vendas a prazo viram contas a receber."}
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
            </>
          )}

          {nfe ? <SecaoNotaFiscal nfe={nfe} c={c} notas={notas} /> : null}

          {!notas ? <SecaoRegraCartao c={c} equipe={equipe} temNota={Boolean(nfe && (nfe.ativa || nfe.nfceAtiva))} /> : null}

          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar configurações</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

function SecaoNotaFiscal({ nfe, c, notas }: { nfe: OpcoesNfeLoja; c: ConfigLoja | null; notas: boolean }) {
  const opsNfe = nfe.operacoes.filter((o) => o.modelos.includes("nfe"));
  const opsNfce = nfe.operacoes.filter((o) => o.modelos.includes("nfce"));
  const automatica = (lista: { nome: string }[]) => (lista.length === 1 ? `Automática (${lista[0].nome})` : "Escolha...");
  return (
    <section className="space-y-4" data-testid="secao-nota-fiscal">
      <h2 className="font-semibold">{notas ? "NF-e das ordens de carregamento" : "Nota fiscal na hora da venda"}</h2>
      <p className="text-sm text-muted-foreground">
        {notas ? (
          "A nota da ordem sai com esta inscrição e esta operação quando a ordem não escolher outras."
        ) : (
          <>
            No caixa, a caixa <strong>Emitir nota fiscal</strong> envia à SEFAZ o cupom fiscal (NFC-e) ou a NF-e assim que a venda é concluída, com os itens, o
            desconto e os pagamentos da venda.
          </>
        )}
        {nfe.ativa ? "" : notas ? " A emissão de NF-e desta empresa ainda está desligada: a nota é liberada quando o escritório ligar." : " A NF-e desta empresa ainda está desligada."}
        {!notas && !nfe.nfceAtiva ? " O cupom fiscal (NFC-e) ainda não foi ligado pelo escritório." : ""}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Operação da NF-e (regras fiscais)" htmlFor="nfe_operacao_id" ajuda="Só as operações marcadas para Nota fiscal (cadastradas pelo escritório).">
          <Select id="nfe_operacao_id" name="nfe_operacao_id" defaultValue={c?.nfe_operacao_id ?? ""}>
            <option value="">{automatica(opsNfe)}</option>
            {opsNfe.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome} — CFOP {o.cfop}
              </option>
            ))}
          </Select>
        </Campo>
        {notas ? null : (
          <Campo rotulo="Operação do cupom fiscal (NFC-e)" htmlFor="nfce_operacao_id" ajuda="Só as operações marcadas para Cupom fiscal.">
            <Select id="nfce_operacao_id" name="nfce_operacao_id" defaultValue={c?.nfce_operacao_id ?? ""}>
              <option value="">{opsNfce.length ? automatica(opsNfce) : "Nenhuma operação de cupom cadastrada"}</option>
              {opsNfce.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome} — CFOP {o.cfop}
                </option>
              ))}
            </Select>
          </Campo>
        )}
        <Campo rotulo="Quem emite (inscrição e série)" htmlFor="nfe_emitente_id">
          <Select id="nfe_emitente_id" name="nfe_emitente_id" defaultValue={c?.nfe_emitente_id ?? ""}>
            <option value="">{nfe.emitentes.length === 1 ? `Automático (${nfe.emitentes[0].nome})` : "Escolha..."}</option>
            {nfe.emitentes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome} — IE {e.inscricao} · série {e.serie}
                {e.nfceSerie != null ? ` · cupom série ${e.nfceSerie}` : ""}
              </option>
            ))}
          </Select>
        </Campo>
        {notas ? null : (
          <Campo rotulo="Nota que o caixa já deixa escolhida" htmlFor="documento_padrao">
            <Select id="documento_padrao" name="documento_padrao" defaultValue={c?.documento_padrao ?? "nfe"}>
              <option value="nfce">{DOCUMENTO_FISCAL.nfce.longo}</option>
              <option value="nfe">{DOCUMENTO_FISCAL.nfe.longo}</option>
            </Select>
          </Campo>
        )}
      </div>
      {notas ? null : (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox name="nfe_marcada_padrao" defaultChecked={c?.nfe_marcada_padrao ?? false} className="mt-0.5" />
          <span>
            Deixar &quot;Emitir nota fiscal&quot; já marcado em toda venda
            <span className="block text-muted-foreground">Para quem emite nota em quase todas as vendas. Dá para desmarcar na hora, venda por venda.</span>
          </span>
        </label>
      )}
    </section>
  );
}

/** Regra do escritório: no cartão (crédito e/ou débito), a venda sai com nota. Só o escritório muda. */
function SecaoRegraCartao({ c, equipe, temNota }: { c: ConfigLoja | null; equipe: boolean; temNota: boolean }) {
  const atuais = c?.nota_obrigatoria_formas ?? [];
  return (
    <section className="space-y-3" data-testid="regra-cartao">
      <h2 className="font-semibold">Nota fiscal no cartão</h2>
      <p className="text-sm text-muted-foreground">
        Com a regra ligada, a venda paga com a forma marcada só conclui com nota fiscal (cupom ou NF-e). Vale também quando o pagamento é dividido.
        {equipe ? "" : " Só o escritório liga ou desliga esta regra."}
      </p>
      {equipe ? <input type="hidden" name="regra_cartao" value="1" /> : null}
      <div className="flex flex-wrap gap-4">
        {FORMAS_COM_REGRA_DE_NOTA.map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm">
            <Checkbox name="nota_obrigatoria_formas" value={f} defaultChecked={atuais.includes(f)} disabled={!equipe} />
            Exigir nota no {FORMAS_PAGAMENTO[f].toLowerCase()}
          </label>
        ))}
      </div>
      {equipe && !temNota ? (
        <Alerta tom="alerta">Nenhuma nota está ligada nesta empresa: com a regra ligada, a venda no cartão fica impedida. Ligue o cupom fiscal ou a NF-e antes.</Alerta>
      ) : null}
    </section>
  );
}
