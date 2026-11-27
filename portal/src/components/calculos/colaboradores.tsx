"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Trash2, UserPlus } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { excluirColaborador, salvarColaborador } from "@/lib/calculos/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export interface Colaborador {
  id: string;
  nome: string;
  cargo: string | null;
  admissao: string;
  desligamento: string | null;
  contrato: "indeterminado" | "experiencia" | "determinado";
  fim_contrato: string | null;
  salario: number;
  adicionais: number;
  dependentes_ir: number;
  ferias_vencidas: number;
  saldo_fgts: number | null;
  observacao: string | null;
}

export const CONTRATOS: Record<Colaborador["contrato"], string> = {
  indeterminado: "Prazo indeterminado",
  experiencia: "Contrato de experiência",
  determinado: "Prazo determinado",
};

function FormColaborador({ empresaId, colaborador, aoSalvar }: { empresaId: string; colaborador: Colaborador | null; aoSalvar: () => void }) {
  const acao = salvarColaborador.bind(null, empresaId, colaborador?.id ?? null);
  const [contrato, setContrato] = React.useState<Colaborador["contrato"]>(colaborador?.contrato ?? "indeterminado");
  const c = colaborador;
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} className="space-y-3">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Nome" htmlFor="co-nome" erro={estado.erros?.nome} obrigatorio>
              <Input id="co-nome" name="nome" maxLength={120} defaultValue={c?.nome ?? ""} />
            </Campo>
            <Campo rotulo="Cargo" htmlFor="co-cargo" erro={estado.erros?.cargo}>
              <Input id="co-cargo" name="cargo" maxLength={80} defaultValue={c?.cargo ?? ""} />
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Admissão" htmlFor="co-adm" erro={estado.erros?.admissao} obrigatorio>
              <Input id="co-adm" name="admissao" type="date" defaultValue={c?.admissao ?? ""} />
            </Campo>
            <Campo rotulo="Tipo de contrato" htmlFor="co-contrato" erro={estado.erros?.contrato}>
              <Select id="co-contrato" name="contrato" value={contrato} onChange={(e) => setContrato(e.target.value as Colaborador["contrato"])}>
                {Object.entries(CONTRATOS).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </Select>
            </Campo>
            {contrato !== "indeterminado" ? (
              <Campo rotulo="Fim previsto do contrato" htmlFor="co-fim" erro={estado.erros?.fim_contrato} obrigatorio>
                <Input id="co-fim" name="fim_contrato" type="date" defaultValue={c?.fim_contrato ?? ""} />
              </Campo>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Salário mensal" htmlFor="co-sal" erro={estado.erros?.salario} obrigatorio>
              <CampoValor id="co-sal" name="salario" valorInicial={c?.salario ?? null} />
            </Campo>
            <Campo rotulo="Adicionais fixos por mês" htmlFor="co-adic" erro={estado.erros?.adicionais} ajuda="Insalubridade, periculosidade, médias habituais.">
              <CampoValor id="co-adic" name="adicionais" valorInicial={c?.adicionais ?? null} />
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Dependentes (IR)" htmlFor="co-dep" erro={estado.erros?.dependentes_ir}>
              <Input id="co-dep" name="dependentes_ir" type="number" min={0} max={20} defaultValue={c?.dependentes_ir ?? 0} />
            </Campo>
            <Campo rotulo="Férias vencidas não tiradas" htmlFor="co-ferias" erro={estado.erros?.ferias_vencidas} ajuda="Períodos completos (0 a 2).">
              <Select id="co-ferias" name="ferias_vencidas" defaultValue={String(c?.ferias_vencidas ?? 0)}>
                <option value="0">Nenhuma</option>
                <option value="1">1 período</option>
                <option value="2">2 períodos</option>
              </Select>
            </Campo>
            <Campo rotulo="Saldo do FGTS" htmlFor="co-fgts" erro={estado.erros?.saldo_fgts} ajuda="Do extrato; sem ele, a multa é estimada.">
              <CampoValor id="co-fgts" name="saldo_fgts" valorInicial={c?.saldo_fgts ?? null} />
            </Campo>
          </div>
          <Campo rotulo="Data de saída" htmlFor="co-saida" erro={estado.erros?.desligamento} ajuda="Preencha quando o colaborador sair; ele deixa de entrar na folha prevista.">
            <Input id="co-saida" name="desligamento" type="date" defaultValue={c?.desligamento ?? ""} className="max-w-48" />
          </Campo>
          <Campo rotulo="Observação" htmlFor="co-obs">
            <Textarea id="co-obs" name="observacao" rows={2} maxLength={500} defaultValue={c?.observacao ?? ""} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{c ? "Salvar alterações" : "Cadastrar"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function NovoColaborador({ empresaId }: { empresaId: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <UserPlus /> Novo colaborador
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Novo colaborador" descricao="Dados usados na previsão da folha e na simulação de rescisão." largura="lg">
          <FormColaborador empresaId={empresaId} colaborador={null} aoSalvar={() => setAberto(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AcoesColaborador({ empresaId, c }: { empresaId: string; c: Colaborador }) {
  const [editar, setEditar] = React.useState(false);
  const [excluir, setExcluir] = React.useState(false);
  const [pendente, iniciar] = React.useTransition();
  const router = useRouter();
  return (
    <>
      <Menu>
        <MenuGatilho asChild>
          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Ações para ${c.nome}`}>
            <MoreHorizontal />
          </Button>
        </MenuGatilho>
        <MenuConteudo>
          <MenuItem onSelect={() => setEditar(true)}>
            <Pencil /> Editar
          </MenuItem>
          <MenuItem onSelect={() => setExcluir(true)} className="text-perigo">
            <Trash2 /> Excluir
          </MenuItem>
        </MenuConteudo>
      </Menu>
      <Dialog open={editar} onOpenChange={setEditar}>
        <DialogContent titulo={`Editar ${c.nome}`} largura="lg">
          <FormColaborador empresaId={empresaId} colaborador={c} aoSalvar={() => setEditar(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={excluir} onOpenChange={setExcluir}>
        <DialogContent
          titulo={`Excluir ${c.nome}?`}
          descricao="O cadastro é apagado. Se o colaborador apenas saiu da empresa, prefira informar a data de saída."
        >
          <div className="flex justify-end gap-2">
            <Button variante="contorno" onClick={() => setExcluir(false)}>
              Cancelar
            </Button>
            <Button
              variante="perigo"
              disabled={pendente}
              onClick={() =>
                iniciar(async () => {
                  const r = await excluirColaborador(empresaId, c.id);
                  if (r.ok) {
                    toast.success(r.mensagem ?? "Colaborador excluído.");
                    setExcluir(false);
                    router.refresh();
                  } else toast.error(r.mensagem ?? "Não foi possível excluir.");
                })
              }
            >
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ListaColaboradores({ empresaId, colaboradores, editar }: { empresaId: string; colaboradores: Colaborador[]; editar: boolean }) {
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Nome</Th>
          <Th className="hidden md:table-cell">Admissão</Th>
          <Th className="text-right">Salário</Th>
          <Th className="hidden sm:table-cell">Situação</Th>
          {editar ? <Th className="w-12" /> : null}
        </Tr>
      </THead>
      <TBody>
        {colaboradores.map((c) => {
          const saiu = c.desligamento && c.desligamento <= hoje;
          return (
            <Tr key={c.id} className={saiu ? "opacity-60" : undefined}>
              <Td>
                <span className="font-medium">{c.nome}</span>
                {c.cargo ? <span className="block text-xs text-muted-foreground">{c.cargo}</span> : null}
                <span className="block text-xs text-muted-foreground md:hidden">Admissão {formatarData(c.admissao)}</span>
              </Td>
              <Td className="hidden md:table-cell">{formatarData(c.admissao)}</Td>
              <Td className="text-right numero">
                {formatarMoeda(c.salario)}
                {c.adicionais > 0 ? <span className="block text-xs text-muted-foreground">+ {formatarMoeda(c.adicionais)}</span> : null}
              </Td>
              <Td className="hidden sm:table-cell">
                {c.desligamento ? (
                  <Badge variante={saiu ? "neutro" : "alerta"}>
                    {saiu ? "Saiu em" : "Sai em"} {formatarData(c.desligamento)}
                  </Badge>
                ) : c.contrato !== "indeterminado" ? (
                  <Badge variante="info">
                    {c.contrato === "experiencia" ? "Experiência" : "Prazo determinado"} até {formatarData(c.fim_contrato)}
                  </Badge>
                ) : (
                  <Badge variante="sucesso">Ativo</Badge>
                )}
              </Td>
              {editar ? (
                <Td className="text-right">
                  <AcoesColaborador empresaId={empresaId} c={c} />
                </Td>
              ) : null}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
