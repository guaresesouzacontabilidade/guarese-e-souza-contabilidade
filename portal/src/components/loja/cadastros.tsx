"use client";

import * as React from "react";
import { Download, Loader2, Pencil, Plus, Search } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { SeletorMunicipio } from "@/components/obrigacoes/seletor-municipio";
import {
  ativarCadastroLoja,
  buscarCnpjCadastro,
  municipiosCadastro,
  salvarCadastroLoja,
  trazerFornecedoresDasNotas,
  type PapelCadastro,
} from "@/lib/gestao/cadastros";
import { formatarCep, formatarDocumento, formatarTelefone, somenteDigitos } from "@/lib/formatos";

export interface CadastroTela {
  id: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  municipio_ibge: string | null;
  uf: string | null;
  inscricao_estadual: string | null;
  contato: string | null;
  prazo_pagamento_dias: number | null;
  observacoes: string | null;
  ativo: boolean;
}

/** Cadastrar ou alterar um cliente ou fornecedor da loja. */
export function DialogoCadastro({
  empresaId,
  papel,
  cadastro,
  gatilho,
}: {
  empresaId: string;
  papel: PapelCadastro;
  cadastro?: CadastroTela;
  gatilho?: "botao" | "icone" | "texto";
}) {
  const [aberto, setAberto] = React.useState(false);
  const c = cadastro;
  const quem = papel === "cliente" ? "cliente" : "fornecedor";
  const titulo = c ? `Editar ${c.nome}` : papel === "cliente" ? "Novo cliente" : "Novo fornecedor";
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {gatilho === "icone" ? (
          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar ${c?.nome ?? quem}`}>
            <Pencil />
          </Button>
        ) : gatilho === "texto" ? (
          <Button variante="contorno">
            <Pencil /> Editar cadastro
          </Button>
        ) : (
          <Button>
            <Plus /> {papel === "cliente" ? "Novo cliente" : "Novo fornecedor"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={titulo}
        descricao={
          papel === "cliente"
            ? "Com CPF/CNPJ e endereço completo, a nota fiscal da venda já sai com os dados do cliente."
            : "Fornecedores das notas de compra entram sozinhos; aqui você completa o contato e o prazo."
        }
        largura="lg"
      >
        {aberto ? <FormCadastro empresaId={empresaId} papel={papel} cadastro={c} aoSalvar={() => setAberto(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FormCadastro({ empresaId, papel, cadastro, aoSalvar }: { empresaId: string; papel: PapelCadastro; cadastro?: CadastroTela; aoSalvar: () => void }) {
  const c = cadastro;
  const [documento, setDocumento] = React.useState(c?.documento ? formatarDocumento(c.documento) : "");
  const [dados, setDados] = React.useState({
    nome: c?.nome ?? "",
    telefone: c?.telefone ? formatarTelefone(c.telefone) : "",
    email: c?.email ?? "",
    cep: c?.cep ? formatarCep(c.cep) : "",
    logradouro: c?.logradouro ?? "",
    numero: c?.numero ?? "",
    complemento: c?.complemento ?? "",
    bairro: c?.bairro ?? "",
  });
  const [mun, setMun] = React.useState({ uf: c?.uf ?? "", ibge: c?.municipio_ibge ?? "", lista: [] as { ibge: string; nome: string }[], chave: 0 });
  const [buscando, setBuscando] = React.useState(false);
  const [aviso, setAviso] = React.useState<{ tom: "sucesso" | "perigo"; texto: string } | null>(null);
  const campo = (k: keyof typeof dados) => ({
    value: dados[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDados((d) => ({ ...d, [k]: e.target.value })),
  });

  React.useEffect(() => {
    if (c?.uf) municipiosCadastro(empresaId, c.uf).then((lista) => setMun((m) => ({ ...m, lista, chave: m.chave + 1 })));
  }, [empresaId, c?.uf]);

  async function buscar() {
    const cnpj = somenteDigitos(documento);
    if (cnpj.length !== 14) {
      setAviso({ tom: "perigo", texto: "A busca é pelo CNPJ: digite os 14 números." });
      return;
    }
    setBuscando(true);
    setAviso(null);
    const r = await buscarCnpjCadastro(empresaId, cnpj);
    if (r.ok && r.dados) {
      const d = r.dados;
      setDados((atual) => ({
        nome: d.nome || atual.nome,
        telefone: atual.telefone || (d.telefone ? formatarTelefone(d.telefone.replace(/\D/g, "")) : ""),
        email: atual.email || d.email || "",
        cep: d.cep ? formatarCep(d.cep) : atual.cep,
        logradouro: d.logradouro ?? atual.logradouro,
        numero: d.numero ?? atual.numero,
        complemento: d.complemento ?? atual.complemento,
        bairro: d.bairro ?? atual.bairro,
      }));
      if (d.uf) {
        const lista = await municipiosCadastro(empresaId, d.uf);
        setMun((m) => ({ uf: d.uf!, ibge: d.municipio_ibge ?? "", lista, chave: m.chave + 1 }));
      }
      setAviso({ tom: "sucesso", texto: r.mensagem ?? "Dados preenchidos." });
    } else setAviso({ tom: "perigo", texto: r.mensagem ?? "Não foi possível consultar o CNPJ." });
    setBuscando(false);
  }

  return (
    <FormularioAcao acao={salvarCadastroLoja.bind(null, empresaId, papel, c?.id ?? null)} aoSucesso={aoSalvar} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          {aviso ? <Alerta tom={aviso.tom}>{aviso.texto}</Alerta> : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end [&>*]:min-w-0">
            <Campo rotulo="CPF ou CNPJ" htmlFor="cad-documento" erro={estado.erros?.documento} ajuda="Opcional, mas necessário para a nota fiscal.">
              <Input id="cad-documento" name="documento" inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={20} />
            </Campo>
            <Button type="button" variante="contorno" onClick={() => void buscar()} disabled={buscando} className="mb-0.5">
              {buscando ? <Loader2 className="animate-spin" /> : <Search />} Buscar pelo CNPJ
            </Button>
          </div>
          <Campo rotulo={papel === "cliente" ? "Nome do cliente" : "Nome do fornecedor"} htmlFor="cad-nome" obrigatorio erro={estado.erros?.nome}>
            <Input id="cad-nome" name="nome" maxLength={120} required {...campo("nome")} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Telefone / WhatsApp" htmlFor="cad-telefone" erro={estado.erros?.telefone}>
              <Input id="cad-telefone" name="telefone" inputMode="tel" placeholder="(63) 99999-0000" {...campo("telefone")} />
            </Campo>
            <Campo rotulo="E-mail" htmlFor="cad-email" erro={estado.erros?.email}>
              <Input id="cad-email" name="email" type="email" maxLength={120} {...campo("email")} />
            </Campo>
          </div>
          {papel === "fornecedor" ? (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Vendedor / contato" htmlFor="cad-contato">
                <Input id="cad-contato" name="contato" maxLength={80} defaultValue={c?.contato ?? ""} placeholder="Ex.: Carlos (vendas)" />
              </Campo>
              <Campo rotulo="Prazo de pagamento (dias)" htmlFor="cad-prazo" erro={estado.erros?.prazo_pagamento_dias} ajuda="Ex.: 28 para boleto em 28 dias.">
                <Input id="cad-prazo" name="prazo_pagamento_dias" inputMode="numeric" maxLength={3} defaultValue={c?.prazo_pagamento_dias?.toString() ?? ""} />
              </Campo>
            </div>
          ) : null}
          <fieldset className="space-y-3 rounded-xl border border-border p-3">
            <legend className="px-1 text-sm font-medium">Endereço</legend>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr] [&>*]:min-w-0">
              <Campo rotulo="CEP" htmlFor="cad-cep" erro={estado.erros?.cep}>
                <Input id="cad-cep" name="cep" inputMode="numeric" maxLength={9} {...campo("cep")} />
              </Campo>
              <Campo rotulo="Rua / avenida" htmlFor="cad-logradouro">
                <Input id="cad-logradouro" name="logradouro" maxLength={60} {...campo("logradouro")} />
              </Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-[7rem_1fr_1fr] [&>*]:min-w-0">
              <Campo rotulo="Número" htmlFor="cad-numero">
                <Input id="cad-numero" name="numero" maxLength={60} {...campo("numero")} />
              </Campo>
              <Campo rotulo="Complemento" htmlFor="cad-complemento">
                <Input id="cad-complemento" name="complemento" maxLength={60} {...campo("complemento")} />
              </Campo>
              <Campo rotulo="Bairro" htmlFor="cad-bairro">
                <Input id="cad-bairro" name="bairro" maxLength={60} {...campo("bairro")} />
              </Campo>
            </div>
            <Campo rotulo="Estado e município" htmlFor="cad-mun">
              <SeletorMunicipio
                key={mun.chave}
                idBase="cad-mun"
                ufInicial={mun.uf}
                municipioInicial={mun.ibge}
                municipiosIniciais={mun.lista}
                carregar={(uf) => municipiosCadastro(empresaId, uf)}
              />
            </Campo>
          </fieldset>
          <Campo rotulo="Inscrição estadual" htmlFor="cad-ie" ajuda="Só números. Deixe em branco se não tiver (isento ou consumidor).">
            <Input id="cad-ie" name="inscricao_estadual" inputMode="numeric" maxLength={20} defaultValue={c?.inscricao_estadual ?? ""} />
          </Campo>
          <Campo rotulo="Observações" htmlFor="cad-obs">
            <Textarea id="cad-obs" name="observacoes" rows={2} maxLength={1000} defaultValue={c?.observacoes ?? ""} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{c ? "Salvar alterações" : papel === "cliente" ? "Cadastrar cliente" : "Cadastrar fornecedor"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Desativar (sem apagar o histórico) ou reativar. */
export function BotaoAtivarCadastro({ empresaId, id, nome, ativo }: { empresaId: string; id: string; nome: string; ativo: boolean }) {
  return (
    <BotaoAcao
      variante="contorno"
      acao={() => ativarCadastroLoja(empresaId, id, !ativo)}
      confirmar={
        ativo
          ? {
              titulo: `Desativar ${nome}?`,
              descricao: "O cadastro sai das listas de escolha (venda, nota), mas as compras, vendas e contas continuam no histórico. Dá para reativar depois.",
              textoConfirmar: "Desativar",
            }
          : undefined
      }
    >
      {ativo ? "Desativar" : "Reativar"}
    </BotaoAcao>
  );
}

/** Traz os emitentes das notas de compra já recebidas para o cadastro de fornecedores. */
export function BotaoTrazerFornecedores({ empresaId }: { empresaId: string }) {
  return (
    <BotaoAcao variante="contorno" acao={() => trazerFornecedoresDasNotas(empresaId)}>
      <Download /> Trazer das notas de compra
    </BotaoAcao>
  );
}
