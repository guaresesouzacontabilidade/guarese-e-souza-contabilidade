"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { CampoValor } from "@/components/ui/campo-valor";
import { TIPOS_CATEGORIA } from "@/lib/rotulos";
import { salvarLancamento } from "@/lib/financeiro/acoes-lancamentos";
import { salvarContraparte } from "@/lib/financeiro/acoes-cadastros";

export interface OpcoesLancamento {
  categorias: { id: string; codigo: string; nome: string; natureza: string; tipo: string }[];
  contrapartes: { id: string; nome: string }[];
  centros: { id: string; nome: string }[];
  projetos: { id: string; nome: string }[];
  contas: { id: string; nome: string; tipo: string }[];
}

export interface ValoresLancamento {
  id?: string;
  tipo: "receber" | "pagar";
  descricao: string;
  categoria_id: string;
  contraparte_id: string;
  centro_custo_id: string;
  projeto_id: string;
  conta_financeira_id: string;
  data_competencia: string;
  data_vencimento: string;
  valor: string;
  numero_documento: string;
  observacoes: string;
  documento_id?: string;
}

export function FormularioLancamento({ empresaId, opcoes, valores, base }: { empresaId: string; opcoes: OpcoesLancamento; valores: ValoresLancamento; base: string }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"receber" | "pagar">(valores.tipo);
  const [modo, setModo] = useState<"unico" | "parcelado" | "recorrente">("unico");
  const [jaPago, setJaPago] = useState(false);
  const [contrapartes, setContrapartes] = useState(opcoes.contrapartes);
  const [contraparte, setContraparte] = useState(valores.contraparte_id);
  const [novaContraparte, setNovaContraparte] = useState(false);
  const edicao = Boolean(valores.id);
  const natureza = tipo === "receber" ? "receita" : "despesa";
  const categorias = useMemo(() => opcoes.categorias.filter((c) => c.natureza === natureza), [opcoes.categorias, natureza]);
  const grupos = useMemo(() => {
    const g = new Map<string, typeof categorias>();
    for (const c of categorias) {
      const t = TIPOS_CATEGORIA[c.tipo];
      const nome = t ? (t.dre ? t.grupo : "Fora do resultado (não entra na DRE)") : "Outras";
      g.set(nome, [...(g.get(nome) ?? []), c]);
    }
    return [...g.entries()];
  }, [categorias]);
  const contasPagamento = opcoes.contas.filter((c) => c.tipo !== "cartao_credito" && c.tipo !== "adquirente");

  return (
    <>
      <FormularioAcao
        acao={salvarLancamento.bind(null, empresaId)}
        atualizarAoSucesso={false}
        aoSucesso={(e) => {
          const id = (e.dados as { id?: string } | undefined)?.id;
          router.push(id ? `${base}/${id}` : base);
          router.refresh();
        }}
        className="space-y-5"
      >
        {({ estado, pendente }) => (
          <>
            {valores.id ? <input type="hidden" name="id" value={valores.id} /> : null}
            {valores.documento_id ? <input type="hidden" name="documento_id" value={valores.documento_id} /> : null}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Tipo</legend>
              <div className="flex flex-wrap gap-2">
                {(["receber", "pagar"] as const).map((t) => (
                  <label
                    key={t}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm ${tipo === t ? "border-primary bg-bege font-semibold" : "border-border"}`}
                  >
                    <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="accent-[var(--primary)]" />
                    {t === "receber" ? "Conta a receber (entrada)" : "Conta a pagar (saída)"}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Descrição" htmlFor="l-desc" obrigatorio erro={estado.erros?.descricao} className="md:col-span-2">
                <Input id="l-desc" name="descricao" defaultValue={valores.descricao} maxLength={300} placeholder={tipo === "receber" ? "Ex.: venda para Cliente X" : "Ex.: aluguel da loja"} />
              </Campo>
              <Campo
                rotulo="Categoria"
                htmlFor="l-cat"
                obrigatorio
                erro={estado.erros?.categoria_id}
                ajuda="Aportes, empréstimos recebidos, amortizações e retiradas ficam fora do resultado (não são receita nem despesa)."
              >
                <Select id="l-cat" name="categoria_id" defaultValue={valores.categoria_id} key={tipo}>
                  <option value="">Selecione...</option>
                  {grupos.map(([g, itens]) => (
                    <optgroup key={g} label={g}>
                      {itens.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} {c.nome}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo={tipo === "receber" ? "Cliente / pagador" : "Fornecedor / beneficiário"} htmlFor="l-contra">
                <div className="flex gap-2">
                  <Select id="l-contra" name="contraparte_id" value={contraparte} onChange={(e) => setContraparte(e.target.value)}>
                    <option value="">—</option>
                    {contrapartes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                  <Button type="button" variante="contorno" tamanho="icone" aria-label="Cadastrar novo" onClick={() => setNovaContraparte(true)}>
                    <UserPlus />
                  </Button>
                </div>
              </Campo>
              <Campo rotulo="Competência" htmlFor="l-comp" obrigatorio erro={estado.erros?.data_competencia} ajuda="Quando a receita/despesa aconteceu (base da DRE).">
                <Input id="l-comp" name="data_competencia" type="date" defaultValue={valores.data_competencia} />
              </Campo>
              <Campo rotulo={modo === "parcelado" ? "Vencimento da 1ª parcela" : modo === "recorrente" ? "Primeiro vencimento" : "Vencimento"} htmlFor="l-venc" obrigatorio erro={estado.erros?.data_vencimento} ajuda="Quando o dinheiro deve entrar/sair (base do fluxo de caixa).">
                <Input id="l-venc" name="data_vencimento" type="date" defaultValue={valores.data_vencimento} />
              </Campo>
              <Campo rotulo={modo === "parcelado" ? "Valor total" : "Valor"} htmlFor="l-valor" obrigatorio erro={estado.erros?.valor}>
                <CampoValor id="l-valor" name="valor" valorInicial={valores.valor} />
              </Campo>
              <Campo rotulo="Conta prevista" htmlFor="l-conta" ajuda="Conta em que o valor deve entrar/sair (opcional).">
                <Select id="l-conta" name="conta_financeira_id" defaultValue={valores.conta_financeira_id}>
                  <option value="">—</option>
                  {opcoes.contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Centro de custo" htmlFor="l-cc">
                <Select id="l-cc" name="centro_custo_id" defaultValue={valores.centro_custo_id}>
                  <option value="">—</option>
                  {opcoes.centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Projeto" htmlFor="l-proj">
                <Select id="l-proj" name="projeto_id" defaultValue={valores.projeto_id}>
                  <option value="">—</option>
                  {opcoes.projetos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Nº do documento" htmlFor="l-num" ajuda="Nota fiscal, boleto, contrato...">
                <Input id="l-num" name="numero_documento" defaultValue={valores.numero_documento} maxLength={100} />
              </Campo>
              <Campo rotulo="Observações" htmlFor="l-obs" className="md:col-span-2">
                <Textarea id="l-obs" name="observacoes" defaultValue={valores.observacoes} rows={2} />
              </Campo>
            </div>

            {!edicao ? (
              <fieldset className="space-y-3 rounded-lg border border-border p-4">
                <legend className="px-1 text-sm font-medium">Repetição</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(
                    [
                      ["unico", "Único"],
                      ["parcelado", "Parcelado"],
                      ["recorrente", "Recorrente (mensalidade, aluguel...)"],
                    ] as const
                  ).map(([v, r]) => (
                    <label key={v} className="inline-flex items-center gap-2">
                      <input type="radio" name="modo" value={v} checked={modo === v} onChange={() => setModo(v)} className="accent-[var(--primary)]" /> {r}
                    </label>
                  ))}
                </div>
                {modo === "parcelado" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Número de parcelas" htmlFor="l-parc" erro={estado.erros?.parcelas} ajuda="Os centavos de diferença ficam na última parcela.">
                      <Input id="l-parc" name="parcelas" type="number" min={2} max={360} defaultValue={2} />
                    </Campo>
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <Checkbox name="competencia_por_parcela" /> Competência de cada parcela no mês do vencimento
                    </label>
                  </div>
                ) : null}
                {modo === "recorrente" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="Frequência" htmlFor="l-freq" erro={estado.erros?.frequencia}>
                      <Select id="l-freq" name="frequencia" defaultValue="mensal">
                        <option value="semanal">Semanal</option>
                        <option value="quinzenal">Quinzenal</option>
                        <option value="mensal">Mensal</option>
                        <option value="bimestral">Bimestral</option>
                        <option value="trimestral">Trimestral</option>
                        <option value="semestral">Semestral</option>
                        <option value="anual">Anual</option>
                      </Select>
                    </Campo>
                    <Campo rotulo="Termina em (opcional)" htmlFor="l-fim" ajuda="Sem data final, os lançamentos são gerados 3 meses à frente, continuamente.">
                      <Input id="l-fim" name="data_fim" type="date" />
                    </Campo>
                  </div>
                ) : null}
                {modo === "unico" ? (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox name="ja_pago" checked={jaPago} onChange={(e) => setJaPago(e.target.checked)} /> Já foi {tipo === "receber" ? "recebido" : "pago"} (valor integral)
                    </label>
                    {jaPago ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Campo rotulo="Data do pagamento" htmlFor="l-dpag" erro={estado.erros?.data_pagamento}>
                          <Input id="l-dpag" name="data_pagamento" type="date" />
                        </Campo>
                        <Campo rotulo="Conta" htmlFor="l-cpag" erro={estado.erros?.conta_pagamento_id}>
                          <Select id="l-cpag" name="conta_pagamento_id" defaultValue="">
                            <option value="">Selecione...</option>
                            {contasPagamento.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nome}
                              </option>
                            ))}
                          </Select>
                        </Campo>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variante="contorno" onClick={() => router.back()}>
                Cancelar
              </Button>
              <BotaoEnviar pendente={pendente}>{edicao ? "Salvar alterações" : "Salvar lançamento"}</BotaoEnviar>
            </div>
          </>
        )}
      </FormularioAcao>

      <Dialog open={novaContraparte} onOpenChange={setNovaContraparte}>
        <DialogContent titulo={tipo === "receber" ? "Novo cliente" : "Novo fornecedor"} descricao="Cadastro rápido. Você pode completar depois em Cadastros.">
          <FormularioAcao
            acao={salvarContraparte.bind(null, empresaId)}
            atualizarAoSucesso={false}
            aoSucesso={(e) => {
              const id = (e.dados as { id?: string } | undefined)?.id;
              const nome = (document.getElementById("nc-nome") as HTMLInputElement | null)?.value ?? "Novo cadastro";
              if (id) {
                setContrapartes((l) => [...l, { id, nome }].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
                setContraparte(id);
              }
              setNovaContraparte(false);
            }}
            className="space-y-4"
          >
            {({ estado, pendente }) => (
              <>
                <input type="hidden" name="papeis" value={tipo === "receber" ? "cliente" : "fornecedor"} />
                <Campo rotulo="Nome" htmlFor="nc-nome" obrigatorio erro={estado.erros?.nome}>
                  <Input id="nc-nome" name="nome" />
                </Campo>
                <Campo rotulo="CPF ou CNPJ (opcional)" htmlFor="nc-doc" erro={estado.erros?.documento}>
                  <Input id="nc-doc" name="documento" inputMode="numeric" />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente}>Cadastrar</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}
