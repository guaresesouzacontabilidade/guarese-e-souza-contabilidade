"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarDocumento } from "@/lib/formatos";
import { TIPOS_CATEGORIA } from "@/lib/rotulos";
import { aplicarPlanoPadrao, salvarCategoria, salvarCentroCusto, salvarContraparte, salvarProjeto } from "@/lib/financeiro/acoes-cadastros";

export interface Categoria {
  id: string;
  codigo: string;
  nome: string;
  tipo: string;
  pai_id: string | null;
  sintetica: boolean;
  codigo_sistema: string | null;
  ativa: boolean;
}

export function PlanoContas({ empresaId, categorias, podeEditar }: { empresaId: string; categorias: Categoria[]; podeEditar: boolean }) {
  const [editando, setEditando] = useState<Categoria | "nova" | null>(null);
  const grupos = categorias.filter((c) => c.sintetica);
  const filhos = (id: string) => categorias.filter((c) => c.pai_id === id);
  const soltas = categorias.filter((c) => !c.sintetica && !c.pai_id);
  const e = editando === "nova" ? null : editando;
  return (
    <div className="space-y-4">
      {podeEditar ? (
        <div className="flex flex-wrap justify-end gap-2">
          <BotaoAcao variante="contorno" acao={() => aplicarPlanoPadrao(empresaId)}>
            <Wand2 /> Completar com o plano padrão
          </BotaoAcao>
          <Button onClick={() => setEditando("nova")}>
            <Plus /> Nova categoria
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        O tipo de cada categoria define onde ela aparece na DRE. Categorias “fora do resultado” (aportes, empréstimos, retiradas, investimentos) movimentam o caixa mas
        não são receita nem despesa.
      </p>
      {categorias.length === 0 ? (
        <EstadoVazio titulo="Plano de contas vazio" descricao="Aplique o plano padrão para começar." />
      ) : (
        <div className="space-y-4">
          {[...grupos.map((g) => ({ g, itens: filhos(g.id) })), ...(soltas.length ? [{ g: null, itens: soltas }] : [])].map(({ g, itens }) => (
            <div key={g?.id ?? "soltas"} className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between bg-muted/70 px-4 py-2">
                <p className="text-sm font-semibold text-titulo">{g ? `${g.codigo} ${g.nome}` : "Sem grupo"}</p>
                {g && podeEditar ? (
                  <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${g.nome}`} onClick={() => setEditando(g)}>
                    <Pencil />
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y divide-border">
                {itens.map((c) => {
                  const t = TIPOS_CATEGORIA[c.tipo];
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                      <span className="min-w-0">
                        <span className={c.ativa ? "" : "text-muted-foreground line-through"}>
                          {c.codigo} {c.nome}
                        </span>
                        <span className="block text-xs text-muted-foreground">{t?.rotulo ?? c.tipo}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {!t?.dre ? <Badge variante="info">Fora da DRE</Badge> : null}
                        {c.codigo_sistema ? <Badge variante="neutro">Usada pelo sistema</Badge> : null}
                        {podeEditar ? (
                          <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${c.nome}`} onClick={() => setEditando(c)}>
                            <Pencil />
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
                {!itens.length ? <li className="px-4 py-2 text-sm text-muted-foreground">Nenhuma subcategoria.</li> : null}
              </ul>
            </div>
          ))}
        </div>
      )}
      {editando ? (
        <Dialog open onOpenChange={(v) => !v && setEditando(null)}>
          <DialogContent titulo={e ? "Editar categoria" : "Nova categoria"}>
            <FormularioAcao acao={salvarCategoria.bind(null, empresaId)} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  {e ? <input type="hidden" name="id" value={e.id} /> : null}
                  <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                    <Campo rotulo="Código" htmlFor="cat-cod" obrigatorio erro={estado.erros?.codigo}>
                      <Input id="cat-cod" name="codigo" defaultValue={e?.codigo ?? ""} />
                    </Campo>
                    <Campo rotulo="Nome" htmlFor="cat-nome" obrigatorio erro={estado.erros?.nome}>
                      <Input id="cat-nome" name="nome" defaultValue={e?.nome ?? ""} />
                    </Campo>
                  </div>
                  <Campo rotulo="Tipo (define a posição na DRE)" htmlFor="cat-tipo" obrigatorio ajuda={e?.codigo_sistema ? "Categoria usada automaticamente pelo sistema: o tipo não pode mudar." : undefined}>
                    <Select id="cat-tipo" name="tipo" defaultValue={e?.tipo ?? "despesa_operacional"} disabled={Boolean(e?.codigo_sistema)}>
                      {Object.entries(TIPOS_CATEGORIA).map(([v, t]) => (
                        <option key={v} value={v}>
                          {t.rotulo}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  {e?.codigo_sistema ? <input type="hidden" name="tipo" value={e.tipo} /> : null}
                  {!e?.sintetica ? (
                    <Campo rotulo="Grupo" htmlFor="cat-pai">
                      <Select id="cat-pai" name="pai_id" defaultValue={e?.pai_id ?? ""}>
                        <option value="">—</option>
                        {grupos.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.codigo} {g.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="ativa" value="false" />
                    <Checkbox name="ativa" defaultChecked={e?.ativa ?? true} /> Ativa
                  </label>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export interface Contraparte {
  id: string;
  nome: string;
  documento: string | null;
  papeis: string[];
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  ativo: boolean;
}

const PAPEIS: Record<string, string> = {
  cliente: "Cliente",
  fornecedor: "Fornecedor",
  socio: "Sócio",
  funcionario: "Funcionário",
  banco: "Banco",
  governo: "Órgão público",
  outro: "Outro",
};

export function ListaContrapartes({ empresaId, contrapartes, podeEditar }: { empresaId: string; contrapartes: Contraparte[]; podeEditar: boolean }) {
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Contraparte | "nova" | null>(null);
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const dig = t.replace(/\D/g, "");
    return contrapartes.filter((c) => !t || c.nome.toLowerCase().includes(t) || (dig.length >= 3 && c.documento?.includes(dig)));
  }, [busca, contrapartes]);
  const e = editando === "nova" ? null : editando;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar por nome ou CPF/CNPJ" className="pl-9" aria-label="Buscar" />
        </div>
        {podeEditar ? (
          <Button onClick={() => setEditando("nova")}>
            <Plus /> Novo cadastro
          </Button>
        ) : null}
      </div>
      {filtradas.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Nome</Th>
              <Th>CPF/CNPJ</Th>
              <Th>Papéis</Th>
              <Th>Contato</Th>
              <Th className="w-10">
                <span className="sr-only">Editar</span>
              </Th>
            </tr>
          </THead>
          <TBody>
            {filtradas.slice(0, 500).map((c) => (
              <Tr key={c.id}>
                <Td className={c.ativo ? "font-medium" : "text-muted-foreground"}>{c.nome}</Td>
                <Td className="whitespace-nowrap text-sm">{c.documento ? formatarDocumento(c.documento) : "—"}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {c.papeis.map((p) => (
                      <Badge key={p} variante="neutro">
                        {PAPEIS[p] ?? p}
                      </Badge>
                    ))}
                  </div>
                </Td>
                <Td className="text-sm text-muted-foreground">{[c.email, c.telefone].filter(Boolean).join(" · ") || "—"}</Td>
                <Td>
                  {podeEditar ? (
                    <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${c.nome}`} onClick={() => setEditando(c)}>
                      <Pencil />
                    </Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <EstadoVazio titulo="Nenhum cadastro encontrado" descricao="Clientes e fornecedores também são criados automaticamente pela leitura de XMLs e importações." />
      )}
      {editando ? (
        <Dialog open onOpenChange={(v) => !v && setEditando(null)}>
          <DialogContent titulo={e ? "Editar cadastro" : "Novo cliente ou fornecedor"}>
            <FormularioAcao acao={salvarContraparte.bind(null, empresaId)} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  {e ? <input type="hidden" name="id" value={e.id} /> : null}
                  <Campo rotulo="Nome / razão social" htmlFor="cp-nome" obrigatorio erro={estado.erros?.nome}>
                    <Input id="cp-nome" name="nome" defaultValue={e?.nome ?? ""} />
                  </Campo>
                  <Campo rotulo="CPF ou CNPJ" htmlFor="cp-doc" erro={estado.erros?.documento}>
                    <Input id="cp-doc" name="documento" defaultValue={e?.documento ? formatarDocumento(e.documento) : ""} inputMode="numeric" />
                  </Campo>
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium">Papéis</legend>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {Object.entries(PAPEIS).map(([v, r]) => (
                        <label key={v} className="inline-flex items-center gap-2">
                          <Checkbox name="papeis" value={v} defaultChecked={e ? e.papeis.includes(v) : v === "fornecedor"} /> {r}
                        </label>
                      ))}
                    </div>
                    {estado.erros?.papeis ? <p className="mt-1 text-xs text-perigo">{estado.erros.papeis[0]}</p> : null}
                  </fieldset>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Campo rotulo="E-mail" htmlFor="cp-email">
                      <Input id="cp-email" name="email" type="email" defaultValue={e?.email ?? ""} />
                    </Campo>
                    <Campo rotulo="Telefone" htmlFor="cp-tel">
                      <Input id="cp-tel" name="telefone" defaultValue={e?.telefone ?? ""} />
                    </Campo>
                  </div>
                  <Campo rotulo="Observações" htmlFor="cp-obs">
                    <Textarea id="cp-obs" name="observacoes" defaultValue={e?.observacoes ?? ""} rows={2} />
                  </Campo>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="ativo" value="false" />
                    <Checkbox name="ativo" defaultChecked={e?.ativo ?? true} /> Ativo
                  </label>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

interface ItemSimples {
  id: string;
  nome: string;
  codigo: string | null;
  ativo: boolean;
  inicio?: string | null;
  fim?: string | null;
}

export function ListaSimples({ empresaId, itens, tipo, podeEditar }: { empresaId: string; itens: ItemSimples[]; tipo: "centro" | "projeto"; podeEditar: boolean }) {
  const [editando, setEditando] = useState<ItemSimples | "novo" | null>(null);
  const e = editando === "novo" ? null : editando;
  const acao = tipo === "centro" ? salvarCentroCusto : salvarProjeto;
  const nome = tipo === "centro" ? "centro de custo" : "projeto";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {tipo === "centro" ? "Separe receitas e despesas por área (loja, fábrica, administrativo...)." : "Acompanhe obras, contratos ou eventos separadamente."}
        </p>
        {podeEditar ? (
          <Button onClick={() => setEditando("novo")}>
            <Plus /> Novo {nome}
          </Button>
        ) : null}
      </div>
      {itens.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {itens.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className={i.ativo ? "" : "text-muted-foreground line-through"}>
                {i.codigo ? `${i.codigo} · ` : ""}
                {i.nome}
              </span>
              {podeEditar ? (
                <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${i.nome}`} onClick={() => setEditando(i)}>
                  <Pencil />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EstadoVazio titulo={`Nenhum ${nome} cadastrado`} />
      )}
      {editando ? (
        <Dialog open onOpenChange={(v) => !v && setEditando(null)}>
          <DialogContent titulo={e ? `Editar ${nome}` : `Novo ${nome}`}>
            <FormularioAcao acao={acao.bind(null, empresaId)} aoSucesso={() => setEditando(null)} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  {e ? <input type="hidden" name="id" value={e.id} /> : null}
                  <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                    <Campo rotulo="Código" htmlFor="s-cod">
                      <Input id="s-cod" name="codigo" defaultValue={e?.codigo ?? ""} />
                    </Campo>
                    <Campo rotulo="Nome" htmlFor="s-nome" obrigatorio erro={estado.erros?.nome}>
                      <Input id="s-nome" name="nome" defaultValue={e?.nome ?? ""} />
                    </Campo>
                  </div>
                  {tipo === "projeto" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Campo rotulo="Início" htmlFor="s-ini">
                        <Input id="s-ini" name="inicio" type="date" defaultValue={e?.inicio ?? ""} />
                      </Campo>
                      <Campo rotulo="Fim" htmlFor="s-fim">
                        <Input id="s-fim" name="fim" type="date" defaultValue={e?.fim ?? ""} />
                      </Campo>
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="ativo" value="false" />
                    <Checkbox name="ativo" defaultChecked={e?.ativo ?? true} /> Ativo
                  </label>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
