"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Send } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { buscarTomador, pedirNota, type TomadorReceita } from "@/lib/nfse-emissao/acoes";
import { TOMADOR_TIPO } from "@/lib/nfse-emissao/rotulos";
import type { ResultadoAcao } from "@/lib/acoes";
import { formatarMoeda, lerValorBR } from "@/lib/dinheiro";
import { formatarDocumento, somenteDigitos } from "@/lib/formatos";

export interface ServicoOpcao {
  id: string;
  nome: string;
  codigo: string;
  descricaoPadrao: string | null;
}

export interface DadosIniciais {
  servico_id?: string;
  tomador_tipo?: "cnpj" | "cpf" | "nao_identificado";
  tomador_documento?: string | null;
  tomador_nome?: string | null;
  tomador_email?: string | null;
  tomador_telefone?: string | null;
  endereco?: TomadorReceita["endereco"] | null;
  valor?: string | number | null;
  descricao?: string | null;
  informacoes_complementares?: string | null;
}

const hojeLocal = () => {
  const d = new Date(Date.now() - 3 * 3600_000);
  return d.toISOString().slice(0, 10);
};

export function PedirNota({
  empresaId,
  servicos,
  municipioEmpresa,
  retencaoPermitida,
  ambiente,
  iniciais,
}: {
  empresaId: string;
  servicos: ServicoOpcao[];
  municipioEmpresa: string;
  retencaoPermitida: boolean;
  ambiente: "homologacao" | "producao";
  iniciais?: DadosIniciais;
}) {
  const router = useRouter();
  const formId = "form-pedir-nota";
  const [servicoId, setServicoId] = React.useState(iniciais?.servico_id ?? (servicos.length === 1 ? servicos[0].id : ""));
  const [descricao, setDescricao] = React.useState(iniciais?.descricao ?? (servicos.length === 1 ? (servicos[0].descricaoPadrao ?? "") : ""));
  const [tipo, setTipo] = React.useState<"cnpj" | "cpf" | "nao_identificado">(iniciais?.tomador_tipo ?? "cnpj");
  const [documento, setDocumento] = React.useState(iniciais?.tomador_documento ? formatarDocumento(iniciais.tomador_documento) : "");
  const [nome, setNome] = React.useState(iniciais?.tomador_nome ?? "");
  const [email, setEmail] = React.useState(iniciais?.tomador_email ?? "");
  const [endereco, setEndereco] = React.useState<TomadorReceita["endereco"] | null>(iniciais?.endereco ?? null);
  const [valor, setValor] = React.useState(iniciais?.valor ? String(iniciais.valor) : "");
  const [local, setLocal] = React.useState("empresa");
  const [buscando, setBuscando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "sucesso" | "perigo"; texto: string } | null>(null);
  const [confirmar, setConfirmar] = React.useState(false);
  const [repetida, setRepetida] = React.useState(false);

  const servico = servicos.find((s) => s.id === servicoId);
  const valorLido = lerValorBR(valor);

  async function buscar() {
    const cnpj = somenteDigitos(documento);
    if (cnpj.length !== 14) {
      setAviso({ tom: "perigo", texto: "Digite os 14 números do CNPJ." });
      return;
    }
    setBuscando(true);
    setAviso(null);
    const r = await buscarTomador(empresaId, cnpj);
    setBuscando(false);
    if (r.ok && r.dados) {
      setNome(r.dados.nome);
      if (r.dados.email && !email) setEmail(r.dados.email);
      setEndereco(r.dados.endereco);
      setAviso({ tom: "sucesso", texto: r.mensagem ?? "Dados preenchidos." });
    } else setAviso({ tom: "perigo", texto: r.mensagem ?? "Não foi possível consultar o CNPJ." });
  }

  const faltando = (): string | null => {
    if (!servicoId) return "Escolha o serviço.";
    if (tipo === "cnpj" && (!nome || !endereco?.codigo_municipio)) return "Busque o CNPJ do tomador na Receita para trazer o nome e o endereço.";
    if (tipo === "cpf" && (somenteDigitos(documento).length !== 11 || nome.trim().length < 2)) return "Informe o CPF e o nome do tomador.";
    if (!valorLido || valorLido.lte(0)) return "Informe o valor do serviço.";
    if (descricao.trim().length < 3) return "Descreva o serviço prestado.";
    return null;
  };

  return (
    <FormularioAcao
      id={formId}
      acao={pedirNota.bind(null, empresaId)}
      atualizarAoSucesso={false}
      aoSucesso={(r: ResultadoAcao) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        if (id) router.push(`/e/${empresaId}/notas-servico/${id}`);
      }}
      className="space-y-5"
    >
      {({ estado, pendente }) => {
        const erros = estado.erros ?? {};
        const ehRepetida = !estado.ok && (estado.dados as { repetida?: boolean } | undefined)?.repetida;
        return (
          <>
            {ambiente === "homologacao" ? (
              <Alerta tom="info" titulo="Emissão em teste">
                Esta empresa ainda emite no ambiente de testes do governo: a nota sai com a marca &quot;sem validade jurídica&quot; e não vale como nota fiscal.
              </Alerta>
            ) : null}

            <Campo rotulo="Serviço" htmlFor="servico_id" obrigatorio erro={erros.servico_id}>
              <Select
                id="servico_id"
                name="servico_id"
                value={servicoId}
                onChange={(e) => {
                  setServicoId(e.target.value);
                  const s = servicos.find((x) => x.id === e.target.value);
                  if (s?.descricaoPadrao && !descricao.trim()) setDescricao(s.descricaoPadrao);
                }}
              >
                <option value="">Escolha...</option>
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nome} ({s.codigo})
                  </option>
                ))}
              </Select>
            </Campo>

            <fieldset className="space-y-3 rounded-lg border border-border p-3 sm:p-4">
              <legend className="px-1 text-sm font-medium">Para quem é a nota (tomador)</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2" role="radiogroup" aria-label="Tipo de tomador">
                {(Object.keys(TOMADOR_TIPO) as (keyof typeof TOMADOR_TIPO)[]).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="tomador_tipo"
                      value={t}
                      checked={tipo === t}
                      onChange={() => {
                        setTipo(t);
                        setAviso(null);
                        if (t !== "cnpj") setEndereco(null);
                        if (local === "tomador") setLocal("empresa");
                      }}
                      className="size-4 accent-[var(--primary)]"
                    />
                    {TOMADOR_TIPO[t]}
                  </label>
                ))}
              </div>

              {tipo !== "nao_identificado" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo rotulo={tipo === "cnpj" ? "CNPJ" : "CPF"} htmlFor="tomador_documento" obrigatorio erro={erros.tomador_documento}>
                    <div className="flex gap-2">
                      <Input
                        id="tomador_documento"
                        name="tomador_documento"
                        inputMode="numeric"
                        value={documento}
                        onChange={(e) => {
                          setDocumento(e.target.value);
                          if (tipo === "cnpj") setEndereco(null);
                        }}
                        placeholder={tipo === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"}
                      />
                      {tipo === "cnpj" ? (
                        <Button type="button" variante="contorno" onClick={buscar} disabled={buscando} aria-label="Buscar o CNPJ na Receita">
                          {buscando ? <Loader2 className="animate-spin" /> : <Search />} Buscar
                        </Button>
                      ) : null}
                    </div>
                  </Campo>
                  <Campo rotulo={tipo === "cnpj" ? "Razão social" : "Nome completo"} htmlFor="tomador_nome" obrigatorio erro={erros.tomador_nome}>
                    <Input id="tomador_nome" name="tomador_nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={300} />
                  </Campo>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">A nota sai sem identificar o tomador (não vale com ISS retido).</p>
              )}

              {aviso ? <Alerta tom={aviso.tom}>{aviso.texto}</Alerta> : null}

              {tipo === "cnpj" && endereco ? (
                <div className="grid gap-3 sm:grid-cols-6">
                  <Campo rotulo="Endereço" htmlFor="end_logradouro" className="sm:col-span-3" erro={erros.end_logradouro}>
                    <Input id="end_logradouro" name="end_logradouro" defaultValue={endereco.logradouro ?? ""} maxLength={255} />
                  </Campo>
                  <Campo rotulo="Número" htmlFor="end_numero">
                    <Input id="end_numero" name="end_numero" defaultValue={endereco.numero ?? ""} maxLength={60} />
                  </Campo>
                  <Campo rotulo="Complemento" htmlFor="end_complemento" className="sm:col-span-2">
                    <Input id="end_complemento" name="end_complemento" defaultValue={endereco.complemento ?? ""} maxLength={156} />
                  </Campo>
                  <Campo rotulo="Bairro" htmlFor="end_bairro" className="sm:col-span-2">
                    <Input id="end_bairro" name="end_bairro" defaultValue={endereco.bairro ?? ""} maxLength={60} />
                  </Campo>
                  <Campo rotulo="Município" htmlFor="end_municipio" className="sm:col-span-2" erro={erros.end_codigo_municipio}>
                    <Input id="end_municipio" value={`${endereco.municipio ?? ""}${endereco.uf ? ` / ${endereco.uf}` : ""}`} readOnly />
                  </Campo>
                  <Campo rotulo="CEP" htmlFor="end_cep" className="sm:col-span-2" erro={erros.end_cep}>
                    <Input id="end_cep" name="end_cep" defaultValue={endereco.cep ?? ""} inputMode="numeric" />
                  </Campo>
                  <input type="hidden" name="end_codigo_municipio" value={endereco.codigo_municipio ?? ""} />
                  <input type="hidden" name="end_municipio" value={endereco.municipio ?? ""} />
                  <input type="hidden" name="end_uf" value={endereco.uf ?? ""} />
                </div>
              ) : null}

              {tipo !== "nao_identificado" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo rotulo="E-mail do tomador" htmlFor="tomador_email" ajuda="Opcional. Em produção, a nota é enviada para este e-mail." erro={erros.tomador_email}>
                    <Input id="tomador_email" name="tomador_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={80} />
                  </Campo>
                  <Campo rotulo="Telefone do tomador" htmlFor="tomador_telefone" ajuda="Opcional.">
                    <Input id="tomador_telefone" name="tomador_telefone" inputMode="tel" defaultValue={iniciais?.tomador_telefone ?? ""} />
                  </Campo>
                </div>
              ) : null}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Valor do serviço" htmlFor="valor" obrigatorio erro={erros.valor}>
                <CampoValor id="valor" name="valor" valorInicial={iniciais?.valor ?? null} aoMudar={setValor} />
              </Campo>
              <Campo rotulo="Data da prestação" htmlFor="competencia" obrigatorio erro={erros.competencia} ajuda="Dia em que o serviço foi prestado.">
                <Input id="competencia" name="competencia" type="date" defaultValue={hojeLocal()} max={hojeLocal()} />
              </Campo>
              <Campo rotulo="Local da prestação" htmlFor="local_prestacao" erro={erros.local_prestacao}>
                <Select id="local_prestacao" name="local_prestacao" value={local} onChange={(e) => setLocal(e.target.value)}>
                  <option value="empresa">{municipioEmpresa} (município da empresa)</option>
                  {tipo === "cnpj" && endereco?.codigo_municipio ? (
                    <option value="tomador">
                      {endereco.municipio}
                      {endereco.uf ? ` / ${endereco.uf}` : ""} (município do tomador)
                    </option>
                  ) : null}
                </Select>
              </Campo>
            </div>

            <Campo rotulo="Descrição do serviço" htmlFor="descricao" obrigatorio erro={erros.descricao} ajuda={`${descricao.length}/1000 caracteres. Aparece na nota.`}>
              <Textarea id="descricao" name="descricao" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={1000} />
            </Campo>

            {retencaoPermitida && tipo !== "nao_identificado" ? (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="iss_retido" className="mt-0.5" />
                <span>
                  O tomador vai reter o ISS
                  <span className="block text-xs text-muted-foreground">Marque só quando o tomador for responsável por recolher o ISS desta nota.</span>
                </span>
              </label>
            ) : null}

            <Campo rotulo="Informações complementares" htmlFor="informacoes_complementares" ajuda="Opcional (pedido, contrato, observações). Uma linha só.">
              <Input id="informacoes_complementares" name="informacoes_complementares" maxLength={500} defaultValue={iniciais?.informacoes_complementares ?? ""} />
            </Campo>

            {ehRepetida ? (
              <label className="flex items-start gap-2 rounded-lg border border-alerta/40 bg-alerta-bg p-3 text-sm text-alerta-fg">
                <Checkbox name="confirmar_repetida" checked={repetida} onChange={(e) => setRepetida(e.target.checked)} className="mt-0.5" />
                <span>Sim, é outra nota igual e quero emitir mesmo assim.</span>
              </label>
            ) : null}

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  const f = faltando();
                  if (f) setAviso({ tom: "perigo", texto: f });
                  else setConfirmar(true);
                }}
              >
                <Send /> Emitir nota
              </Button>
            </div>

            <Dialog open={confirmar} onOpenChange={setConfirmar}>
              <DialogContent titulo="Confirme a nota" descricao="Depois de emitida, a nota só pode ser cancelada.">
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Tomador</dt>
                  <dd className="font-medium">
                    {tipo === "nao_identificado" ? "Consumidor não identificado" : `${nome} — ${formatarDocumento(somenteDigitos(documento))}`}
                  </dd>
                  <dt className="text-muted-foreground">Serviço</dt>
                  <dd>{servico ? `${servico.nome} (${servico.codigo})` : "-"}</dd>
                  <dt className="text-muted-foreground">Valor</dt>
                  <dd className="font-semibold numero">{valorLido ? formatarMoeda(valorLido) : "-"}</dd>
                  <dt className="text-muted-foreground">Ambiente</dt>
                  <dd>{ambiente === "producao" ? "Produção — nota com valor fiscal" : "Teste — nota sem validade jurídica"}</dd>
                </dl>
                <div className="mt-5 flex justify-end gap-2">
                  <Button type="button" variante="contorno" onClick={() => setConfirmar(false)}>
                    Voltar
                  </Button>
                  <BotaoEnviar form={formId} pendente={pendente} textoPendente="Enviando..." onClick={() => window.setTimeout(() => setConfirmar(false), 0)}>
                    <Send /> Emitir agora
                  </BotaoEnviar>
                </div>
              </DialogContent>
            </Dialog>
          </>
        );
      }}
    </FormularioAcao>
  );
}
