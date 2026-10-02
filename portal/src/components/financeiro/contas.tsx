"use client";

import { useState } from "react";
import { Landmark, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { TIPOS_CONTA } from "@/lib/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { salvarConta } from "@/lib/financeiro/acoes-cadastros";

export interface ContaFinanceira {
  id: string;
  tipo: string;
  nome: string;
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  numero: string | null;
  saldo_inicial: number;
  saldo_inicial_data: string;
  cartao_dia_fechamento: number | null;
  cartao_dia_vencimento: number | null;
  cartao_conta_pagamento_id: string | null;
  limite: number | null;
  compoe_saldo_disponivel: boolean;
  ativa: boolean;
  observacoes: string | null;
}

export function FormularioConta({
  empresaId,
  conta,
  contas,
  aoSalvar,
}: {
  empresaId: string;
  conta?: ContaFinanceira | null;
  contas: ContaFinanceira[];
  aoSalvar?: () => void;
}) {
  const [tipo, setTipo] = useState(conta?.tipo ?? "conta_corrente");
  const acao = salvarConta.bind(null, empresaId);
  const bancarias = contas.filter((c) => c.id !== conta?.id && ["conta_corrente", "poupanca"].includes(c.tipo));
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          {conta ? <input type="hidden" name="id" value={conta.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Tipo" htmlFor="conta-tipo">
              <Select id="conta-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(TIPOS_CONTA).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Nome de identificação" htmlFor="conta-nome" obrigatorio erro={estado.erros?.nome}>
              <Input id="conta-nome" name="nome" defaultValue={conta?.nome ?? ""} placeholder="Ex.: Banco do Brasil 1234-5" />
            </Campo>
            {["conta_corrente", "poupanca", "investimento", "cartao_credito"].includes(tipo) ? (
              <>
                <Campo rotulo="Banco" htmlFor="conta-banco">
                  <Input id="conta-banco" name="banco_nome" defaultValue={conta?.banco_nome ?? ""} placeholder="Ex.: Banco do Brasil" />
                </Campo>
                <div className="grid grid-cols-3 gap-2">
                  <Campo rotulo="Cód." htmlFor="conta-cod">
                    <Input id="conta-cod" name="banco_codigo" defaultValue={conta?.banco_codigo ?? ""} placeholder="001" />
                  </Campo>
                  <Campo rotulo="Agência" htmlFor="conta-ag">
                    <Input id="conta-ag" name="agencia" defaultValue={conta?.agencia ?? ""} />
                  </Campo>
                  <Campo rotulo={tipo === "cartao_credito" ? "Final" : "Conta"} htmlFor="conta-num">
                    <Input id="conta-num" name="numero" defaultValue={conta?.numero ?? ""} />
                  </Campo>
                </div>
              </>
            ) : null}
            <Campo
              rotulo={tipo === "cartao_credito" ? "Saldo devedor inicial (negativo)" : "Saldo inicial"}
              htmlFor="conta-saldo"
              erro={estado.erros?.saldo_inicial}
              ajuda="Saldo ao final do dia de referência."
            >
              <CampoValor id="conta-saldo" name="saldo_inicial" valorInicial={conta?.saldo_inicial ?? ""} permitirNegativo />
            </Campo>
            <Campo rotulo="Data de referência do saldo" htmlFor="conta-data" obrigatorio erro={estado.erros?.saldo_inicial_data}>
              <Input id="conta-data" name="saldo_inicial_data" type="date" defaultValue={conta?.saldo_inicial_data ?? ""} />
            </Campo>
            {tipo === "cartao_credito" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="Dia do fechamento" htmlFor="conta-fech">
                    <Input id="conta-fech" name="cartao_dia_fechamento" type="number" min={1} max={31} defaultValue={conta?.cartao_dia_fechamento ?? ""} />
                  </Campo>
                  <Campo rotulo="Dia do vencimento" htmlFor="conta-venc">
                    <Input id="conta-venc" name="cartao_dia_vencimento" type="number" min={1} max={31} defaultValue={conta?.cartao_dia_vencimento ?? ""} />
                  </Campo>
                </div>
                <Campo rotulo="Conta que paga a fatura" htmlFor="conta-pag">
                  <Select id="conta-pag" name="cartao_conta_pagamento_id" defaultValue={conta?.cartao_conta_pagamento_id ?? ""}>
                    <option value="">Não definida</option>
                    {bancarias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Limite" htmlFor="conta-limite" erro={estado.erros?.limite}>
                  <CampoValor id="conta-limite" name="limite" valorInicial={conta?.limite ?? ""} />
                </Campo>
              </>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                name="compoe_saldo_disponivel"
                defaultChecked={conta ? conta.compoe_saldo_disponivel : !["cartao_credito", "adquirente"].includes(tipo)}
                key={tipo}
              />
              Compõe o saldo disponível
            </label>
            {conta ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="hidden" name="ativa" value="false" />
                <Checkbox name="ativa" defaultChecked={conta.ativa} value="true" />
                Conta ativa
              </label>
            ) : null}
          </div>
          {tipo === "cartao_credito" ? (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Compras no cartão são despesas na data da compra. O pagamento da fatura é registrado como transferência da conta bancária para o cartão —
              assim a despesa nunca é contada duas vezes.
            </p>
          ) : null}
          {tipo === "adquirente" ? (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Use para maquininhas e plataformas de pagamento. As vendas registram o valor bruto como receita e a taxa como despesa financeira; o valor líquido é o que entra na conta.
            </p>
          ) : null}
          <Campo rotulo="Observações" htmlFor="conta-obs">
            <Textarea id="conta-obs" name="observacoes" defaultValue={conta?.observacoes ?? ""} rows={2} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{conta ? "Salvar conta" : "Cadastrar conta"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function ListaContas({
  empresaId,
  contas,
  saldos,
  podeEditar,
}: {
  empresaId: string;
  contas: ContaFinanceira[];
  saldos?: Record<string, number | null>;
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState<ContaFinanceira | "nova" | null>(null);
  return (
    <div className="space-y-3">
      {podeEditar ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditando("nova")}>
            <Plus /> Nova conta
          </Button>
        </div>
      ) : null}
      {contas.length === 0 ? (
        <EstadoVazio
          icone={Landmark}
          titulo="Nenhuma conta cadastrada"
          descricao="Cadastre as contas bancárias, o caixa, os cartões de crédito e as maquininhas da empresa, com o saldo inicial e a data de referência."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Conta</Th>
              <Th className="hidden sm:table-cell">Tipo</Th>
              <Th className="hidden md:table-cell">Saldo inicial</Th>
              {saldos ? <Th className="text-right">Saldo atual (sistema)</Th> : null}
              <Th>Situação</Th>
              {podeEditar ? <Th className="w-10" /> : null}
            </tr>
          </THead>
          <TBody>
            {contas.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {[c.banco_nome, c.agencia && `ag. ${c.agencia}`, c.numero && `conta ${c.numero}`].filter(Boolean).join(" · ") || "—"}
                  </p>
                </Td>
                <Td className="hidden text-sm sm:table-cell">{TIPOS_CONTA[c.tipo]}</Td>
                <Td className="hidden text-sm md:table-cell">
                  <span className="numero">{formatarMoeda(c.saldo_inicial)}</span>
                  <span className="block text-xs text-muted-foreground">em {formatarData(c.saldo_inicial_data)}</span>
                </Td>
                {saldos ? (
                  <Td className="text-right font-medium numero">{saldos[c.id] == null ? "—" : formatarMoeda(saldos[c.id])}</Td>
                ) : null}
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {c.ativa ? <Badge variante="sucesso">Ativa</Badge> : <Badge>Inativa</Badge>}
                    {!c.compoe_saldo_disponivel ? <Badge variante="contorno">Fora do disponível</Badge> : null}
                  </div>
                </Td>
                {podeEditar ? (
                  <Td>
                    <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar ${c.nome}`} onClick={() => setEditando(c)}>
                      <Pencil />
                    </Button>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando !== null ? (
          <DialogContent largura="lg" titulo={editando === "nova" ? "Nova conta financeira" : `Editar ${editando.nome}`}>
            <FormularioConta
              empresaId={empresaId}
              conta={editando === "nova" ? null : editando}
              contas={contas}
              aoSalvar={() => setEditando(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
