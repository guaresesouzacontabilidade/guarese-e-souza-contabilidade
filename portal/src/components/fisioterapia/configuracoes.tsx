"use client";

import * as React from "react";
import { Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { salvarConfiguracaoFisio, salvarProfissional } from "@/lib/fisioterapia/acoes";

export interface ConfigFisio {
  nome_clinica: string | null;
  registro_crefito: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  cidade_documentos: string | null;
  horario_inicio: string;
  horario_fim: string;
  duracao_padrao_min: number;
  valor_sessao: number;
  falta_desconta_sessao: boolean;
  mensagem_confirmacao: string | null;
}

export function FormConfigFisio({ empresaId, cfg }: { empresaId: string; cfg: ConfigFisio }) {
  return (
    <FormularioAcao acao={salvarConfiguracaoFisio.bind(null, empresaId)} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome da clínica nos documentos" htmlFor="cf-nome" ajuda="Vazio = nome fantasia da empresa">
              <Input id="cf-nome" name="nome_clinica" maxLength={120} defaultValue={cfg.nome_clinica ?? ""} />
            </Campo>
            <Campo rotulo="Registro da clínica no CREFITO" htmlFor="cf-crefito">
              <Input id="cf-crefito" name="registro_crefito" maxLength={30} defaultValue={cfg.registro_crefito ?? ""} />
            </Campo>
            <Campo rotulo="Telefone" htmlFor="cf-tel" erro={estado.erros?.telefone}>
              <Input id="cf-tel" name="telefone" inputMode="tel" maxLength={16} defaultValue={cfg.telefone ?? ""} />
            </Campo>
            <Campo rotulo="E-mail" htmlFor="cf-email">
              <Input id="cf-email" name="email" type="email" maxLength={200} defaultValue={cfg.email ?? ""} />
            </Campo>
            <Campo rotulo="Endereço nos documentos" htmlFor="cf-end" className="sm:col-span-2">
              <Input id="cf-end" name="endereco" maxLength={300} defaultValue={cfg.endereco ?? ""} />
            </Campo>
            <Campo rotulo="Cidade dos documentos" htmlFor="cf-cidade">
              <Input id="cf-cidade" name="cidade_documentos" maxLength={80} defaultValue={cfg.cidade_documentos ?? ""} />
            </Campo>
            <Campo rotulo="Valor da sessão avulsa (R$)" htmlFor="cf-valor" erro={estado.erros?.valor_sessao} ajuda="Base do repasse quando a sessão não é de pacote">
              <Input id="cf-valor" name="valor_sessao" inputMode="decimal" defaultValue={String(cfg.valor_sessao).replace(".", ",")} />
            </Campo>
            <Campo rotulo="Agenda abre às" htmlFor="cf-ini" erro={estado.erros?.horario_inicio}>
              <Input id="cf-ini" name="horario_inicio" type="time" defaultValue={cfg.horario_inicio.slice(0, 5)} />
            </Campo>
            <Campo rotulo="Agenda fecha às" htmlFor="cf-fim" erro={estado.erros?.horario_fim}>
              <Input id="cf-fim" name="horario_fim" type="time" defaultValue={cfg.horario_fim.slice(0, 5)} />
            </Campo>
            <Campo rotulo="Duração padrão da sessão (min)" htmlFor="cf-dur">
              <Input id="cf-dur" name="duracao_padrao_min" type="number" min={10} max={240} step={5} defaultValue={cfg.duracao_padrao_min} />
            </Campo>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="falta_desconta_sessao" defaultChecked={cfg.falta_desconta_sessao} className="mt-0.5" />
            <span>Falta sem aviso conta como sessão usada do pacote</span>
          </label>
          <Campo
            rotulo="Mensagem de confirmação (WhatsApp da clínica)"
            htmlFor="cf-msg"
            ajuda="A recepção abre o WhatsApp com a mensagem pronta. Use {paciente}, {clinica}, {data}, {hora} e {profissional}."
          >
            <Textarea id="cf-msg" name="mensagem_confirmacao" rows={3} maxLength={600} defaultValue={cfg.mensagem_confirmacao ?? ""} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export interface ProfissionalForm {
  id: string;
  nome: string;
  crefito: string;
  crefito_regiao: number;
  especialidade: string | null;
  telefone: string | null;
  email: string | null;
  cor: string;
  repasse_percentual: number;
  perfil_id: string | null;
  responsavel_tecnico: boolean;
  ativo: boolean;
}

export function DialogoProfissional({ empresaId, profissional, usuarios }: { empresaId: string; profissional?: ProfissionalForm; usuarios: { id: string; nome: string }[] }) {
  const [aberto, setAberto] = React.useState(false);
  const p = profissional;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {p ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Alterar ${p.nome}`}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <UserPlus /> Novo fisioterapeuta
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={p ? "Alterar fisioterapeuta" : "Novo fisioterapeuta"} largura="lg">
        <FormularioAcao acao={salvarProfissional.bind(null, empresaId, p?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Nome" htmlFor="pr-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-3">
                  <Input id="pr-nome" name="nome" maxLength={120} defaultValue={p?.nome ?? ""} />
                </Campo>
                <Campo rotulo="CREFITO nº" htmlFor="pr-crefito" obrigatorio erro={estado.erros?.crefito}>
                  <Input id="pr-crefito" name="crefito" maxLength={15} defaultValue={p?.crefito ?? ""} placeholder="123456-F" />
                </Campo>
                <Campo rotulo="Região" htmlFor="pr-regiao" obrigatorio erro={estado.erros?.crefito_regiao} ajuda="Ex.: 11 (CREFITO-11)">
                  <Input id="pr-regiao" name="crefito_regiao" type="number" min={1} max={30} defaultValue={p?.crefito_regiao ?? ""} />
                </Campo>
                <Campo rotulo="Especialidade" htmlFor="pr-esp">
                  <Input id="pr-esp" name="especialidade" maxLength={80} defaultValue={p?.especialidade ?? ""} placeholder="Ortopedia, neuro..." />
                </Campo>
                <Campo rotulo="Telefone" htmlFor="pr-tel">
                  <Input id="pr-tel" name="telefone" inputMode="tel" maxLength={16} defaultValue={p?.telefone ?? ""} />
                </Campo>
                <Campo rotulo="E-mail" htmlFor="pr-email">
                  <Input id="pr-email" name="email" type="email" maxLength={200} defaultValue={p?.email ?? ""} />
                </Campo>
                <Campo rotulo="Cor na agenda" htmlFor="pr-cor">
                  <Input id="pr-cor" name="cor" type="color" defaultValue={p?.cor ?? "#2563eb"} className="h-10 p-1" />
                </Campo>
                <Campo rotulo="Repasse (%)" htmlFor="pr-repasse" ajuda="Do valor das sessões realizadas">
                  <Input id="pr-repasse" name="repasse_percentual" inputMode="decimal" defaultValue={p ? String(p.repasse_percentual).replace(".", ",") : "0"} />
                </Campo>
                <Campo rotulo="Usuário do portal" htmlFor="pr-perfil" erro={estado.erros?.perfil_id} className="sm:col-span-2" ajuda="Quem registra e lê o prontuário com este CREFITO">
                  <Select id="pr-perfil" name="perfil_id" defaultValue={p?.perfil_id ?? ""}>
                    <option value="">Sem usuário (só aparece na agenda)</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox name="responsavel_tecnico" defaultChecked={p?.responsavel_tecnico ?? false} /> Responsável técnico da clínica
                </label>
                {p ? (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox name="ativo" defaultChecked={p.ativo} /> Ativo
                  </label>
                ) : null}
              </div>
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
