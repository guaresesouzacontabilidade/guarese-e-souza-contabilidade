"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, CircleHelp, KeyRound, Pencil, Plus, ScanSearch, Stamp, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { SeletorMunicipio } from "@/components/obrigacoes/seletor-municipio";
import {
  conferirPedidoGta,
  excluirPedidoGta,
  municipiosGta,
  registrarEmissaoGta,
  removerAcessoSidago,
  salvarAcessoSidago,
  salvarPedidoGta,
} from "@/lib/gta/acoes";
import { ESPECIES_GTA, FAIXAS_GTA, FINALIDADES_GTA, ROTULO_FAIXA, SITUACAO_ACESSO_SIDAGO, TRANSPORTES_GTA } from "@/lib/gta/rotulos";
import type { AnimalGta, ItemConferencia, ResultadoConferencia } from "@/lib/gta/sidago";
import { UFS } from "@/lib/obrigacoes/rotulos";
import { formatarDataHora, formatarDocumento } from "@/lib/formatos";

export interface AcessoSidagoTela {
  login_mascarado: string;
  situacao: string;
  ultimo_teste_em: string | null;
  ultima_mensagem: string | null;
}

export interface EmitenteGta {
  id: string;
  nome: string;
  inscricao_estadual: string;
}

export interface NotaGta {
  id: string;
  numero: number;
  serie: number;
  ambiente: string;
  emitente_id: string;
  destinatario_nome: string;
  destinatario_documento: string | null;
  destino_ie: string | null;
  destino_municipio_ibge: string | null;
  destino_uf: string | null;
  autorizada_em: string | null;
}

export interface PedidoGtaTela {
  id: string;
  emitente_id: string | null;
  nfe_emissao_id: string | null;
  nf_numero: number | null;
  nf_serie: number | null;
  destino_nome: string;
  destino_documento: string | null;
  destino_ie: string | null;
  destino_municipio_ibge: string | null;
  destino_uf: string | null;
  destino_municipio: string | null;
  destino_codigo: string | null;
  finalidade: string;
  especie: string;
  animais: AnimalGta[];
  total_animais: number;
  transporte: string;
  placa: string | null;
  placa_uf: string | null;
  transportador_nome: string | null;
  transportador_documento: string | null;
  data_saida: string;
  observacoes: string | null;
  status: string;
  gta_numero: string | null;
  gta_serie: string | null;
}

export interface ConferenciaTela {
  ok: boolean;
  mensagem: string | null;
  created_at: string;
  mapeamento: (Partial<ResultadoConferencia> & { etapa?: string }) | null;
}

// -----------------------------------------------------------------------------
// Acesso ao SIDAGO
// -----------------------------------------------------------------------------
export function AcessoSidago({ empresaId, acesso, podeConfigurar }: { empresaId: string; acesso: AcessoSidagoTela | null; podeConfigurar: boolean }) {
  const [editando, setEditando] = React.useState(!acesso);
  const sit = acesso ? SITUACAO_ACESSO_SIDAGO[acesso.situacao] : null;
  return (
    <div className="space-y-3">
      {acesso ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          <span>
            Usuário <strong className="font-mono">{acesso.login_mascarado}</strong>
          </span>
          {sit ? <Badge variante={sit.variante}>{sit.rotulo}</Badge> : null}
          {acesso.ultimo_teste_em ? <span className="text-xs text-muted-foreground">em {formatarDataHora(acesso.ultimo_teste_em)}</span> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum acesso cadastrado. O robô fica desconectado até alguém cadastrar o usuário e a senha do produtor no SIDAGO.</p>
      )}
      {acesso?.situacao === "erro" && acesso.ultima_mensagem ? <Alerta tom="perigo">{acesso.ultima_mensagem}</Alerta> : null}
      {!podeConfigurar ? (
        <p className="text-xs text-muted-foreground">Só quem configura a NF-e da empresa cadastra ou troca o acesso.</p>
      ) : editando ? (
        <FormularioAcao acao={salvarAcessoSidago.bind(null, empresaId)} aoSucesso={() => setEditando(false)} manterAoErrar className="space-y-3">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="Usuário do SIDAGO" htmlFor="sidago-login" ajuda="Normalmente o CPF do produtor, só números." erro={estado.erros?.login} obrigatorio>
                  <Input id="sidago-login" name="login" autoComplete="off" inputMode="numeric" />
                </Campo>
                <Campo rotulo="Senha do SIDAGO" htmlFor="sidago-senha" erro={estado.erros?.senha} obrigatorio>
                  <Input id="sidago-senha" name="senha" type="password" autoComplete="new-password" />
                </Campo>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="autorizacao" className="mt-0.5" />
                <span>O produtor autorizou o escritório a usar este acesso para preparar e conferir as GTAs dele.</span>
              </label>
              {estado.erros?.autorizacao ? <p className="text-xs text-perigo">{estado.erros.autorizacao[0]}</p> : null}
              <p className="text-xs text-muted-foreground">
                A senha fica cifrada no servidor e nunca volta para a tela. O robô só entra e lê o formulário da GTA: não emite, não grava e não cancela nada no SIDAGO.
              </p>
              <div className="flex flex-wrap gap-2">
                <BotaoEnviar pendente={pendente}>Guardar acesso</BotaoEnviar>
                {acesso ? (
                  <Button type="button" variante="fantasma" onClick={() => setEditando(false)}>
                    Cancelar
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </FormularioAcao>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variante="contorno" tamanho="sm" onClick={() => setEditando(true)}>
            <Pencil /> Trocar usuário ou senha
          </Button>
          <BotaoAcao
            variante="fantasma"
            tamanho="sm"
            acao={() => removerAcessoSidago(empresaId)}
            confirmar={{ titulo: "Remover o acesso ao SIDAGO?", descricao: "A senha guardada é apagada. O robô fica desconectado até cadastrar de novo.", perigo: true, textoConfirmar: "Remover" }}
          >
            <Trash2 /> Remover
          </BotaoAcao>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pedido de GTA (os dados para a emissão)
// -----------------------------------------------------------------------------
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export function FormPedidoGta({
  empresaId,
  inicial,
  notaInicial,
  emitentes,
  notas,
  aoSalvar,
}: {
  empresaId: string;
  inicial?: PedidoGtaTela | null;
  notaInicial?: string | null;
  emitentes: EmitenteGta[];
  notas: NotaGta[];
  aoSalvar?: () => void;
}) {
  const nota0 = notas.find((n) => n.id === (inicial?.nfe_emissao_id ?? notaInicial)) ?? null;
  const [notaId, setNotaId] = React.useState(nota0?.id ?? "");
  const [emitente, setEmitente] = React.useState(inicial?.emitente_id ?? nota0?.emitente_id ?? (emitentes.length === 1 ? emitentes[0].id : ""));
  const [destino, setDestino] = React.useState({
    nome: inicial?.destino_nome ?? nota0?.destinatario_nome ?? "",
    documento: formatarDocumento(inicial?.destino_documento ?? nota0?.destinatario_documento ?? ""),
    ie: inicial?.destino_ie ?? nota0?.destino_ie ?? "",
  });
  const [mun, setMun] = React.useState({
    uf: inicial?.destino_uf ?? nota0?.destino_uf ?? "GO",
    ibge: inicial?.destino_municipio_ibge ?? nota0?.destino_municipio_ibge ?? "",
    lista: [] as { ibge: string; nome: string }[],
    chave: 0,
  });
  const [transporte, setTransporte] = React.useState(inicial?.transporte ?? "rodoviario");
  const qtd = (sexo: string, faixa: string) => inicial?.animais.find((a) => a.sexo === sexo && a.faixa === faixa)?.quantidade ?? "";
  const [total, setTotal] = React.useState(inicial?.total_animais ?? 0);
  const ref = React.useRef<HTMLDivElement>(null);

  const carregar = React.useCallback((uf: string) => municipiosGta(empresaId, uf), [empresaId]);
  React.useEffect(() => {
    if (mun.uf && !mun.lista.length) carregar(mun.uf).then((lista) => setMun((m) => ({ ...m, lista, chave: m.chave + 1 })));
    // só na abertura: depois o seletor busca sozinho
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolherNota = (id: string) => {
    setNotaId(id);
    const n = notas.find((x) => x.id === id);
    if (!n) return;
    setEmitente(n.emitente_id);
    setDestino({ nome: n.destinatario_nome, documento: formatarDocumento(n.destinatario_documento ?? ""), ie: n.destino_ie ?? "" });
    if (n.destino_uf) {
      const uf = n.destino_uf;
      carregar(uf).then((lista) => setMun((m) => ({ uf, ibge: n.destino_municipio_ibge ?? "", lista, chave: m.chave + 1 })));
    }
  };

  const somar = () => {
    const campos = ref.current?.querySelectorAll<HTMLInputElement>("input[data-animal]") ?? [];
    setTotal([...campos].reduce((s, c) => s + (Number(c.value) || 0), 0));
  };

  return (
    <FormularioAcao acao={salvarPedidoGta.bind(null, empresaId, inicial?.id ?? null)} aoSucesso={() => aoSalvar?.()} manterAoErrar className="space-y-5">
      {({ estado, pendente }) => {
        const erros = estado.erros ?? {};
        return (
          <>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Nota fiscal e origem</h3>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo
                  rotulo="Nota fiscal dos animais"
                  htmlFor="gta-nota"
                  ajuda="Em Goiás, a GTA de bovinos só é impressa com o número da nota (informado no SIDAGO até 24 h antes). Ainda sem nota? Deixe em branco e complete depois."
                >
                  <Select id="gta-nota" name="nfe_emissao_id" value={notaId} onChange={(e) => escolherNota(e.target.value)}>
                    <option value="">Sem nota no portal (informar o número abaixo)</option>
                    {notas.map((n) => (
                      <option key={n.id} value={n.id}>
                        Nº {n.numero} série {n.serie} — {n.destinatario_nome}
                        {n.ambiente !== "producao" ? " (teste)" : ""}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {!notaId ? (
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <Campo rotulo="Número da nota" htmlFor="gta-nf-numero">
                      <Input id="gta-nf-numero" name="nf_numero" inputMode="numeric" defaultValue={inicial?.nf_numero ?? ""} />
                    </Campo>
                    <Campo rotulo="Série" htmlFor="gta-nf-serie">
                      <Input id="gta-nf-serie" name="nf_serie" inputMode="numeric" defaultValue={inicial?.nf_serie ?? ""} />
                    </Campo>
                  </div>
                ) : (
                  <div />
                )}
                <Campo rotulo="Propriedade de origem (inscrição estadual)" htmlFor="gta-emitente" ajuda="A inscrição do produtor de onde os animais saem.">
                  <Select id="gta-emitente" name="emitente_id" value={emitente} onChange={(e) => setEmitente(e.target.value)}>
                    <option value="">Escolha</option>
                    {emitentes.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome} — IE {e.inscricao_estadual}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Data de saída" htmlFor="gta-saida" erro={erros.data_saida} obrigatorio>
                  <Input id="gta-saida" name="data_saida" type="date" defaultValue={inicial?.data_saida ?? hoje()} />
                </Campo>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Destino</h3>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="Comprador ou estabelecimento" htmlFor="gta-destino" erro={erros.destino_nome} obrigatorio className="sm:col-span-2">
                  <Input id="gta-destino" name="destino_nome" value={destino.nome} onChange={(e) => setDestino({ ...destino, nome: e.target.value })} />
                </Campo>
                <Campo rotulo="CPF ou CNPJ" htmlFor="gta-destino-doc">
                  <Input id="gta-destino-doc" name="destino_documento" value={destino.documento} onChange={(e) => setDestino({ ...destino, documento: e.target.value })} />
                </Campo>
                <Campo rotulo="Inscrição estadual" htmlFor="gta-destino-ie">
                  <Input id="gta-destino-ie" name="destino_ie" inputMode="numeric" value={destino.ie} onChange={(e) => setDestino({ ...destino, ie: e.target.value })} />
                </Campo>
                <Campo rotulo="Município de destino" htmlFor="gta-municipio">
                  <SeletorMunicipio
                    key={mun.chave}
                    ufInicial={mun.uf}
                    municipioInicial={mun.ibge}
                    municipiosIniciais={mun.lista}
                    nomeCampo="destino_municipio_ibge"
                    nomeUf="destino_uf"
                    idBase="gta-municipio"
                    carregar={carregar}
                  />
                </Campo>
                <Campo rotulo="Código no SIDAGO ou registro (SIF/SIE/SIM)" htmlFor="gta-destino-codigo" ajuda="Do frigorífico ou da propriedade de destino, se souber.">
                  <Input id="gta-destino-codigo" name="destino_codigo" defaultValue={inicial?.destino_codigo ?? ""} />
                </Campo>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Animais</h3>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="Finalidade" htmlFor="gta-finalidade" obrigatorio>
                  <Select id="gta-finalidade" name="finalidade" defaultValue={inicial?.finalidade ?? "abate"}>
                    {Object.entries(FINALIDADES_GTA).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Espécie" htmlFor="gta-especie" obrigatorio>
                  <Select id="gta-especie" name="especie" defaultValue={inicial?.especie ?? "bovina"}>
                    {Object.entries(ESPECIES_GTA).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <div ref={ref} className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <th className="p-2 font-medium">Idade</th>
                      <th className="p-2 font-medium">Machos</th>
                      <th className="p-2 font-medium">Fêmeas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FAIXAS_GTA.map((f) => (
                      <tr key={f} className="border-t border-border">
                        <td className="p-2 whitespace-nowrap">{ROTULO_FAIXA[f]}</td>
                        {(["macho", "femea"] as const).map((s) => (
                          <td key={s} className="p-2">
                            <Input
                              name={`animais_${s}_${f}`}
                              data-animal
                              type="number"
                              min={0}
                              max={9999}
                              inputMode="numeric"
                              defaultValue={qtd(s, f)}
                              onChange={somar}
                              aria-label={`${s === "macho" ? "Machos" : "Fêmeas"} ${f === "36+" ? "" : "de "}${ROTULO_FAIXA[f]}`}
                              className="w-24"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">
                Total: <strong>{total}</strong> {total === 1 ? "animal" : "animais"}
              </p>
              {erros.animais ? <p className="text-xs text-perigo">{erros.animais[0]}</p> : null}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Transporte</h3>
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="Meio de transporte" htmlFor="gta-transporte">
                  <Select id="gta-transporte" name="transporte" value={transporte} onChange={(e) => setTransporte(e.target.value)}>
                    {Object.entries(TRANSPORTES_GTA).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {transporte === "rodoviario" ? (
                  <div className="grid grid-cols-[1fr_6rem] gap-2">
                    <Campo rotulo="Placa do caminhão" htmlFor="gta-placa">
                      <Input id="gta-placa" name="placa" placeholder="ABC1D23" defaultValue={inicial?.placa ?? ""} className="uppercase" />
                    </Campo>
                    <Campo rotulo="UF da placa" htmlFor="gta-placa-uf">
                      <Select id="gta-placa-uf" name="placa_uf" defaultValue={inicial?.placa_uf ?? ""}>
                        <option value="">UF</option>
                        {UFS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </Select>
                    </Campo>
                  </div>
                ) : (
                  <div />
                )}
                <Campo rotulo="Transportador (motorista ou transportadora)" htmlFor="gta-transportador">
                  <Input id="gta-transportador" name="transportador_nome" defaultValue={inicial?.transportador_nome ?? ""} />
                </Campo>
                <Campo rotulo="CPF ou CNPJ do transportador" htmlFor="gta-transportador-doc">
                  <Input id="gta-transportador-doc" name="transportador_documento" defaultValue={formatarDocumento(inicial?.transportador_documento ?? "")} />
                </Campo>
                <Campo rotulo="Observações" htmlFor="gta-obs" className="sm:col-span-2">
                  <Textarea id="gta-obs" name="observacoes" rows={2} maxLength={500} defaultValue={inicial?.observacoes ?? ""} />
                </Campo>
              </div>
            </section>

            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>{inicial ? "Salvar alterações" : "Salvar pedido de GTA"}</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function NovoPedidoGta({ empresaId, emitentes, notas, notaInicial }: { empresaId: string; emitentes: EmitenteGta[]; notas: NotaGta[]; notaInicial?: string | null }) {
  const [aberto, setAberto] = React.useState(Boolean(notaInicial));
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Novo pedido de GTA
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Novo pedido de GTA" descricao="Os dados que vão na GTA do SIDAGO. O robô confere o formulário com eles, sem emitir." largura="lg">
        <FormPedidoGta empresaId={empresaId} emitentes={emitentes} notas={notas} notaInicial={notaInicial} aoSalvar={() => setAberto(false)} />
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Ações de cada pedido
// -----------------------------------------------------------------------------
const SITUACAO_ITEM: Record<ItemConferencia["situacao"], { rotulo: string; variante: "sucesso" | "alerta" | "perigo"; Icone: typeof CheckCircle2 }> = {
  encontrado: { rotulo: "Campo encontrado", variante: "sucesso", Icone: CheckCircle2 },
  opcao_nao_encontrada: { rotulo: "Opção não encontrada", variante: "alerta", Icone: CircleHelp },
  campo_nao_encontrado: { rotulo: "Campo não achado", variante: "perigo", Icone: CircleAlert },
};

export function ResultadoConferenciaGta({ conferencia }: { conferencia: ConferenciaTela }) {
  const m = conferencia.mapeamento;
  const itens = m?.itens ?? [];
  return (
    <div className="space-y-4">
      <Alerta tom={conferencia.ok ? "sucesso" : "alerta"}>
        {conferencia.mensagem} <span className="text-xs opacity-80">({formatarDataHora(conferencia.created_at)})</span>
      </Alerta>
      {m?.formulario ? (
        <p className="text-sm">
          Formulário no SIDAGO: <strong>{m.formulario.titulo}</strong> <span className="font-mono text-xs text-muted-foreground">{m.formulario.caminho}</span>
        </p>
      ) : null}
      {itens.length ? (
        <Table>
          <THead>
            <Tr>
              <Th>Dado do pedido</Th>
              <Th>Valor que iria</Th>
              <Th>Campo no SIDAGO</Th>
              <Th>Situação</Th>
            </Tr>
          </THead>
          <TBody>
            {itens.map((i, n) => {
              const s = SITUACAO_ITEM[i.situacao];
              return (
                <Tr key={n}>
                  <Td>{i.dado}</Td>
                  <Td className="font-medium">{i.valor}</Td>
                  <Td>
                    {i.campo ?? "—"}
                    {i.opcao ? <span className="text-muted-foreground"> → {i.opcao}</span> : null}
                  </Td>
                  <Td>
                    <Badge variante={s.variante}>
                      <s.Icone /> {s.rotulo}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      ) : null}
      {m && !m.formulario && (m.paginas?.length || m.links?.length) ? (
        <div className="space-y-2 text-sm">
          {m.paginas?.length ? (
            <div>
              <p className="font-medium">Páginas da GTA abertas pelo robô</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {m.paginas.map((p) => (
                  <li key={p.caminho}>
                    {p.titulo} <span className="font-mono text-xs">{p.caminho}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {m.links?.length ? (
            <div>
              <p className="font-medium">Itens do menu do SIDAGO (para ajustar o robô)</p>
              <p className="text-muted-foreground">{m.links.map((l) => l.texto).filter(Boolean).join(" · ")}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Modo conferência: o robô só entrou no SIDAGO e leu o formulário. Nada foi enviado nem emitido. Emita a GTA no SIDAGO com estes dados e depois anote o número aqui.
      </p>
    </div>
  );
}

export function AcoesPedidoGta({
  empresaId,
  pedido,
  conferencia,
  emitentes,
  notas,
  temAcesso,
}: {
  empresaId: string;
  pedido: PedidoGtaTela;
  conferencia: ConferenciaTela | null;
  emitentes: EmitenteGta[];
  notas: NotaGta[];
  temAcesso: boolean;
}) {
  const [editar, setEditar] = React.useState(false);
  const [anotar, setAnotar] = React.useState(false);
  const emitida = pedido.status === "emitida";
  return (
    <div className="flex flex-wrap gap-2">
      {!emitida ? (
        <BotaoAcao tamanho="sm" acao={() => conferirPedidoGta(empresaId, pedido.id)} disabled={!temAcesso} title={temAcesso ? undefined : "Cadastre o acesso ao SIDAGO primeiro"}>
          <ScanSearch /> Conferir no SIDAGO
        </BotaoAcao>
      ) : null}
      {conferencia ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button tamanho="sm" variante="contorno">
              Ver conferência
            </Button>
          </DialogTrigger>
          <DialogContent titulo="Conferência no SIDAGO" descricao={`GTA para ${pedido.destino_nome}`} largura="xl">
            <ResultadoConferenciaGta conferencia={conferencia} />
          </DialogContent>
        </Dialog>
      ) : null}
      {!emitida ? (
        <>
          <Dialog open={editar} onOpenChange={setEditar}>
            <DialogTrigger asChild>
              <Button tamanho="sm" variante="contorno">
                <Pencil /> Editar
              </Button>
            </DialogTrigger>
            <DialogContent titulo="Editar pedido de GTA" largura="lg">
              <FormPedidoGta empresaId={empresaId} inicial={pedido} emitentes={emitentes} notas={notas} aoSalvar={() => setEditar(false)} />
            </DialogContent>
          </Dialog>
          <Dialog open={anotar} onOpenChange={setAnotar}>
            <DialogTrigger asChild>
              <Button tamanho="sm" variante="contorno">
                <Stamp /> Anotar GTA emitida
              </Button>
            </DialogTrigger>
            <DialogContent titulo="Anotar a GTA emitida no SIDAGO" descricao="Depois de emitir no SIDAGO, guarde aqui o número para usar na nota fiscal." largura="sm">
              <FormularioAcao acao={registrarEmissaoGta.bind(null, empresaId, pedido.id)} aoSucesso={() => setAnotar(false)} manterAoErrar className="space-y-3">
                {({ pendente }) => (
                  <>
                    <Campo rotulo="Número da GTA" htmlFor={`gta-num-${pedido.id}`} obrigatorio>
                      <Input id={`gta-num-${pedido.id}`} name="gta_numero" inputMode="numeric" />
                    </Campo>
                    <Campo rotulo="Série" htmlFor={`gta-serie-${pedido.id}`}>
                      <Input id={`gta-serie-${pedido.id}`} name="gta_serie" className="uppercase" />
                    </Campo>
                    <div className="flex justify-end">
                      <BotaoEnviar pendente={pendente}>Anotar</BotaoEnviar>
                    </div>
                  </>
                )}
              </FormularioAcao>
            </DialogContent>
          </Dialog>
          <BotaoAcao
            tamanho="sm"
            variante="fantasma"
            acao={() => excluirPedidoGta(empresaId, pedido.id)}
            confirmar={{ titulo: "Apagar este pedido de GTA?", descricao: "Os dados e as conferências deste pedido são apagados do portal.", perigo: true, textoConfirmar: "Apagar" }}
            aria-label="Apagar pedido"
          >
            <Trash2 />
          </BotaoAcao>
        </>
      ) : null}
    </div>
  );
}
