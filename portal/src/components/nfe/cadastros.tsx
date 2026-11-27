"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/form";
import { SeletorMunicipio } from "@/components/obrigacoes/seletor-municipio";
import { buscarCnpj, municipiosDaUf, salvarDestinatario, salvarTransportador } from "@/lib/nfe-emissao/acoes";
import { INDICADOR_IE } from "@/lib/nfe-emissao/rotulos";
import { UFS } from "@/lib/obrigacoes/rotulos";
import type { ResultadoAcao } from "@/lib/acoes";
import { formatarCep, formatarDocumento, somenteDigitos } from "@/lib/formatos";

export interface Destinatario {
  id: string;
  tipo: "cnpj" | "cpf" | "estrangeiro";
  documento: string | null;
  nome: string;
  indicador_ie: number;
  inscricao_estadual: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio_ibge: string | null;
  uf: string | null;
  municipio: string | null;
  codigo_pais: string | null;
  pais: string | null;
  cidade_exterior: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
}

export interface Transportador {
  id: string;
  tipo: "cnpj" | "cpf";
  documento: string;
  nome: string;
  inscricao_estadual: string | null;
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  placa: string | null;
  placa_uf: string | null;
  rntc: string | null;
}

/** Cliente (comprador): CNPJ com busca na Receita, CPF (produtor, consumidor) ou estrangeiro. */
export function FormDestinatario({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial?: Destinatario | null; aoSalvar?: (id: string) => void }) {
  const [tipo, setTipo] = React.useState<Destinatario["tipo"]>(inicial?.tipo ?? "cnpj");
  const [documento, setDocumento] = React.useState(inicial?.documento ? formatarDocumento(inicial.documento) : "");
  const [nome, setNome] = React.useState(inicial?.nome ?? "");
  const [indicador, setIndicador] = React.useState(String(inicial?.indicador_ie ?? (inicial?.tipo === "cpf" ? 9 : 1)));
  const [end, setEnd] = React.useState({
    logradouro: inicial?.logradouro ?? "",
    numero: inicial?.numero ?? "",
    complemento: inicial?.complemento ?? "",
    bairro: inicial?.bairro ?? "",
    cep: inicial?.cep ? formatarCep(inicial.cep) : "",
    email: inicial?.email ?? "",
    telefone: inicial?.telefone ?? "",
  });
  const [mun, setMun] = React.useState({ uf: inicial?.uf ?? "", ibge: inicial?.municipio_ibge ?? "", lista: [] as { ibge: string; nome: string }[], chave: 0 });
  const [buscando, setBuscando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "sucesso" | "perigo"; texto: string } | null>(null);

  React.useEffect(() => {
    if (inicial?.uf) municipiosDaUf(empresaId, inicial.uf).then((lista) => setMun((m) => ({ ...m, lista, chave: m.chave + 1 })));
  }, [empresaId, inicial?.uf]);

  async function buscar() {
    const cnpj = somenteDigitos(documento);
    if (cnpj.length !== 14) {
      setAviso({ tom: "perigo", texto: "Digite os 14 números do CNPJ." });
      return;
    }
    setBuscando(true);
    setAviso(null);
    const r = await buscarCnpj(empresaId, cnpj);
    if (r.ok && r.dados) {
      const d = r.dados;
      setNome(d.nome);
      setEnd((e) => ({
        ...e,
        logradouro: d.endereco.logradouro ?? "",
        numero: d.endereco.numero ?? "",
        complemento: d.endereco.complemento ?? "",
        bairro: d.endereco.bairro ?? "",
        cep: d.endereco.cep ? formatarCep(d.endereco.cep) : "",
        email: e.email || d.email || "",
        telefone: e.telefone || (d.telefone ?? "").replace(/\D/g, ""),
      }));
      if (d.endereco.uf) {
        const lista = await municipiosDaUf(empresaId, d.endereco.uf);
        setMun((m) => ({ uf: d.endereco.uf!, ibge: d.endereco.codigo_municipio ?? "", lista, chave: m.chave + 1 }));
      }
      setAviso({ tom: "sucesso", texto: r.mensagem ?? "Dados preenchidos." });
    } else setAviso({ tom: "perigo", texto: r.mensagem ?? "Não foi possível consultar o CNPJ." });
    setBuscando(false);
  }

  return (
    <FormularioAcao
      acao={salvarDestinatario.bind(null, empresaId, inicial?.id ?? null)}
      aoSucesso={(r: ResultadoAcao) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        if (id) aoSalvar?.(id);
      }}
      className="space-y-3"
    >
      {({ estado, pendente }) => {
        const erros = estado.erros ?? {};
        return (
          <>
            {aviso ? <Alerta tom={aviso.tom}>{aviso.texto}</Alerta> : null}
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Tipo" htmlFor="d-tipo" obrigatorio>
                <Select
                  id="d-tipo"
                  name="tipo"
                  value={tipo}
                  onChange={(e) => {
                    const t = e.target.value as Destinatario["tipo"];
                    setTipo(t);
                    setIndicador(t === "cnpj" ? "1" : "9");
                  }}
                >
                  <option value="cnpj">Empresa (CNPJ)</option>
                  <option value="cpf">Pessoa física (CPF) — produtor ou consumidor</option>
                  <option value="estrangeiro">Estrangeiro (exportação)</option>
                </Select>
              </Campo>
              <Campo rotulo={tipo === "estrangeiro" ? "Identificação (passaporte, ID)" : tipo === "cnpj" ? "CNPJ" : "CPF"} htmlFor="d-doc" obrigatorio={tipo !== "estrangeiro"} erro={erros.documento}>
                <div className="flex gap-2">
                  <Input id="d-doc" name="documento" value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode={tipo === "estrangeiro" ? "text" : "numeric"} />
                  {tipo === "cnpj" ? (
                    <Button type="button" variante="contorno" onClick={buscar} disabled={buscando} title="Buscar na Receita">
                      {buscando ? <Loader2 className="animate-spin" /> : <Search />}
                    </Button>
                  ) : null}
                </div>
              </Campo>
            </div>
            <Campo rotulo="Nome / razão social" htmlFor="d-nome" obrigatorio erro={erros.nome}>
              <Input id="d-nome" name="nome" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
            </Campo>
            {tipo !== "estrangeiro" ? (
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Campo rotulo="Situação no ICMS" htmlFor="d-ind" obrigatorio>
                  <Select id="d-ind" name="indicador_ie" value={indicador} onChange={(e) => setIndicador(e.target.value)}>
                    {Object.entries(INDICADOR_IE).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {indicador === "1" ? (
                  <Campo rotulo="Inscrição estadual" htmlFor="d-ie" obrigatorio ajuda="A Receita não informa: peça ao cliente. Produtor rural usa a inscrição de produtor.">
                    <Input id="d-ie" name="inscricao_estadual" defaultValue={inicial?.inscricao_estadual ?? ""} inputMode="numeric" />
                  </Campo>
                ) : null}
              </div>
            ) : (
              <input type="hidden" name="indicador_ie" value="9" />
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem] [&>*]:min-w-0">
              <Campo rotulo="Endereço" htmlFor="d-lgr" obrigatorio>
                <Input id="d-lgr" name="logradouro" maxLength={60} value={end.logradouro} onChange={(e) => setEnd({ ...end, logradouro: e.target.value })} />
              </Campo>
              <Campo rotulo="Número" htmlFor="d-nro">
                <Input id="d-nro" name="numero" maxLength={60} value={end.numero} onChange={(e) => setEnd({ ...end, numero: e.target.value })} placeholder="SN" />
              </Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Complemento" htmlFor="d-cpl">
                <Input id="d-cpl" name="complemento" maxLength={60} value={end.complemento} onChange={(e) => setEnd({ ...end, complemento: e.target.value })} />
              </Campo>
              <Campo rotulo="Bairro / localidade" htmlFor="d-bairro">
                <Input id="d-bairro" name="bairro" maxLength={60} value={end.bairro} onChange={(e) => setEnd({ ...end, bairro: e.target.value })} />
              </Campo>
            </div>
            {tipo === "estrangeiro" ? (
              <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                <Campo rotulo="Cidade" htmlFor="d-cid" obrigatorio>
                  <Input id="d-cid" name="cidade_exterior" maxLength={60} defaultValue={inicial?.cidade_exterior ?? ""} />
                </Campo>
                <Campo rotulo="País" htmlFor="d-pais" obrigatorio>
                  <Input id="d-pais" name="pais" maxLength={60} defaultValue={inicial?.pais ?? ""} />
                </Campo>
                <Campo rotulo="Código do país (Bacen)" htmlFor="d-cpais" obrigatorio ajuda="Ex.: 2496 Estados Unidos, 1600 China.">
                  <Input id="d-cpais" name="codigo_pais" maxLength={4} inputMode="numeric" defaultValue={inicial?.codigo_pais ?? ""} />
                </Campo>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem] [&>*]:min-w-0">
                <Campo rotulo="Município" htmlFor="d-mun" obrigatorio>
                  <SeletorMunicipio
                    key={mun.chave}
                    idBase="d-mun"
                    ufInicial={mun.uf}
                    municipioInicial={mun.ibge}
                    municipiosIniciais={mun.lista}
                    carregar={(uf) => municipiosDaUf(empresaId, uf)}
                  />
                </Campo>
                <Campo rotulo="CEP" htmlFor="d-cep">
                  <Input id="d-cep" name="cep" inputMode="numeric" value={end.cep} onChange={(e) => setEnd({ ...end, cep: e.target.value })} />
                </Campo>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="E-mail" htmlFor="d-email" ajuda="A nota autorizada é enviada para este e-mail, se o escritório ligar o envio.">
                <Input id="d-email" name="email" type="email" maxLength={60} value={end.email} onChange={(e) => setEnd({ ...end, email: e.target.value })} />
              </Campo>
              <Campo rotulo="Telefone" htmlFor="d-tel">
                <Input id="d-tel" name="telefone" inputMode="tel" value={end.telefone} onChange={(e) => setEnd({ ...end, telefone: e.target.value })} />
              </Campo>
            </div>
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar cliente</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function FormTransportador({ empresaId, inicial, aoSalvar }: { empresaId: string; inicial?: Transportador | null; aoSalvar?: (id: string) => void }) {
  const [tipo, setTipo] = React.useState<Transportador["tipo"]>(inicial?.tipo ?? "cpf");
  return (
    <FormularioAcao
      acao={salvarTransportador.bind(null, empresaId, inicial?.id ?? null)}
      aoSucesso={(r: ResultadoAcao) => {
        const id = (r.dados as { id?: string } | undefined)?.id;
        if (id) aoSalvar?.(id);
      }}
      className="space-y-3"
    >
      {({ pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Tipo" htmlFor="t-tipo" obrigatorio>
              <Select id="t-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as Transportador["tipo"])}>
                <option value="cpf">Motorista autônomo (CPF)</option>
                <option value="cnpj">Transportadora (CNPJ)</option>
              </Select>
            </Campo>
            <Campo rotulo={tipo === "cnpj" ? "CNPJ" : "CPF"} htmlFor="t-doc" obrigatorio>
              <Input id="t-doc" name="documento" inputMode="numeric" defaultValue={inicial?.documento ? formatarDocumento(inicial.documento) : ""} />
            </Campo>
          </div>
          <Campo rotulo="Nome" htmlFor="t-nome" obrigatorio>
            <Input id="t-nome" name="nome" maxLength={60} defaultValue={inicial?.nome ?? ""} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Inscrição estadual" htmlFor="t-ie" ajuda='Ou "ISENTO".'>
              <Input id="t-ie" name="inscricao_estadual" defaultValue={inicial?.inscricao_estadual ?? ""} />
            </Campo>
            <Campo rotulo="Município" htmlFor="t-mun">
              <Input id="t-mun" name="municipio" maxLength={60} defaultValue={inicial?.municipio ?? ""} />
            </Campo>
            <Campo rotulo="UF" htmlFor="t-uf">
              <Select id="t-uf" name="uf" defaultValue={inicial?.uf ?? ""}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
          <Campo rotulo="Endereço" htmlFor="t-end">
            <Input id="t-end" name="endereco" maxLength={60} defaultValue={inicial?.endereco ?? ""} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Placa do veículo" htmlFor="t-placa">
              <Input id="t-placa" name="placa" maxLength={8} defaultValue={inicial?.placa ?? ""} className="uppercase" />
            </Campo>
            <Campo rotulo="UF da placa" htmlFor="t-placa-uf">
              <Select id="t-placa-uf" name="placa_uf" defaultValue={inicial?.placa_uf ?? ""}>
                <option value="">—</option>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="RNTRC (ANTT)" htmlFor="t-rntc">
              <Input id="t-rntc" name="rntc" maxLength={20} defaultValue={inicial?.rntc ?? ""} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar transportador</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
