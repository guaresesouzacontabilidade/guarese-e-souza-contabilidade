"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { previsaoOs, salvarOs, type DadosOs } from "@/lib/os/acoes";
import { formatarEntrega, formatarMinutos, minutosDoItem, PRIORIDADE } from "@/lib/os/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarDocumento, formatarTelefone } from "@/lib/formatos";

export interface ServicoOs {
  id: string;
  nome: string;
  unidade: string;
  minutos_por_unidade: number | string;
  minutos_fixos: number | string;
  valor_unitario: number | string;
  setor: string | null;
  ativo: boolean;
}

export interface PessoaOs {
  id: string;
  nome: string;
  cor: string;
  ativo: boolean;
}

interface Linha {
  chave: number;
  servico_id: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  minutos: string;
  valor: string;
}

export interface OsInicial {
  id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_documento: string | null;
  descricao: string | null;
  observacoes: string | null;
  prioridade: string;
  responsavel_id: string | null;
  prazo: string | null;
  itens: { servico_id: string | null; descricao: string; quantidade: number | string; unidade: string; minutos_estimados: number | string; valor_unitario: number | string }[];
}

const numero = (v: string) => Number(String(v).replace(/\./g, "").replace(",", ".")) || 0;
const decimalBr = (v: number | string) => String(Number(v) || 0).replace(".", ",");

/** ISO → "AAAA-MM-DDTHH:MM" no horário de Brasília/Tocantins (para o campo de data e hora). */
function paraCampo(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(new Date(ts).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function FormOs({
  empresaId,
  servicos,
  equipe,
  inicial,
  aoSalvar,
}: {
  empresaId: string;
  servicos: ServicoOs[];
  equipe: PessoaOs[];
  inicial?: OsInicial | null;
  aoSalvar?: (id: string) => void;
}) {
  const router = useRouter();
  const ativos = servicos.filter((s) => s.ativo || inicial?.itens.some((i) => i.servico_id === s.id));
  const novaLinha = (chave: number): Linha => ({ chave, servico_id: ativos[0]?.id ?? "", descricao: "", quantidade: "1", unidade: "un", minutos: "", valor: "" });
  const seq = React.useRef((inicial?.itens.length ?? 1) + 1);
  const [cliente, setCliente] = React.useState({
    nome: inicial?.cliente_nome ?? "",
    telefone: inicial?.cliente_telefone ? formatarTelefone(inicial.cliente_telefone) : "",
    documento: inicial?.cliente_documento ? formatarDocumento(inicial.cliente_documento) : "",
  });
  const [linhas, setLinhas] = React.useState<Linha[]>(() =>
    inicial?.itens.length
      ? inicial.itens.map((i, n) => ({
          chave: n + 1,
          servico_id: i.servico_id ?? "",
          descricao: i.servico_id ? "" : i.descricao,
          quantidade: decimalBr(i.quantidade),
          unidade: i.unidade,
          minutos: i.servico_id ? "" : decimalBr(i.minutos_estimados),
          valor: decimalBr(i.valor_unitario),
        }))
      : [novaLinha(1)],
  );
  const [prioridade, setPrioridade] = React.useState(inicial?.prioridade ?? "normal");
  const [responsavel, setResponsavel] = React.useState(inicial?.responsavel_id ?? "");
  const [prazo, setPrazo] = React.useState(paraCampo(inicial?.prazo ?? null));
  const [descricao, setDescricao] = React.useState(inicial?.descricao ?? "");
  const [observacoes, setObservacoes] = React.useState(inicial?.observacoes ?? "");
  const [previsao, setPrevisao] = React.useState<string | null>(null);
  const [calculando, setCalculando] = React.useState(false);
  const [erros, setErros] = React.useState<Record<string, string[] | undefined>>({});
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [pendente, iniciar] = React.useTransition();

  const porId = React.useMemo(() => new Map(servicos.map((s) => [s.id, s])), [servicos]);
  const calc = linhas.map((l) => {
    const s = l.servico_id ? porId.get(l.servico_id) : undefined;
    const q = numero(l.quantidade);
    const minutos = minutosDoItem(s ?? null, q, numero(l.minutos));
    const unit = l.valor.trim() ? numero(l.valor) : s ? Number(s.valor_unitario) : 0;
    return { minutos, valor: Math.round(unit * q * 100) / 100, unidade: s?.unidade ?? (l.unidade || "un") };
  });
  const totalMin = calc.reduce((s, c) => s + c.minutos, 0);
  const totalValor = calc.reduce((s, c) => s + c.valor, 0);

  // Previsão ao vivo (só na abertura)
  React.useEffect(() => {
    if (inicial) return;
    const t = window.setTimeout(async () => {
      setCalculando(true);
      setPrevisao(await previsaoOs(empresaId, totalMin, prioridade));
      setCalculando(false);
    }, 500);
    return () => window.clearTimeout(t);
  }, [empresaId, totalMin, prioridade, inicial]);

  const mudar = (chave: number, campo: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...campo } : l)));

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErros({});
    setErroGeral(null);
    const dados: DadosOs = {
      cliente_nome: cliente.nome,
      cliente_telefone: cliente.telefone,
      cliente_documento: cliente.documento,
      descricao,
      observacoes,
      prioridade,
      responsavel_id: responsavel || null,
      prazo,
      itens: linhas.map((l) => ({
        servico_id: l.servico_id || null,
        descricao: l.descricao,
        quantidade: numero(l.quantidade),
        unidade: l.unidade,
        minutos: numero(l.minutos),
        valor_unitario: l.valor.trim() ? numero(l.valor) : null,
      })),
    };
    iniciar(async () => {
      const r = await salvarOs(empresaId, inicial?.id ?? null, dados);
      if (r.ok && r.dados) {
        toast.success(r.mensagem ?? "OS salva.");
        router.refresh();
        aoSalvar?.(r.dados.id);
      } else {
        setErros(r.erros ?? {});
        setErroGeral(r.mensagem ?? "Não foi possível salvar a OS.");
      }
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-5" noValidate>
      {erroGeral ? <Alerta tom="perigo">{erroGeral}</Alerta> : null}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Cliente</h3>
        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <Campo rotulo="Nome" htmlFor="os-cliente" obrigatorio erro={erros.cliente_nome} className="sm:col-span-3">
            <Input id="os-cliente" value={cliente.nome} onChange={(e) => setCliente({ ...cliente, nome: e.target.value })} autoFocus={!inicial} />
          </Campo>
          <Campo rotulo="Telefone (WhatsApp)" htmlFor="os-telefone">
            <Input id="os-telefone" inputMode="tel" placeholder="(63) 99999-0000" value={cliente.telefone} onChange={(e) => setCliente({ ...cliente, telefone: e.target.value })} />
          </Campo>
          <Campo rotulo="CPF ou CNPJ" htmlFor="os-documento">
            <Input id="os-documento" inputMode="numeric" value={cliente.documento} onChange={(e) => setCliente({ ...cliente, documento: e.target.value })} />
          </Campo>
          <Campo rotulo="Prioridade" htmlFor="os-prioridade">
            <Select id="os-prioridade" value={prioridade} onChange={(e) => setPrioridade(e.target.value)}>
              {Object.entries(PRIORIDADE)
                .sort((a, b) => b[1].peso - a[1].peso)
                .map(([v, p]) => (
                  <option key={v} value={v}>
                    {p.rotulo}
                  </option>
                ))}
            </Select>
          </Campo>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Serviços</h3>
          <Button type="button" variante="contorno" tamanho="sm" onClick={() => {
              const chave = seq.current++;
              setLinhas((ls) => [...ls, novaLinha(chave)]);
            }} disabled={linhas.length >= 60}>
            <Plus /> Serviço
          </Button>
        </div>
        {erros.itens ? <p className="text-xs text-perigo">{erros.itens[0]}</p> : null}
        <div className="space-y-2">
          {linhas.map((l, i) => {
            const c = calc[i];
            return (
              <div key={l.chave} className="grid grid-cols-6 items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,2fr)_5.5rem_6rem_6.5rem_auto]" data-testid="linha-servico">
                <Campo rotulo="Serviço" htmlFor={`os-serv-${l.chave}`} className="col-span-6 sm:col-span-1">
                  <Select id={`os-serv-${l.chave}`} value={l.servico_id} onChange={(e) => mudar(l.chave, { servico_id: e.target.value, valor: "" })}>
                    {ativos.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome} ({formatarMinutos(Number(s.minutos_por_unidade))}/{s.unidade}
                        {Number(s.minutos_fixos) ? ` + ${formatarMinutos(Number(s.minutos_fixos))}` : ""})
                      </option>
                    ))}
                    <option value="">Outro serviço (avulso)</option>
                  </Select>
                </Campo>
                {!l.servico_id ? (
                  <>
                    <Campo rotulo="Descrição do serviço" htmlFor={`os-desc-${l.chave}`} className="col-span-6 sm:col-span-5">
                      <Input id={`os-desc-${l.chave}`} value={l.descricao} onChange={(e) => mudar(l.chave, { descricao: e.target.value })} placeholder="Ex.: Montagem de prateleira" />
                    </Campo>
                    <Campo rotulo="Tempo (min)" htmlFor={`os-min-${l.chave}`} className="col-span-3 sm:col-span-1">
                      <Input id={`os-min-${l.chave}`} inputMode="decimal" value={l.minutos} onChange={(e) => mudar(l.chave, { minutos: e.target.value })} />
                    </Campo>
                  </>
                ) : null}
                <Campo rotulo={`Quantidade (${c.unidade})`} htmlFor={`os-qtd-${l.chave}`} className="col-span-3 sm:col-span-1">
                  <Input id={`os-qtd-${l.chave}`} inputMode="decimal" value={l.quantidade} onChange={(e) => mudar(l.chave, { quantidade: e.target.value })} />
                </Campo>
                <Campo rotulo="Valor unit. (R$)" htmlFor={`os-valor-${l.chave}`} className="col-span-3 sm:col-span-1">
                  <Input
                    id={`os-valor-${l.chave}`}
                    inputMode="decimal"
                    value={l.valor}
                    placeholder={l.servico_id ? decimalBr(porId.get(l.servico_id)?.valor_unitario ?? 0) : "0,00"}
                    onChange={(e) => mudar(l.chave, { valor: e.target.value })}
                  />
                </Campo>
                <div className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:pb-2.5">
                  <p className="font-medium text-foreground">{formatarMinutos(c.minutos)}</p>
                  <p>{formatarMoeda(c.valor)}</p>
                </div>
                <Button
                  type="button"
                  variante="fantasma"
                  tamanho="iconeSm"
                  className="col-span-1 justify-self-end sm:mb-1"
                  onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}
                  disabled={linhas.length === 1}
                  aria-label={`Remover o serviço ${i + 1}`}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span>
            Tempo estimado: <strong data-testid="os-total-tempo">{formatarMinutos(totalMin)}</strong>
          </span>
          <span>
            Valor: <strong>{formatarMoeda(totalValor)}</strong>
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Entrega</h3>
        {!inicial ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info-bg/50 px-3 py-2 text-sm" data-testid="os-previsao">
            <CalendarClock className="size-4 text-info" aria-hidden />
            {calculando ? <Loader2 className="size-4 animate-spin" /> : null}
            <span>
              Previsão pela fila de hoje: <strong>{previsao ? formatarEntrega(previsao) : "—"}</strong>
            </span>
            {previsao ? (
              <Button type="button" variante="link" tamanho="sm" onClick={() => setPrazo(paraCampo(previsao))}>
                Usar como prazo
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <Campo rotulo="Prazo combinado com o cliente" htmlFor="os-prazo" ajuda="Opcional. Sem prazo, o atraso é contado pela previsão.">
            <Input id="os-prazo" type="datetime-local" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </Campo>
          <Campo rotulo="Responsável" htmlFor="os-responsavel">
            <Select id="os-responsavel" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Definir depois</option>
              {equipe
                .filter((p) => p.ativo || p.id === responsavel)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
            </Select>
          </Campo>
          <Campo rotulo="O que fazer (medidas, cores, detalhes)" htmlFor="os-descricao" className="sm:col-span-2">
            <Textarea id="os-descricao" rows={3} maxLength={2000} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </Campo>
          <Campo rotulo="Observações internas" htmlFor="os-obs" className="sm:col-span-2">
            <Textarea id="os-obs" rows={2} maxLength={2000} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </Campo>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pendente}>
          {pendente ? <Loader2 className="animate-spin" /> : null}
          {inicial ? "Salvar alterações" : "Abrir OS"}
        </Button>
      </div>
    </form>
  );
}
