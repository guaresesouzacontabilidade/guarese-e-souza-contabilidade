"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { salvarConfiguracaoClinica, salvarServico, salvarVacinaCatalogo, salvarVeterinario } from "@/lib/veterinaria/acoes";
import { CATEGORIAS_SERVICO, ESPECIES_VACINA } from "@/lib/veterinaria/rotulos";

export interface ConfigClinica {
  nome_clinica: string | null;
  registro_crmv: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  cidade_documentos: string | null;
  horario_inicio: string;
  horario_fim: string;
  duracao_padrao_min: number;
  lembrete_dias_antes: number;
  lembrete_email: boolean;
  mensagem_vacina: string | null;
  mensagem_retorno: string | null;
}

export function FormularioConfigClinica({ empresaId, c, emailConfigurado }: { empresaId: string; c: ConfigClinica; emailConfigurado: boolean }) {
  return (
    <FormularioAcao acao={salvarConfiguracaoClinica.bind(null, empresaId)} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <section className="space-y-4">
            <h2 className="font-semibold">Identificação nos documentos</h2>
            <p className="text-sm text-muted-foreground">
              Receitas, atestados e termos saem só com a logo da clínica (a do cadastro da empresa), sem propaganda (Res. CFMV nº 1.321/2020, art. 3º, § 1º).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome da clínica" htmlFor="cf-nome" ajuda="Vazio = nome fantasia do cadastro.">
                <Input id="cf-nome" name="nome_clinica" maxLength={120} defaultValue={c.nome_clinica ?? ""} />
              </Campo>
              <Campo rotulo="Registro da clínica no CRMV" htmlFor="cf-crmv">
                <Input id="cf-crmv" name="registro_crmv" maxLength={30} defaultValue={c.registro_crmv ?? ""} />
              </Campo>
              <Campo rotulo="Telefone" htmlFor="cf-tel" erro={estado.erros?.telefone}>
                <Input id="cf-tel" name="telefone" inputMode="tel" maxLength={16} defaultValue={c.telefone ?? ""} />
              </Campo>
              <Campo rotulo="E-mail" htmlFor="cf-email">
                <Input id="cf-email" name="email" type="email" maxLength={200} defaultValue={c.email ?? ""} />
              </Campo>
              <Campo rotulo="Endereço completo" htmlFor="cf-end" className="sm:col-span-2" ajuda="Vazio = endereço do cadastro da empresa.">
                <Input id="cf-end" name="endereco" maxLength={300} defaultValue={c.endereco ?? ""} />
              </Campo>
              <Campo rotulo="Cidade que sai na data dos documentos" htmlFor="cf-cidade" ajuda="Ex.: Porto Nacional/TO">
                <Input id="cf-cidade" name="cidade_documentos" maxLength={80} defaultValue={c.cidade_documentos ?? ""} />
              </Campo>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold">Agenda</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Abre às" htmlFor="cf-ini" erro={estado.erros?.horario_inicio}>
                <Input id="cf-ini" name="horario_inicio" type="time" defaultValue={c.horario_inicio.slice(0, 5)} />
              </Campo>
              <Campo rotulo="Fecha às" htmlFor="cf-fim" erro={estado.erros?.horario_fim}>
                <Input id="cf-fim" name="horario_fim" type="time" defaultValue={c.horario_fim.slice(0, 5)} />
              </Campo>
              <Campo rotulo="Duração padrão (min)" htmlFor="cf-dur">
                <Input id="cf-dur" name="duracao_padrao_min" type="number" min={5} max={240} step={5} defaultValue={c.duracao_padrao_min} />
              </Campo>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-semibold">Lembretes de vacina e retorno</h2>
            <Campo rotulo="Avisar quantos dias antes" htmlFor="cf-dias" erro={estado.erros?.lembrete_dias_antes}>
              <Input id="cf-dias" name="lembrete_dias_antes" type="number" min={0} max={60} defaultValue={c.lembrete_dias_antes} className="w-28" />
            </Campo>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="lembrete_email" defaultChecked={c.lembrete_email} className="mt-0.5" />
              <span>
                Enviar e-mail automático aos tutores que autorizaram
                <span className="block text-muted-foreground">
                  {emailConfigurado
                    ? "Sai todo dia de manhã, pelo e-mail do portal, com o nome da clínica no assunto."
                    : "O envio de e-mail do portal ainda não está configurado pelo escritório: os lembretes ficam registrados como “não enviados” até a configuração."}
                </span>
              </span>
            </label>
            <Campo
              rotulo="Mensagem da vacina"
              htmlFor="cf-msg-vac"
              ajuda="Use {tutor}, {animal}, {vacina}, {data} e {clinica}. Vai no WhatsApp e no e-mail."
            >
              <Textarea id="cf-msg-vac" name="mensagem_vacina" rows={3} maxLength={600} defaultValue={c.mensagem_vacina ?? ""} />
            </Campo>
            <Campo rotulo="Mensagem do retorno" htmlFor="cf-msg-ret" ajuda="Use {tutor}, {animal}, {data} e {clinica}.">
              <Textarea id="cf-msg-ret" name="mensagem_retorno" rows={3} maxLength={600} defaultValue={c.mensagem_retorno ?? ""} />
            </Campo>
          </section>

          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar configurações</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export interface VeterinarioForm {
  id: string;
  nome: string;
  crmv: string;
  crmv_uf: string;
  cadastro_mapa: string | null;
  especialidade: string | null;
  telefone: string | null;
  email: string | null;
  perfil_id: string | null;
  responsavel_tecnico: boolean;
  ativo: boolean;
}

export function DialogoVeterinario({ empresaId, v, usuarios }: { empresaId: string; v?: VeterinarioForm; usuarios: { id: string; nome: string }[] }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {v ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Editar ${v.nome}`}>
            <Pencil />
          </Button>
        ) : (
          <Button tamanho="sm">
            <Plus /> Veterinário
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={v ? v.nome : "Novo veterinário"}
        descricao="Ligue ao usuário do portal da pessoa: só ela registra prontuário, receitas, vacinas e atestados com o próprio CRMV."
        largura="lg"
      >
        <FormularioAcao acao={salvarVeterinario.bind(null, empresaId, v?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome completo" htmlFor="ve-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                  <Input id="ve-nome" name="nome" maxLength={120} defaultValue={v?.nome ?? ""} />
                </Campo>
                <Campo rotulo="CRMV (número)" htmlFor="ve-crmv" obrigatorio erro={estado.erros?.crmv}>
                  <Input id="ve-crmv" name="crmv" maxLength={15} defaultValue={v?.crmv ?? ""} />
                </Campo>
                <Campo rotulo="UF do CRMV" htmlFor="ve-uf" obrigatorio erro={estado.erros?.crmv_uf}>
                  <Input id="ve-uf" name="crmv_uf" maxLength={2} defaultValue={v?.crmv_uf ?? ""} className="uppercase" placeholder="TO" />
                </Campo>
                <Campo rotulo="Cadastro no MAPA" htmlFor="ve-mapa" ajuda="Só para receita de manipulado sujeito a controle especial (Portaria MAPA nº 837/2025).">
                  <Input id="ve-mapa" name="cadastro_mapa" maxLength={30} defaultValue={v?.cadastro_mapa ?? ""} />
                </Campo>
                <Campo rotulo="Especialidade" htmlFor="ve-esp">
                  <Input id="ve-esp" name="especialidade" maxLength={80} defaultValue={v?.especialidade ?? ""} />
                </Campo>
                <Campo rotulo="Telefone" htmlFor="ve-tel">
                  <Input id="ve-tel" name="telefone" inputMode="tel" maxLength={16} defaultValue={v?.telefone ?? ""} />
                </Campo>
                <Campo rotulo="E-mail" htmlFor="ve-email">
                  <Input id="ve-email" name="email" type="email" maxLength={200} defaultValue={v?.email ?? ""} />
                </Campo>
                <Campo rotulo="Usuário do portal" htmlFor="ve-perfil" erro={estado.erros?.perfil_id} className="sm:col-span-2" ajuda="Quem não tem usuário: convide em Configurações > Usuários.">
                  <Select id="ve-perfil" name="perfil_id" defaultValue={v?.perfil_id ?? ""}>
                    <option value="">Sem usuário (não registra atos clínicos)</option>
                    {usuarios.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="responsavel_tecnico" defaultChecked={v?.responsavel_tecnico ?? false} /> Responsável técnico da clínica
              </label>
              {v ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativo" value="off" />
                  <Checkbox name="ativo" defaultChecked={v.ativo} /> Ativo
                </label>
              ) : null}
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

export interface VacinaForm {
  id: string;
  nome: string;
  especie: string;
  fabricante: string | null;
  doses_iniciais: number;
  intervalo_doses_dias: number;
  reforco_dias: number | null;
  observacao: string | null;
  ativa: boolean;
  produto_id?: string | null;
}

export function DialogoVacinaCatalogo({ empresaId, v, produtos = [] }: { empresaId: string; v?: VacinaForm; produtos?: { id: string; descricao: string }[] }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {v ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Editar ${v.nome}`}>
            <Pencil />
          </Button>
        ) : (
          <Button tamanho="sm">
            <Plus /> Vacina
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={v ? v.nome : "Nova vacina"} descricao="O esquema define a próxima dose sugerida (e os lembretes). Confira com a bula do fabricante.">
        <FormularioAcao acao={salvarVacinaCatalogo.bind(null, empresaId, v?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome" htmlFor="vc-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                  <Input id="vc-nome" name="nome" maxLength={80} defaultValue={v?.nome ?? ""} />
                </Campo>
                <Campo rotulo="Para" htmlFor="vc-especie">
                  <Select id="vc-especie" name="especie" defaultValue={v?.especie ?? "canina"}>
                    {Object.entries(ESPECIES_VACINA).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Fabricante usual" htmlFor="vc-fab">
                  <Input id="vc-fab" name="fabricante" maxLength={80} defaultValue={v?.fabricante ?? ""} />
                </Campo>
                <Campo rotulo="Doses do esquema inicial" htmlFor="vc-doses">
                  <Input id="vc-doses" name="doses_iniciais" type="number" min={1} max={6} defaultValue={v?.doses_iniciais ?? 1} />
                </Campo>
                <Campo rotulo="Intervalo entre as doses (dias)" htmlFor="vc-int">
                  <Input id="vc-int" name="intervalo_doses_dias" type="number" min={7} max={120} defaultValue={v?.intervalo_doses_dias ?? 21} />
                </Campo>
                <Campo rotulo="Reforço depois de (dias)" htmlFor="vc-ref" ajuda="Vazio = sem reforço. Anual = 365.">
                  <Input id="vc-ref" name="reforco_dias" type="number" min={30} max={1825} defaultValue={v?.reforco_dias ?? 365} />
                </Campo>
              </div>
              <Campo rotulo="Observação" htmlFor="vc-obs">
                <Input id="vc-obs" name="observacao" maxLength={300} defaultValue={v?.observacao ?? ""} />
              </Campo>
              <Campo
                rotulo="Produto do estoque"
                htmlFor="vc-produto"
                ajuda="Cada aplicação na clínica tira 1 unidade deste produto (cadastre a vacina por dose) e cancelar a vacina devolve. Vazio = sem baixa."
              >
                <Select id="vc-produto" name="produto_id" defaultValue={v?.produto_id ?? ""}>
                  <option value="">Sem baixa no estoque</option>
                  {produtos.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.descricao}
                    </option>
                  ))}
                </Select>
              </Campo>
              {v ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativa" value="off" />
                  <Checkbox name="ativa" defaultChecked={v.ativa} /> Ativa (aparece na aplicação)
                </label>
              ) : null}
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

export interface ServicoForm {
  id: string;
  nome: string;
  categoria: string;
  preco: number | string;
  ativo: boolean;
}

export function DialogoServico({ empresaId, s }: { empresaId: string; s?: ServicoForm }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {s ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Editar ${s.nome}`}>
            <Pencil />
          </Button>
        ) : (
          <Button tamanho="sm">
            <Plus /> Serviço
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={s ? s.nome : "Novo serviço"} descricao="Tabela de preços usada nas contas da clínica.">
        <FormularioAcao acao={salvarServico.bind(null, empresaId, s?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome" htmlFor="sv-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                  <Input id="sv-nome" name="nome" maxLength={80} defaultValue={s?.nome ?? ""} />
                </Campo>
                <Campo rotulo="Categoria" htmlFor="sv-cat">
                  <Select id="sv-cat" name="categoria" defaultValue={s?.categoria ?? "consulta"}>
                    {Object.entries(CATEGORIAS_SERVICO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Preço (R$)" htmlFor="sv-preco" obrigatorio erro={estado.erros?.preco}>
                  <Input id="sv-preco" name="preco" inputMode="decimal" maxLength={14} defaultValue={s ? String(s.preco).replace(".", ",") : ""} />
                </Campo>
              </div>
              {s ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativo" value="off" />
                  <Checkbox name="ativo" defaultChecked={s.ativo} /> Ativo
                </label>
              ) : null}
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
