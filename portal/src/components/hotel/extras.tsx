"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, BedDouble, Building2, Car, ConciergeBell, FileText, Loader2, Minus, Pencil, Plus, Search, Shirt, Soup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { CampoValor } from "@/components/ui/campo-valor";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Decimal, formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import {
  buscarEmpresaHotel,
  cadastrarEmpresaHospede,
  cadastrarEmpresaHotel,
  cancelarReciboExtra,
  lancarExtras,
  lancarExtrasEmpresa,
  salvarExtra,
  type EmpresaClienteHotel,
} from "@/lib/hotel/acoes";
import { FORMAS_PAGAMENTO_HOTEL, NATUREZAS_EXTRA, UNIDADES_EXTRA, quantidadeExtra, type NaturezaExtra, type UnidadeExtra } from "@/lib/hotel/rotulos";
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

/** Formas de quem paga na hora (o "faturado" do hóspede, aqui, é o "a prazo"). */
const FORMAS_NA_HORA = ["dinheiro", "pix", "cartao_debito", "cartao_credito", "transferencia", "outro"] as const;

function somarDias(dataIso: string, dias: number) {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Lançar serviços extras: na conta do quarto de quem está hospedado, ou para
 * uma empresa (sem hóspede), que recebe um recibo numerado. A recepção escolhe
 * a quantidade de cada um (marmitas, peças, dias de aluguel) e o total é
 * quantidade × preço.
 */
export function LancarExtras({
  empresaId,
  extras,
  hospedagens,
  empresas: empresasIniciais = [],
  reservaFixa,
  gerente,
  hoje,
}: {
  empresaId: string;
  extras: ExtraForm[];
  hospedagens: HospedagemExtra[];
  /** Empresas (clientes do Financeiro) para o lançamento sem hóspede; sem a lista, só a conta do quarto. */
  empresas?: EmpresaClienteHotel[];
  reservaFixa?: string;
  gerente: boolean;
  hoje: string;
}) {
  const router = useRouter();
  const comEmpresa = !reservaFixa;
  const [para, setPara] = React.useState<"hospede" | "empresa">(reservaFixa || hospedagens.length ? "hospede" : "empresa");
  const [reserva, setReserva] = React.useState(reservaFixa ?? "");
  const [empresas, setEmpresas] = React.useState(empresasIniciais);
  const [empresa, setEmpresa] = React.useState("");
  const [solicitante, setSolicitante] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [pagamento, setPagamento] = React.useState<"na_hora" | "a_prazo">("na_hora");
  const [forma, setForma] = React.useState("");
  const [vencimento, setVencimento] = React.useState(() => somarDias(hoje, 30));
  const [data, setData] = React.useState(hoje);
  const [qtd, setQtd] = React.useState<Record<string, string>>({});
  const [preco, setPreco] = React.useState<Record<string, string>>({});
  const [ultimo, setUltimo] = React.useState<{ id: string; numero: number } | null>(null);
  const [pendente, iniciar] = React.useTransition();
  const entrada = hospedagens.find((h) => h.reserva_id === reserva)?.entrada;
  const paraEmpresa = para === "empresa";

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

  const itensEscolhidos = () =>
    escolhidos.map((e) => {
      const p = precoDe(e);
      return { extra_id: e.id, quantidade: qtd[e.id], valor_unitario: p.eq(e.preco) ? null : p.toString().replace(".", ",") };
    });

  function limpar() {
    setQtd({});
    setPreco({});
    setData(hoje);
  }

  function lancar() {
    if (paraEmpresa) {
      if (!empresa) return void toast.error("Escolha a empresa que pediu os serviços.");
      if (pagamento === "na_hora" && !forma) return void toast.error("Escolha como a empresa pagou.");
      if (pagamento === "a_prazo" && !vencimento) return void toast.error("Informe o vencimento.");
      iniciar(async () => {
        const r = await lancarExtrasEmpresa(empresaId, {
          contraparte_id: empresa,
          solicitante,
          observacao,
          data: data === hoje ? null : data,
          pagamento,
          forma: pagamento === "na_hora" ? forma : null,
          vencimento: pagamento === "a_prazo" ? vencimento : null,
          itens: itensEscolhidos(),
        });
        if (r.ok && r.dados) {
          toast.success(r.mensagem ?? "Recibo gerado.");
          setUltimo(r.dados);
          limpar();
          setSolicitante("");
          setObservacao("");
          router.refresh();
        } else toast.error(r.mensagem ?? "Não foi possível lançar.");
      });
      return;
    }
    if (!reserva) return void toast.error("Escolha o quarto do hóspede.");
    iniciar(async () => {
      const r = await lancarExtras(empresaId, reserva, itensEscolhidos(), data === hoje ? null : data);
      if (r.ok) {
        toast.success(r.mensagem ?? "Lançado.");
        limpar();
        if (!reservaFixa) setReserva("");
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível lançar.");
    });
  }

  return (
    <div className="space-y-4">
      {ultimo ? (
        <Alerta tom="sucesso" titulo={`Recibo nº ${ultimo.numero} gerado`}>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild tamanho="sm">
              <a href={`/api/hotel/${empresaId}/recibos/${ultimo.id}`} target="_blank" rel="noopener">
                <FileText /> Abrir o recibo (PDF)
              </a>
            </Button>
            <Button type="button" variante="contorno" tamanho="sm" onClick={() => setUltimo(null)}>
              Fechar
            </Button>
          </div>
        </Alerta>
      ) : null}
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
          {comEmpresa ? (
            <div role="radiogroup" aria-label="Lançar para" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm">
              {(
                [
                  ["hospede", "Hóspede", BedDouble],
                  ["empresa", "Empresa", Building2],
                ] as const
              ).map(([v, rotulo, Icone]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={para === v}
                  onClick={() => setPara(v)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-medium transition",
                    para === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icone className="size-4" /> {rotulo}
                </button>
              ))}
            </div>
          ) : null}

          {!paraEmpresa ? (
            !reservaFixa ? (
              hospedagens.length ? (
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
              ) : (
                <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Nenhum hóspede na casa agora. Para quem não está hospedado, escolha <strong>Empresa</strong>.
                </p>
              )
            ) : null
          ) : (
            <>
              <Campo rotulo="Empresa" htmlFor="ex-empresa" ajuda="Do cadastro de clientes do Financeiro.">
                <div className="flex gap-2">
                  <Select id="ex-empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="min-w-0 flex-1">
                    <option value="">{empresas.length ? "Escolha..." : "Cadastre a empresa →"}</option>
                    {empresas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                  <DialogoEmpresaHotel
                    empresaId={empresaId}
                    aoCadastrar={(c) => {
                      setEmpresas((l) => (l.some((x) => x.id === c.id) ? l : [...l, c].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))));
                      setEmpresa(c.id);
                    }}
                  />
                </div>
              </Campo>
              <Campo rotulo="Quem pediu (opcional)" htmlFor="ex-solicitante" ajuda="Funcionário, obra ou setor da empresa. Sai no recibo.">
                <Input id="ex-solicitante" value={solicitante} onChange={(e) => setSolicitante(e.target.value)} maxLength={120} placeholder="Ex.: Eng. Paulo, obra da ponte" />
              </Campo>
            </>
          )}

          <Campo
            rotulo="Data do serviço"
            htmlFor="ex-data"
            ajuda={paraEmpresa ? "Deixe hoje, ou volte a data (até 90 dias) para lançar algo esquecido." : "Deixe hoje, ou volte a data para lançar algo esquecido da estadia."}
          >
            <Input id="ex-data" type="date" value={data} min={paraEmpresa ? somarDias(hoje, -90) : entrada} max={hoje} onChange={(e) => setData(e.target.value || hoje)} />
          </Campo>

          {paraEmpresa ? (
            <>
              <div role="radiogroup" aria-label="Pagamento" className="space-y-1.5 text-sm">
                <span className="font-medium">Pagamento</span>
                {(
                  [
                    ["na_hora", "Pagou na hora"],
                    ["a_prazo", "Vai pagar depois (a prazo)"],
                  ] as const
                ).map(([v, rotulo]) => (
                  <label key={v} className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="ex-pagamento" value={v} checked={pagamento === v} onChange={() => setPagamento(v)} className="accent-primary" />
                    {rotulo}
                  </label>
                ))}
              </div>
              {pagamento === "na_hora" ? (
                <Campo rotulo="Forma de pagamento" htmlFor="ex-forma" ajuda="Entra no Financeiro já recebido. Com o seu caixa aberto, entra também no caixa do dia.">
                  <Select id="ex-forma" value={forma} onChange={(e) => setForma(e.target.value)}>
                    <option value="">Escolha...</option>
                    {FORMAS_NA_HORA.map((f) => (
                      <option key={f} value={f}>
                        {FORMAS_PAGAMENTO_HOTEL[f]}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : (
                <Campo rotulo="Vencimento" htmlFor="ex-vencimento" ajuda="Entra no Financeiro como conta a receber da empresa.">
                  <Input id="ex-vencimento" type="date" value={vencimento} min={hoje} onChange={(e) => setVencimento(e.target.value)} />
                </Campo>
              )}
              <Campo rotulo="Observação (opcional)" htmlFor="ex-obs">
                <Input id="ex-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={300} placeholder="Ex.: entregue na obra às 11h30" />
              </Campo>
            </>
          ) : null}

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
              <p className="text-sm text-muted-foreground">Informe a quantidade de cada serviço{paraEmpresa ? " pedido" : " usado"}.</p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <strong className="text-lg numero">{formatarMoeda(total)}</strong>
          </div>
          <Button type="button" className="w-full" disabled={!escolhidos.length || pendente || (!paraEmpresa && !reservaFixa && !hospedagens.length)} onClick={lancar}>
            {pendente ? <Loader2 className="animate-spin" /> : paraEmpresa ? <FileText /> : null} {paraEmpresa ? "Lançar e gerar recibo" : "Lançar na conta do quarto"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Cadastro rápido de empresa pelo CNPJ (dados da Receita): a que pede serviços
 * extras (cliente do Financeiro) ou, com `comoHospede`, a que faz a reserva no
 * nome dela (hóspede pessoa jurídica, que também vira cliente do Financeiro).
 */
export function DialogoEmpresaHotel({
  empresaId,
  aoCadastrar,
  comoHospede = false,
  rotuloBotao,
}: {
  empresaId: string;
  aoCadastrar: (c: EmpresaClienteHotel) => void;
  comoHospede?: boolean;
  /** Botão com texto (sem ele, só o ícone "+"). */
  rotuloBotao?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [doc, setDoc] = React.useState("");
  const [nome, setNome] = React.useState("");
  const [telefone, setTelefone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [erros, setErros] = React.useState<Record<string, string[] | undefined>>({});
  const [buscando, setBuscando] = React.useState(false);
  const [salvando, iniciar] = React.useTransition();

  async function buscar() {
    setBuscando(true);
    const r = await buscarEmpresaHotel(empresaId, doc);
    setBuscando(false);
    if (r.ok && r.dados) {
      setNome(r.dados.nome);
      if (r.dados.telefone) setTelefone(r.dados.telefone);
      if (r.dados.email) setEmail(r.dados.email);
      toast.success(r.mensagem ?? "Dados preenchidos.");
    } else toast.error(r.mensagem ?? "Não foi possível consultar.");
  }

  function salvar() {
    iniciar(async () => {
      const r = await (comoHospede ? cadastrarEmpresaHospede : cadastrarEmpresaHotel)(empresaId, { nome, documento: doc, telefone, email });
      if (r.ok && r.dados) {
        toast.success(r.mensagem ?? "Empresa cadastrada.");
        aoCadastrar(r.dados);
        setAberto(false);
        setDoc("");
        setNome("");
        setTelefone("");
        setEmail("");
        setErros({});
      } else {
        setErros(r.erros ?? {});
        toast.error(r.mensagem ?? "Não foi possível cadastrar.");
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {rotuloBotao ? (
          <Button type="button" variante="contorno" tamanho="sm">
            <Building2 /> {rotuloBotao}
          </Button>
        ) : (
          <Button type="button" variante="contorno" tamanho="icone" aria-label="Cadastrar empresa">
            <Plus />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo="Cadastrar empresa"
        descricao={
          comoHospede
            ? "A reserva fica no nome da empresa e é faturada para ela. Quem se hospedou pela empresa é informado na reserva, até o check-out."
            : "Digite o CNPJ e busque os dados na Receita. A empresa entra nos clientes do Financeiro."
        }
      >
        <div className="space-y-4">
          <Campo rotulo={comoHospede ? "CNPJ" : "CNPJ (ou CPF)"} htmlFor="emp-doc" obrigatorio erro={erros.documento}>
            <div className="flex gap-2">
              <Input id="emp-doc" value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" className="min-w-0 flex-1" />
              <Button type="button" variante="contorno" onClick={buscar} disabled={buscando || doc.replace(/\D/g, "").length !== 14}>
                {buscando ? <Loader2 className="animate-spin" /> : <Search />} Buscar na Receita
              </Button>
            </div>
          </Campo>
          <Campo rotulo="Nome da empresa" htmlFor="emp-nome" obrigatorio erro={erros.nome}>
            <Input id="emp-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Telefone" htmlFor="emp-tel">
              <Input id="emp-tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" maxLength={20} />
            </Campo>
            <Campo rotulo="E-mail" htmlFor="emp-email" erro={erros.email}>
              <Input id="emp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <Button type="button" onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 className="animate-spin" /> : null} Salvar empresa
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cancela o recibo de serviços extras (gerente), com o motivo. */
export function CancelarRecibo({ empresaId, reciboId, numero }: { empresaId: string; reciboId: string; numero: number }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="fantasma" tamanho="iconeSm" aria-label={`Cancelar o recibo nº ${numero}`}>
          <Ban />
        </Button>
      </DialogTrigger>
      <DialogContent titulo={`Cancelar o recibo nº ${numero}`} descricao="O recibo fica marcado como cancelado e o lançamento do Financeiro é cancelado junto.">
        <FormularioAcao acao={cancelarReciboExtra.bind(null, empresaId, reciboId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Motivo" htmlFor={`cr-${reciboId}`} obrigatorio erro={estado.erros?.motivo}>
                <Input id={`cr-${reciboId}`} name="motivo" maxLength={300} placeholder="Ex.: lançado em dobro" />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante="perigo">
                  Cancelar recibo
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

