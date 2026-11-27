"use client";

import * as React from "react";
import { Ban, Check, CheckCircle2, Copy, HandCoins, Plus, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import {
  aprovarCobrancas,
  baixarCobranca,
  cancelarCobranca,
  estornarCobranca,
  gerarCobrancasDoMes,
  salvarCobranca,
} from "@/lib/honorarios/acoes";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { FORMAS_PAGAMENTO } from "@/lib/recibos/comum";
import { cn } from "@/lib/utils";

/** Gera as cobranças mensais (rascunho) das fichas ativas para um mês de referência. */
export function GerarMes({ meses, padrao }: { meses: { valor: string; rotulo: string }[]; padrao: string }) {
  return (
    <FormularioAcao acao={gerarCobrancasDoMes} className="flex flex-wrap items-end gap-2">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Mês de referência" htmlFor="gerar-mes" className="min-w-44">
            <Select id="gerar-mes" name="competencia" defaultValue={padrao}>
              {meses.map((m) => (
                <option key={m.valor} value={m.valor}>
                  {m.rotulo}
                </option>
              ))}
            </Select>
          </Campo>
          <BotaoEnviar pendente={pendente} variante="contorno" textoPendente="Gerando...">
            <HandCoins /> Gerar cobranças do mês
          </BotaoEnviar>
          {estado.mensagem && !estado.ok ? <p className="w-full text-sm text-perigo">{estado.mensagem}</p> : null}
        </>
      )}
    </FormularioAcao>
  );
}

/** Cobranças "para conferir" com seleção: "Enviar aos clientes" aprova as marcadas. */
export function ListaParaConferir({
  linhas,
}: {
  linhas: { id: string; numero: string; pagador_nome: string; descricao: string; valor: number; vencimento: string }[];
}) {
  const ids = linhas.map((l) => l.id);
  const [marcados, setMarcados] = React.useState<Set<string>>(() => new Set(ids));
  const alternar = (id: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const lista = ids.filter((id) => marcados.has(id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Checkbox
          id="marcar-todas"
          checked={lista.length === ids.length && ids.length > 0}
          onChange={(e) => setMarcados(e.target.checked ? new Set(ids) : new Set())}
        />
        <label htmlFor="marcar-todas" className="text-sm">
          {lista.length} de {ids.length} marcada(s) · {formatarMoeda(linhas.filter((l) => marcados.has(l.id)).reduce((t, l) => t + Number(l.valor), 0))}
        </label>
        <BotaoAcao
          className="ml-auto"
          acao={() => aprovarCobrancas(lista)}
          disabled={!lista.length}
          confirmar={{
            titulo: `Enviar ${lista.length} cobrança(s) aos clientes?`,
            descricao: "Cada cliente recebe a cobrança com o Pix por e-mail e WhatsApp (os canais ligados) e um aviso no portal. Depois disso, o robô manda os lembretes da régua.",
            textoConfirmar: "Enviar",
          }}
        >
          <Send /> Enviar aos clientes
        </BotaoAcao>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {linhas.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <Checkbox checked={marcados.has(c.id)} onChange={() => alternar(c.id)} aria-label={`Marcar ${c.pagador_nome}`} />
            <a href={`/escritorio/honorarios/cobrancas/${c.id}`} className="min-w-0 flex-1 hover:text-primary">
              <span className="block truncate text-sm font-medium">{c.pagador_nome}</span>
              <span className="block truncate text-xs text-muted-foreground">
                nº {c.numero} · {c.descricao}
              </span>
            </a>
            <span className="text-right text-sm">
              <span className="block font-semibold">{formatarMoeda(c.valor)}</span>
              <span className="block text-xs text-muted-foreground">vence {c.vencimento.split("-").reverse().join("/")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CopiarPix({ codigo, className }: { codigo: string; className?: string }) {
  const [copiado, setCopiado] = React.useState(false);
  return (
    <Button
      type="button"
      variante="contorno"
      tamanho="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(codigo);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2500);
        } catch {
          setCopiado(false);
        }
      }}
    >
      {copiado ? <Check /> : <Copy />} {copiado ? "Copiado!" : "Copiar Pix copia e cola"}
    </Button>
  );
}

/** Registrar pagamento recebido (baixa). */
export function BaixarCobranca({
  id,
  valor,
  valorHoje,
  hoje,
  rotulo,
}: {
  id: string;
  valor: string;
  /** Valor com multa e juros até hoje (igual ao valor sem atraso). */
  valorHoje: string;
  hoje: string;
  rotulo: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [pago, setPago] = React.useState(valorHoje);
  const recebido = lerValorBR(pago);
  const diferenca = recebido ? recebido.minus(valor) : null;
  return (
    <>
      <Button variante="sucesso" onClick={() => setAberto(true)}>
        <CheckCircle2 /> Registrar pagamento
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo={`Pagamento recebido — ${rotulo}`}
          descricao="O valor entra na DRE do escritório (cada item na sua linha; multa e juros à parte) e, se ligado nas configurações, o recibo sai assinado e vai para o cliente."
        >
          <FormularioAcao acao={baixarCobranca.bind(null, id)} manterAoErrar aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Data do pagamento" htmlFor="baixa-data" erro={estado.erros?.pago_em} obrigatorio>
                    <Input id="baixa-data" name="pago_em" type="date" defaultValue={hoje} max={hoje} />
                  </Campo>
                  <Campo rotulo="Valor recebido" htmlFor="baixa-valor" erro={estado.erros?.valor_pago} obrigatorio>
                    <CampoValor id="baixa-valor" name="valor_pago" valorInicial={valorHoje} aoMudar={setPago} />
                  </Campo>
                </div>
                {diferenca && diferenca.greaterThan(0) ? (
                  <p className="text-xs text-muted-foreground">{formatarMoeda(diferenca)} acima do valor da cobrança entram como multa e juros por atraso.</p>
                ) : null}
                {diferenca && diferenca.lessThan(0) ? (
                  <Campo rotulo="Desconto dado" htmlFor="baixa-desconto" erro={estado.erros?.desconto} ajuda="O valor recebido ficou abaixo da cobrança: o desconto aparece na DRE como dedução.">
                    <CampoValor id="baixa-desconto" name="desconto" valorInicial={diferenca.abs().toFixed(2)} key={diferenca.toFixed(2)} />
                  </Campo>
                ) : null}
                <Campo rotulo="Forma de pagamento" htmlFor="baixa-forma" erro={estado.erros?.forma_pagamento}>
                  <Select id="baixa-forma" name="forma_pagamento" defaultValue="pix">
                    {Object.entries(FORMAS_PAGAMENTO).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Observação (opcional)" htmlFor="baixa-obs">
                  <Input id="baixa-obs" name="observacao" maxLength={300} />
                </Campo>
                {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="sucesso" textoPendente="Registrando...">
                    <CheckCircle2 /> Registrar pagamento
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

/** Cancelar (rascunho ou aberta) ou desfazer pagamento, com motivo. */
export function AcaoComMotivo({ id, tipo }: { id: string; tipo: "cancelar" | "estornar" }) {
  const [aberto, setAberto] = React.useState(false);
  const cancelar = tipo === "cancelar";
  return (
    <>
      <Button variante={cancelar ? "fantasma" : "contorno"} onClick={() => setAberto(true)}>
        {cancelar ? <Ban /> : <Undo2 />} {cancelar ? "Cancelar cobrança" : "Desfazer pagamento"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo={cancelar ? "Cancelar a cobrança?" : "Desfazer o pagamento?"}
          descricao={
            cancelar
              ? "Ela continua na lista, marcada como cancelada, e os lembretes que estavam na fila não saem mais."
              : "Use quando o pagamento foi lançado por engano: os lançamentos saem da DRE, o recibo emitido é cancelado e a cobrança volta a ficar em aberto."
          }
        >
          <FormularioAcao acao={(cancelar ? cancelarCobranca : estornarCobranca).bind(null, id)} aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Motivo" htmlFor={`motivo-${tipo}`} erro={estado.erros?.motivo} obrigatorio>
                  <Textarea id={`motivo-${tipo}`} name="motivo" rows={3} maxLength={300} />
                </Campo>
                {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo">
                    {cancelar ? <Ban /> : <RotateCcw />} {cancelar ? "Cancelar cobrança" : "Desfazer pagamento"}
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

// -----------------------------------------------------------------------------
// Nova cobrança (avulsa) ou edição
// -----------------------------------------------------------------------------
export interface CategoriaReceita {
  id: string;
  codigo: string;
  nome: string;
  chave: string | null;
}
interface ItemEdicao {
  chave: number;
  descricao: string;
  categoria_id: string;
  quantidade: string;
  valor_unitario: string;
}

export function FormularioCobranca({
  empresas,
  categorias,
  inicial,
  hoje,
}: {
  empresas: { id: string; nome: string; email: string | null; whatsapp: string | null; autorizado: boolean }[];
  categorias: CategoriaReceita[];
  hoje: string;
  inicial?: {
    id: string;
    pagador: string;
    descricao: string;
    vencimento: string;
    contato_email: string | null;
    contato_whatsapp: string | null;
    whatsapp_autorizado: boolean;
    situacao: string;
    itens: { descricao: string; categoria_id: string; quantidade: number; valor_unitario: number }[];
  };
}) {
  const padraoCategoria = categorias.find((c) => c.chave === "SERV_AVULSO")?.id ?? categorias[0]?.id ?? "";
  const [modo, setModo] = React.useState<"carteira" | "avulso">(empresas.length ? "carteira" : "avulso");
  const [empresaId, setEmpresaId] = React.useState("");
  const empresa = empresas.find((e) => e.id === empresaId);
  // Chave de cada linha na tela (as novas continuam depois das iniciais; só lida ao incluir)
  const contador = React.useRef(Math.max(inicial?.itens.length ?? 0, 1));
  const [itens, setItens] = React.useState<ItemEdicao[]>(() =>
    inicial?.itens.length
      ? inicial.itens.map((i, n) => ({ chave: n, descricao: i.descricao, categoria_id: i.categoria_id, quantidade: String(i.quantidade), valor_unitario: Number(i.valor_unitario).toFixed(2) }))
      : [{ chave: 0, descricao: "", categoria_id: padraoCategoria, quantidade: "1", valor_unitario: "" }],
  );
  const total = itens.reduce((t, i) => {
    const v = lerValorBR(i.valor_unitario);
    const q = Number(i.quantidade.replace(",", "."));
    return v && Number.isFinite(q) ? t.plus(v.times(q)) : t;
  }, lerValorBR("0")!);
  const mudar = (chave: number, campo: keyof ItemEdicao, valor: string) => setItens((l) => l.map((i) => (i.chave === chave ? { ...i, [campo]: valor } : i)));

  return (
    <FormularioAcao acao={salvarCobranca} manterAoErrar className="space-y-5">
      {({ estado, pendente }) => (
        <>
          {inicial ? <input type="hidden" name="id" value={inicial.id} /> : <input type="hidden" name="modo" value={modo} />}
          <input
            type="hidden"
            name="itens"
            value={JSON.stringify(itens.map((i) => ({ descricao: i.descricao, categoria_id: i.categoria_id, quantidade: i.quantidade, valor_unitario: i.valor_unitario })))}
          />
          {inicial ? (
            <p className="text-sm">
              Para: <strong>{inicial.pagador}</strong>
            </p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Para quem é a cobrança?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["carteira", "Empresa da carteira", "Nome, CNPJ e contatos vêm do cadastro."],
                    ["avulso", "Outra pessoa ou empresa", "Ex.: imposto de renda de pessoa física."],
                  ] as const
                ).map(([valor, titulo, ajuda]) => (
                  <label
                    key={valor}
                    className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm", modo === valor ? "border-primary bg-secondary" : "border-border hover:border-primary/40")}
                  >
                    <input type="radio" name="modo_escolha" value={valor} checked={modo === valor} onChange={() => setModo(valor)} className="mt-0.5 accent-[var(--primary)]" />
                    <span>
                      <span className="block font-medium">{titulo}</span>
                      <span className="block text-xs text-muted-foreground">{ajuda}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {!inicial && modo === "carteira" ? (
            <Campo rotulo="Empresa" htmlFor="cob-empresa" erro={estado.erros?.empresa_id} obrigatorio>
              <Select id="cob-empresa" name="empresa_id" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
                <option value="">Escolha a empresa...</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : null}
          {!inicial && modo === "avulso" ? (
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Campo rotulo="Nome" htmlFor="cob-nome" erro={estado.erros?.pagador_nome} obrigatorio>
                <Input id="cob-nome" name="pagador_nome" maxLength={200} autoComplete="off" />
              </Campo>
              <Campo rotulo="CPF ou CNPJ" htmlFor="cob-doc" erro={estado.erros?.pagador_documento}>
                <Input id="cob-doc" name="pagador_documento" inputMode="numeric" maxLength={20} autoComplete="off" />
              </Campo>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Campo rotulo="O que está sendo cobrado" htmlFor="cob-desc" erro={estado.erros?.descricao} obrigatorio ajuda="Aparece no e-mail, no WhatsApp e na DRE.">
              <Input id="cob-desc" name="descricao" maxLength={200} defaultValue={inicial?.descricao} placeholder="Ex.: Declaração de imposto de renda 2027" />
            </Campo>
            <Campo rotulo="Vencimento" htmlFor="cob-venc" erro={estado.erros?.vencimento} obrigatorio>
              <Input id="cob-venc" name="vencimento" type="date" defaultValue={inicial?.vencimento} min={inicial ? undefined : hoje} />
            </Campo>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Itens (cada um vai para a sua linha da DRE)</legend>
            {estado.erros?.itens ? <p className="text-xs text-perigo">{estado.erros.itens[0]}</p> : null}
            {itens.map((i, n) => (
              <div key={i.chave} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[2fr_1.4fr_70px_120px_auto] sm:items-end">
                <Campo rotulo="Descrição" htmlFor={`item-desc-${i.chave}`}>
                  <Input id={`item-desc-${i.chave}`} value={i.descricao} onChange={(e) => mudar(i.chave, "descricao", e.target.value)} maxLength={200} />
                </Campo>
                <Campo rotulo="Linha da DRE" htmlFor={`item-cat-${i.chave}`}>
                  <Select id={`item-cat-${i.chave}`} value={i.categoria_id} onChange={(e) => mudar(i.chave, "categoria_id", e.target.value)}>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Qtde." htmlFor={`item-qtd-${i.chave}`}>
                  <Input id={`item-qtd-${i.chave}`} inputMode="decimal" value={i.quantidade} onChange={(e) => mudar(i.chave, "quantidade", e.target.value)} />
                </Campo>
                <Campo rotulo="Valor" htmlFor={`item-valor-${i.chave}`}>
                  <CampoValor id={`item-valor-${i.chave}`} valorInicial={i.valor_unitario} aoMudar={(t) => mudar(i.chave, "valor_unitario", t)} />
                </Campo>
                <Button
                  type="button"
                  variante="fantasma"
                  tamanho="icone"
                  aria-label={`Tirar o item ${n + 1}`}
                  disabled={itens.length === 1}
                  onClick={() => setItens((l) => l.filter((x) => x.chave !== i.chave))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variante="contorno"
                tamanho="sm"
                onClick={() => setItens((l) => [...l, { chave: contador.current++, descricao: "", categoria_id: padraoCategoria, quantidade: "1", valor_unitario: "" }])}
              >
                <Plus /> Incluir item
              </Button>
              <p className="text-sm">
                Total: <strong>{formatarMoeda(total)}</strong>
              </p>
            </div>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium sm:col-span-2">Para onde mandar</legend>
            <Campo rotulo="E-mail" htmlFor="cob-email" erro={estado.erros?.contato_email}>
              <Input id="cob-email" name="contato_email" type="email" key={`e-${empresaId}`} defaultValue={inicial?.contato_email ?? empresa?.email ?? ""} />
            </Campo>
            <Campo rotulo="WhatsApp" htmlFor="cob-zap" erro={estado.erros?.contato_whatsapp}>
              <Input id="cob-zap" name="contato_whatsapp" inputMode="tel" key={`w-${empresaId}`} defaultValue={inicial?.contato_whatsapp ?? empresa?.whatsapp ?? ""} placeholder="(63) 99999-0000" />
            </Campo>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <Checkbox name="whatsapp_autorizado" key={`a-${empresaId}`} defaultChecked={inicial?.whatsapp_autorizado ?? empresa?.autorizado ?? false} />
              <span>O cliente autorizou receber cobranças por WhatsApp neste número.</span>
            </label>
          </fieldset>

          {!inicial ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="aprovar" defaultChecked />
              <span>Enviar ao cliente agora (sem marcar, a cobrança fica em “Para conferir”).</span>
            </label>
          ) : inicial.situacao === "aberta" ? (
            <Alerta tom="info">A cobrança já foi enviada. Depois de salvar, use “Reenviar ao cliente” para mandar a versão corrigida.</Alerta>
          ) : null}
          {estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{inicial ? "Salvar alterações" : "Criar cobrança"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
