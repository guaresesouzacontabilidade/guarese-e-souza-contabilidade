"use client";

import * as React from "react";
import { Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { buscarTomador, excluirTomador, salvarTomador, type TomadorReceita, type TomadorSalvo } from "@/lib/nfse-emissao/acoes";
import { formatarData, formatarDocumento, formatarTelefone, somenteDigitos } from "@/lib/formatos";

/** Lista dos tomadores salvos da empresa, com busca, cadastro, edição e exclusão. */
export function TomadoresSalvos({ empresaId, tomadores }: { empresaId: string; tomadores: TomadorSalvo[] }) {
  const [busca, setBusca] = React.useState("");
  const [editando, setEditando] = React.useState<TomadorSalvo | null>(null);
  const [novo, setNovo] = React.useState(false);
  const termo = busca.trim().toLowerCase();
  const digitos = somenteDigitos(busca);
  const lista = termo
    ? tomadores.filter((t) => t.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && t.documento.includes(digitos)) || (t.email ?? "").includes(termo))
    : tomadores;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar tomador por nome, CPF, CNPJ ou e-mail" placeholder="Buscar por nome, CPF, CNPJ ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={() => setNovo(true)} className="ml-auto">
          <Plus /> Novo tomador
        </Button>
      </div>

      {!tomadores.length ? (
        <EstadoVazio
          icone={Users}
          titulo="Nenhum tomador salvo ainda"
          descricao="Cadastre aqui os clientes para quem a empresa emite nota, ou marque “Salvar este tomador” ao emitir: nas próximas notas é só escolher na lista."
        />
      ) : !lista.length ? (
        <p className="text-sm text-muted-foreground">Nenhum tomador encontrado para “{busca}”.</p>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Tomador</Th>
              <Th>CPF ou CNPJ</Th>
              <Th className="hidden md:table-cell">Contato</Th>
              <Th className="hidden sm:table-cell">Última nota</Th>
              <Th className="text-right">Ações</Th>
            </Tr>
          </THead>
          <TBody>
            {lista.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <span className="font-medium text-titulo">{t.nome}</span>
                  {t.tipo === "cnpj" && t.endereco?.municipio ? (
                    <span className="block text-xs text-muted-foreground">
                      {t.endereco.municipio}
                      {t.endereco.uf ? ` / ${t.endereco.uf}` : ""}
                    </span>
                  ) : null}
                </Td>
                <Td className="numero whitespace-nowrap">{formatarDocumento(t.documento)}</Td>
                <Td className="hidden text-sm md:table-cell">
                  {t.email ?? "-"}
                  {t.telefone ? <span className="block text-xs text-muted-foreground">{formatarTelefone(t.telefone)}</span> : null}
                </Td>
                <Td className="hidden text-sm sm:table-cell">{t.ultimo_uso_em ? formatarData(t.ultimo_uso_em.slice(0, 10)) : "-"}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variante="fantasma" tamanho="icone" aria-label={`Editar ${t.nome}`} onClick={() => setEditando(t)}>
                      <Pencil />
                    </Button>
                    <BotaoAcao
                      variante="fantasma"
                      tamanho="icone"
                      aria-label={`Excluir ${t.nome}`}
                      acao={excluirTomador.bind(null, empresaId, t.id)}
                      confirmar={{
                        titulo: `Excluir ${t.nome}?`,
                        descricao: "O tomador sai da lista de tomadores salvos. As notas já emitidas para ele não mudam.",
                        textoConfirmar: "Excluir",
                        perigo: true,
                      }}
                    >
                      <Trash2 />
                    </BotaoAcao>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      <FormTomador empresaId={empresaId} aberto={novo} aoFechar={() => setNovo(false)} />
      {editando ? <FormTomador key={editando.id} empresaId={empresaId} inicial={editando} aberto aoFechar={() => setEditando(null)} /> : null}
    </div>
  );
}

/** Cadastro (ou edição) de um tomador: CPF com nome, ou CNPJ com os dados da Receita. */
function FormTomador({ empresaId, inicial, aberto, aoFechar }: { empresaId: string; inicial?: TomadorSalvo; aberto: boolean; aoFechar: () => void }) {
  const [tipo, setTipo] = React.useState<"cnpj" | "cpf">(inicial?.tipo ?? "cnpj");
  const [documento, setDocumento] = React.useState(inicial ? formatarDocumento(inicial.documento) : "");
  const [nome, setNome] = React.useState(inicial?.nome ?? "");
  const [email, setEmail] = React.useState(inicial?.email ?? "");
  const [endereco, setEndereco] = React.useState<TomadorReceita["endereco"] | null>(inicial?.endereco ?? null);
  const [versao, setVersao] = React.useState(0);
  const [buscando, setBuscando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "sucesso" | "perigo"; texto: string } | null>(null);

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
      setVersao((v) => v + 1);
      setAviso({ tom: "sucesso", texto: r.mensagem ?? "Dados preenchidos." });
    } else setAviso({ tom: "perigo", texto: r.mensagem ?? "Não foi possível consultar o CNPJ." });
  }

  return (
    <Dialog open={aberto} onOpenChange={(a) => (a ? null : aoFechar())}>
      <DialogContent
        titulo={inicial ? `Editar ${inicial.nome}` : "Novo tomador"}
        descricao="Fica salvo só para esta empresa e aparece na lista ao emitir a nota de serviço."
      >
        <FormularioAcao acao={salvarTomador.bind(null, empresaId)} aoSucesso={aoFechar} className="space-y-4">
          {({ estado, pendente }) => {
            const erros = estado.erros ?? {};
            return (
              <>
                {!inicial ? (
                  <div className="flex gap-5" role="radiogroup" aria-label="Tipo de tomador">
                    {(["cnpj", "cpf"] as const).map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="tomador_tipo"
                          value={t}
                          checked={tipo === t}
                          onChange={() => {
                            setTipo(t);
                            setAviso(null);
                            setEndereco(null);
                          }}
                          className="size-4 accent-[var(--primary)]"
                        />
                        {t === "cnpj" ? "Empresa (CNPJ)" : "Pessoa (CPF)"}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input type="hidden" name="tomador_tipo" value={tipo} />
                )}

                <Campo rotulo={tipo === "cnpj" ? "CNPJ" : "CPF"} htmlFor="tom_documento" obrigatorio erro={erros.tomador_documento}>
                  <div className="flex gap-2">
                    <Input
                      id="tom_documento"
                      name="tomador_documento"
                      inputMode="numeric"
                      value={documento}
                      readOnly={Boolean(inicial)}
                      onChange={(e) => {
                        setDocumento(e.target.value);
                        if (tipo === "cnpj") setEndereco(null);
                      }}
                      placeholder={tipo === "cnpj" ? "00.000.000/0000-00" : "000.000.000-00"}
                    />
                    {tipo === "cnpj" ? (
                      <Button type="button" variante="contorno" onClick={buscar} disabled={buscando} aria-label="Buscar o CNPJ na Receita">
                        {buscando ? <Loader2 className="animate-spin" /> : <Search />} {inicial ? "Atualizar" : "Buscar"}
                      </Button>
                    ) : null}
                  </div>
                </Campo>

                <Campo rotulo={tipo === "cnpj" ? "Razão social" : "Nome completo"} htmlFor="tom_nome" obrigatorio erro={erros.tomador_nome}>
                  <Input id="tom_nome" name="tomador_nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={300} />
                </Campo>

                {aviso ? <Alerta tom={aviso.tom}>{aviso.texto}</Alerta> : null}
                {tipo === "cnpj" && !endereco ? <p className="text-sm text-muted-foreground">Clique em Buscar para trazer o nome e o endereço do CNPJ na Receita.</p> : null}

                {tipo === "cnpj" && endereco ? (
                  <div key={versao} className="grid gap-3 sm:grid-cols-6">
                    <Campo rotulo="Endereço" htmlFor="tom_logradouro" className="sm:col-span-4" erro={erros.end_logradouro}>
                      <Input id="tom_logradouro" name="end_logradouro" defaultValue={endereco.logradouro ?? ""} maxLength={255} />
                    </Campo>
                    <Campo rotulo="Número" htmlFor="tom_numero" className="sm:col-span-2">
                      <Input id="tom_numero" name="end_numero" defaultValue={endereco.numero ?? ""} maxLength={60} />
                    </Campo>
                    <Campo rotulo="Complemento" htmlFor="tom_complemento" className="sm:col-span-3">
                      <Input id="tom_complemento" name="end_complemento" defaultValue={endereco.complemento ?? ""} maxLength={156} />
                    </Campo>
                    <Campo rotulo="Bairro" htmlFor="tom_bairro" className="sm:col-span-3">
                      <Input id="tom_bairro" name="end_bairro" defaultValue={endereco.bairro ?? ""} maxLength={60} />
                    </Campo>
                    <Campo rotulo="Município" htmlFor="tom_municipio" className="sm:col-span-4" erro={erros.end_codigo_municipio}>
                      <Input id="tom_municipio" value={`${endereco.municipio ?? ""}${endereco.uf ? ` / ${endereco.uf}` : ""}`} readOnly />
                    </Campo>
                    <Campo rotulo="CEP" htmlFor="tom_cep" className="sm:col-span-2" erro={erros.end_cep}>
                      <Input id="tom_cep" name="end_cep" defaultValue={endereco.cep ?? ""} inputMode="numeric" />
                    </Campo>
                    <input type="hidden" name="end_codigo_municipio" value={endereco.codigo_municipio ?? ""} />
                    <input type="hidden" name="end_municipio" value={endereco.municipio ?? ""} />
                    <input type="hidden" name="end_uf" value={endereco.uf ?? ""} />
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo rotulo="E-mail" htmlFor="tom_email" ajuda="Opcional. Em produção, a nota é enviada para este e-mail." erro={erros.tomador_email}>
                    <Input id="tom_email" name="tomador_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={80} />
                  </Campo>
                  <Campo rotulo="Telefone" htmlFor="tom_telefone" ajuda="Opcional." erro={erros.tomador_telefone}>
                    <Input id="tom_telefone" name="tomador_telefone" inputMode="tel" defaultValue={inicial?.telefone ? formatarTelefone(inicial.telefone) : ""} />
                  </Campo>
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variante="contorno" onClick={aoFechar}>
                    Voltar
                  </Button>
                  <BotaoEnviar pendente={pendente} disabled={tipo === "cnpj" && !endereco}>
                    Salvar tomador
                  </BotaoEnviar>
                </div>
              </>
            );
          }}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
