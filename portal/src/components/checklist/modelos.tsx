"use client";

import { useState } from "react";
import { ListChecks, Pencil, Plus, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { TIPOS_CONTA } from "@/lib/rotulos";
import { nomeMes } from "@/lib/formatos";
import { aplicarChecklistPadrao, salvarModelo } from "@/lib/checklist/acoes";

export interface ModeloChecklist {
  id: string;
  categoria_codigo: string;
  titulo: string;
  descricao: string | null;
  obrigatorio: boolean;
  quantidade_minima: number;
  por_conta: boolean;
  tipos_conta: string[] | null;
  dia_prazo: number;
  meses_apos: number;
  periodicidade: string;
  meses: number[] | null;
  responsavel_cliente_id: string | null;
  responsavel_equipe_id: string | null;
  ativo: boolean;
}

export interface Opcao {
  id: string;
  nome: string;
}

function descreverPrazo(m: Pick<ModeloChecklist, "dia_prazo" | "meses_apos">) {
  const quando = m.meses_apos === 0 ? "do próprio mês" : m.meses_apos === 1 ? "do mês seguinte" : `de ${m.meses_apos} meses depois`;
  return `Dia ${m.dia_prazo} ${quando}`;
}

export function ModelosChecklist({
  empresaId,
  modelos,
  categorias,
  clientes,
  equipe,
  podeGerenciar,
}: {
  empresaId: string;
  modelos: ModeloChecklist[];
  categorias: { codigo: string; nome: string; escritorio: boolean }[];
  clientes: Opcao[];
  equipe: Opcao[];
  podeGerenciar: boolean;
}) {
  const [editando, setEditando] = useState<ModeloChecklist | "novo" | null>(null);
  const nomeCategoria = new Map(categorias.map((c) => [c.codigo, c.nome]));
  return (
    <div className="space-y-3">
      {podeGerenciar ? (
        <div className="flex flex-wrap justify-end gap-2">
          <BotaoAcao variante="contorno" acao={() => aplicarChecklistPadrao(empresaId)}>
            <Wand2 /> Aplicar itens padrão
          </BotaoAcao>
          <Button onClick={() => setEditando("novo")}>
            <Plus /> Novo item
          </Button>
        </div>
      ) : null}
      {modelos.length === 0 ? (
        <EstadoVazio
          icone={ListChecks}
          titulo="Checklist não configurado"
          descricao="Aplique os itens padrão (conforme regime e serviços) ou cadastre os documentos exigidos mensalmente."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Documento exigido</Th>
              <Th className="hidden md:table-cell">Prazo</Th>
              <Th className="hidden lg:table-cell">Periodicidade</Th>
              <Th>Regra</Th>
              {podeGerenciar ? <Th className="w-10" /> : null}
            </tr>
          </THead>
          <TBody>
            {modelos.map((m) => (
              <Tr key={m.id} className={m.ativo ? "" : "opacity-60"}>
                <Td>
                  <p className="font-medium">{m.titulo}</p>
                  <p className="text-xs text-muted-foreground">{nomeCategoria.get(m.categoria_codigo)}</p>
                </Td>
                <Td className="hidden text-sm md:table-cell">{descreverPrazo(m)}</Td>
                <Td className="hidden text-sm lg:table-cell">
                  {m.periodicidade === "mensal" ? "Mensal" : `${m.periodicidade === "anual" ? "Anual" : "Trimestral"}: ${(m.meses ?? []).map((x) => nomeMes(x, true)).join(", ")}`}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {m.obrigatorio ? <Badge variante="primario">Obrigatório</Badge> : <Badge>Opcional</Badge>}
                    {m.por_conta ? <Badge variante="info">Por conta</Badge> : null}
                    {m.quantidade_minima > 1 ? <Badge variante="contorno">Mín. {m.quantidade_minima} arquivos</Badge> : null}
                    {!m.ativo ? <Badge>Inativo</Badge> : null}
                  </div>
                </Td>
                {podeGerenciar ? (
                  <Td>
                    <Button variante="fantasma" tamanho="iconeSm" aria-label={`Editar ${m.titulo}`} onClick={() => setEditando(m)}>
                      <Pencil />
                    </Button>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">
        Alterações no modelo valem para as competências geradas a partir de agora. Itens de meses já gerados podem ser ajustados na página de pendências.
      </p>
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        {editando !== null ? (
          <DialogContent largura="lg" titulo={editando === "novo" ? "Novo item do checklist" : "Editar item do checklist"}>
            <FormularioModelo
              empresaId={empresaId}
              modelo={editando === "novo" ? null : editando}
              categorias={categorias.filter((c) => !c.escritorio)}
              clientes={clientes}
              equipe={equipe}
              aoSalvar={() => setEditando(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function FormularioModelo({
  empresaId,
  modelo,
  categorias,
  clientes,
  equipe,
  aoSalvar,
}: {
  empresaId: string;
  modelo: ModeloChecklist | null;
  categorias: { codigo: string; nome: string }[];
  clientes: Opcao[];
  equipe: Opcao[];
  aoSalvar: () => void;
}) {
  const [periodicidade, setPeriodicidade] = useState(modelo?.periodicidade ?? "mensal");
  const [porConta, setPorConta] = useState(modelo?.por_conta ?? false);
  const acao = salvarModelo.bind(null, empresaId);
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          {modelo ? <input type="hidden" name="id" value={modelo.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Título exibido ao cliente" htmlFor="m-titulo" obrigatorio erro={estado.erros?.titulo} className="sm:col-span-2">
              <Input id="m-titulo" name="titulo" defaultValue={modelo?.titulo ?? ""} />
            </Campo>
            <Campo rotulo="Categoria do documento" htmlFor="m-cat" erro={estado.erros?.categoria_codigo}>
              <Select id="m-cat" name="categoria_codigo" defaultValue={modelo?.categoria_codigo ?? ""}>
                <option value="" disabled>
                  Selecione
                </option>
                {categorias.map((c) => (
                  <option key={c.codigo} value={c.codigo}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Quantidade mínima de arquivos conferidos" htmlFor="m-qtd">
              <Input id="m-qtd" name="quantidade_minima" type="number" min={1} max={100} defaultValue={modelo?.quantidade_minima ?? 1} />
            </Campo>
            <Campo rotulo="Instruções ao cliente" htmlFor="m-desc" className="sm:col-span-2">
              <Textarea id="m-desc" name="descricao" defaultValue={modelo?.descricao ?? ""} rows={2} />
            </Campo>
            <Campo rotulo="Dia do prazo" htmlFor="m-dia" erro={estado.erros?.dia_prazo}>
              <Input id="m-dia" name="dia_prazo" type="number" min={1} max={31} defaultValue={modelo?.dia_prazo ?? 10} />
            </Campo>
            <Campo rotulo="Mês do prazo" htmlFor="m-meses-apos">
              <Select id="m-meses-apos" name="meses_apos" defaultValue={String(modelo?.meses_apos ?? 1)}>
                <option value="0">No próprio mês da competência</option>
                <option value="1">No mês seguinte</option>
                <option value="2">Dois meses depois</option>
                <option value="3">Três meses depois</option>
              </Select>
            </Campo>
            <Campo rotulo="Periodicidade" htmlFor="m-per">
              <Select id="m-per" name="periodicidade" value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
                <option value="mensal">Mensal</option>
                <option value="trimestral">Trimestral</option>
                <option value="anual">Anual</option>
              </Select>
            </Campo>
            {periodicidade !== "mensal" ? (
              <fieldset className="sm:col-span-2">
                <legend className="mb-1 text-sm font-medium">Meses em que é exigido</legend>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <label key={m} className="flex items-center gap-1 text-xs">
                      <Checkbox name="meses" value={m} defaultChecked={modelo?.meses?.includes(m) ?? false} />
                      {nomeMes(m, true)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <Campo rotulo="Responsável no cliente" htmlFor="m-resp-cli">
              <Select id="m-resp-cli" name="responsavel_cliente_id" defaultValue={modelo?.responsavel_cliente_id ?? ""}>
                <option value="">Todos os usuários da empresa</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Responsável no escritório" htmlFor="m-resp-eq">
              <Select id="m-resp-eq" name="responsavel_equipe_id" defaultValue={modelo?.responsavel_equipe_id ?? ""}>
                <option value="">Não definido</option>
                {equipe.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </Campo>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="obrigatorio" defaultChecked={modelo?.obrigatorio ?? true} /> Obrigatório (entra no percentual de conclusão)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="por_conta" checked={porConta} onChange={(e) => setPorConta(e.target.checked)} /> Gerar um item para cada conta financeira
            </label>
            {porConta ? (
              <div className="ml-6 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(TIPOS_CONTA).map(([v, r]) => (
                  <label key={v} className="flex items-center gap-1 text-xs">
                    <Checkbox name="tipos_conta" value={v} defaultChecked={modelo?.tipos_conta?.includes(v) ?? false} />
                    {r}
                  </label>
                ))}
              </div>
            ) : null}
            {modelo ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="hidden" name="ativo" value="false" />
                <Checkbox name="ativo" value="true" defaultChecked={modelo.ativo} /> Item ativo
              </label>
            ) : null}
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
