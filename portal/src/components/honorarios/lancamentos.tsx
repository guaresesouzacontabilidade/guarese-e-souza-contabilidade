"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { excluirLancamento, salvarCategoria, salvarLancamento } from "@/lib/honorarios/acoes";
import { TIPOS_CATEGORIA_ESCRITORIO, naturezaDoTipo } from "@/lib/honorarios/comum";

export interface CategoriaOpcao {
  id: string;
  codigo: string;
  nome: string;
  tipo: string;
}

export interface LancamentoEdicao {
  id: string;
  natureza: string;
  data: string;
  competencia: string;
  descricao: string;
  valor: number;
  categoria_id: string | null;
  empresa_id: string | null;
  origem: string;
  forma_pagamento: string | null;
}

/** Novo lançamento, edição ou classificação (escolher a linha da DRE). */
export function FormLancamento({
  categorias,
  empresas,
  hoje,
  lancamento,
  rotulo,
  naturezaInicial = "despesa",
}: {
  categorias: CategoriaOpcao[];
  empresas: { id: string; nome: string }[];
  hoje: string;
  lancamento?: LancamentoEdicao;
  rotulo?: string;
  naturezaInicial?: "receita" | "despesa";
}) {
  const [aberto, setAberto] = React.useState(false);
  const [natureza, setNatureza] = React.useState<string>(lancamento?.natureza ?? naturezaInicial);
  const daCobranca = lancamento?.origem === "cobranca";
  const opcoes = categorias.filter((c) => naturezaDoTipo(c.tipo) === natureza);
  const editar = Boolean(lancamento);
  return (
    <>
      {editar ? (
        <Button variante={lancamento?.categoria_id ? "fantasma" : "contorno"} tamanho="sm" onClick={() => setAberto(true)}>
          <Pencil /> {rotulo ?? (lancamento?.categoria_id ? "Editar" : "Classificar")}
        </Button>
      ) : (
        <Button onClick={() => setAberto(true)} variante={naturezaInicial === "receita" ? "contorno" : "primario"}>
          <Plus /> {rotulo ?? "Novo lançamento"}
        </Button>
      )}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo={editar ? (lancamento?.categoria_id ? "Editar lançamento" : "Classificar lançamento") : "Novo lançamento do escritório"}
          descricao="Todo lançamento tem descrição e a linha da DRE. Sem a linha, ele fica em “A classificar” e não entra no resultado."
        >
          <FormularioAcao acao={salvarLancamento} manterAoErrar aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                {lancamento ? <input type="hidden" name="id" value={lancamento.id} /> : null}
                {!daCobranca ? (
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
                    {(["despesa", "receita"] as const).map((n) => (
                      <label key={n} className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-2 text-sm ${natureza === n ? "border-primary bg-secondary font-medium" : "border-border"}`}>
                        <input type="radio" name="natureza" value={n} checked={natureza === n} onChange={() => setNatureza(n)} className="sr-only" />
                        {n === "despesa" ? "Saída (despesa)" : "Entrada (receita)"}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input type="hidden" name="natureza" value={natureza} />
                )}
                <Campo rotulo="Descrição" htmlFor="lanc-desc" erro={estado.erros?.descricao} obrigatorio ajuda="Como vai aparecer no detalhe da DRE. Ex.: Aluguel da sala — novembro.">
                  <Input id="lanc-desc" name="descricao" maxLength={300} defaultValue={lancamento?.descricao} />
                </Campo>
                <Campo rotulo="Linha da DRE" htmlFor="lanc-cat" erro={estado.erros?.categoria_id}>
                  <Select id="lanc-cat" name="categoria_id" defaultValue={lancamento?.categoria_id ?? ""} key={natureza}>
                    <option value="">A classificar depois</option>
                    {opcoes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {!daCobranca ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Campo rotulo="Data" htmlFor="lanc-data" erro={estado.erros?.data} obrigatorio>
                        <Input id="lanc-data" name="data" type="date" defaultValue={lancamento?.data ?? hoje} />
                      </Campo>
                      <Campo rotulo="Mês de referência" htmlFor="lanc-comp" ajuda="Vazio = mês da data.">
                        <Input id="lanc-comp" name="competencia" type="month" defaultValue={lancamento?.competencia.slice(0, 7) ?? ""} />
                      </Campo>
                      <Campo rotulo="Valor" htmlFor="lanc-valor" erro={estado.erros?.valor} obrigatorio>
                        <CampoValor id="lanc-valor" name="valor" valorInicial={lancamento?.valor ?? null} />
                      </Campo>
                    </div>
                    {natureza === "receita" ? (
                      <Campo rotulo="Cliente (opcional)" htmlFor="lanc-empresa">
                        <Select id="lanc-empresa" name="empresa_id" defaultValue={lancamento?.empresa_id ?? ""}>
                          <option value="">—</option>
                          {empresas.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.nome}
                            </option>
                          ))}
                        </Select>
                      </Campo>
                    ) : null}
                  </>
                ) : (
                  <input type="hidden" name="data" value={lancamento?.data} />
                )}
                {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
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

export function ExcluirLancamento({ id }: { id: string }) {
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="iconeSm"
      aria-label="Excluir lançamento"
      acao={() => excluirLancamento(id)}
      confirmar={{ titulo: "Excluir este lançamento?", descricao: "Ele sai da DRE do escritório.", textoConfirmar: "Excluir", perigo: true }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}

/** Nova linha no plano de contas do escritório. */
export function NovaCategoria() {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="contorno" tamanho="sm" onClick={() => setAberto(true)}>
        <Plus /> Nova linha da DRE
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Nova linha da DRE" descricao="Use um código que siga o grupo (ex.: 4.09 para mais uma despesa do escritório).">
          <FormularioAcao acao={salvarCategoria} manterAoErrar aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-[100px_1fr]">
                  <Campo rotulo="Código" htmlFor="cat-codigo" erro={estado.erros?.codigo} obrigatorio>
                    <Input id="cat-codigo" name="codigo" maxLength={10} placeholder="4.09" />
                  </Campo>
                  <Campo rotulo="Nome" htmlFor="cat-nome" erro={estado.erros?.nome} obrigatorio>
                    <Input id="cat-nome" name="nome" maxLength={120} />
                  </Campo>
                </div>
                <Campo rotulo="Grupo da DRE" htmlFor="cat-tipo" erro={estado.erros?.tipo} obrigatorio>
                  <Select id="cat-tipo" name="tipo" defaultValue="despesa_operacional">
                    {Object.entries(TIPOS_CATEGORIA_ESCRITORIO).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
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
