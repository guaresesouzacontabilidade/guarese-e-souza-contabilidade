"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Scale, XCircle } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Confirmacao } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { lerValorBR } from "@/lib/dinheiro";
import { formatarDocumento } from "@/lib/formatos";
import { cancelarOrdem, registrarPesagem, salvarOrdem } from "@/lib/gestao/acoes-carregamento";
import { FRETE_POR_CONTA, formatarKg, mostrarPlaca, quantidadePelaPesagem } from "@/lib/gestao/carregamentos";
import { formatarQuantidade } from "@/lib/gestao/rotulos";

export interface OpcoesOrdem {
  produtos: {
    id: string;
    descricao: string;
    unidade: string;
    peso_kg: number | null;
    valor_unitario: number | null;
  }[];
  compradores: { id: string; nome: string; documento: string | null }[];
  transportadores: {
    id: string;
    nome: string;
    documento: string | null;
    placa: string | null;
    placa_uf: string | null;
    rntc: string | null;
  }[];
  emitentes: { id: string; nome: string; inscricao: string }[];
  operacoes: { id: string; nome: string; cfop: string }[];
}

/** Dados de uma ordem já salva, para editar. */
export interface OrdemEditavel {
  id: string;
  produto_id: string;
  quantidade: string;
  peso_previsto_kg: string | null;
  preco_unitario: string | null;
  contrato: string | null;
  destinatario_id: string | null;
  destinatario_nome: string;
  destinatario_documento: string | null;
  local_carregamento: string | null;
  local_descarga: string | null;
  emitente_id: string | null;
  operacao_id: string | null;
  validade: string | null;
  frete_por_conta: number;
  transportador_id: string | null;
  transportador_nome: string | null;
  rntrc: string | null;
  motorista_nome: string | null;
  motorista_cpf: string | null;
  placa: string | null;
  placa_uf: string | null;
  placas_reboque: string[];
  observacoes: string | null;
}

const UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");

/** Número do banco ("1234.5") → campo em português ("1234,5"). */
const campoNumero = (v: string | null | undefined, casas = 4) => (v == null || v === "" ? "" : formatarQuantidade(v, casas).replace(/\./g, ""));

export function FormOrdem({ empresaId, ordem, opcoes }: { empresaId: string; ordem: OrdemEditavel | null; opcoes: OpcoesOrdem }) {
  const router = useRouter();
  const o = ordem;
  const [produtoId, setProdutoId] = React.useState(o?.produto_id ?? (opcoes.produtos.length === 1 ? opcoes.produtos[0].id : ""));
  const [quantidade, setQuantidade] = React.useState(campoNumero(o?.quantidade));
  const [compradorId, setCompradorId] = React.useState(o ? (o.destinatario_id ?? "outro") : "");
  const [transportadorId, setTransportadorId] = React.useState(o ? (o.transportador_id ?? (o.transportador_nome ? "outro" : "")) : "");
  const [placa, setPlaca] = React.useState(o?.placa ?? "");
  const [placaUf, setPlacaUf] = React.useState(o?.placa_uf ?? "");
  const [rntrc, setRntrc] = React.useState(o?.rntrc ?? "");
  const produto = opcoes.produtos.find((p) => p.id === produtoId);
  const qtd = lerValorBR(quantidade);
  const pesoCalculado = produto?.peso_kg && qtd ? qtd.times(produto.peso_kg) : null;

  const escolherTransportador = (id: string) => {
    setTransportadorId(id);
    const t = opcoes.transportadores.find((x) => x.id === id);
    if (t) {
      if (t.placa) setPlaca(t.placa);
      if (t.placa_uf) setPlacaUf(t.placa_uf);
      if (t.rntc) setRntrc(t.rntc);
    }
  };

  return (
    <FormularioAcao
      acao={salvarOrdem.bind(null, empresaId, o?.id ?? null)}
      atualizarAoSucesso={false}
      aoSucesso={(r) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        if (id) router.push(`/e/${empresaId}/loja/carregamentos/${id}`);
      }}
      className="space-y-6"
    >
      {({ estado, pendente }) => (
        <>
          <section className="space-y-4">
            <h2 className="font-semibold">Venda</h2>
            <div className="grid gap-4 sm:grid-cols-[1fr_160px_160px]">
              <Campo rotulo="Produto" htmlFor="produto_id" obrigatorio erro={estado.erros?.produto_id}>
                <Select id="produto_id" name="produto_id" value={produtoId} onChange={(e) => setProdutoId(e.target.value)}>
                  <option value="">Escolha...</option>
                  {opcoes.produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.descricao} ({p.unidade}
                      {p.peso_kg && p.unidade.toUpperCase() !== "KG" ? ` de ${formatarQuantidade(p.peso_kg, 3)} kg` : ""})
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo={`Quantidade${produto ? ` (${produto.unidade})` : ""}`} htmlFor="quantidade" obrigatorio erro={estado.erros?.quantidade}>
                <Input
                  id="quantidade"
                  name="quantidade"
                  inputMode="decimal"
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  placeholder="Ex.: 600"
                />
              </Campo>
              <Campo
                rotulo="Peso previsto (kg)"
                htmlFor="peso_previsto_kg"
                erro={estado.erros?.peso_previsto_kg}
                ajuda={pesoCalculado ? `Em branco: ${formatarKg(pesoCalculado)}.` : "Opcional."}
              >
                <Input id="peso_previsto_kg" name="peso_previsto_kg" inputMode="decimal" defaultValue={campoNumero(o?.peso_previsto_kg, 3)} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo
                rotulo={`Preço por ${produto?.unidade ?? "unidade"} (R$)`}
                htmlFor="preco_unitario"
                erro={estado.erros?.preco_unitario}
                ajuda={
                  produto?.valor_unitario != null && !o?.preco_unitario
                    ? `Em branco: o do cadastro (R$ ${formatarQuantidade(produto.valor_unitario, 4)}).`
                    : "Vai para a NF-e."
                }
              >
                <Input id="preco_unitario" name="preco_unitario" inputMode="decimal" defaultValue={campoNumero(o?.preco_unitario, 6)} />
              </Campo>
              <Campo rotulo="Contrato ou pedido" htmlFor="contrato" ajuda="Ex.: nº do contrato com a trading.">
                <Input id="contrato" name="contrato" maxLength={60} defaultValue={o?.contrato ?? ""} />
              </Campo>
              <Campo rotulo="Válida até" htmlFor="validade" erro={estado.erros?.validade} ajuda="Opcional: depois disso, não carregar.">
                <Input id="validade" name="validade" type="date" defaultValue={o?.validade ?? ""} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                rotulo="Comprador"
                htmlFor="destinatario_id"
                obrigatorio
                erro={estado.erros?.destinatario_id}
                ajuda="Os compradores são os clientes cadastrados na NF-e."
              >
                <Select
                  id="destinatario_id"
                  name="destinatario_id"
                  value={compradorId === "outro" ? "" : compradorId}
                  onChange={(e) => setCompradorId(e.target.value || "outro")}
                >
                  <option value="">{compradorId === "outro" ? "Outro (digitar abaixo)" : "Escolha..."}</option>
                  {opcoes.compradores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.documento ? ` — ${formatarDocumento(c.documento)}` : ""}
                    </option>
                  ))}
                </Select>
              </Campo>
              {compradorId === "outro" || (!compradorId && !opcoes.compradores.length) ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome do comprador" htmlFor="destinatario_nome">
                    <Input
                      id="destinatario_nome"
                      name="destinatario_nome"
                      maxLength={120}
                      defaultValue={o?.destinatario_id ? "" : (o?.destinatario_nome ?? "")}
                    />
                  </Campo>
                  <Campo rotulo="CPF ou CNPJ" htmlFor="destinatario_documento">
                    <Input
                      id="destinatario_documento"
                      name="destinatario_documento"
                      inputMode="numeric"
                      defaultValue={o?.destinatario_id ? "" : (o?.destinatario_documento ?? "")}
                    />
                  </Campo>
                </div>
              ) : (
                <div className="flex items-end">
                  <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setCompradorId("outro")}>
                    Comprador sem cadastro? Digitar o nome
                  </Button>
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Local de carregamento" htmlFor="local_carregamento" ajuda="Armazém, silo ou fazenda.">
                <Input id="local_carregamento" name="local_carregamento" maxLength={300} defaultValue={o?.local_carregamento ?? ""} />
              </Campo>
              <Campo rotulo="Local de descarga" htmlFor="local_descarga" ajuda="Destino: armazém do comprador, porto, indústria.">
                <Input id="local_descarga" name="local_descarga" maxLength={300} defaultValue={o?.local_descarga ?? ""} />
              </Campo>
            </div>
            {opcoes.emitentes.length > 1 || opcoes.operacoes.length > 1 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {opcoes.emitentes.length > 1 ? (
                  <Campo rotulo="Quem vende (inscrição)" htmlFor="emitente_id" ajuda="Em branco: a escolhida nas configurações.">
                    <Select id="emitente_id" name="emitente_id" defaultValue={o?.emitente_id ?? ""}>
                      <option value="">Padrão</option>
                      {opcoes.emitentes.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.nome} — IE {e.inscricao}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                ) : null}
                {opcoes.operacoes.length > 1 ? (
                  <Campo rotulo="Operação da NF-e" htmlFor="operacao_id" ajuda="Ex.: venda dentro de MT ou para outro estado.">
                    <Select id="operacao_id" name="operacao_id" defaultValue={o?.operacao_id ?? ""}>
                      <option value="">Escolher na hora da nota</option>
                      {opcoes.operacoes.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.nome} — CFOP {op.cfop}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold">Transporte</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Frete por conta" htmlFor="frete_por_conta" erro={estado.erros?.frete_por_conta}>
                <Select id="frete_por_conta" name="frete_por_conta" defaultValue={String(o?.frete_por_conta ?? 0)}>
                  {Object.entries(FRETE_POR_CONTA).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Transportadora" htmlFor="transportador_id" ajuda="Cadastradas na NF-e. Autônomo sem cadastro: digite o nome.">
                <Select
                  id="transportador_id"
                  name="transportador_id"
                  value={transportadorId === "outro" ? "" : transportadorId}
                  onChange={(e) => escolherTransportador(e.target.value || "outro")}
                >
                  <option value="">{transportadorId === "outro" ? "Outra (digitar abaixo)" : "Nenhuma / escolher..."}</option>
                  {opcoes.transportadores.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                      {t.documento ? ` — ${formatarDocumento(t.documento)}` : ""}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {transportadorId === "outro" ? (
                <Campo rotulo="Nome da transportadora ou autônomo" htmlFor="transportador_nome">
                  <Input
                    id="transportador_nome"
                    name="transportador_nome"
                    maxLength={60}
                    defaultValue={o?.transportador_id ? "" : (o?.transportador_nome ?? "")}
                  />
                </Campo>
              ) : null}
              <Campo rotulo="RNTRC (ANTT)" htmlFor="rntrc">
                <Input id="rntrc" name="rntrc" maxLength={20} value={rntrc} onChange={(e) => setRntrc(e.target.value)} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Motorista" htmlFor="motorista_nome">
                <Input id="motorista_nome" name="motorista_nome" maxLength={60} defaultValue={o?.motorista_nome ?? ""} />
              </Campo>
              <Campo rotulo="CPF do motorista" htmlFor="motorista_cpf" erro={estado.erros?.motorista_cpf}>
                <Input id="motorista_cpf" name="motorista_cpf" inputMode="numeric" defaultValue={o?.motorista_cpf ? formatarDocumento(o.motorista_cpf) : ""} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_100px]">
              <Campo rotulo="Placa do caminhão (cavalo)" htmlFor="placa" erro={estado.erros?.placa}>
                <Input id="placa" name="placa" maxLength={8} value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" />
              </Campo>
              <Campo rotulo="UF" htmlFor="placa_uf">
                <Select id="placa_uf" name="placa_uf" value={placaUf} onChange={(e) => setPlacaUf(e.target.value)}>
                  <option value="">—</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <Campo key={n} rotulo={`Placa da carreta ${n}`} htmlFor={`reboque_${n}`} erro={n === 1 ? estado.erros?.reboque_1 : undefined}>
                  <Input id={`reboque_${n}`} name={`reboque_${n}`} maxLength={8} defaultValue={o?.placas_reboque[n - 1] ?? ""} className="uppercase" />
                </Campo>
              ))}
            </div>
            <Campo rotulo="Observações" htmlFor="observacoes" ajuda="Saem impressas na ordem. Ex.: carregar só com lona, horário do armazém.">
              <Textarea id="observacoes" name="observacoes" rows={3} maxLength={1000} defaultValue={o?.observacoes ?? ""} />
            </Campo>
          </section>

          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{o ? "Salvar alterações" : "Criar ordem de carregamento"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Pesagem na balança: bruto (carregado) − tara (vazio) = líquido, com a classificação do grão. */
export function FormPesagem({
  empresaId,
  ordemId,
  unidade,
  pesoKgUnidade,
  atual,
}: {
  empresaId: string;
  ordemId: string;
  unidade: string;
  pesoKgUnidade: number | null;
  atual: {
    bruto: string | null;
    tara: string | null;
    umidade: string | null;
    impureza: string | null;
    ticket: string | null;
  } | null;
}) {
  const [bruto, setBruto] = React.useState(campoNumero(atual?.bruto, 3));
  const [tara, setTara] = React.useState(campoNumero(atual?.tara, 3));
  const b = lerValorBR(bruto);
  const t = lerValorBR(tara);
  const liquido = b && t && b.gt(t) ? b.minus(t) : null;
  const naUnidade = liquido ? quantidadePelaPesagem(liquido, unidade, pesoKgUnidade) : null;
  return (
    <FormularioAcao acao={registrarPesagem.bind(null, empresaId, ordemId)} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Peso bruto (kg)" htmlFor="peso_bruto_kg" obrigatorio erro={estado.erros?.peso_bruto_kg} ajuda="Caminhão carregado.">
              <Input id="peso_bruto_kg" name="peso_bruto_kg" inputMode="decimal" value={bruto} onChange={(e) => setBruto(e.target.value)} />
            </Campo>
            <Campo rotulo="Tara (kg)" htmlFor="tara_kg" obrigatorio erro={estado.erros?.tara_kg} ajuda="Caminhão vazio.">
              <Input id="tara_kg" name="tara_kg" inputMode="decimal" value={tara} onChange={(e) => setTara(e.target.value)} />
            </Campo>
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
            Peso líquido: <strong className="numero">{liquido ? formatarKg(liquido) : "—"}</strong>
            {naUnidade && unidade.toUpperCase() !== "KG" ? (
              <>
                {" "}
                = <strong className="numero">{formatarQuantidade(naUnidade)}</strong> {unidade}
              </>
            ) : null}
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Umidade (%)" htmlFor="umidade" erro={estado.erros?.umidade}>
              <Input id="umidade" name="umidade" inputMode="decimal" defaultValue={campoNumero(atual?.umidade, 2)} />
            </Campo>
            <Campo rotulo="Impureza (%)" htmlFor="impureza" erro={estado.erros?.impureza}>
              <Input id="impureza" name="impureza" inputMode="decimal" defaultValue={campoNumero(atual?.impureza, 2)} />
            </Campo>
            <Campo rotulo="Ticket da balança" htmlFor="ticket_balanca">
              <Input id="ticket_balanca" name="ticket_balanca" maxLength={30} defaultValue={atual?.ticket ?? ""} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>
              <Scale /> {atual?.bruto ? "Corrigir a pesagem" : "Registrar a pesagem"}
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function CancelarOrdem({ empresaId, ordemId, placa }: { empresaId: string; ordemId: string; placa: string | null }) {
  const router = useRouter();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno">
          <XCircle /> Cancelar ordem
        </Button>
      }
      titulo="Cancelar esta ordem de carregamento?"
      descricao={`O caminhão${placa ? ` ${mostrarPlaca(placa)}` : ""} não pode mais carregar com ela. O número continua reservado.`}
      textoConfirmar="Cancelar ordem"
      variante="perigo"
      aoConfirmar={async () => {
        if (motivo.trim().length < 3) {
          setErro("Explique o motivo do cancelamento.");
          return false;
        }
        const r = await cancelarOrdem(empresaId, ordemId, motivo);
        if (!r.ok) {
          setErro(r.mensagem ?? "Não foi possível cancelar.");
          return false;
        }
        toast.success("Ordem cancelada.");
        router.refresh();
      }}
    >
      <Campo rotulo="Motivo" htmlFor="motivo-cancelamento" erro={erro}>
        <Textarea id="motivo-cancelamento" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Campo>
    </Confirmacao>
  );
}
