"use client";

import { useState } from "react";
import { Contact, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { FUNCOES_CONTATO } from "@/lib/rotulos";
import { formatarTelefone } from "@/lib/formatos";
import { excluirContato, salvarContato } from "@/app/(app)/escritorio/empresas/acoes";

export interface ContatoEmpresa {
  id: string;
  nome: string;
  funcao: string;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  principal: boolean;
  recebe_lembretes: boolean;
  observacoes: string | null;
}

export function ContatosEmpresa({ empresaId, contatos, podeEditar }: { empresaId: string; contatos: ContatoEmpresa[]; podeEditar: boolean }) {
  const [editando, setEditando] = useState<ContatoEmpresa | "novo" | null>(null);
  const acao = salvarContato.bind(null, empresaId);
  return (
    <div className="space-y-3">
      {podeEditar ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditando("novo")}>
            <Plus /> Novo contato
          </Button>
        </div>
      ) : null}
      {contatos.length === 0 ? (
        <EstadoVazio icone={Contact} titulo="Nenhum responsável cadastrado" descricao="Cadastre sócios e responsáveis (financeiro, RH) para contato e lembretes." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {contatos.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">{FUNCOES_CONTATO[c.funcao] ?? c.funcao}</p>
                </div>
                <div className="flex gap-1">
                  {c.principal ? <Badge variante="primario">Principal</Badge> : null}
                  {c.recebe_lembretes ? <Badge variante="info">Lembretes</Badge> : null}
                </div>
              </div>
              <dl className="mt-2 space-y-0.5 text-sm">
                {c.email ? <dd>{c.email}</dd> : null}
                {c.telefone ? <dd>Tel.: {formatarTelefone(c.telefone)}</dd> : null}
                {c.whatsapp ? <dd>WhatsApp: {formatarTelefone(c.whatsapp)}</dd> : null}
              </dl>
              {podeEditar ? (
                <div className="mt-3 flex gap-2">
                  <Button variante="contorno" tamanho="sm" onClick={() => setEditando(c)}>
                    <Pencil /> Editar
                  </Button>
                  <BotaoAcao
                    variante="fantasma"
                    tamanho="sm"
                    acao={() => excluirContato(empresaId, c.id)}
                    confirmar={{ titulo: `Remover ${c.nome}?`, textoConfirmar: "Remover", perigo: true }}
                  >
                    <Trash2 /> Remover
                  </BotaoAcao>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando !== null ? (
          <DialogContent titulo={editando === "novo" ? "Novo contato" : `Editar ${editando.nome}`}>
            <FormularioAcao acao={acao} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente }) => {
                const c = editando === "novo" ? null : editando;
                return (
                  <>
                    {c ? <input type="hidden" name="id" value={c.id} /> : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo rotulo="Nome" htmlFor="ct-nome" obrigatorio erro={estado.erros?.nome}>
                        <Input id="ct-nome" name="nome" defaultValue={c?.nome ?? ""} />
                      </Campo>
                      <Campo rotulo="Função" htmlFor="ct-funcao">
                        <Select id="ct-funcao" name="funcao" defaultValue={c?.funcao ?? "socio_administrador"}>
                          {Object.entries(FUNCOES_CONTATO).map(([v, r]) => (
                            <option key={v} value={v}>
                              {r}
                            </option>
                          ))}
                        </Select>
                      </Campo>
                      <Campo rotulo="E-mail" htmlFor="ct-email">
                        <Input id="ct-email" name="email" type="email" defaultValue={c?.email ?? ""} />
                      </Campo>
                      <Campo rotulo="Telefone" htmlFor="ct-tel">
                        <Input id="ct-tel" name="telefone" type="tel" defaultValue={c?.telefone ?? ""} />
                      </Campo>
                      <Campo rotulo="WhatsApp (com DDD)" htmlFor="ct-wa" ajuda="Usado nos lembretes por WhatsApp, quando a integração estiver ativa.">
                        <Input id="ct-wa" name="whatsapp" type="tel" defaultValue={c?.whatsapp ?? ""} placeholder="63999999999" />
                      </Campo>
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox name="principal" defaultChecked={c?.principal ?? false} /> Contato principal
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox name="recebe_lembretes" defaultChecked={c?.recebe_lembretes ?? true} /> Recebe lembretes
                      </label>
                    </div>
                    <Campo rotulo="Observações" htmlFor="ct-obs">
                      <Textarea id="ct-obs" name="observacoes" defaultValue={c?.observacoes ?? ""} rows={2} />
                    </Campo>
                    <div className="flex justify-end">
                      <BotaoEnviar pendente={pendente}>Salvar contato</BotaoEnviar>
                    </div>
                  </>
                );
              }}
            </FormularioAcao>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
