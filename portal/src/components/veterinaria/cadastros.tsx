"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PawPrint, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { excluirPaciente, excluirTutor, salvarPaciente, salvarTutor } from "@/lib/veterinaria/acoes";
import { ESPECIES, PORTES, SEXOS } from "@/lib/veterinaria/rotulos";

export interface TutorForm {
  id?: string;
  nome?: string;
  cpf?: string | null;
  telefone?: string | null;
  telefone2?: string | null;
  email?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  autorizados?: string | null;
  observacoes?: string | null;
  aceita_whatsapp?: boolean;
  aceita_email?: boolean;
}

/** Cadastro ou edição do tutor (responsável pelo animal). Ao criar, pode abrir a ficha do novo tutor. */
export function DialogoTutor({ empresaId, tutor, abrirAoCriar = false }: { empresaId: string; tutor?: TutorForm & { id: string }; abrirAoCriar?: boolean }) {
  const [aberto, setAberto] = React.useState(false);
  const router = useRouter();
  const t = tutor;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {t ? (
          <Button variante="contorno" tamanho="sm">
            <Pencil /> Editar tutor
          </Button>
        ) : (
          <Button>
            <UserPlus /> Novo tutor
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={t ? (t.nome ?? "Tutor") : "Novo tutor"}
        descricao="Responsável pelo animal. Nome, CPF e endereço completo saem nas receitas, atestados e termos (Res. CFMV nº 1.321/2020)."
        largura="lg"
      >
        <FormularioAcao
          acao={salvarTutor.bind(null, empresaId, t?.id ?? null)}
          aoSucesso={(r) => {
            setAberto(false);
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (!t && abrirAoCriar && id) router.push(`/e/${empresaId}/veterinaria/tutores/${id}`);
          }}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome completo" htmlFor="tu-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
                  <Input id="tu-nome" name="nome" maxLength={120} defaultValue={t?.nome ?? ""} autoComplete="off" />
                </Campo>
                <Campo rotulo="CPF" htmlFor="tu-cpf" erro={estado.erros?.cpf}>
                  <Input id="tu-cpf" name="cpf" inputMode="numeric" maxLength={14} defaultValue={t?.cpf ?? ""} placeholder="000.000.000-00" />
                </Campo>
                <Campo rotulo="Telefone (WhatsApp)" htmlFor="tu-telefone" erro={estado.erros?.telefone}>
                  <Input id="tu-telefone" name="telefone" inputMode="tel" maxLength={16} defaultValue={t?.telefone ?? ""} placeholder="(63) 99999-0000" />
                </Campo>
                <Campo rotulo="Outro telefone" htmlFor="tu-telefone2" erro={estado.erros?.telefone2}>
                  <Input id="tu-telefone2" name="telefone2" inputMode="tel" maxLength={16} defaultValue={t?.telefone2 ?? ""} />
                </Campo>
                <Campo rotulo="E-mail" htmlFor="tu-email" erro={estado.erros?.email}>
                  <Input id="tu-email" name="email" type="email" maxLength={200} defaultValue={t?.email ?? ""} />
                </Campo>
                <Campo rotulo="CEP" htmlFor="tu-cep" erro={estado.erros?.cep}>
                  <Input id="tu-cep" name="cep" inputMode="numeric" maxLength={9} defaultValue={t?.cep ?? ""} />
                </Campo>
                <Campo rotulo="Rua" htmlFor="tu-logradouro">
                  <Input id="tu-logradouro" name="logradouro" maxLength={150} defaultValue={t?.logradouro ?? ""} />
                </Campo>
                <Campo rotulo="Número" htmlFor="tu-numero">
                  <Input id="tu-numero" name="numero" maxLength={20} defaultValue={t?.numero ?? ""} />
                </Campo>
                <Campo rotulo="Complemento" htmlFor="tu-complemento">
                  <Input id="tu-complemento" name="complemento" maxLength={80} defaultValue={t?.complemento ?? ""} />
                </Campo>
                <Campo rotulo="Bairro" htmlFor="tu-bairro">
                  <Input id="tu-bairro" name="bairro" maxLength={80} defaultValue={t?.bairro ?? ""} />
                </Campo>
                <Campo rotulo="Cidade" htmlFor="tu-cidade">
                  <Input id="tu-cidade" name="cidade" maxLength={80} defaultValue={t?.cidade ?? ""} />
                </Campo>
                <Campo rotulo="UF" htmlFor="tu-uf" erro={estado.erros?.uf}>
                  <Input id="tu-uf" name="uf" maxLength={2} defaultValue={t?.uf ?? ""} placeholder="TO" className="uppercase" />
                </Campo>
              </div>
              <Campo rotulo="Pessoas autorizadas" htmlFor="tu-autorizados" ajuda="Quem pode buscar o animal ou pedir cópia do prontuário em nome do tutor.">
                <Input id="tu-autorizados" name="autorizados" maxLength={500} defaultValue={t?.autorizados ?? ""} />
              </Campo>
              <Campo rotulo="Observações" htmlFor="tu-observacoes">
                <Textarea id="tu-observacoes" name="observacoes" rows={2} maxLength={1000} defaultValue={t?.observacoes ?? ""} />
              </Campo>
              <fieldset className="space-y-2 rounded-xl border border-border p-3">
                <legend className="px-1 text-sm font-medium">Lembretes de vacina e retorno (o tutor autoriza)</legend>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="aceita_whatsapp" defaultChecked={t?.aceita_whatsapp ?? true} className="mt-0.5" />
                  <span>Pelo WhatsApp da clínica (a recepção envia pelo celular da clínica)</span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="aceita_email" defaultChecked={t?.aceita_email ?? false} className="mt-0.5" />
                  <span>Por e-mail automático (quando a clínica liga o envio nas configurações)</span>
                </label>
              </fieldset>
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

export interface PacienteForm {
  id?: string;
  tutor_id: string;
  nome?: string;
  especie?: string;
  especie_outra?: string | null;
  raca?: string | null;
  sexo?: string;
  castrado?: boolean;
  nascimento?: string | null;
  nascimento_estimado?: boolean;
  pelagem?: string | null;
  porte?: string | null;
  peso_kg?: number | string | null;
  microchip?: string | null;
  sinais_particulares?: string | null;
  alergias?: string | null;
  observacoes?: string | null;
  ativo?: boolean;
}

/** Cadastro ou edição do animal. Ao criar, abre a ficha do animal. */
export function DialogoPaciente({
  empresaId,
  paciente,
  tutores,
}: {
  empresaId: string;
  paciente: PacienteForm;
  /** Na edição, permite trocar o tutor (lista dos tutores da clínica). */
  tutores?: { id: string; nome: string }[];
}) {
  const [aberto, setAberto] = React.useState(false);
  const [especie, setEspecie] = React.useState(paciente.especie ?? "canina");
  const router = useRouter();
  const p = paciente;
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {p.id ? (
          <Button variante="contorno" tamanho="sm">
            <Pencil /> Editar animal
          </Button>
        ) : (
          <Button>
            <PawPrint /> Novo animal
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={p.id ? (p.nome ?? "Animal") : "Novo animal"} descricao="Identificação usada no prontuário e em todos os documentos." largura="lg">
        <FormularioAcao
          acao={salvarPaciente.bind(null, empresaId, p.id ?? null)}
          aoSucesso={(r) => {
            setAberto(false);
            const id = (r.dados as { id?: string } | undefined)?.id;
            if (!p.id && id) router.push(`/e/${empresaId}/veterinaria/pacientes/${id}`);
          }}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              {tutores?.length ? (
                <Campo rotulo="Tutor" htmlFor="pa-tutor" obrigatorio erro={estado.erros?.tutor_id}>
                  <Select id="pa-tutor" name="tutor_id" defaultValue={p.tutor_id}>
                    {tutores.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : (
                <input type="hidden" name="tutor_id" value={p.tutor_id} />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome" htmlFor="pa-nome" obrigatorio erro={estado.erros?.nome}>
                  <Input id="pa-nome" name="nome" maxLength={80} defaultValue={p.nome ?? ""} autoComplete="off" />
                </Campo>
                <Campo rotulo="Espécie" htmlFor="pa-especie" obrigatorio erro={estado.erros?.especie}>
                  <Select id="pa-especie" name="especie" value={especie} onChange={(e) => setEspecie(e.target.value)}>
                    {Object.entries(ESPECIES).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                {especie === "outra" ? (
                  <Campo rotulo="Qual espécie" htmlFor="pa-especie-outra" obrigatorio erro={estado.erros?.especie_outra}>
                    <Input id="pa-especie-outra" name="especie_outra" maxLength={60} defaultValue={p.especie_outra ?? ""} />
                  </Campo>
                ) : null}
                <Campo rotulo="Raça" htmlFor="pa-raca">
                  <Input id="pa-raca" name="raca" maxLength={80} defaultValue={p.raca ?? ""} placeholder="Ex.: SRD, Labrador" />
                </Campo>
                <Campo rotulo="Sexo" htmlFor="pa-sexo">
                  <Select id="pa-sexo" name="sexo" defaultValue={p.sexo ?? "indefinido"}>
                    {Object.entries(SEXOS).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Nascimento" htmlFor="pa-nascimento" erro={estado.erros?.nascimento}>
                  <Input id="pa-nascimento" name="nascimento" type="date" defaultValue={p.nascimento ?? ""} />
                </Campo>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox name="nascimento_estimado" defaultChecked={p.nascimento_estimado ?? false} /> Idade presumida (data aproximada)
                </label>
                <Campo rotulo="Pelagem / cor" htmlFor="pa-pelagem">
                  <Input id="pa-pelagem" name="pelagem" maxLength={80} defaultValue={p.pelagem ?? ""} />
                </Campo>
                <Campo rotulo="Porte" htmlFor="pa-porte">
                  <Select id="pa-porte" name="porte" defaultValue={p.porte ?? ""}>
                    <option value="">—</option>
                    {Object.entries(PORTES).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Peso (kg)" htmlFor="pa-peso" erro={estado.erros?.peso_kg}>
                  <Input id="pa-peso" name="peso_kg" inputMode="decimal" maxLength={10} defaultValue={p.peso_kg == null ? "" : String(p.peso_kg).replace(".", ",")} />
                </Campo>
                <Campo rotulo="Microchip" htmlFor="pa-microchip" erro={estado.erros?.microchip}>
                  <Input id="pa-microchip" name="microchip" maxLength={23} defaultValue={p.microchip ?? ""} />
                </Campo>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox name="castrado" defaultChecked={p.castrado ?? false} /> Castrado(a)
                </label>
              </div>
              <Campo rotulo="Sinais particulares" htmlFor="pa-sinais">
                <Input id="pa-sinais" name="sinais_particulares" maxLength={300} defaultValue={p.sinais_particulares ?? ""} placeholder="Ex.: mancha branca no peito, orelha esquerda caída" />
              </Campo>
              <Campo rotulo="Alergias e alertas" htmlFor="pa-alergias" ajuda="Aparece em destaque no prontuário.">
                <Textarea id="pa-alergias" name="alergias" rows={2} maxLength={500} defaultValue={p.alergias ?? ""} />
              </Campo>
              <Campo rotulo="Observações" htmlFor="pa-observacoes">
                <Textarea id="pa-observacoes" name="observacoes" rows={2} maxLength={1000} defaultValue={p.observacoes ?? ""} />
              </Campo>
              {p.id ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativo" value="off" />
                  <Checkbox name="ativo" defaultChecked={p.ativo ?? true} /> Ativo (desmarque se o animal não é mais atendido; o prontuário continua guardado)
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

export function BotaoExcluirTutor({ empresaId, tutorId }: { empresaId: string; tutorId: string }) {
  const router = useRouter();
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="sm"
      acao={excluirTutor.bind(null, empresaId, tutorId)}
      aoSucesso={() => router.push(`/e/${empresaId}/veterinaria/pacientes`)}
      confirmar={{
        titulo: "Excluir o cadastro deste tutor?",
        descricao: "Só é possível quando ele não tem animais, atendimentos nem contas (esses ficam no histórico da clínica).",
        textoConfirmar: "Excluir",
        perigo: true,
      }}
    >
      <Trash2 /> Excluir
    </BotaoAcao>
  );
}

export function BotaoExcluirPaciente({ empresaId, pacienteId, tutorId }: { empresaId: string; pacienteId: string; tutorId: string }) {
  const router = useRouter();
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="sm"
      acao={excluirPaciente.bind(null, empresaId, pacienteId)}
      aoSucesso={() => router.push(`/e/${empresaId}/veterinaria/tutores/${tutorId}`)}
      confirmar={{
        titulo: "Excluir o cadastro deste animal?",
        descricao: "Só é possível quando ele não tem prontuário, vacinas, receitas, agenda nem contas (o prontuário fica guardado por pelo menos 5 anos).",
        textoConfirmar: "Excluir",
        perigo: true,
      }}
    >
      <Trash2 /> Excluir
    </BotaoAcao>
  );
}
