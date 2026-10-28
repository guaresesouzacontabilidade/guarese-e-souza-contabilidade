"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NotebookPen, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { excluirHospede, salvarHospede, salvarObservacoesHospede } from "@/lib/hotel/acoes";
import { GENEROS, TIPOS_DOCUMENTO } from "@/lib/hotel/rotulos";

export interface HospedeForm {
  id?: string;
  nome?: string;
  cpf?: string | null;
  documento_tipo?: string | null;
  documento?: string | null;
  nascimento?: string | null;
  genero?: string | null;
  nacionalidade?: string | null;
  profissao?: string | null;
  telefone?: string | null;
  email?: string | null;
  cep?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  uf?: string | null;
  pais?: string | null;
  observacoes?: string | null;
}

/**
 * Campos da ficha do hóspede (dados pedidos na Ficha Nacional de Registro de
 * Hóspedes). `prefixo` permite usar os campos dentro do formulário da reserva.
 */
export function CamposHospede({ prefixo = "", h, erros, completo = true }: { prefixo?: string; h?: HospedeForm; erros?: Record<string, string[] | undefined>; completo?: boolean }) {
  const n = (c: string) => `${prefixo}${c}`;
  const id = (c: string) => `hs-${prefixo}${c}`;
  const e = (c: string) => erros?.[n(c)];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Nome completo" htmlFor={id("nome")} obrigatorio erro={e("nome")} className="sm:col-span-2">
          <Input id={id("nome")} name={n("nome")} maxLength={120} defaultValue={h?.nome ?? ""} autoComplete="off" />
        </Campo>
        <Campo rotulo="CPF" htmlFor={id("cpf")} erro={e("cpf")} ajuda="Para estrangeiro ou criança sem CPF, informe outro documento.">
          <Input id={id("cpf")} name={n("cpf")} inputMode="numeric" maxLength={14} defaultValue={h?.cpf ?? ""} placeholder="000.000.000-00" />
        </Campo>
        <Campo rotulo="Telefone (WhatsApp)" htmlFor={id("telefone")} erro={e("telefone")}>
          <Input id={id("telefone")} name={n("telefone")} inputMode="tel" maxLength={16} defaultValue={h?.telefone ?? ""} placeholder="(63) 99999-0000" />
        </Campo>
        <Campo rotulo="Outro documento" htmlFor={id("documento_tipo")}>
          <Select id={id("documento_tipo")} name={n("documento_tipo")} defaultValue={h?.documento_tipo ?? ""}>
            <option value="">—</option>
            {Object.entries(TIPOS_DOCUMENTO).map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Número do documento" htmlFor={id("documento")}>
          <Input id={id("documento")} name={n("documento")} maxLength={30} defaultValue={h?.documento ?? ""} />
        </Campo>
        <Campo rotulo="Data de nascimento" htmlFor={id("nascimento")} erro={e("nascimento")}>
          <Input id={id("nascimento")} name={n("nascimento")} type="date" defaultValue={h?.nascimento ?? ""} />
        </Campo>
        <Campo rotulo="E-mail" htmlFor={id("email")} erro={e("email")}>
          <Input id={id("email")} name={n("email")} type="email" maxLength={200} defaultValue={h?.email ?? ""} />
        </Campo>
        <Campo rotulo="Cidade de residência" htmlFor={id("cidade")}>
          <Input id={id("cidade")} name={n("cidade")} maxLength={80} defaultValue={h?.cidade ?? ""} />
        </Campo>
        <Campo rotulo="UF" htmlFor={id("uf")} erro={e("uf")}>
          <Input id={id("uf")} name={n("uf")} maxLength={2} defaultValue={h?.uf ?? ""} placeholder="TO" className="uppercase" />
        </Campo>
      </div>
      {completo ? (
        <details className="rounded-xl border border-border p-3" open={Boolean(h?.endereco || h?.profissao || h?.genero)}>
          <summary className="cursor-pointer text-sm font-medium">Mais dados da ficha (endereço, profissão, nacionalidade)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Gênero" htmlFor={id("genero")}>
              <Select id={id("genero")} name={n("genero")} defaultValue={h?.genero ?? ""}>
                <option value="">—</option>
                {Object.entries(GENEROS).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Profissão" htmlFor={id("profissao")}>
              <Input id={id("profissao")} name={n("profissao")} maxLength={80} defaultValue={h?.profissao ?? ""} />
            </Campo>
            <Campo rotulo="Nacionalidade" htmlFor={id("nacionalidade")}>
              <Input id={id("nacionalidade")} name={n("nacionalidade")} maxLength={60} defaultValue={h?.nacionalidade ?? "Brasileira"} />
            </Campo>
            <Campo rotulo="País de residência" htmlFor={id("pais")}>
              <Input id={id("pais")} name={n("pais")} maxLength={60} defaultValue={h?.pais ?? "Brasil"} />
            </Campo>
            <Campo rotulo="Endereço" htmlFor={id("endereco")} className="sm:col-span-2">
              <Input id={id("endereco")} name={n("endereco")} maxLength={200} defaultValue={h?.endereco ?? ""} placeholder="Rua, número, bairro" />
            </Campo>
            <Campo rotulo="CEP" htmlFor={id("cep")} erro={e("cep")}>
              <Input id={id("cep")} name={n("cep")} inputMode="numeric" maxLength={9} defaultValue={h?.cep ?? ""} />
            </Campo>
          </div>
        </details>
      ) : null}
      {completo ? (
        <Campo
          rotulo="Observações sobre o hóspede"
          htmlFor={id("observacoes")}
          erro={e("observacoes")}
          ajuda="Preferências, alergias, cuidados e avisos para a equipe. Só o hotel vê: não sai nos documentos do hóspede."
        >
          <Textarea
            id={id("observacoes")}
            name={n("observacoes")}
            rows={3}
            maxLength={1000}
            defaultValue={h?.observacoes ?? ""}
            placeholder="Prefere quarto no térreo. Alergia a camarão. Chega tarde, deixar a chave na portaria."
          />
        </Campo>
      ) : null}
    </div>
  );
}

/** Cadastro ou edição do hóspede. Ao criar, pode abrir a ficha do novo hóspede. */
export function DialogoHospede({ empresaId, hospede, abrirAoCriar = false }: { empresaId: string; hospede?: HospedeForm & { id: string }; abrirAoCriar?: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  const router = useRouter();
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {hospede ? (
          <Button variante="contorno" tamanho="sm">
            <Pencil /> Editar cadastro
          </Button>
        ) : (
          <Button>
            <UserPlus /> Novo hóspede
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={hospede ? hospede.nome ?? "Hóspede" : "Novo hóspede"} descricao="Dados da ficha de registro. Ficam só com o hotel." largura="lg">
        <FormularioAcao
          acao={salvarHospede.bind(null, empresaId, hospede?.id ?? null)}
          aoSucesso={(r) => {
            setAberto(false);
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (!hospede && abrirAoCriar && id) router.push(`/e/${empresaId}/hotel/hospedes/${id}`);
          }}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              <CamposHospede h={hospede} erros={estado.erros} />
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Observações sobre o hóspede (preferências, alergias, cuidados): a recepção anota a qualquer momento. */
export function DialogoObservacoesHospede({ empresaId, hospedeId, nome, observacoes }: { empresaId: string; hospedeId: string; nome: string; observacoes: string | null }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={observacoes ? "fantasma" : "contorno"} tamanho="sm" aria-label={observacoes ? "Editar as observações sobre o hóspede" : "Anotar observação sobre o hóspede"}>
          <NotebookPen /> {observacoes ? "Editar" : "Anotar"}
        </Button>
      </DialogTrigger>
      <DialogContent
        titulo={`Observações sobre ${nome}`}
        descricao="Ficam no cadastro do hóspede e aparecem nas próximas estadias. Só a equipe do hotel vê: não saem nos documentos entregues ao hóspede."
      >
        <FormularioAcao acao={salvarObservacoesHospede.bind(null, empresaId, hospedeId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Observações" htmlFor="ob-texto" erro={estado.erros?.observacoes}>
                <Textarea
                  id="ob-texto"
                  name="observacoes"
                  rows={5}
                  maxLength={1000}
                  defaultValue={observacoes ?? ""}
                  placeholder="Prefere quarto no térreo. Alergia a camarão. Pede travesseiro extra."
                />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar observações</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function BotaoExcluirHospede({ empresaId, hospedeId }: { empresaId: string; hospedeId: string }) {
  const router = useRouter();
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="sm"
      acao={excluirHospede.bind(null, empresaId, hospedeId)}
      aoSucesso={() => router.push(`/e/${empresaId}/hotel/hospedes`)}
      confirmar={{
        titulo: "Excluir o cadastro deste hóspede?",
        descricao: "Só é possível quando ele não tem hospedagem registrada (a ficha de quem se hospedou fica guardada com a hospedagem).",
        textoConfirmar: "Excluir",
        perigo: true,
      }}
    >
      <Trash2 /> Excluir
    </BotaoAcao>
  );
}
