"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Banknote, PackagePlus, Pencil, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { registrarRecebimento, salvarPacote, salvarPaciente } from "@/lib/fisioterapia/acoes";
import { ESTADOS_CIVIS, FORMAS_RECEBIMENTO, GENEROS } from "@/lib/fisioterapia/rotulos";

export interface PacienteForm {
  id: string;
  nome: string;
  nome_social: string | null;
  cpf: string | null;
  nascimento: string | null;
  genero: string | null;
  estado_civil: string | null;
  naturalidade: string | null;
  profissao: string | null;
  telefone: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
  contato_emergencia: string | null;
  convenio: string | null;
  carteirinha: string | null;
  medico_encaminhador: string | null;
  observacoes: string | null;
  aceita_whatsapp: boolean;
  consentimento_em: string | null;
}

/** Cadastro do paciente (identificação do prontuário, Res. COFFITO nº 414/2012) e consentimento LGPD. */
export function DialogoPaciente({ empresaId, paciente }: { empresaId: string; paciente?: PacienteForm }) {
  const [aberto, setAberto] = React.useState(false);
  const router = useRouter();
  const p = paciente;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {p ? (
          <Button variante="contorno" tamanho="sm">
            <Pencil /> Editar cadastro
          </Button>
        ) : (
          <Button>
            <UserPlus /> Novo paciente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={p ? "Cadastro do paciente" : "Novo paciente"} largura="xl">
        <FormularioAcao
          acao={salvarPaciente.bind(null, empresaId, p?.id ?? null)}
          aoSucesso={(r) => {
            setAberto(false);
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (!p && id) router.push(`/e/${empresaId}/fisioterapia/pacientes/${id}`);
          }}
          className="space-y-5"
        >
          {({ estado, pendente }) => (
            <>
              <section className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Nome completo" htmlFor="pa-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                  <Input id="pa-nome" name="nome" maxLength={120} defaultValue={p?.nome ?? ""} required />
                </Campo>
                <Campo rotulo="Nome social" htmlFor="pa-social">
                  <Input id="pa-social" name="nome_social" maxLength={120} defaultValue={p?.nome_social ?? ""} />
                </Campo>
                <Campo rotulo="CPF" htmlFor="pa-cpf" erro={estado.erros?.cpf}>
                  <Input id="pa-cpf" name="cpf" inputMode="numeric" maxLength={14} defaultValue={p?.cpf ?? ""} />
                </Campo>
                <Campo rotulo="Nascimento" htmlFor="pa-nasc" erro={estado.erros?.nascimento}>
                  <Input id="pa-nasc" name="nascimento" type="date" defaultValue={p?.nascimento ?? ""} />
                </Campo>
                <Campo rotulo="Gênero" htmlFor="pa-genero">
                  <Select id="pa-genero" name="genero" defaultValue={p?.genero ?? ""}>
                    <option value="">—</option>
                    {Object.entries(GENEROS).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Estado civil" htmlFor="pa-civil">
                  <Select id="pa-civil" name="estado_civil" defaultValue={p?.estado_civil ?? ""}>
                    <option value="">—</option>
                    {Object.entries(ESTADOS_CIVIS).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Naturalidade" htmlFor="pa-nat" ajuda="Cidade/UF onde nasceu">
                  <Input id="pa-nat" name="naturalidade" maxLength={80} defaultValue={p?.naturalidade ?? ""} />
                </Campo>
                <Campo rotulo="Profissão" htmlFor="pa-prof">
                  <Input id="pa-prof" name="profissao" maxLength={80} defaultValue={p?.profissao ?? ""} />
                </Campo>
              </section>
              <section className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Telefone (WhatsApp)" htmlFor="pa-tel" erro={estado.erros?.telefone}>
                  <Input id="pa-tel" name="telefone" inputMode="tel" maxLength={16} defaultValue={p?.telefone ?? ""} />
                </Campo>
                <Campo rotulo="E-mail" htmlFor="pa-email" className="sm:col-span-2">
                  <Input id="pa-email" name="email" type="email" maxLength={200} defaultValue={p?.email ?? ""} />
                </Campo>
                <Campo rotulo="CEP" htmlFor="pa-cep">
                  <Input id="pa-cep" name="cep" inputMode="numeric" maxLength={9} defaultValue={p?.cep ?? ""} />
                </Campo>
                <Campo rotulo="Endereço" htmlFor="pa-log" className="sm:col-span-2">
                  <Input id="pa-log" name="logradouro" maxLength={150} defaultValue={p?.logradouro ?? ""} />
                </Campo>
                <Campo rotulo="Número" htmlFor="pa-num">
                  <Input id="pa-num" name="numero" maxLength={20} defaultValue={p?.numero ?? ""} />
                </Campo>
                <Campo rotulo="Complemento" htmlFor="pa-comp">
                  <Input id="pa-comp" name="complemento" maxLength={80} defaultValue={p?.complemento ?? ""} />
                </Campo>
                <Campo rotulo="Bairro" htmlFor="pa-bairro">
                  <Input id="pa-bairro" name="bairro" maxLength={80} defaultValue={p?.bairro ?? ""} />
                </Campo>
                <Campo rotulo="Cidade" htmlFor="pa-cidade" className="sm:col-span-2">
                  <Input id="pa-cidade" name="cidade" maxLength={80} defaultValue={p?.cidade ?? ""} />
                </Campo>
                <Campo rotulo="UF" htmlFor="pa-uf">
                  <Input id="pa-uf" name="uf" maxLength={2} defaultValue={p?.uf ?? ""} className="uppercase" />
                </Campo>
              </section>
              <section className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Convênio" htmlFor="pa-conv" ajuda="Vazio = particular">
                  <Input id="pa-conv" name="convenio" maxLength={80} defaultValue={p?.convenio ?? ""} />
                </Campo>
                <Campo rotulo="Carteirinha" htmlFor="pa-cart">
                  <Input id="pa-cart" name="carteirinha" maxLength={40} defaultValue={p?.carteirinha ?? ""} />
                </Campo>
                <Campo rotulo="Médico que encaminhou" htmlFor="pa-med">
                  <Input id="pa-med" name="medico_encaminhador" maxLength={120} defaultValue={p?.medico_encaminhador ?? ""} />
                </Campo>
                <Campo rotulo="Responsável (menor de idade)" htmlFor="pa-resp">
                  <Input id="pa-resp" name="responsavel" maxLength={120} defaultValue={p?.responsavel ?? ""} />
                </Campo>
                <Campo rotulo="Contato de emergência" htmlFor="pa-emerg" className="sm:col-span-2">
                  <Input id="pa-emerg" name="contato_emergencia" maxLength={160} defaultValue={p?.contato_emergencia ?? ""} placeholder="Nome e telefone" />
                </Campo>
              </section>
              <Campo rotulo="Observações da recepção" htmlFor="pa-obs" ajuda="Dados administrativos. A parte clínica vai no prontuário, que só os fisioterapeutas leem.">
                <Textarea id="pa-obs" name="observacoes" rows={2} maxLength={1000} defaultValue={p?.observacoes ?? ""} />
              </Campo>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="aceita_whatsapp" defaultChecked={p?.aceita_whatsapp ?? true} className="mt-0.5" />
                  <span>Aceita receber a confirmação dos horários pelo WhatsApp da clínica</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="consentimento" defaultChecked={Boolean(p?.consentimento_em)} className="mt-0.5" />
                  <span>
                    O paciente (ou responsável) autorizou o uso dos dados de saúde para o atendimento e o prontuário (LGPD, art. 11).
                    <span className="block text-xs text-muted-foreground">O portal guarda a data e quem registrou a autorização.</span>
                  </span>
                </label>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{p ? "Salvar" : "Cadastrar"}</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export interface PacoteForm {
  id: string;
  descricao: string;
  sessoes: number;
  valor_total: number;
  inicio: string;
  validade: string | null;
  convenio: string | null;
  guia: string | null;
  status: string;
}

/** Pacote de sessões (particular ou convênio, com a guia de autorização). */
export function DialogoPacote({ empresaId, pacienteId, pacote, hoje }: { empresaId: string; pacienteId: string; pacote?: PacoteForm; hoje: string }) {
  const [aberto, setAberto] = React.useState(false);
  const k = pacote;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {k ? (
          <Button variante="fantasma" tamanho="sm" aria-label="Alterar pacote">
            <Pencil />
          </Button>
        ) : (
          <Button variante="contorno" tamanho="sm">
            <PackagePlus /> Novo pacote
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={k ? "Alterar pacote" : "Novo pacote de sessões"}>
        <FormularioAcao acao={salvarPacote.bind(null, empresaId, pacienteId, k?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Descrição" htmlFor="pk-desc" className="sm:col-span-2">
                  <Input id="pk-desc" name="descricao" maxLength={120} defaultValue={k?.descricao ?? ""} placeholder="Ex.: Pacote 10 sessões — coluna" />
                </Campo>
                <Campo rotulo="Sessões" htmlFor="pk-sessoes" obrigatorio erro={estado.erros?.sessoes}>
                  <Input id="pk-sessoes" name="sessoes" type="number" min={1} max={200} defaultValue={k?.sessoes ?? 10} />
                </Campo>
                <Campo rotulo="Valor total (R$)" htmlFor="pk-valor" erro={estado.erros?.valor_total} ajuda="0 para convênio (o convênio paga depois)">
                  <Input id="pk-valor" name="valor_total" inputMode="decimal" defaultValue={k ? String(k.valor_total).replace(".", ",") : ""} placeholder="0,00" />
                </Campo>
                <Campo rotulo="Início" htmlFor="pk-inicio" erro={estado.erros?.inicio}>
                  <Input id="pk-inicio" name="inicio" type="date" defaultValue={k?.inicio ?? hoje} />
                </Campo>
                <Campo rotulo="Validade" htmlFor="pk-validade" erro={estado.erros?.validade}>
                  <Input id="pk-validade" name="validade" type="date" defaultValue={k?.validade ?? ""} />
                </Campo>
                <Campo rotulo="Convênio" htmlFor="pk-conv" ajuda="Vazio = particular">
                  <Input id="pk-conv" name="convenio" maxLength={80} defaultValue={k?.convenio ?? ""} />
                </Campo>
                <Campo rotulo="Guia / autorização" htmlFor="pk-guia">
                  <Input id="pk-guia" name="guia" maxLength={40} defaultValue={k?.guia ?? ""} />
                </Campo>
                {k ? (
                  <Campo rotulo="Situação" htmlFor="pk-status">
                    <Select id="pk-status" name="status" defaultValue={k.status}>
                      <option value="ativo">Ativo</option>
                      <option value="encerrado">Encerrado</option>
                      <option value="cancelado">Cancelado</option>
                    </Select>
                  </Campo>
                ) : null}
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{k ? "Salvar" : "Criar pacote"}</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Recebimento (sessão, avaliação, pacote) que vira lançamento no Financeiro. */
export function DialogoRecebimento({
  empresaId,
  pacientes,
  pacienteId,
  pacotes,
  rotulo = "Registrar recebimento",
}: {
  empresaId: string;
  pacientes: { id: string; nome: string }[];
  pacienteId?: string;
  pacotes?: { id: string; descricao: string; falta: number }[];
  rotulo?: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [forma, setForma] = React.useState("pix");
  const [pacote, setPacote] = React.useState("");
  const escolhido = pacotes?.find((p) => p.id === pacote);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={pacienteId ? "contorno" : "primario"} tamanho={pacienteId ? "sm" : "md"}>
          <Banknote /> {rotulo}
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Registrar recebimento" descricao="Entra no Financeiro da empresa (contas a receber e caixa ou banco).">
        <FormularioAcao acao={registrarRecebimento.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              {pacienteId ? (
                <input type="hidden" name="paciente_id" value={pacienteId} />
              ) : (
                <Campo rotulo="Paciente" htmlFor="rc-paciente" obrigatorio erro={estado.erros?.paciente_id}>
                  <Select id="rc-paciente" name="paciente_id" defaultValue="">
                    <option value="">Escolha...</option>
                    {pacientes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              )}
              {pacotes?.length ? (
                <Campo rotulo="Pacote" htmlFor="rc-pacote">
                  <Select id="rc-pacote" name="pacote_id" value={pacote} onChange={(e) => setPacote(e.target.value)}>
                    <option value="">Sessão avulsa / outro</option>
                    {pacotes.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.descricao}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Descrição" htmlFor="rc-desc" className="sm:col-span-2">
                  <Input id="rc-desc" name="descricao" maxLength={120} placeholder={escolhido ? escolhido.descricao : "Ex.: Sessão de fisioterapia"} />
                </Campo>
                <Campo rotulo="Valor (R$)" htmlFor="rc-valor" obrigatorio erro={estado.erros?.valor}>
                  <Input
                    id="rc-valor"
                    name="valor"
                    inputMode="decimal"
                    placeholder="0,00"
                    key={pacote}
                    defaultValue={escolhido && escolhido.falta > 0 ? escolhido.falta.toFixed(2).replace(".", ",") : ""}
                  />
                </Campo>
                <Campo rotulo="Forma" htmlFor="rc-forma" erro={estado.erros?.forma}>
                  <Select id="rc-forma" name="forma" value={forma} onChange={(e) => setForma(e.target.value)}>
                    {Object.entries(FORMAS_RECEBIMENTO).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {forma === "a_receber" ? (
                  <Campo rotulo="Vencimento" htmlFor="rc-venc" obrigatorio erro={estado.erros?.vencimento}>
                    <Input id="rc-venc" name="vencimento" type="date" />
                  </Campo>
                ) : null}
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Registrar</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
