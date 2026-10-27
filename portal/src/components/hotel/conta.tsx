"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Ban, CircleDollarSign, Loader2, LogIn, LogOut, Minus, Percent, Plus, Search, Trash2, Undo2, UtensilsCrossed, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { Alerta } from "@/components/ui/feedback";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import {
  cancelarItemConta,
  cancelarReserva,
  estornarPagamento,
  fazerCheckin,
  fazerCheckout,
  lancarConsumo,
  lancarServico,
  registrarPagamento,
  trocarQuarto,
} from "@/lib/hotel/acoes";
import { FORMAS_PAGAMENTO_HOTEL, MEIOS_TRANSPORTE, MOTIVOS_VIAGEM, SETORES } from "@/lib/hotel/rotulos";

/** Check-in: confirma os dados da viagem da ficha de registro. */
export function DialogoCheckin({
  empresaId,
  reservaId,
  quarto,
  padrao,
  bloqueio,
}: {
  empresaId: string;
  reservaId: string;
  quarto: string;
  padrao: { motivo_viagem: string | null; meio_transporte: string | null; placa_veiculo: string | null; procedencia: string | null; destino: string | null };
  /** Motivo que impede o check-in (mostrado antes de tentar). */
  bloqueio?: string | null;
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="sucesso">
          <LogIn /> Fazer check-in
        </Button>
      </DialogTrigger>
      <DialogContent titulo={`Check-in no quarto ${quarto}`} descricao="Confira os dados da viagem (ficha de registro do hóspede).">
        <FormularioAcao acao={fazerCheckin.bind(null, empresaId, reservaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              {bloqueio ? <Alerta tom="alerta">{bloqueio}</Alerta> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Motivo da viagem" htmlFor="ci-motivo">
                  <Select id="ci-motivo" name="motivo_viagem" defaultValue={padrao.motivo_viagem ?? ""}>
                    <option value="">—</option>
                    {Object.entries(MOTIVOS_VIAGEM).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Meio de transporte" htmlFor="ci-transp">
                  <Select id="ci-transp" name="meio_transporte" defaultValue={padrao.meio_transporte ?? ""}>
                    <option value="">—</option>
                    {Object.entries(MEIOS_TRANSPORTE).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Placa do veículo" htmlFor="ci-placa" erro={estado.erros?.placa_veiculo}>
                  <Input id="ci-placa" name="placa_veiculo" maxLength={8} defaultValue={padrao.placa_veiculo ?? ""} className="uppercase" />
                </Campo>
                <Campo rotulo="Vem de (cidade/UF)" htmlFor="ci-proc">
                  <Input id="ci-proc" name="procedencia" maxLength={120} defaultValue={padrao.procedencia ?? ""} />
                </Campo>
                <Campo rotulo="Próximo destino" htmlFor="ci-dest">
                  <Input id="ci-dest" name="destino" maxLength={120} defaultValue={padrao.destino ?? ""} />
                </Campo>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} textoPendente="Fazendo o check-in...">
                  Confirmar check-in
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoTrocarQuarto({ empresaId, reservaId, quartos }: { empresaId: string; reservaId: string; quartos: { id: string; rotulo: string; livre: boolean }[] }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          <ArrowLeftRight /> Trocar quarto
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Trocar de quarto" descricao="Com o hóspede na casa, a diária combinada continua a mesma e o quarto antigo vai para a limpeza.">
        <FormularioAcao acao={trocarQuarto.bind(null, empresaId, reservaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Novo quarto" htmlFor="tq-quarto" obrigatorio erro={estado.erros?.quarto_id}>
                <Select id="tq-quarto" name="quarto_id" defaultValue="">
                  <option value="">Escolha...</option>
                  {quartos.map((q) => (
                    <option key={q.id} value={q.id} disabled={!q.livre}>
                      {q.rotulo}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Motivo" htmlFor="tq-motivo">
                <Input id="tq-motivo" name="motivo" maxLength={200} placeholder="Ar-condicionado com defeito, pedido do hóspede" />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Trocar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function DialogoCancelarReserva({ empresaId, reservaId, podeNoShow }: { empresaId: string; reservaId: string; podeNoShow: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="sm">
          <Ban /> Cancelar reserva
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Cancelar a reserva" descricao="O quarto fica livre para outra reserva. O sinal recebido continua registrado; para devolver, o gerente estorna o pagamento.">
        <FormularioAcao acao={cancelarReserva.bind(null, empresaId, reservaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="O que aconteceu" htmlFor="cr-tipo">
                <Select id="cr-tipo" name="tipo" defaultValue="cancelada">
                  <option value="cancelada">Cancelada pelo hóspede ou pelo hotel</option>
                  {podeNoShow ? <option value="no_show">Não compareceu (no-show)</option> : null}
                </Select>
              </Campo>
              <Campo rotulo="Motivo" htmlFor="cr-motivo" obrigatorio erro={estado.erros?.motivo}>
                <Input id="cr-motivo" name="motivo" maxLength={500} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante="perigo">
                  Cancelar a reserva
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Serviço (lavanderia, late check-out) ou desconto (gerente) na conta. */
export function DialogoServico({ empresaId, reservaId, desconto = false }: { empresaId: string; reservaId: string; desconto?: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" tamanho="sm">
          {desconto ? <Percent /> : <Wrench />} {desconto ? "Desconto" : "Serviço"}
        </Button>
      </DialogTrigger>
      <DialogContent titulo={desconto ? "Desconto na conta" : "Lançar serviço na conta"} descricao={desconto ? "Só o gerente dá desconto. Fica registrado quem lançou." : "Lavanderia, late check-out, passeio, estacionamento, cama extra..."}>
        <FormularioAcao acao={lancarServico.bind(null, empresaId, reservaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <input type="hidden" name="tipo" value={desconto ? "desconto" : "servico"} />
              <Campo rotulo="Descrição" htmlFor="sv-desc" obrigatorio erro={estado.erros?.descricao}>
                <Input id="sv-desc" name="descricao" maxLength={160} placeholder={desconto ? "Cortesia, cliente frequente" : "Lavanderia (3 peças)"} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Valor" htmlFor="sv-valor" obrigatorio erro={estado.erros?.valor}>
                  <CampoValor id="sv-valor" name="valor" />
                </Campo>
                {!desconto ? (
                  <Campo rotulo="Setor" htmlFor="sv-setor">
                    <Select id="sv-setor" name="setor" defaultValue="recepcao">
                      {Object.entries(SETORES).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                ) : null}
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Lançar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Recebimento (ou sinal) da conta. */
export function DialogoPagamento({
  empresaId,
  reservaId,
  sugerido,
  sinal,
  empresas,
  faturarPadrao,
  hoje,
}: {
  empresaId: string;
  reservaId: string;
  sugerido: number;
  sinal: boolean;
  empresas: { id: string; nome: string }[];
  faturarPadrao: string | null;
  hoje: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [forma, setForma] = React.useState("pix");
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={sinal ? "contorno" : "primario"}>
          <CircleDollarSign /> {sinal ? "Receber sinal" : "Receber pagamento"}
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo={sinal ? "Sinal da reserva" : "Receber pagamento"}
        descricao="O valor entra como recebido no Financeiro, na conta configurada para a forma de pagamento. Com o seu caixa aberto, entra também na conferência do caixa."
      >
        <FormularioAcao acao={registrarPagamento.bind(null, empresaId, reservaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Forma de pagamento" htmlFor="pg-forma" obrigatorio erro={estado.erros?.forma}>
                  <Select id="pg-forma" name="forma" value={forma} onChange={(e) => setForma(e.target.value)}>
                    {Object.entries(FORMAS_PAGAMENTO_HOTEL)
                      .filter(([v]) => v !== "faturado" || empresas.length)
                      .map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                  </Select>
                </Campo>
                <Campo rotulo="Valor" htmlFor="pg-valor" obrigatorio erro={estado.erros?.valor}>
                  <CampoValor id="pg-valor" name="valor" valorInicial={sugerido > 0 ? sugerido : null} />
                </Campo>
              </div>
              {forma === "faturado" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Empresa que paga" htmlFor="pg-empresa" obrigatorio erro={estado.erros?.contraparte_id}>
                    <Select id="pg-empresa" name="contraparte_id" defaultValue={faturarPadrao ?? ""}>
                      <option value="">Escolha...</option>
                      {empresas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Vencimento da fatura" htmlFor="pg-venc" obrigatorio erro={estado.erros?.vencimento}>
                    <Input id="pg-venc" name="vencimento" type="date" min={hoje} />
                  </Campo>
                </div>
              ) : null}
              <Campo rotulo="Observação" htmlFor="pg-obs">
                <Input id="pg-obs" name="observacao" maxLength={300} placeholder={forma.startsWith("cartao") ? "Bandeira e parcelas, ex.: Visa 3x" : ""} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function BotaoCheckout({ empresaId, reservaId, saldo }: { empresaId: string; reservaId: string; saldo: number }) {
  return (
    <BotaoAcao
      variante={saldo === 0 ? "sucesso" : "contorno"}
      acao={fazerCheckout.bind(null, empresaId, reservaId)}
      confirmar={{
        titulo: "Fazer o check-out?",
        descricao:
          saldo === 0
            ? "As diárias até hoje são lançadas na conta, a conta é fechada e o quarto vai para a limpeza."
            : `A conta ainda tem ${saldo > 0 ? `${formatarMoeda(saldo)} a receber` : `${formatarMoeda(-saldo)} pagos a mais`}. Ajuste os pagamentos antes de fechar.`,
        textoConfirmar: "Fazer check-out",
      }}
    >
      <LogOut /> Check-out
    </BotaoAcao>
  );
}

/** Cancela um lançamento da conta (gerente). */
export function CancelarItem({ empresaId, itemId, descricao }: { empresaId: string; itemId: string; descricao: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="iconeSm" aria-label={`Cancelar ${descricao}`}>
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Cancelar lançamento" descricao={`${descricao}. O consumo volta ao estoque.`}>
        <FormularioAcao acao={cancelarItemConta.bind(null, empresaId, itemId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Motivo" htmlFor={`ci-${itemId}`} obrigatorio erro={estado.erros?.motivo}>
                <Input id={`ci-${itemId}`} name="motivo" maxLength={300} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante="perigo">
                  Cancelar lançamento
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function EstornarPagamento({ empresaId, pagamentoId, descricao }: { empresaId: string; pagamentoId: string; descricao: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="iconeSm" aria-label={`Estornar ${descricao}`}>
          <Undo2 />
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Estornar pagamento" descricao={`${descricao}. O lançamento do Financeiro é cancelado.`}>
        <FormularioAcao acao={estornarPagamento.bind(null, empresaId, pagamentoId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Motivo" htmlFor={`ep-${pagamentoId}`} obrigatorio erro={estado.erros?.motivo}>
                <Input id={`ep-${pagamentoId}`} name="motivo" maxLength={300} />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante="perigo">
                  Estornar
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export interface ProdutoConsumo {
  id: string;
  codigo: string;
  descricao: string;
  unidade: string;
  grupo: string | null;
  valor_unitario: number | null;
  estoque_atual: number;
  controla_estoque: boolean;
}

export interface HospedagemConsumo {
  reserva_id: string;
  quarto: string;
  hospede: string;
}

/**
 * Lançar consumo (restaurante, bar, frigobar) na conta do quarto: escolhe os
 * produtos (mesmos do estoque) e as quantidades. Sai do estoque na hora.
 */
export function LancarConsumo({
  empresaId,
  produtos,
  hospedagens,
  reservaFixa,
}: {
  empresaId: string;
  produtos: ProdutoConsumo[];
  hospedagens?: HospedagemConsumo[];
  reservaFixa?: string;
}) {
  const router = useRouter();
  const [reserva, setReserva] = React.useState(reservaFixa ?? "");
  const [setor, setSetor] = React.useState("restaurante");
  const [busca, setBusca] = React.useState("");
  const [itens, setItens] = React.useState<{ produto: ProdutoConsumo; quantidade: string }[]>([]);
  const [pendente, iniciar] = React.useTransition();
  const termo = busca.trim().toLowerCase();
  const grupos = [...new Set(produtos.map((p) => p.grupo).filter(Boolean))] as string[];
  const [grupo, setGrupo] = React.useState<string | null>(null);
  const lista = produtos
    .filter((p) => (!grupo || p.grupo === grupo) && (!termo || p.descricao.toLowerCase().includes(termo) || p.codigo.toLowerCase() === termo))
    .slice(0, 24);
  const total = itens.reduce((s, i) => s.plus(new Decimal(i.produto.valor_unitario ?? 0).times(lerValorBR(i.quantidade) ?? 0)), new Decimal(0));

  function somar(p: ProdutoConsumo, delta: number) {
    setItens((atual) => {
      const i = atual.findIndex((x) => x.produto.id === p.id);
      if (i < 0) return delta > 0 ? [...atual, { produto: p, quantidade: "1" }] : atual;
      const q = (lerValorBR(atual[i].quantidade)?.toNumber() ?? 0) + delta;
      if (q <= 0) return atual.filter((_, k) => k !== i);
      return atual.map((x, k) => (k === i ? { ...x, quantidade: String(q).replace(".", ",") } : x));
    });
  }

  function lancar() {
    if (!reserva) {
      toast.error("Escolha o quarto do hóspede.");
      return;
    }
    iniciar(async () => {
      const r = await lancarConsumo(
        empresaId,
        reserva,
        setor,
        itens.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade })),
      );
      if (r.ok) {
        toast.success(r.mensagem ?? "Lançado.");
        setItens([]);
        if (!reservaFixa) setReserva("");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível lançar.");
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou código..." className="pl-9" aria-label="Buscar produto" />
          </div>
          {grupos.length ? (
            <Select value={grupo ?? ""} onChange={(e) => setGrupo(e.target.value || null)} aria-label="Grupo de produtos" className="w-auto">
              <option value="">Todos os grupos</option>
              {grupos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
        {lista.length ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {lista.map((p) => {
              const semEstoque = p.controla_estoque && p.estoque_atual <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => somar(p, 1)}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-left text-sm transition hover:border-primary/40 hover:bg-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.descricao}</span>
                    <span className={`text-xs ${semEstoque ? "text-perigo" : "text-muted-foreground"}`}>
                      {p.controla_estoque ? `${String(p.estoque_atual).replace(".", ",")} ${p.unidade} no estoque` : p.grupo ?? p.unidade}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{p.valor_unitario != null ? formatarMoeda(p.valor_unitario) : "—"}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhum produto encontrado. Cadastre os alimentos e bebidas em Restaurante e bar → Produtos e estoque.
          </p>
        )}
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        {!reservaFixa ? (
          <Campo rotulo="Quarto (hóspede na casa)" htmlFor="cs-reserva">
            <Select id="cs-reserva" value={reserva} onChange={(e) => setReserva(e.target.value)}>
              <option value="">Escolha...</option>
              {(hospedagens ?? []).map((h) => (
                <option key={h.reserva_id} value={h.reserva_id}>
                  Quarto {h.quarto} — {h.hospede}
                </option>
              ))}
            </Select>
          </Campo>
        ) : null}
        <Campo rotulo="Setor" htmlFor="cs-setor">
          <Select id="cs-setor" value={setor} onChange={(e) => setSetor(e.target.value)}>
            {Object.entries(SETORES)
              .filter(([v]) => v !== "recepcao")
              .map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
          </Select>
        </Campo>
        <div className="space-y-2">
          {itens.length ? (
            itens.map((i) => (
              <div key={i.produto.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.produto.descricao}</span>
                <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label="Menos" onClick={() => somar(i.produto, -1)}>
                  <Minus />
                </Button>
                <Input
                  value={i.quantidade}
                  onChange={(e) => setItens((a) => a.map((x) => (x.produto.id === i.produto.id ? { ...x, quantidade: e.target.value } : x)))}
                  className="h-8 w-14 text-center"
                  inputMode="decimal"
                  aria-label={`Quantidade de ${i.produto.descricao}`}
                />
                <Button type="button" variante="fantasma" tamanho="iconeSm" aria-label="Mais" onClick={() => somar(i.produto, 1)}>
                  <Plus />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              <UtensilsCrossed className="mr-1 inline size-4" /> Toque nos produtos para adicionar.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <strong className="text-lg">{formatarMoeda(total)}</strong>
        </div>
        <Button type="button" className="w-full" disabled={!itens.length || pendente} onClick={lancar}>
          {pendente ? <Loader2 className="animate-spin" /> : null} Lançar na conta do quarto
        </Button>
      </div>
    </div>
  );
}
