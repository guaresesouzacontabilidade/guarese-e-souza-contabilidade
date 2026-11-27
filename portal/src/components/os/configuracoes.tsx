"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EstadoVazio } from "@/components/ui/feedback";
import { Campo, Checkbox, Input, Textarea } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { ativarPessoaOs, ativarServicoOs, configurarOs, salvarPessoaOs, salvarServicoOs } from "@/lib/os/acoes";
import { DIAS_SEMANA, formatarMinutos } from "@/lib/os/rotulos";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarTelefone } from "@/lib/formatos";
import type { PessoaOs, ServicoOs } from "./form-os";

const decimalBr = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)).replace(".", ","));
const CORES = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#4b5563"];

/** Exemplos para começar (madeireira e marcenaria). */
const EXEMPLOS = [
  { nome: "Corte de chapa (MDF/compensado)", unidade: "chapa", por: "4", fixo: "5", setor: "Seccionadora" },
  { nome: "Fita de borda", unidade: "m", por: "1", fixo: "5", setor: "Coladeira de borda" },
  { nome: "Furação", unidade: "furo", por: "0,5", fixo: "5", setor: "Furadeira" },
];

function FormServico({ empresaId, s, aoSalvar }: { empresaId: string; s?: ServicoOs; aoSalvar: () => void }) {
  const [exemplo, setExemplo] = React.useState<(typeof EXEMPLOS)[number] | null>(null);
  const v = exemplo ?? (s ? { nome: s.nome, unidade: s.unidade, por: decimalBr(s.minutos_por_unidade), fixo: decimalBr(s.minutos_fixos), setor: s.setor ?? "" } : null);
  return (
    <FormularioAcao acao={salvarServicoOs.bind(null, empresaId, s?.id ?? null)} aoSucesso={aoSalvar} manterAoErrar className="space-y-3" key={exemplo?.nome ?? "f"}>
      {({ estado, pendente }) => (
        <>
          {!s ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">Exemplos:</span>
              {EXEMPLOS.map((e) => (
                <Button key={e.nome} type="button" tamanho="sm" variante="contorno" onClick={() => setExemplo(e)}>
                  {e.nome.split(" (")[0]}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Nome do serviço" htmlFor="serv-nome" obrigatorio erro={estado.erros?.nome} className="sm:col-span-2">
              <Input id="serv-nome" name="nome" defaultValue={v?.nome ?? ""} />
            </Campo>
            <Campo rotulo="Unidade" htmlFor="serv-unidade" ajuda="Ex.: chapa, m, peça, furo, hora.">
              <Input id="serv-unidade" name="unidade" defaultValue={v?.unidade ?? "un"} maxLength={12} />
            </Campo>
            <Campo rotulo="Setor ou máquina" htmlFor="serv-setor">
              <Input id="serv-setor" name="setor" defaultValue={v?.setor ?? ""} maxLength={60} />
            </Campo>
            <Campo rotulo="Minutos por unidade" htmlFor="serv-por" ajuda="Quanto tempo leva cada unidade.">
              <Input id="serv-por" name="minutos_por_unidade" inputMode="decimal" defaultValue={v?.por ?? ""} />
            </Campo>
            <Campo rotulo="Minutos fixos (preparação)" htmlFor="serv-fixo" ajuda="Tempo de preparar a máquina, uma vez por OS.">
              <Input id="serv-fixo" name="minutos_fixos" inputMode="decimal" defaultValue={v?.fixo ?? "0"} />
            </Campo>
            <Campo rotulo="Valor por unidade (R$)" htmlFor="serv-valor">
              <Input id="serv-valor" name="valor_unitario" inputMode="decimal" defaultValue={s ? decimalBr(s.valor_unitario) : ""} placeholder="0,00" />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{s ? "Salvar serviço" : "Cadastrar serviço"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function ServicosOs({ empresaId, servicos }: { empresaId: string; servicos: ServicoOs[] }) {
  const [aberto, setAberto] = React.useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Dialog open={aberto === "novo"} onOpenChange={(v) => setAberto(v ? "novo" : null)}>
        <DialogTrigger asChild>
          <Button>
            <Plus /> Novo serviço
          </Button>
        </DialogTrigger>
        <DialogContent titulo="Novo serviço" descricao="O tempo estimado da OS é o tempo fixo + o tempo por unidade × a quantidade." largura="lg">
          <FormServico empresaId={empresaId} aoSalvar={() => setAberto(null)} />
        </DialogContent>
      </Dialog>
      {!servicos.length ? (
        <EstadoVazio titulo="Nenhum serviço cadastrado" descricao="Cadastre os serviços que a loja faz, com o tempo de cada um." />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Serviço</Th>
              <Th>Tempo estimado</Th>
              <Th className="text-right">Valor</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {servicos.map((s) => (
              <Tr key={s.id} className={s.ativo ? undefined : "opacity-60"}>
                <Td>
                  <p className="font-medium">{s.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.setor ?? "—"}
                    {!s.ativo ? " · desativado" : ""}
                  </p>
                </Td>
                <Td className="text-sm">
                  {Number(s.minutos_por_unidade) ? `${decimalBr(s.minutos_por_unidade)} min por ${s.unidade}` : ""}
                  {Number(s.minutos_fixos) ? `${Number(s.minutos_por_unidade) ? " + " : ""}${formatarMinutos(s.minutos_fixos)} fixos` : ""}
                </Td>
                <Td className="text-right text-sm">
                  {formatarMoeda(s.valor_unitario)}/{s.unidade}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Dialog open={aberto === s.id} onOpenChange={(v) => setAberto(v ? s.id : null)}>
                      <DialogTrigger asChild>
                        <Button tamanho="iconeSm" variante="fantasma" aria-label={`Editar ${s.nome}`}>
                          <Pencil />
                        </Button>
                      </DialogTrigger>
                      <DialogContent titulo={`Editar: ${s.nome}`} largura="lg">
                        <FormServico empresaId={empresaId} s={s} aoSalvar={() => setAberto(null)} />
                      </DialogContent>
                    </Dialog>
                    <BotaoAcao tamanho="sm" variante="fantasma" acao={() => ativarServicoOs(empresaId, s.id, !s.ativo)}>
                      {s.ativo ? "Desativar" : "Reativar"}
                    </BotaoAcao>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function EquipeOs({ empresaId, equipe }: { empresaId: string; equipe: PessoaOs[] }) {
  const [cor, setCor] = React.useState(CORES[equipe.length % CORES.length]);
  return (
    <div className="space-y-3">
      <FormularioAcao acao={salvarPessoaOs.bind(null, empresaId, null)} resetarAoSucesso className="flex flex-wrap items-end gap-2">
        {({ estado, pendente }) => (
          <>
            <Campo rotulo="Nome" htmlFor="equipe-nome" erro={estado.erros?.nome} className="min-w-0 flex-1">
              <Input id="equipe-nome" name="nome" placeholder="Ex.: João (seccionadora)" maxLength={80} />
            </Campo>
            <input type="hidden" name="cor" value={cor} />
            <div className="flex gap-1 pb-2" role="radiogroup" aria-label="Cor na esteira">
              {CORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cor === c}
                  aria-label={`Cor ${c}`}
                  onClick={() => setCor(c)}
                  className={`size-6 rounded-full border-2 ${cor === c ? "border-foreground" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>
            <BotaoEnviar pendente={pendente}>
              <Plus /> Incluir
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
      {equipe.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {equipe.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={`flex items-center gap-2 ${p.ativo ? "" : "opacity-60"}`}>
                <span className="size-3 rounded-full" style={{ background: p.cor }} aria-hidden /> {p.nome}
                {!p.ativo ? <Badge>desativado</Badge> : null}
              </span>
              <BotaoAcao tamanho="sm" variante="fantasma" acao={() => ativarPessoaOs(empresaId, p.id, !p.ativo)}>
                {p.ativo ? "Desativar" : "Reativar"}
              </BotaoAcao>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Inclua quem faz os serviços. Não precisa ter acesso ao portal.</p>
      )}
    </div>
  );
}

export interface ConfigOs {
  nome_exibicao: string | null;
  telefone: string | null;
  hora_inicio: string;
  hora_fim: string;
  dias_semana: number[];
  executores_simultaneos: number;
  mensagem_pronta: string | null;
  rodape_impressao: string | null;
}

export function FormConfigOs({ empresaId, cfg, nomePadrao }: { empresaId: string; cfg: ConfigOs | null; nomePadrao: string }) {
  const dias = cfg?.dias_semana ?? [1, 2, 3, 4, 5, 6];
  return (
    <FormularioAcao acao={configurarOs.bind(null, empresaId)} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Horário de trabalho: início" htmlFor="cfg-inicio">
              <Input id="cfg-inicio" name="hora_inicio" type="time" defaultValue={(cfg?.hora_inicio ?? "08:00").slice(0, 5)} />
            </Campo>
            <Campo rotulo="Fim" htmlFor="cfg-fim">
              <Input id="cfg-fim" name="hora_fim" type="time" defaultValue={(cfg?.hora_fim ?? "18:00").slice(0, 5)} />
            </Campo>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Dias de trabalho</legend>
              <div className="flex flex-wrap gap-3">
                {DIAS_SEMANA.map((d) => (
                  <label key={d.valor} className="flex items-center gap-1.5 text-sm">
                    <Checkbox name="dias_semana" value={d.valor} defaultChecked={dias.includes(d.valor)} /> {d.rotulo}
                  </label>
                ))}
              </div>
              {estado.erros?.dias_semana ? <p className="mt-1 text-xs text-perigo">{estado.erros.dias_semana[0]}</p> : null}
            </fieldset>
            <Campo
              rotulo="Quantas OS a equipe faz ao mesmo tempo"
              htmlFor="cfg-executores"
              ajuda="Usado na previsão de entrega: com 2, a fila anda duas vezes mais rápido."
              className="sm:col-span-2"
            >
              <Input id="cfg-executores" name="executores_simultaneos" type="number" min={1} max={50} defaultValue={cfg?.executores_simultaneos ?? 1} className="w-28" />
            </Campo>
            <Campo rotulo="Nome na OS impressa e no acompanhamento" htmlFor="cfg-nome">
              <Input id="cfg-nome" name="nome_exibicao" defaultValue={cfg?.nome_exibicao ?? ""} placeholder={nomePadrao} maxLength={120} />
            </Campo>
            <Campo rotulo="Telefone da loja" htmlFor="cfg-telefone">
              <Input id="cfg-telefone" name="telefone" inputMode="tel" defaultValue={cfg?.telefone ? formatarTelefone(cfg.telefone) : ""} />
            </Campo>
            <Campo
              rotulo="Mensagem do WhatsApp (OS pronta)"
              htmlFor="cfg-mensagem"
              ajuda="Use {cliente}, {numero}, {link} e {loja}. A mensagem abre no WhatsApp da loja; nada é enviado sozinho."
              className="sm:col-span-2"
            >
              <Textarea id="cfg-mensagem" name="mensagem_pronta" rows={3} maxLength={600} defaultValue={cfg?.mensagem_pronta ?? ""} />
            </Campo>
            <Campo rotulo="Texto no rodapé da OS impressa" htmlFor="cfg-rodape" ajuda="Ex.: prazo de retirada, garantia." className="sm:col-span-2">
              <Textarea id="cfg-rodape" name="rodape_impressao" rows={2} maxLength={1000} defaultValue={cfg?.rodape_impressao ?? ""} />
            </Campo>
          </div>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar configuração</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
