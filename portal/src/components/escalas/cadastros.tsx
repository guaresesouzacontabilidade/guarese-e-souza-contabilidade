"use client";

import * as React from "react";
import { Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { criarEscala, excluirFuncionario, importarColaboradores, salvarFuncionario } from "@/lib/escalas/acoes";
import { DIAS_CURTOS, ORDEM_SEMANA } from "@/lib/escalas/tipos";

/** Valor da opção "Novo cargo" no cadastro do funcionário. */
const NOVO_CARGO = "novo";

export interface FuncionarioTela {
  id: string;
  nome: string;
  cargo: string | null;
  setor: string | null;
  jornada_semanal: number;
  nao_trabalha: number[];
  domingo_quinzenal: boolean;
  menor_idade: boolean;
  preferencias: string | null;
  ativo: boolean;
  cargo_id?: string | null;
  usuario_id?: string | null;
}

/**
 * Cadastrar ou alterar um funcionário. Na Gestão de RH, o cargo vem da lista de
 * cargos e dá para ligar o cadastro a um acesso do portal (a pessoa vê as
 * próprias tarefas).
 */
export function DialogoFuncionario({
  empresaId,
  funcionario,
  cargos,
  acessos,
}: {
  empresaId: string;
  funcionario?: FuncionarioTela;
  cargos?: { id: string; nome: string }[];
  acessos?: { id: string; nome: string; email: string }[];
}) {
  const [aberto, setAberto] = React.useState(false);
  const f = funcionario;
  // "Novo cargo": digita o nome ali mesmo (o cargo entra na lista de cargos ao salvar)
  const [cargoNovo, setCargoNovo] = React.useState(false);
  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setCargoNovo(false);
      }}
    >
      <DialogTrigger asChild>
        {f ? (
          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar ${f.nome}`}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Cadastrar funcionário
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        titulo={f ? `Editar ${f.nome}` : "Cadastrar funcionário"}
        descricao="Só o que a escala precisa: nome, jornada e restrições. Salário e documentos ficam fora daqui."
        largura="lg"
      >
        <FormularioAcao acao={salvarFuncionario.bind(null, empresaId, f?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome" htmlFor="nome" obrigatorio erro={estado.erros?.nome}>
                  <Input id="nome" name="nome" defaultValue={f?.nome} maxLength={120} required />
                </Campo>
                {cargos ? (
                  <Campo rotulo="Cargo" htmlFor="cargo_id" erro={estado.erros?.cargo_novo}>
                    <Select id="cargo_id" name="cargo_id" defaultValue={f?.cargo_id ?? ""} onChange={(e) => setCargoNovo(e.target.value === NOVO_CARGO)}>
                      <option value="">{f?.cargo && !f.cargo_id ? `${f.cargo} (sem cargo cadastrado)` : "Sem cargo"}</option>
                      {cargos.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                      <option value={NOVO_CARGO}>Novo cargo (digitar o nome)</option>
                    </Select>
                    {f?.cargo && !f.cargo_id ? <input type="hidden" name="cargo" value={f.cargo} /> : null}
                    {cargoNovo ? (
                      <Input
                        name="cargo_novo"
                        aria-label="Nome do novo cargo"
                        placeholder="Ex.: Atendente"
                        maxLength={80}
                        className="mt-2"
                        autoFocus
                        required
                      />
                    ) : null}
                  </Campo>
                ) : (
                  <Campo rotulo="Cargo" htmlFor="cargo">
                    <Input id="cargo" name="cargo" defaultValue={f?.cargo ?? ""} maxLength={80} placeholder="Ex.: Atendente" />
                  </Campo>
                )}
                {acessos ? (
                  <Campo rotulo="Acesso ao portal" htmlFor="usuario_id" ajuda="Com o acesso ligado, a pessoa vê e conclui as tarefas atribuídas a ela.">
                    <Select id="usuario_id" name="usuario_id" defaultValue={f?.usuario_id ?? ""}>
                      <option value="">Sem acesso ao portal</option>
                      {acessos.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nome}
                          {a.email && a.email !== a.nome ? ` (${a.email})` : ""}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                ) : null}
                <Campo rotulo="Setor" htmlFor="setor" ajuda="Opcional (ex.: balcão, cozinha).">
                  <Input id="setor" name="setor" defaultValue={f?.setor ?? ""} maxLength={60} />
                </Campo>
                <Campo rotulo="Jornada do contrato (horas por semana)" htmlFor="jornada_semanal" erro={estado.erros?.jornada_semanal} ajuda="44 é o máximo da lei; jornada parcial vai até 30.">
                  <Input id="jornada_semanal" name="jornada_semanal" inputMode="decimal" defaultValue={String(f?.jornada_semanal ?? 44).replace(".", ",")} />
                </Campo>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Dias em que não trabalha</legend>
                <div className="flex flex-wrap gap-2">
                  {ORDEM_SEMANA.map((d) => (
                    <label key={d} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary">
                      <Checkbox name="nao_trabalha" value={d} defaultChecked={f?.nao_trabalha.includes(d)} />
                      {DIAS_CURTOS[d]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Ex.: quem estuda no sábado. O gerador dá folga nesses dias.</p>
              </fieldset>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="domingo_quinzenal" defaultChecked={f?.domingo_quinzenal} className="mt-0.5" />
                  <span>
                    Domingo de folga a cada 15 dias
                    <span className="block text-xs text-muted-foreground">Regra das empregadas mulheres quando há trabalho aos domingos (art. 386 da CLT).</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="menor_idade" defaultChecked={f?.menor_idade} className="mt-0.5" />
                  <span>
                    Menor de 18 anos
                    <span className="block text-xs text-muted-foreground">Não pode trabalhar entre 22h e 5h nem fazer hora extra.</span>
                  </span>
                </label>
              </div>
              <Campo
                rotulo="Preferências para a escala"
                htmlFor="preferencias"
                ajuda="Vão para o assistente de IA sem o nome. Não escreva CPF, telefone, salário ou dados de saúde."
              >
                <Textarea id="preferencias" name="preferencias" defaultValue={f?.preferencias ?? ""} maxLength={200} rows={2} placeholder="Ex.: prefere o turno da manhã; folga de preferência na segunda." />
              </Campo>
              {f ? (
                <Campo rotulo="Situação" htmlFor="ativo">
                  <Select id="ativo" name="ativo" defaultValue={f.ativo ? "on" : "off"}>
                    <option value="on">Ativo (entra nas novas escalas)</option>
                    <option value="off">Inativo (não entra nas novas escalas)</option>
                  </Select>
                </Campo>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>{f ? "Salvar" : "Cadastrar"}</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function ExcluirFuncionario({ empresaId, id, nome }: { empresaId: string; id: string; nome: string }) {
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="iconeSm"
      aria-label={`Remover ${nome}`}
      acao={() => excluirFuncionario(empresaId, id)}
      confirmar={{ titulo: `Remover ${nome}?`, descricao: "As escalas já montadas continuam com o nome. Para só tirar das próximas escalas, marque como inativo.", textoConfirmar: "Remover", perigo: true }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}

export function ImportarColaboradores({ empresaId }: { empresaId: string }) {
  return (
    <BotaoAcao variante="contorno" acao={() => importarColaboradores(empresaId)}>
      <UserPlus /> Trazer do cadastro de colaboradores
    </BotaoAcao>
  );
}

/** Criar a escala de um mês. */
export function NovaEscala({ empresaId, mesSugerido, escalas }: { empresaId: string; mesSugerido: string; escalas: { id: string; nome: string; competencia: string }[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Nova escala
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Nova escala" descricao="O portal monta a escala do mês com os funcionários ativos e você ajusta o que quiser.">
        <FormularioAcao acao={criarEscala.bind(null, empresaId)} atualizarAoSucesso={false} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Nome" htmlFor="nome-escala" ajuda="Ex.: Loja, Cozinha, Plantão.">
                <Input id="nome-escala" name="nome" defaultValue="Escala da equipe" maxLength={80} />
              </Campo>
              <Campo rotulo="Mês" htmlFor="mes" obrigatorio erro={estado.erros?.mes}>
                <Input id="mes" name="mes" type="month" defaultValue={mesSugerido} required />
              </Campo>
              {escalas.length ? (
                <Campo rotulo="Aproveitar turnos e modelos de" htmlFor="copiar_de" ajuda="Por padrão, a escala mais recente.">
                  <Select id="copiar_de" name="copiar_de" defaultValue="">
                    <option value="">A escala mais recente</option>
                    {escalas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome} — {e.competencia.slice(5, 7)}/{e.competencia.slice(0, 4)}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} textoPendente="Montando...">
                  Montar a escala
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
