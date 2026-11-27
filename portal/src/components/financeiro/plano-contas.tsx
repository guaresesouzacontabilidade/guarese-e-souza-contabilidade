"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderPlus, Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { TIPOS_CATEGORIA } from "@/lib/rotulos";
import { naturezaDoTipo, proximoCodigo, tipoEntraNoDre } from "@/lib/financeiro/plano-contas";
import { aplicarPlanoPadrao, desativarCategoria, excluirCategoria, salvarCategoria, usoCategoria, type UsoConta } from "@/lib/financeiro/acoes-cadastros";

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

type Edicao = { modo: "conta"; conta: Categoria | null; paiId: string | null } | { modo: "grupo"; conta: Categoria | null };

/**
 * Plano de contas da empresa: grupos e contas, com o lugar de cada conta no
 * DRE. Quem pode editar o financeiro cria, edita, desativa e exclui contas e
 * grupos (a exclusão move os lançamentos para outra conta).
 */
export function PlanoContas({
  empresaId,
  categorias,
  podeEditar,
  linhaDre = {},
  linhaPorTipo = {},
}: {
  empresaId: string;
  categorias: Categoria[];
  podeEditar: boolean;
  /** Linha do DRE em que cada conta aparece. */
  linhaDre?: Record<string, string>;
  /** Linha do DRE que recebe cada tipo de conta (para a dica ao editar). */
  linhaPorTipo?: Record<string, string>;
}) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [excluindo, setExcluindo] = useState<Categoria | null>(null);
  const grupos = categorias.filter((c) => c.sintetica);
  const filhos = (id: string) => categorias.filter((c) => c.pai_id === id);
  const soltas = categorias.filter((c) => !c.sintetica && !c.pai_id);

  return (
    <div className="space-y-4">
      {podeEditar ? (
        <div className="flex flex-wrap justify-end gap-2">
          <BotaoAcao variante="contorno" acao={() => aplicarPlanoPadrao(empresaId)}>
            <Wand2 /> Completar com o plano padrão
          </BotaoAcao>
          <Button variante="contorno" onClick={() => setEdicao({ modo: "grupo", conta: null })}>
            <FolderPlus /> Novo grupo
          </Button>
          <Button onClick={() => setEdicao({ modo: "conta", conta: null, paiId: null })}>
            <Plus /> Nova conta
          </Button>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        O tipo de cada conta define em que linha do DRE ela aparece. Contas “fora do resultado” (aportes, empréstimos, retiradas, investimentos) movimentam o
        caixa, mas não são receita nem despesa.
      </p>
      {categorias.length === 0 ? (
        <EstadoVazio titulo="Plano de contas vazio" descricao="Aplique o plano padrão para começar." />
      ) : (
        <div className="space-y-4">
          {[...grupos.map((g) => ({ g, itens: filhos(g.id) })), ...(soltas.length ? [{ g: null, itens: soltas }] : [])].map(({ g, itens }) => (
            <section key={g?.id ?? "soltas"} className="overflow-hidden rounded-xl border border-border" aria-label={g ? `Grupo ${g.nome}` : "Contas sem grupo"}>
              <div className="flex items-center justify-between gap-2 bg-muted/70 px-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-titulo">{g ? `${g.codigo} ${g.nome}` : "Sem grupo"}</p>
                  {g && linhaDre[g.id] ? <p className="text-xs text-muted-foreground">Todas as contas no DRE em: {linhaDre[g.id]}</p> : null}
                </div>
                {g && podeEditar ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Button tamanho="iconeSm" variante="fantasma" aria-label={`Nova conta em ${g.nome}`} title="Nova conta neste grupo" onClick={() => setEdicao({ modo: "conta", conta: null, paiId: g.id })}>
                      <Plus />
                    </Button>
                    <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${g.nome}`} onClick={() => setEdicao({ modo: "grupo", conta: g })}>
                      <Pencil />
                    </Button>
                    <Button tamanho="iconeSm" variante="fantasma" aria-label={`Excluir ${g.nome}`} onClick={() => setExcluindo(g)}>
                      <Trash2 />
                    </Button>
                  </span>
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
                        <span className="block text-xs text-muted-foreground">
                          {t?.dre ? `No DRE: ${linhaDre[c.id] ?? t.grupo}` : (t?.rotulo ?? c.tipo)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {!c.ativa ? <Badge variante="neutro">Desativada</Badge> : null}
                        {!t?.dre ? <Badge variante="info">Fora do DRE</Badge> : null}
                        {c.codigo_sistema ? <Badge variante="neutro">Usada pelo sistema</Badge> : null}
                        {podeEditar ? (
                          <>
                            <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${c.nome}`} onClick={() => setEdicao({ modo: "conta", conta: c, paiId: c.pai_id })}>
                              <Pencil />
                            </Button>
                            {!c.codigo_sistema ? (
                              <Button tamanho="iconeSm" variante="fantasma" aria-label={`Excluir ${c.nome}`} onClick={() => setExcluindo(c)}>
                                <Trash2 />
                              </Button>
                            ) : null}
                          </>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
                {!itens.length ? <li className="px-4 py-2 text-sm text-muted-foreground">Nenhuma conta neste grupo.</li> : null}
              </ul>
            </section>
          ))}
        </div>
      )}
      {edicao ? (
        <DialogoConta empresaId={empresaId} edicao={edicao} categorias={categorias} linhaPorTipo={linhaPorTipo} linhaDre={linhaDre} aoFechar={() => setEdicao(null)} />
      ) : null}
      {excluindo ? <DialogoExcluir empresaId={empresaId} conta={excluindo} categorias={categorias} aoFechar={() => setExcluindo(null)} /> : null}
    </div>
  );
}

function DialogoConta({
  empresaId,
  edicao,
  categorias,
  linhaPorTipo,
  linhaDre,
  aoFechar,
}: {
  empresaId: string;
  edicao: Edicao;
  categorias: Categoria[];
  linhaPorTipo: Record<string, string>;
  linhaDre: Record<string, string>;
  aoFechar: () => void;
}) {
  const grupo = edicao.modo === "grupo";
  const e = edicao.conta;
  const grupos = categorias.filter((c) => c.sintetica);
  const paiInicial = edicao.modo === "conta" ? (e?.pai_id ?? edicao.paiId ?? "") : "";
  const [pai, setPai] = useState(paiInicial);
  const tipoInicial = e?.tipo ?? grupos.find((g) => g.id === paiInicial)?.tipo ?? "despesa_operacional";
  const [tipo, setTipo] = useState(tipoInicial);
  const sugerido = (p: string) => proximoCodigo(categorias, p || null, grupo);
  const [codigo, setCodigo] = useState(e?.codigo ?? sugerido(paiInicial));
  const [codigoEditado, setCodigoEditado] = useState(Boolean(e));
  const t = TIPOS_CATEGORIA[tipo];
  // Conta levada para outra linha no modelo do DRE mantém essa linha
  const linhaFixa = e && !grupo && linhaDre[e.id] && linhaDre[e.id] !== linhaPorTipo[e.tipo] ? linhaDre[e.id] : null;
  const grupoComLinha = !grupo && pai && linhaDre[pai] ? linhaDre[pai] : null;
  const ondeAparece = !t?.dre ? "Fora do resultado: não aparece no DRE." : `No DRE, aparece em: ${grupoComLinha ?? linhaFixa ?? linhaPorTipo[tipo] ?? t.grupo}`;

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent titulo={grupo ? (e ? "Editar grupo" : "Novo grupo") : e ? "Editar conta" : "Nova conta"}>
        <FormularioAcao acao={salvarCategoria.bind(null, empresaId)} aoSucesso={aoFechar} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              {e ? <input type="hidden" name="id" value={e.id} /> : null}
              {grupo && !e ? <input type="hidden" name="sintetica" value="true" /> : null}
              <Campo rotulo="Nome" htmlFor="cat-nome" obrigatorio erro={estado.erros?.nome}>
                <Input id="cat-nome" name="nome" defaultValue={e?.nome ?? ""} placeholder={grupo ? "Ex.: Despesas com pessoal" : "Ex.: Uniformes"} autoFocus />
              </Campo>
              {!grupo ? (
                <Campo rotulo="Grupo" htmlFor="cat-pai">
                  <Select
                    id="cat-pai"
                    name="pai_id"
                    value={pai}
                    onChange={(ev) => {
                      const novo = ev.target.value;
                      setPai(novo);
                      if (!codigoEditado) setCodigo(sugerido(novo));
                      if (!e) setTipo(grupos.find((g) => g.id === novo)?.tipo ?? tipo);
                    }}
                  >
                    <option value="">Sem grupo</option>
                    {grupos.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.codigo} {g.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <Campo
                rotulo={grupo ? "Tipo das contas deste grupo" : "Tipo"}
                htmlFor="cat-tipo"
                obrigatorio
                ajuda={e?.codigo_sistema ? "Conta usada automaticamente pelo sistema: o tipo não pode mudar." : grupo ? "Sugerido ao criar contas dentro do grupo." : ondeAparece}
              >
                <Select id="cat-tipo" name="tipo" value={tipo} onChange={(ev) => setTipo(ev.target.value)} disabled={Boolean(e?.codigo_sistema)}>
                  {Object.entries(TIPOS_CATEGORIA).map(([v, x]) => (
                    <option key={v} value={v}>
                      {x.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              {e?.codigo_sistema ? <input type="hidden" name="tipo" value={e.tipo} /> : null}
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr] sm:items-end">
                <Campo rotulo="Código" htmlFor="cat-cod" obrigatorio erro={estado.erros?.codigo} ajuda={!e ? "Sugerido automaticamente." : undefined}>
                  <Input
                    id="cat-cod"
                    name="codigo"
                    value={codigo}
                    onChange={(ev) => {
                      setCodigo(ev.target.value);
                      setCodigoEditado(true);
                    }}
                  />
                </Campo>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="hidden" name="ativa" value="false" />
                  <Checkbox name="ativa" defaultChecked={e?.ativa ?? true} /> Ativa (aparece nos lançamentos)
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variante="contorno" onClick={aoFechar}>
                  Cancelar
                </Button>
                <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

function DialogoExcluir({ empresaId, conta, categorias, aoFechar }: { empresaId: string; conta: Categoria; categorias: Categoria[]; aoFechar: () => void }) {
  const router = useRouter();
  const [uso, setUso] = useState<UsoConta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [destino, setDestino] = useState("");
  const [enviando, iniciarEnvio] = useTransition();
  const carregando = !uso && !erro;

  useEffect(() => {
    let vivo = true;
    usoCategoria(empresaId, conta.id).then((r) => {
      if (!vivo) return;
      if (r.ok && r.dados) setUso(r.dados);
      else setErro(r.mensagem ?? "Não foi possível consultar a conta.");
    });
    return () => {
      vivo = false;
    };
  }, [empresaId, conta.id]);

  const destinos = useMemo(
    () =>
      conta.sintetica
        ? categorias.filter((c) => c.sintetica && c.id !== conta.id)
        : categorias.filter((c) => !c.sintetica && c.ativa && c.id !== conta.id && naturezaDoTipo(c.tipo) === naturezaDoTipo(conta.tipo)),
    [categorias, conta],
  );
  const movidos = uso ? uso.lancamentos + uso.recorrencias + uso.ajustes : 0;
  const precisaDestino = !conta.sintetica && movidos > 0;
  const bloqueada = Boolean(uso && (uso.sistema || uso.meses_fechados.length > 0));
  const destinoInvalido = precisaDestino && !destino;
  const exigeDreNoDestino = uso && uso.ajustes > 0;

  const executar = (fn: () => Promise<{ ok: boolean; mensagem?: string }>) =>
    iniciarEnvio(async () => {
      const r = await fn();
      if (r.ok) {
        if (r.mensagem) toast.success(r.mensagem);
        aoFechar();
        router.refresh();
      } else {
        toast.error(r.mensagem ?? "Não foi possível concluir.");
      }
    });

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent titulo={conta.sintetica ? `Excluir o grupo “${conta.nome}”` : `Excluir a conta “${conta.nome}”`}>
        <div className="space-y-4 text-sm">
          {carregando ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Conferindo onde a conta é usada…
            </p>
          ) : erro ? (
            <Alerta tom="perigo">{erro}</Alerta>
          ) : uso ? (
            <>
              {uso.sistema ? (
                <Alerta tom="alerta">Esta conta é usada automaticamente pelo sistema (juros, tarifas, taxas). Ela não pode ser excluída, mas pode ser desativada.</Alerta>
              ) : uso.meses_fechados.length ? (
                <Alerta tom="alerta">
                  Esta conta tem lançamentos em meses já fechados pelo escritório ({uso.meses_fechados.map((m) => m.split("-").reverse().join("/")).join(", ")}).
                  Para não mudar o que já foi entregue, ela não pode ser excluída. Você pode desativá-la: ela some dos novos lançamentos e o histórico continua.
                </Alerta>
              ) : conta.sintetica ? (
                <>
                  <p>
                    {uso.contas_no_grupo
                      ? `O grupo tem ${uso.contas_no_grupo} conta(s). Elas não são excluídas: passam para o grupo que você escolher.`
                      : "O grupo está vazio."}
                  </p>
                  {uso.contas_no_grupo ? (
                    <Campo rotulo="As contas vão para" htmlFor="exc-destino">
                      <Select id="exc-destino" value={destino} onChange={(ev) => setDestino(ev.target.value)}>
                        <option value="">Sem grupo</option>
                        {destinos.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.codigo} {g.nome}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  ) : null}
                </>
              ) : movidos ? (
                <>
                  <p>
                    Esta conta tem{" "}
                    {[
                      uso.lancamentos ? `${uso.lancamentos} lançamento(s)` : null,
                      uso.recorrencias ? `${uso.recorrencias} lançamento(s) que se repetem` : null,
                      uso.ajustes ? `${uso.ajustes} ajuste(s) no resultado` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Para não perder nada, eles passam para outra conta antes da exclusão.
                  </p>
                  <Campo
                    rotulo="Mover os lançamentos para"
                    htmlFor="exc-destino"
                    obrigatorio
                    ajuda={exigeDreNoDestino ? "Como há ajustes no resultado, escolha uma conta que aparece no DRE." : "Só aparecem contas ativas do mesmo tipo (receita ou despesa)."}
                  >
                    <Select id="exc-destino" value={destino} onChange={(ev) => setDestino(ev.target.value)}>
                      <option value="">Selecione...</option>
                      {destinos
                        .filter((c) => !exigeDreNoDestino || tipoEntraNoDre(c.tipo))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.codigo} {c.nome}
                          </option>
                        ))}
                    </Select>
                  </Campo>
                </>
              ) : (
                <p>A conta não tem lançamentos. Ela será excluída do plano de contas.</p>
              )}
              <p className="text-xs text-muted-foreground">A exclusão fica registrada no histórico, com quem fez e quando.</p>
            </>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variante="contorno" onClick={aoFechar}>
              Cancelar
            </Button>
            {uso && bloqueada && conta.ativa && !conta.sintetica ? (
              <Button type="button" disabled={enviando} onClick={() => executar(() => desativarCategoria(empresaId, conta.id))}>
                Desativar a conta
              </Button>
            ) : null}
            {uso && !bloqueada ? (
              <Button type="button" variante="perigo" disabled={enviando || destinoInvalido} onClick={() => executar(() => excluirCategoria(empresaId, conta.id, destino || null))}>
                {enviando ? <Loader2 className="animate-spin" /> : <Trash2 />} {precisaDestino ? "Mover e excluir" : "Excluir"}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
