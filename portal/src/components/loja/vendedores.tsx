"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { definirVendedorObrigatorio, excluirVendedor, salvarVendedor, trocarVendedor } from "@/lib/gestao/acoes-vendedores";

export interface VendedorLinha {
  id: string;
  nome: string;
  comissao: number;
  ativo: boolean;
  usuarioId: string | null;
  usuarioNome: string | null;
}

/** Cadastro dos vendedores da loja (comissão) e a opção de exigir o vendedor. */
export function Vendedores({
  empresaId,
  vendedores,
  acessos,
  obrigatorio,
}: {
  empresaId: string;
  vendedores: VendedorLinha[];
  acessos: { id: string; nome: string }[];
  obrigatorio: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = React.useState<VendedorLinha | "novo" | null>(null);
  const [pendente, iniciar] = React.useTransition();
  const ligados = new Set(vendedores.map((v) => v.usuarioId).filter(Boolean));

  function alternarObrigatorio(v: boolean) {
    iniciar(async () => {
      const r = await definirVendedorObrigatorio(empresaId, v);
      if (r.ok) {
        toast.success(r.mensagem ?? "Salvo.");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível salvar.");
    });
  }

  const atual = editando && editando !== "novo" ? editando : null;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-5 text-primary" /> Vendedores
            </CardTitle>
            <CardDescription>
              Quem vende e ganha comissão. O vendedor é escolhido no orçamento e no caixa. Vários vendedores podem usar o mesmo login do balcão.
            </CardDescription>
          </div>
          <Button onClick={() => setEditando("novo")}>
            <Plus /> Novo vendedor
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
            <Checkbox checked={obrigatorio} disabled={pendente} onChange={(e) => alternarObrigatorio(e.target.checked)} aria-label="Exigir o vendedor" />
            <span>
              <span className="block font-medium">Exigir o vendedor em todo orçamento e venda</span>
              <span className="text-muted-foreground">Sem vendedor escolhido, o portal não salva o orçamento nem conclui a venda (vale também no banco de dados).</span>
            </span>
          </label>
          {vendedores.length ? (
            <Table>
              <THead>
                <Tr>
                  <Th>Nome</Th>
                  <Th className="text-right">Comissão</Th>
                  <Th>Login ligado</Th>
                  <Th>Situação</Th>
                  <Th className="w-24" />
                </Tr>
              </THead>
              <TBody>
                {vendedores.map((v) => (
                  <Tr key={v.id} data-testid="linha-vendedor">
                    <Td className="font-medium">{v.nome}</Td>
                    <Td className="numero text-right">{v.comissao.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</Td>
                    <Td className="text-sm text-muted-foreground">{v.usuarioNome ?? "—"}</Td>
                    <Td>{v.ativo ? <Badge variante="sucesso">Ativo</Badge> : <Badge variante="neutro">Inativo</Badge>}</Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${v.nome}`} onClick={() => setEditando(v)}>
                          <Pencil />
                        </Button>
                        <BotaoAcao
                          variante="fantasma"
                          tamanho="iconeSm"
                          aria-label={`Excluir ${v.nome}`}
                          acao={excluirVendedor.bind(null, empresaId, v.id)}
                          confirmar={{
                            titulo: `Excluir ${v.nome}?`,
                            descricao: "Se ele já tiver vendas, o portal só desativa o cadastro: as vendas e as comissões continuam no histórico.",
                            textoConfirmar: "Excluir",
                            perigo: true,
                          }}
                        >
                          <Trash2 />
                        </BotaoAcao>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <EstadoVazio icone={UserRound} titulo="Nenhum vendedor cadastrado" descricao="Cadastre os vendedores para escolher quem vendeu no orçamento e no caixa e calcular a comissão." />
          )}
        </CardContent>
      </Card>

      <Dialog open={editando !== null} onOpenChange={(a) => !a && setEditando(null)}>
        <DialogContent titulo={atual ? `Editar ${atual.nome}` : "Novo vendedor"} descricao="A comissão é calculada sobre o valor dos produtos com desconto, sem o frete.">
          <FormularioAcao
            key={atual?.id ?? "novo"}
            acao={salvarVendedor.bind(null, empresaId)}
            aoSucesso={() => {
              setEditando(null);
              router.refresh();
            }}
            className="space-y-4"
          >
            {({ estado, pendente: salvando }) => (
              <>
                {atual ? <input type="hidden" name="id" value={atual.id} /> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome" htmlFor="vd-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                    <Input id="vd-nome" name="nome" defaultValue={atual?.nome ?? ""} maxLength={80} autoComplete="off" />
                  </Campo>
                  <Campo rotulo="Comissão (%)" htmlFor="vd-comissao" erro={estado.erros?.comissao} ajuda="Ex.: 2,5. Mudar depois não altera as vendas já feitas.">
                    <Input id="vd-comissao" name="comissao" inputMode="decimal" defaultValue={atual ? String(atual.comissao).replace(".", ",") : ""} placeholder="0" />
                  </Campo>
                  <Campo rotulo="Login ligado (opcional)" htmlFor="vd-login" ajuda="Quando ele entrar no portal, já vem escolhido e ele vê as próprias comissões.">
                    <Select id="vd-login" name="usuario_id" defaultValue={atual?.usuarioId ?? ""}>
                      <option value="">Sem login (usa o login do balcão)</option>
                      {acessos.map((a) => (
                        <option key={a.id} value={a.id} disabled={ligados.has(a.id) && a.id !== atual?.usuarioId}>
                          {a.nome}
                          {ligados.has(a.id) && a.id !== atual?.usuarioId ? " (já ligado)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <Checkbox name="ativo" defaultChecked={atual ? atual.ativo : true} /> Ativo (aparece para escolher no orçamento e no caixa)
                  </label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variante="fantasma" onClick={() => setEditando(null)}>
                    Voltar
                  </Button>
                  <BotaoEnviar pendente={salvando}>Salvar vendedor</BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Troca o vendedor de uma venda ou orçamento (quem gerencia a loja; pede o motivo e fica no histórico). */
export function TrocarVendedor({
  empresaId,
  vendaId,
  atual,
  vendedores,
}: {
  empresaId: string;
  vendaId: string;
  atual: string | null;
  vendedores: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  const [vendedor, setVendedor] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [pendente, iniciar] = React.useTransition();
  function confirmar() {
    iniciar(async () => {
      const r = await trocarVendedor(empresaId, vendaId, vendedor, motivo);
      if (r.ok) {
        toast.success(r.mensagem ?? "Vendedor trocado.");
        setAberto(false);
        setMotivo("");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível trocar.");
    });
  }
  return (
    <>
      <Button variante="contorno" tamanho="sm" onClick={() => setAberto(true)}>
        <UserRound /> {atual ? "Trocar vendedor" : "Escolher vendedor"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={atual ? "Trocar o vendedor" : "Escolher o vendedor"} descricao="A comissão passa para o novo vendedor, com o % dele hoje. A troca fica no histórico da venda.">
          <div className="space-y-4">
            <Campo rotulo="Novo vendedor" htmlFor="tv-vendedor" obrigatorio>
              <Select id="tv-vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
                <option value="">Escolha…</option>
                {vendedores
                  .filter((v) => v.id !== atual)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nome}
                    </option>
                  ))}
              </Select>
            </Campo>
            <Campo rotulo="Motivo" htmlFor="tv-motivo" obrigatorio>
              <Input id="tv-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: o atendimento foi de outro vendedor" />
            </Campo>
            <div className="flex justify-end gap-2">
              <Button variante="fantasma" onClick={() => setAberto(false)}>
                Voltar
              </Button>
              <Button onClick={confirmar} disabled={pendente || !vendedor || motivo.trim().length < 3}>
                Confirmar troca
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
