"use client";

import * as React from "react";
import { BedDouble, CalendarPlus, DoorOpen, ListPlus, Pencil, Sparkles, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { CampoValor } from "@/components/ui/campo-valor";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import {
  cadastrarQuartosEmLote,
  colocarEmManutencao,
  excluirTarifa,
  mudarLimpeza,
  salvarCategoria,
  salvarConfiguracaoHotel,
  salvarQuarto,
  salvarTarifa,
} from "@/lib/hotel/acoes";
import type { Limpeza } from "@/lib/hotel/rotulos";

export interface CategoriaForm {
  id: string;
  nome: string;
  descricao: string | null;
  capacidade: number;
  pessoas_incluidas: number;
  diaria: number;
  adicional_pessoa: number;
  ativa: boolean;
}

export interface QuartoForm {
  id: string;
  numero: string;
  andar: string | null;
  camas: string | null;
  observacao: string | null;
  ativo: boolean;
  categoria_id: string;
}

/** Nova categoria ou edição (diária de tabela, capacidade e adicional por pessoa). */
export function DialogoCategoria({ empresaId, categoria }: { empresaId: string; categoria?: CategoriaForm }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {categoria ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Editar a categoria ${categoria.nome}`}>
            <Pencil />
          </Button>
        ) : (
          <Button variante="contorno">
            <BedDouble /> Nova categoria
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={categoria ? `Categoria ${categoria.nome}` : "Nova categoria de quarto"} descricao="A diária de tabela vale para todas as noites, menos as que tiverem tarifa de período.">
        <FormularioAcao acao={salvarCategoria.bind(null, empresaId, categoria?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Nome" htmlFor="cat-nome" obrigatorio erro={estado.erros?.nome}>
                <Input id="cat-nome" name="nome" maxLength={60} defaultValue={categoria?.nome} placeholder="Standard casal, Luxo, Suíte família" />
              </Campo>
              <Campo rotulo="Descrição" htmlFor="cat-desc">
                <Input id="cat-desc" name="descricao" maxLength={500} defaultValue={categoria?.descricao ?? ""} placeholder="Cama de casal, ar-condicionado, frigobar, TV" />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Diária de tabela" htmlFor="cat-diaria" obrigatorio erro={estado.erros?.diaria}>
                  <CampoValor id="cat-diaria" name="diaria" valorInicial={categoria?.diaria} />
                </Campo>
                <Campo rotulo="Adicional por pessoa a mais" htmlFor="cat-adic" ajuda="Por noite, acima das pessoas incluídas.">
                  <CampoValor id="cat-adic" name="adicional_pessoa" valorInicial={categoria?.adicional_pessoa} />
                </Campo>
                <Campo rotulo="Capacidade (pessoas)" htmlFor="cat-cap" erro={estado.erros?.capacidade}>
                  <Input id="cat-cap" name="capacidade" type="number" min={1} max={20} defaultValue={categoria?.capacidade ?? 2} />
                </Campo>
                <Campo rotulo="Pessoas incluídas na diária" htmlFor="cat-inc" erro={estado.erros?.pessoas_incluidas}>
                  <Input id="cat-inc" name="pessoas_incluidas" type="number" min={1} max={20} defaultValue={categoria?.pessoas_incluidas ?? 2} />
                </Campo>
              </div>
              {categoria ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativa_presente" value="1" />
                  <Checkbox name="ativa" defaultChecked={categoria.ativa} /> Categoria em uso
                </label>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar categoria</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Novo quarto ou edição. */
export function DialogoQuarto({ empresaId, categorias, quarto }: { empresaId: string; categorias: { id: string; nome: string }[]; quarto?: QuartoForm }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        {quarto ? (
          <Button variante="fantasma" tamanho="sm" aria-label={`Editar o quarto ${quarto.numero}`}>
            <Pencil />
          </Button>
        ) : (
          <Button disabled={!categorias.length}>
            <DoorOpen /> Novo quarto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent titulo={quarto ? `Quarto ${quarto.numero}` : "Novo quarto"} descricao="A categoria define a diária de tabela e quantas pessoas o quarto comporta.">
        <FormularioAcao acao={salvarQuarto.bind(null, empresaId, quarto?.id ?? null)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Número" htmlFor="q-num" obrigatorio erro={estado.erros?.numero}>
                  <Input id="q-num" name="numero" maxLength={10} defaultValue={quarto?.numero} placeholder="101" />
                </Campo>
                <Campo rotulo="Categoria" htmlFor="q-cat" obrigatorio erro={estado.erros?.categoria_id}>
                  <Select id="q-cat" name="categoria_id" defaultValue={quarto?.categoria_id ?? (categorias.length === 1 ? categorias[0].id : "")}>
                    <option value="">Escolha...</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Andar" htmlFor="q-andar">
                  <Input id="q-andar" name="andar" maxLength={20} defaultValue={quarto?.andar ?? ""} placeholder="Térreo, 1º andar" />
                </Campo>
                <Campo rotulo="Camas" htmlFor="q-camas">
                  <Input id="q-camas" name="camas" maxLength={120} defaultValue={quarto?.camas ?? ""} placeholder="1 casal + 1 solteiro" />
                </Campo>
              </div>
              <Campo rotulo="Observação" htmlFor="q-obs">
                <Input id="q-obs" name="observacao" maxLength={500} defaultValue={quarto?.observacao ?? ""} placeholder="Vista para o rio, acessível, perto do elevador" />
              </Campo>
              {quarto ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="ativo_presente" value="1" />
                  <Checkbox name="ativo" defaultChecked={quarto.ativo} /> Quarto em uso (desmarque para tirar da venda)
                </label>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar quarto</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Números da faixa (com os zeros à esquerda do primeiro), sem os que o hotel não tem. */
function numerosDaFaixa(inicio: string, fim: string, pular: string): string[] {
  if (!/^\d{1,5}$/.test(inicio) || !/^\d{1,5}$/.test(fim)) return [];
  const [a, b] = [Number(inicio), Number(fim)];
  if (b < a || b - a + 1 > 200) return [];
  const largura = inicio.length > 1 && inicio.startsWith("0") ? inicio.length : 0;
  const fora = new Set((pular.match(/\d{1,5}/g) ?? []).map(Number));
  const lista: string[] = [];
  for (let n = a; n <= b; n++) if (!fora.has(n)) lista.push(largura ? String(n).padStart(largura, "0") : String(n));
  return lista;
}

function resumirNumeros(lista: string[]) {
  return lista.length > 12 ? `${lista.slice(0, 6).join(", ")} … ${lista.slice(-3).join(", ")}` : lista.join(", ");
}

/** Vários quartos de uma vez: do 101 ao 120, da mesma categoria. */
export function DialogoQuartosLote({ empresaId, categorias, existentes }: { empresaId: string; categorias: { id: string; nome: string }[]; existentes: string[] }) {
  const [aberto, setAberto] = React.useState(false);
  const [faixa, setFaixa] = React.useState({ inicio: "", fim: "", pular: "" });
  const numeros = numerosDaFaixa(faixa.inicio, faixa.fim, faixa.pular);
  const jaTem = new Set(existentes.map((n) => n.toUpperCase()));
  const novos = numeros.filter((n) => !jaTem.has(n));
  const repetidos = numeros.filter((n) => jaTem.has(n));
  const mudar = (campo: keyof typeof faixa) => (e: React.ChangeEvent<HTMLInputElement>) => setFaixa((f) => ({ ...f, [campo]: e.target.value }));
  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setFaixa({ inicio: "", fim: "", pular: "" });
      }}
    >
      <DialogTrigger asChild>
        <Button variante="contorno" disabled={!categorias.length}>
          <ListPlus /> Cadastrar vários quartos
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Cadastrar vários quartos" descricao="Informe o primeiro e o último número. Todos ficam na mesma categoria; depois dá para ajustar cada quarto no lápis.">
        <FormularioAcao
          acao={cadastrarQuartosEmLote.bind(null, empresaId)}
          aoSucesso={() => {
            setAberto(false);
            setFaixa({ inicio: "", fim: "", pular: "" });
          }}
          className="space-y-4"
        >
          {({ estado, pendente }) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Do número" htmlFor="ql-inicio" obrigatorio erro={estado.erros?.inicio}>
                  <Input id="ql-inicio" name="inicio" inputMode="numeric" maxLength={5} placeholder="101" value={faixa.inicio} onChange={mudar("inicio")} />
                </Campo>
                <Campo rotulo="Até o número" htmlFor="ql-fim" obrigatorio erro={estado.erros?.fim}>
                  <Input id="ql-fim" name="fim" inputMode="numeric" maxLength={5} placeholder="120" value={faixa.fim} onChange={mudar("fim")} />
                </Campo>
                <Campo rotulo="Categoria" htmlFor="ql-cat" obrigatorio erro={estado.erros?.categoria_id}>
                  <Select id="ql-cat" name="categoria_id" defaultValue={categorias.length === 1 ? categorias[0].id : ""}>
                    <option value="">Escolha...</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Andar" htmlFor="ql-andar">
                  <Input id="ql-andar" name="andar" maxLength={20} placeholder="1º andar" />
                </Campo>
              </div>
              <Campo rotulo="Camas" htmlFor="ql-camas">
                <Input id="ql-camas" name="camas" maxLength={120} placeholder="1 casal + 1 solteiro" />
              </Campo>
              <Campo rotulo="Números que não existem no hotel" htmlFor="ql-pular" ajuda="Opcional. Separe por vírgula. Ex.: 113, 213.">
                <Input id="ql-pular" name="pular" maxLength={500} placeholder="113" value={faixa.pular} onChange={mudar("pular")} />
              </Campo>
              {numeros.length ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-live="polite">
                  {novos.length ? (
                    <p>
                      Vai cadastrar <strong>{novos.length}</strong> {novos.length === 1 ? "quarto" : "quartos"}: {resumirNumeros(novos)}
                    </p>
                  ) : (
                    <p>Todos esses quartos já existem.</p>
                  )}
                  {repetidos.length ? <p className="mt-1 text-muted-foreground">Já existem e ficam como estão: {resumirNumeros(repetidos)}</p> : null}
                </div>
              ) : null}
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} disabled={!novos.length}>
                  Cadastrar quartos
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

/** Tarifa de um período (alta temporada, feriado, evento). */
export function DialogoTarifa({ empresaId, categorias, hoje }: { empresaId: string; categorias: { id: string; nome: string }[]; hoje: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante="contorno" disabled={!categorias.length}>
          <CalendarPlus /> Tarifa de período
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Tarifa de período" descricao="Nas noites dentro do período, a diária da categoria passa a ser esta (a reserva calcula sozinha). Períodos mais curtos têm preferência.">
        <FormularioAcao acao={salvarTarifa.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <Campo rotulo="Nome" htmlFor="t-nome" obrigatorio erro={estado.erros?.nome}>
                <Input id="t-nome" name="nome" maxLength={60} placeholder="Temporada de praia, Réveillon, Feriado" />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Categoria" htmlFor="t-cat" obrigatorio erro={estado.erros?.categoria_id}>
                  <Select id="t-cat" name="categoria_id" defaultValue={categorias.length === 1 ? categorias[0].id : ""}>
                    <option value="">Escolha...</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo rotulo="Diária no período" htmlFor="t-diaria" obrigatorio erro={estado.erros?.diaria}>
                  <CampoValor id="t-diaria" name="diaria" />
                </Campo>
                <Campo rotulo="Primeira noite" htmlFor="t-ini" obrigatorio erro={estado.erros?.inicio}>
                  <Input id="t-ini" name="inicio" type="date" defaultValue={hoje} />
                </Campo>
                <Campo rotulo="Última noite" htmlFor="t-fim" obrigatorio erro={estado.erros?.fim}>
                  <Input id="t-fim" name="fim" type="date" defaultValue={hoje} />
                </Campo>
              </div>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar tarifa</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export function BotaoExcluirTarifa({ empresaId, tarifaId, nome }: { empresaId: string; tarifaId: string; nome: string }) {
  return (
    <BotaoAcao
      variante="fantasma"
      tamanho="sm"
      aria-label={`Excluir a tarifa ${nome}`}
      acao={excluirTarifa.bind(null, empresaId, tarifaId)}
      confirmar={{ titulo: `Excluir a tarifa "${nome}"?`, descricao: "As reservas já feitas continuam com o valor calculado. As novas voltam à diária de tabela.", textoConfirmar: "Excluir", perigo: true }}
    >
      <Trash2 />
    </BotaoAcao>
  );
}

/** Botões da governança no cartão do quarto. */
export function BotoesLimpeza({ empresaId, quartoId, numero, limpeza, ocupado }: { empresaId: string; quartoId: string; numero: string; limpeza: Limpeza; ocupado: boolean }) {
  const [manut, setManut] = React.useState(false);
  return (
    <div className="flex flex-wrap gap-1.5">
      {limpeza !== "limpo" ? (
        <BotaoAcao tamanho="sm" variante="contorno" acao={mudarLimpeza.bind(null, empresaId, quartoId, "limpo", undefined)} aoSucesso={() => undefined}>
          <Sparkles /> Limpo
        </BotaoAcao>
      ) : null}
      {limpeza === "sujo" ? (
        <BotaoAcao tamanho="sm" variante="fantasma" acao={mudarLimpeza.bind(null, empresaId, quartoId, "em_limpeza", undefined)}>
          Em limpeza
        </BotaoAcao>
      ) : null}
      {limpeza === "limpo" ? (
        <BotaoAcao tamanho="sm" variante="fantasma" acao={mudarLimpeza.bind(null, empresaId, quartoId, "sujo", undefined)}>
          Marcar sujo
        </BotaoAcao>
      ) : null}
      {limpeza !== "manutencao" && !ocupado ? (
        <Dialog open={manut} onOpenChange={setManut}>
          <DialogTrigger asChild>
            <Button tamanho="sm" variante="fantasma" aria-label={`Manutenção no quarto ${numero}`}>
              <Wrench />
            </Button>
          </DialogTrigger>
          <DialogContent titulo={`Manutenção no quarto ${numero}`} descricao="O quarto fica bloqueado para check-in até ser marcado como limpo.">
            <FormularioAcao acao={colocarEmManutencao.bind(null, empresaId, quartoId)} aoSucesso={() => setManut(false)} className="space-y-4">
              {({ estado, pendente }) => (
                <>
                  <Campo rotulo="O que está em manutenção" htmlFor={`m-${quartoId}`} obrigatorio erro={estado.erros?.motivo}>
                    <Input id={`m-${quartoId}`} name="motivo" maxLength={300} placeholder="Ar-condicionado, chuveiro, pintura" />
                  </Campo>
                  <div className="flex justify-end">
                    <BotaoEnviar pendente={pendente}>Bloquear o quarto</BotaoEnviar>
                  </div>
                </>
              )}
            </FormularioAcao>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export interface ConfigHotelForm {
  hora_checkin: string;
  hora_checkout: string;
  taxa_servico: number | null;
  cafe_incluso: boolean;
  politica: string | null;
}

export function FormConfigHotel({ empresaId, config }: { empresaId: string; config: ConfigHotelForm }) {
  return (
    <FormularioAcao acao={salvarConfiguracaoHotel.bind(null, empresaId)} className="space-y-5">
      {({ pendente }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Horário do check-in" htmlFor="h-in">
              <Input id="h-in" name="hora_checkin" type="time" defaultValue={config.hora_checkin.slice(0, 5)} />
            </Campo>
            <Campo rotulo="Horário do check-out" htmlFor="h-out">
              <Input id="h-out" name="hora_checkout" type="time" defaultValue={config.hora_checkout.slice(0, 5)} />
            </Campo>
            <Campo rotulo="Taxa de serviço (%)" htmlFor="h-taxa" ajuda="Sobre o consumo (restaurante, bar, frigobar). Em branco: não cobra.">
              <Input id="h-taxa" name="taxa_servico" inputMode="decimal" defaultValue={config.taxa_servico ? String(config.taxa_servico).replace(".", ",") : ""} placeholder="10" />
            </Campo>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="cafe_incluso" defaultChecked={config.cafe_incluso} className="mt-0.5" />
            <span>
              Café da manhã incluso na diária
              <span className="block text-muted-foreground">Aparece na confirmação da reserva e no extrato da conta.</span>
            </span>
          </label>
          <Campo rotulo="Política de cancelamento e regras da casa" htmlFor="h-pol" ajuda="Aparece na confirmação da reserva. Ex.: cancelamento sem custo até 48 h antes; sinal de 30%.">
            <Textarea id="h-pol" name="politica" rows={4} maxLength={2000} defaultValue={config.politica ?? ""} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar configurações</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
