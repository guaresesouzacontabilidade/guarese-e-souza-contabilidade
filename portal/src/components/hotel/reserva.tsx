"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BedDouble, CalendarDays, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { Alerta } from "@/components/ui/feedback";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { formatarCpf, formatarTelefone } from "@/lib/formatos";
import { salvarReserva } from "@/lib/hotel/acoes";
import { diariasDaEstadia, type CategoriaPreco, type TarifaPeriodo } from "@/lib/hotel/calculo";
import { LIMPEZA, MEIOS_TRANSPORTE, MOTIVOS_VIAGEM, ORIGENS, diaMes, noites as contarNoites, somarDias, type Limpeza } from "@/lib/hotel/rotulos";
import { CamposHospede } from "./hospede";

export interface QuartoOpcao {
  id: string;
  numero: string;
  categoria_id: string;
  categoria: string;
  capacidade: number;
  limpeza: Limpeza;
}

export interface Ocupacao {
  reserva_id: string;
  quarto_id: string;
  entrada: string;
  saida: string;
  numero: number;
  hospede: string;
}

export interface HospedeOpcaoForm {
  id: string;
  nome: string;
  cpf: string | null;
  documento: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface ReservaEditar {
  id: string;
  status: string;
  hospede_id: string;
  quarto_id: string;
  entrada: string;
  saida: string;
  adultos: number;
  criancas: number;
  origem: string;
  diaria_acordada: number | null;
  empresa_faturar_id: string | null;
  observacoes: string | null;
  motivo_viagem: string | null;
  meio_transporte: string | null;
  placa_veiculo: string | null;
  procedencia: string | null;
  destino: string | null;
  acompanhantes: string[];
}

export function FormReserva({
  empresaId,
  hoje,
  quartos,
  categorias,
  tarifas,
  ocupacoes,
  hospedes,
  empresasFaturar,
  reserva,
  padrao,
}: {
  empresaId: string;
  hoje: string;
  quartos: QuartoOpcao[];
  categorias: (CategoriaPreco & { nome: string })[];
  tarifas: TarifaPeriodo[];
  ocupacoes: Ocupacao[];
  hospedes: HospedeOpcaoForm[];
  empresasFaturar: { id: string; nome: string }[];
  reserva?: ReservaEditar;
  padrao?: { quarto_id?: string; entrada?: string; hospede_id?: string };
}) {
  const router = useRouter();
  const hospedado = reserva?.status === "hospedado";
  const [entrada, setEntrada] = React.useState(reserva?.entrada ?? padrao?.entrada ?? hoje);
  const [saida, setSaida] = React.useState(reserva?.saida ?? somarDias(padrao?.entrada ?? hoje, 1));
  const [quarto, setQuarto] = React.useState(reserva?.quarto_id ?? padrao?.quarto_id ?? "");
  const [adultos, setAdultos] = React.useState(String(reserva?.adultos ?? 2));
  const [criancas, setCriancas] = React.useState(String(reserva?.criancas ?? 0));
  const [acordada, setAcordada] = React.useState(reserva?.diaria_acordada ? formatarMoeda(reserva.diaria_acordada, { semSimbolo: true }) : "");
  const [modoHospede, setModoHospede] = React.useState<"lista" | "novo">(reserva || padrao?.hospede_id || hospedes.length ? "lista" : "novo");
  const [hospede, setHospede] = React.useState(reserva?.hospede_id ?? padrao?.hospede_id ?? "");
  const [busca, setBusca] = React.useState("");
  const [acomp, setAcomp] = React.useState<string[]>(reserva?.acompanhantes ?? []);
  const [buscaAcomp, setBuscaAcomp] = React.useState("");

  const n = contarNoites(entrada, saida);
  const conflito = (q: string) => ocupacoes.find((o) => o.quarto_id === q && o.reserva_id !== reserva?.id && o.entrada < saida && entrada < o.saida);
  const qSel = quartos.find((q) => q.id === quarto);
  const cat = categorias.find((c) => c.id === qSel?.categoria_id);
  const pessoas = (Number(adultos) || 0) + (Number(criancas) || 0);
  const diariaAcordada = acordada ? lerValorBR(acordada)?.toNumber() ?? null : null;
  const previa = cat && n > 0 ? diariasDaEstadia(cat, tarifas, { entrada, saida, adultos: Number(adultos) || 1, diariaAcordada }) : [];
  const totalPrevia = previa.reduce((s, x) => s + x.valor, 0);
  const valoresDiferentes = new Set(previa.map((x) => x.valor)).size > 1;

  const termo = busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const filtrados = hospedes
    .filter((h) => !termo || h.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && ((h.cpf ?? "").includes(digitos) || (h.telefone ?? "").includes(digitos))))
    .slice(0, 50);
  const hSel = hospedes.find((h) => h.id === hospede);
  const termoAcomp = buscaAcomp.trim().toLowerCase();
  const sugestoesAcomp = termoAcomp ? hospedes.filter((h) => h.id !== hospede && !acomp.includes(h.id) && h.nome.toLowerCase().includes(termoAcomp)).slice(0, 6) : [];

  return (
    <FormularioAcao
      acao={salvarReserva.bind(null, empresaId, reserva?.id ?? null)}
      atualizarAoSucesso={false}
      aoSucesso={(r) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        router.push(id ? `/e/${empresaId}/hotel/reservas/${id}` : `/e/${empresaId}/hotel/reservas`);
        router.refresh();
      }}
      className="space-y-6"
    >
      {({ estado, pendente }) => (
        <>
          {/* Hóspede */}
          <section className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <Users className="size-4" /> Hóspede responsável
              </h2>
              {!reserva ? (
                <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
                  <button type="button" className={`rounded-md px-3 py-1 ${modoHospede === "lista" ? "bg-card shadow" : ""}`} onClick={() => setModoHospede("lista")}>
                    Já cadastrado
                  </button>
                  <button type="button" className={`rounded-md px-3 py-1 ${modoHospede === "novo" ? "bg-card shadow" : ""}`} onClick={() => setModoHospede("novo")}>
                    <UserPlus className="mr-1 inline size-3.5" /> Novo hóspede
                  </button>
                </div>
              ) : null}
            </div>
            {modoHospede === "lista" ? (
              <>
                <input type="hidden" name="hospede_id" value={hospede} />
                {hSel ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/50 p-3 text-sm">
                    <div>
                      <p className="font-medium">{hSel.nome}</p>
                      <p className="text-muted-foreground">
                        {[hSel.cpf ? `CPF ${formatarCpf(hSel.cpf)}` : hSel.documento ? `Doc. ${hSel.documento}` : "sem documento", hSel.telefone ? formatarTelefone(hSel.telefone) : null, hSel.cidade ? `${hSel.cidade}${hSel.uf ? `/${hSel.uf}` : ""}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {!reserva ? (
                      <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setHospede("")}>
                        Trocar
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <Campo rotulo="Buscar pelo nome, CPF ou telefone" htmlFor="busca-hospede" erro={estado.erros?.hospede_id}>
                    <Input id="busca-hospede" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite para buscar..." autoComplete="off" />
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border">
                      {filtrados.length ? (
                        filtrados.map((h) => (
                          <button key={h.id} type="button" onClick={() => setHospede(h.id)} className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted">
                            <span className="font-medium">{h.nome}</span>
                            <span className="text-xs text-muted-foreground">{h.cpf ? formatarCpf(h.cpf) : h.telefone ? formatarTelefone(h.telefone) : ""}</span>
                          </button>
                        ))
                      ) : (
                        <p className="p-3 text-sm text-muted-foreground">
                          Nenhum hóspede encontrado.{" "}
                          <button type="button" className="underline" onClick={() => setModoHospede("novo")}>
                            Cadastrar novo
                          </button>
                        </p>
                      )}
                    </div>
                  </Campo>
                )}
              </>
            ) : (
              <CamposHospede prefixo="novo_" erros={estado.erros} completo={false} />
            )}
          </section>

          {/* Estadia */}
          <section className="space-y-4 rounded-2xl border border-border p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarDays className="size-4" /> Estadia
            </h2>
            <div className="grid gap-4 sm:grid-cols-4">
              <Campo rotulo="Entrada" htmlFor="r-entrada" obrigatorio erro={estado.erros?.entrada}>
                <Input
                  id="r-entrada"
                  name="entrada"
                  type="date"
                  value={entrada}
                  readOnly={hospedado}
                  onChange={(e) => {
                    setEntrada(e.target.value);
                    if (e.target.value && saida <= e.target.value) setSaida(somarDias(e.target.value, 1));
                  }}
                />
              </Campo>
              <Campo rotulo="Saída" htmlFor="r-saida" obrigatorio erro={estado.erros?.saida} ajuda={n > 0 ? `${n} noite${n > 1 ? "s" : ""}` : undefined}>
                <Input id="r-saida" name="saida" type="date" value={saida} min={somarDias(entrada, 1)} onChange={(e) => setSaida(e.target.value)} />
              </Campo>
              <Campo rotulo="Adultos" htmlFor="r-adultos" erro={estado.erros?.adultos}>
                <Input id="r-adultos" name="adultos" type="number" min={1} max={20} value={adultos} onChange={(e) => setAdultos(e.target.value)} />
              </Campo>
              <Campo rotulo="Crianças" htmlFor="r-criancas" erro={estado.erros?.criancas}>
                <Input id="r-criancas" name="criancas" type="number" min={0} max={20} value={criancas} onChange={(e) => setCriancas(e.target.value)} />
              </Campo>
            </div>
            <Campo rotulo="Quarto" htmlFor="r-quarto" obrigatorio erro={estado.erros?.quarto_id} ajuda="Os quartos ocupados nestas datas aparecem bloqueados.">
              {hospedado ? <input type="hidden" name="quarto_id" value={quarto} /> : null}
              <Select id="r-quarto" name={hospedado ? undefined : "quarto_id"} value={quarto} disabled={hospedado} onChange={(e) => setQuarto(e.target.value)}>
                <option value="">Escolha...</option>
                {quartos.map((q) => {
                  const c = conflito(q.id);
                  const pequeno = pessoas > q.capacidade;
                  return (
                    <option key={q.id} value={q.id} disabled={(Boolean(c) || pequeno) && q.id !== reserva?.quarto_id}>
                      {q.numero} — {q.categoria} (até {q.capacidade}){c ? ` · ocupado: reserva nº ${c.numero} até ${diaMes(c.saida)}` : pequeno ? " · pequeno para o grupo" : q.limpeza !== "limpo" ? ` · ${LIMPEZA[q.limpeza].toLowerCase()}` : ""}
                    </option>
                  );
                })}
              </Select>
            </Campo>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Origem da reserva" htmlFor="r-origem">
                <Select id="r-origem" name="origem" defaultValue={reserva?.origem ?? "balcao"}>
                  {Object.entries(ORIGENS).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              {!hospedado ? (
                <Campo rotulo="Situação" htmlFor="r-status">
                  <Select id="r-status" name="status" defaultValue={reserva?.status === "pre_reserva" ? "pre_reserva" : "confirmada"}>
                    <option value="confirmada">Confirmada</option>
                    <option value="pre_reserva">Pré-reserva (aguardando confirmação)</option>
                  </Select>
                </Campo>
              ) : null}
              <Campo rotulo="Diária acordada (opcional)" htmlFor="r-acordada" erro={estado.erros?.diaria_acordada} ajuda="Preço negociado por noite. Em branco: tabela.">
                <CampoValor id="r-acordada" name="diaria_acordada" valorInicial={reserva?.diaria_acordada} aoMudar={setAcordada} />
              </Campo>
            </div>
            {cat && previa.length ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-info-bg/60 p-3 text-sm text-info-fg">
                <span className="flex items-center gap-2">
                  <BedDouble className="size-4" />
                  {previa.length} noite{previa.length > 1 ? "s" : ""} em {cat.nome}
                  {valoresDiferentes ? " (com tarifa de período em algumas noites)" : ` × ${formatarMoeda(previa[0].valor)}`}
                </span>
                <strong>Diárias previstas: {formatarMoeda(totalPrevia)}</strong>
              </div>
            ) : null}
            {empresasFaturar.length ? (
              <Campo rotulo="Empresa que paga (faturado)" htmlFor="r-faturar" ajuda="Do cadastro de clientes do Financeiro. A conta pode ser faturada para ela no check-out.">
                <Select id="r-faturar" name="empresa_faturar_id" defaultValue={reserva?.empresa_faturar_id ?? ""}>
                  <option value="">O próprio hóspede paga</option>
                  {empresasFaturar.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
            ) : null}
            <Campo rotulo="Observações" htmlFor="r-obs">
              <Textarea id="r-obs" name="observacoes" rows={2} maxLength={1000} defaultValue={reserva?.observacoes ?? ""} placeholder="Chegada prevista às 22h, berço no quarto, aniversário..." />
            </Campo>
          </section>

          {/* Acompanhantes */}
          {modoHospede === "lista" && hospedes.length ? (
            <section className="space-y-3 rounded-2xl border border-border p-4">
              <h2 className="font-semibold">Acompanhantes (opcional)</h2>
              <input type="hidden" name="acompanhantes_presente" value="1" />
              {acomp.map((id) => {
                const h = hospedes.find((x) => x.id === id);
                return (
                  <div key={id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <input type="hidden" name="acompanhantes" value={id} />
                    <span>{h?.nome ?? "Hóspede"}</span>
                    <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setAcomp((a) => a.filter((x) => x !== id))}>
                      Tirar
                    </Button>
                  </div>
                );
              })}
              <Input value={buscaAcomp} onChange={(e) => setBuscaAcomp(e.target.value)} placeholder="Buscar acompanhante já cadastrado..." aria-label="Buscar acompanhante" />
              {sugestoesAcomp.length ? (
                <div className="rounded-xl border border-border">
                  {sugestoesAcomp.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-0 hover:bg-muted"
                      onClick={() => {
                        setAcomp((a) => [...a, h.id]);
                        setBuscaAcomp("");
                      }}
                    >
                      {h.nome}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">Cadastre antes em Hóspedes quem ainda não tem ficha. Cada acompanhante adulto precisa da própria ficha de registro.</p>
            </section>
          ) : null}

          {/* Ficha da estadia (FNRH) */}
          <details className="rounded-2xl border border-border p-4" open={Boolean(reserva?.motivo_viagem || reserva?.placa_veiculo)}>
            <summary className="cursor-pointer font-semibold">Dados da viagem para a ficha de registro (pode completar no check-in)</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Motivo da viagem" htmlFor="r-motivo">
                <Select id="r-motivo" name="motivo_viagem" defaultValue={reserva?.motivo_viagem ?? ""}>
                  <option value="">—</option>
                  {Object.entries(MOTIVOS_VIAGEM).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Meio de transporte" htmlFor="r-transp">
                <Select id="r-transp" name="meio_transporte" defaultValue={reserva?.meio_transporte ?? ""}>
                  <option value="">—</option>
                  {Object.entries(MEIOS_TRANSPORTE).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Placa do veículo" htmlFor="r-placa" erro={estado.erros?.placa_veiculo}>
                <Input id="r-placa" name="placa_veiculo" maxLength={8} defaultValue={reserva?.placa_veiculo ?? ""} className="uppercase" placeholder="ABC1D23" />
              </Campo>
              <Campo rotulo="Vem de (cidade/UF)" htmlFor="r-proc">
                <Input id="r-proc" name="procedencia" maxLength={120} defaultValue={reserva?.procedencia ?? ""} />
              </Campo>
              <Campo rotulo="Próximo destino" htmlFor="r-dest">
                <Input id="r-dest" name="destino" maxLength={120} defaultValue={reserva?.destino ?? ""} />
              </Campo>
            </div>
          </details>

          {!reserva && entrada === hoje ? (
            <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
              <Checkbox name="checkin_agora" className="mt-0.5" />
              <span>
                <strong>O hóspede já está aqui: fazer o check-in agora</strong>
                <span className="block text-muted-foreground">O quarto precisa estar limpo e o hóspede, com CPF ou outro documento.</span>
              </span>
            </label>
          ) : null}

          {qSel && qSel.limpeza !== "limpo" && entrada === hoje ? (
            <Alerta tom="alerta">O quarto {qSel.numero} está {LIMPEZA[qSel.limpeza].toLowerCase()}: libere-o na governança antes do check-in.</Alerta>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variante="contorno" onClick={() => router.back()}>
              Voltar
            </Button>
            <BotaoEnviar pendente={pendente}>{reserva ? "Salvar alterações" : "Criar reserva"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
