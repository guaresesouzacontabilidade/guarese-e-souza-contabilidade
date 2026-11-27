"use client";

import * as React from "react";
import { Plus, ReceiptText } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { emitirRecibo } from "@/lib/recibos/acoes";
import { FORMAS_PAGAMENTO } from "@/lib/recibos/comum";
import { cn } from "@/lib/utils";

export interface EmpresaRecibo {
  id: string;
  nome: string;
  /** Valor do último recibo desta empresa (para já vir preenchido). */
  ultimoValor: number | null;
}

/** Botão "Novo recibo" com o formulário de emissão. */
export function NovoRecibo({ empresas, hoje, empresaInicial }: { empresas: EmpresaRecibo[]; hoje: string; empresaInicial?: string }) {
  const [aberto, setAberto] = React.useState(false);
  const [modo, setModo] = React.useState<"carteira" | "avulso">(empresas.length ? "carteira" : "avulso");
  const [empresaId, setEmpresaId] = React.useState(empresaInicial && empresas.some((e) => e.id === empresaInicial) ? empresaInicial : "");
  const empresa = empresas.find((e) => e.id === empresaId);

  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus /> Novo recibo
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          largura="lg"
          titulo="Novo recibo de honorários"
          descricao="O recibo sai em PDF com o timbre do escritório e o número do ano (ex.: 007/2026). Os dados do escritório e do contador vêm das Configurações."
        >
          <FormularioAcao acao={emitirRecibo} manterAoErrar className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <input type="hidden" name="modo" value={modo} />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Quem pagou?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["carteira", "Empresa da carteira", "O nome e o CNPJ vêm do cadastro."],
                        ["avulso", "Outra pessoa ou empresa", "Digite o nome e o CPF/CNPJ."],
                      ] as const
                    ).map(([valor, titulo, ajuda]) => (
                      <label
                        key={valor}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                          modo === valor ? "border-primary bg-secondary" : "border-border hover:border-primary/40",
                        )}
                      >
                        <input
                          type="radio"
                          name="modo_escolha"
                          value={valor}
                          checked={modo === valor}
                          onChange={() => setModo(valor)}
                          className="mt-0.5 accent-[var(--primary)]"
                        />
                        <span>
                          <span className="block font-medium">{titulo}</span>
                          <span className="block text-xs text-muted-foreground">{ajuda}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {modo === "carteira" ? (
                  <Campo rotulo="Empresa" htmlFor="recibo-empresa" erro={estado.erros?.empresa_id} obrigatorio>
                    <Select id="recibo-empresa" name="empresa_id" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                      <option value="">Escolha a empresa...</option>
                      {empresas.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
                    <Campo rotulo="Nome de quem pagou" htmlFor="recibo-nome" erro={estado.erros?.pagador_nome} obrigatorio>
                      <Input id="recibo-nome" name="pagador_nome" maxLength={200} autoComplete="off" />
                    </Campo>
                    <Campo rotulo="CPF ou CNPJ" htmlFor="recibo-doc" erro={estado.erros?.pagador_documento}>
                      <Input id="recibo-doc" name="pagador_documento" inputMode="numeric" maxLength={18} autoComplete="off" />
                    </Campo>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo
                    rotulo="Valor recebido"
                    htmlFor="recibo-valor"
                    erro={estado.erros?.valor}
                    ajuda={empresa?.ultimoValor ? "Igual ao último recibo desta empresa." : undefined}
                    obrigatorio
                  >
                    {/* A chave refaz o campo ao trocar de empresa, para trazer o valor do último recibo */}
                    <CampoValor key={`${modo}-${empresaId}`} id="recibo-valor" name="valor" valorInicial={modo === "carteira" ? empresa?.ultimoValor : null} />
                  </Campo>
                  <Campo rotulo="Mês dos honorários" htmlFor="recibo-competencia" erro={estado.erros?.competencia} ajuda="A competência paga.">
                    <Input id="recibo-competencia" name="competencia" type="month" defaultValue={hoje.slice(0, 7)} />
                  </Campo>
                  <Campo rotulo="Data do recibo" htmlFor="recibo-data" erro={estado.erros?.data_recibo} obrigatorio>
                    <Input id="recibo-data" name="data_recibo" type="date" defaultValue={hoje} max={hoje} />
                  </Campo>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Referente a" htmlFor="recibo-referencia" className="sm:col-span-1">
                    <Input id="recibo-referencia" name="referencia" defaultValue="Honorários contábeis" maxLength={120} />
                  </Campo>
                  <Campo rotulo="Forma de pagamento" htmlFor="recibo-forma" erro={estado.erros?.forma_pagamento}>
                    <Select id="recibo-forma" name="forma_pagamento" defaultValue="">
                      <option value="">Não informar</option>
                      {Object.entries(FORMAS_PAGAMENTO).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Nº da nota fiscal (NFS-e)" htmlFor="recibo-nfse" ajuda="Se houver nota deste pagamento.">
                    <Input id="recibo-nfse" name="nfse_numero" maxLength={30} autoComplete="off" />
                  </Campo>
                </div>

                <details className="rounded-lg border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Mais opções (texto do recibo e observação)</summary>
                  <div className="mt-3 space-y-4">
                    <Campo
                      rotulo="Texto do “referente a”"
                      htmlFor="recibo-descricao"
                      ajuda="Deixe em branco para usar: “pagamento de honorários contábeis / prestação de serviços contábeis da competência de ...”."
                    >
                      <Textarea id="recibo-descricao" name="descricao" rows={2} maxLength={500} placeholder="Ex.: serviço de abertura da empresa" />
                    </Campo>
                    <Campo rotulo="Observação (sai pequena, abaixo da assinatura)" htmlFor="recibo-observacao">
                      <Textarea id="recibo-observacao" name="observacao" rows={2} maxLength={500} />
                    </Campo>
                  </div>
                </details>

                {modo === "carteira" ? (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox name="publicar" defaultChecked className="mt-0.5" />
                    <span>
                      Publicar para o cliente
                      <span className="block text-xs text-muted-foreground">O PDF aparece nos documentos da empresa, em “Recibos”.</span>
                    </span>
                  </label>
                ) : null}

                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Emitindo...">
                    <ReceiptText /> Emitir recibo
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}
