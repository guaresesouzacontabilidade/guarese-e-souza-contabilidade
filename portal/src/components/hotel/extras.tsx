"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Car, ConciergeBell, Loader2, Minus, Pencil, Plus, Shirt, Soup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { lancarExtras, salvarExtra } from "@/lib/hotel/acoes";
import { NATUREZAS_EXTRA, UNIDADES_EXTRA, quantidadeExtra, type NaturezaExtra, type UnidadeExtra } from "@/lib/hotel/rotulos";
import { cn } from "@/lib/utils";

export interface ExtraForm {
  id: string;
  nome: string;
  natureza: NaturezaExtra;
  unidade: UnidadeExtra;
  preco: number;
  ativo: boolean;
}

export const ICONES_EXTRA: Record<NaturezaExtra, typeof Soup> = { alimentacao: Soup, lavanderia: Shirt, locacao: Car, outro: ConciergeBell };

/** Cadastro (gerente) de um serviço extra com preço fixo. */
export function DialogoExtra({
  empresaId,
  extra,
  modelo,
}: {
  empresaId: string;
  extra?: ExtraForm;
  modelo?: { nome: string; natureza: NaturezaExtra; unidade: UnidadeExtra };
}) {
  const [aberto, setAberto] = React.useState(false);
  const base = extra ?? modelo;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {extra ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Editar ${extra.nome}`}>
            <Pencil />
          </Button>
        ) : modelo ? (
          <Button variante="contorno" tamanho="sm">
            <Plus /> {modelo.nome}
          </Button>
        ) : (
          <Button variante="contorno">
            <Plus /> Novo serviço
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={extra ? extra.nome : "Novo serviço extra"}
        descricao="A recepção só informa a quantidade: o preço vem daqui. Preço diferente na hora, só o gerente lança."
      >
        <FormularioAcao acao={salvarExtra.bind(null, empresaId, extra?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Nome" htmlFor="ex-nome" obrigatorio erro={estado.erros?.nome}>
                <Input id="ex-nome" name="nome" maxLength={80} defaultValue={base?.nome} placeholder="Marmita, Lavanderia (por peça), Aluguel de carro" />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo" htmlFor="ex-natureza" obrigatorio erro={estado.erros?.natureza} ajuda="Separa a receita no relatório e na contabilidade.">
                  <Select id="ex-natureza" name="natureza" defaultValue={base?.natureza ?? "alimentacao"}>
                    {Object.entries(NATUREZAS_EXTRA).map(([v, n]) => (
                      <option key={v} value={v}>
                        {n.rotulo}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Cobrado por" htmlFor="ex-unidade" obrigatorio erro={estado.erros?.unidade}>
                  <Select id="ex-unidade" name="unidade" defaultValue={base?.unidade ?? "unidade"}>
                    {Object.entries(UNIDADES_EXTRA).map(([v, u]) => (
                      <option key={v} value={v}>
                        {u.um}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <Campo rotulo="Preço" htmlFor="ex-preco" obrigatorio erro={estado.erros?.preco} ajuda="Por unidade: por marmita, por peça, por dia...">
                <CampoValor id="ex-preco" name="preco" valorInicial={extra?.preco} />
              </Campo>
              {extra ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativo_presente" value="1" />
                  <Checkbox name="ativo" defaultChecked={extra.ativo} /> Em uso (desmarque para tirar da tela de lançamento)
                </label>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar serviço</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export interface HospedagemExtra {
  reserva_id: string;
  quarto: string;
  hospede: string;
  entrada: string;
}

/**
 * Lançar serviços extras na conta do quarto: a recepção escolhe a quantidade
 * de cada um (marmitas, peças, dias de aluguel) e o total é quantidade × preço.
 */
export function LancarExtras({
  empresaId,
  extras,
  hospedagens,
  reservaFixa,
  gerente,
  hoje,
}: {
  empresaId: string;
  extras: ExtraForm[];
  hospedagens: HospedagemExtra[];
  reservaFixa?: string;
  gerente: boolean;
  hoje: string;
}) {
  const router = useRouter();
  const [reserva, setReserva] = React.useState(reservaFixa ?? "");
  const [data, setData] = React.useState(hoje);
  const [qtd, setQtd] = React.useState<Record<string, string>>({});
  const [preco, setPreco] = React.useState<Record<string, string>>({});
  const [pendente, iniciar] = React.useTransition();
  const entrada = hospedagens.find((h) => h.reserva_id === reserva)?.entrada;

  const precoDe = (e: ExtraForm) => (gerente && preco[e.id] ? lerValorBR(preco[e.id]) : null) ?? new Decimal(e.preco);
  const escolhidos = extras.filter((e) => lerValorBR(qtd[e.id] ?? "")?.gt(0));
  const total = escolhidos.reduce((s, e) => s.plus(precoDe(e).times(lerValorBR(qtd[e.id])!)), new Decimal(0));
  const grupos = (Object.keys(NATUREZAS_EXTRA) as NaturezaExtra[]).map((n) => ({ natureza: n, itens: extras.filter((e) => e.natureza === n) })).filter((g) => g.itens.length);

  function somar(e: ExtraForm, delta: number) {
    setQtd((a) => {
      const q = Math.max((lerValorBR(a[e.id] ?? "")?.toNumber() ?? 0) + delta, 0);
      return { ...a, [e.id]: q ? String(q).replace(".", ",") : "" };
    });
  }

  function lancar() {
    if (!reserva) {
      toast.error("Escolha o quarto do hóspede.");
      return;
    }
    iniciar(async () => {
      const r = await lancarExtras(
        empresaId,
        reserva,
        escolhidos.map((e) => {
          const p = precoDe(e);
          return { extra_id: e.id, quantidade: qtd[e.id], valor_unitario: p.eq(e.preco) ? null : p.toString().replace(".", ",") };
        }),
        data === hoje ? null : data,
      );
      if (r.ok) {
        toast.success(r.mensagem ?? "Lançado.");
        setQtd({});
        setPreco({});
        setData(hoje);
        if (!reservaFixa) setReserva("");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível lançar.");
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {grupos.map((g) => {
          const Icone = ICONES_EXTRA[g.natureza];
          return (
            <section key={g.natureza} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Icone className="size-4" /> {NATUREZAS_EXTRA[g.natureza].rotulo}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.itens.map((e) => {
                  const q = lerValorBR(qtd[e.id] ?? "");
                  const u = UNIDADES_EXTRA[e.unidade];
                  return (
                    <div key={e.id} className={cn("rounded-xl border bg-card p-3 text-sm transition", q?.gt(0) ? "border-primary/50 bg-primary/5" : "border-border")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-medium">{e.nome}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatarMoeda(e.preco)} por {u.um}
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label={`Menos ${e.nome}`} onClick={() => somar(e, -1)}>
                            <Minus />
                          </Button>
                          <Input
                            value={qtd[e.id] ?? ""}
                            onChange={(ev) => setQtd((a) => ({ ...a, [e.id]: ev.target.value.replace(/[^\d,.]/g, "") }))}
                            className="h-8 w-16 text-center"
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`Quantidade de ${e.nome} (${u.varios})`}
                          />
                          <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label={`Mais ${e.nome}`} onClick={() => somar(e, 1)}>
                            <Plus />
                          </Button>
                        </div>
                      </div>
                      {gerente && q?.gt(0) ? (
                        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-muted-foreground">
                          <label htmlFor={`ex-preco-${e.id}`}>Preço combinado por {u.um}</label>
                          <CampoValor
                            id={`ex-preco-${e.id}`}
                            valorInicial={lerValorBR(preco[e.id] ?? "")?.toNumber() ?? e.preco}
                            aoMudar={(t) => setPreco((a) => ({ ...a, [e.id]: t }))}
                            className="h-8 w-28"
                            aria-label={`Preço de ${e.nome}`}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="h-fit space-y-3 rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-4">
        {!reservaFixa ? (
          <Campo rotulo="Quarto (hóspede na casa)" htmlFor="ex-reserva">
            <Select id="ex-reserva" value={reserva} onChange={(e) => setReserva(e.target.value)}>
              <option value="">Escolha...</option>
              {hospedagens.map((h) => (
                <option key={h.reserva_id} value={h.reserva_id}>
                  Quarto {h.quarto} — {h.hospede}
                </option>
              ))}
            </Select>
          </Campo>
        ) : null}
        <Campo rotulo="Data do serviço" htmlFor="ex-data" ajuda="Deixe hoje, ou volte a data para lançar algo esquecido da estadia.">
          <Input id="ex-data" type="date" value={data} min={entrada} max={hoje} onChange={(e) => setData(e.target.value || hoje)} />
        </Campo>
        <div className="space-y-1.5 border-t border-border pt-3">
          {escolhidos.length ? (
            escolhidos.map((e) => {
              const q = lerValorBR(qtd[e.id])!;
              return (
                <div key={e.id} className="flex justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    {e.nome}
                    <span className="block text-xs text-muted-foreground">
                      {quantidadeExtra(q.toNumber(), e.unidade)} × {formatarMoeda(precoDe(e))}
                    </span>
                  </span>
                  <span className="shrink-0 numero">{formatarMoeda(precoDe(e).times(q))}</span>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">Informe a quantidade de cada serviço usado.</p>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <strong className="text-lg numero">{formatarMoeda(total)}</strong>
        </div>
        <Button type="button" className="w-full" disabled={!escolhidos.length || pendente} onClick={lancar}>
          {pendente ? <Loader2 className="animate-spin" /> : null} Lançar na conta do quarto
        </Button>
      </div>
    </div>
  );
}
