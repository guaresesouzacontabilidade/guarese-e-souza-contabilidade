"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { CampoValor } from "@/components/ui/campo-valor";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { excluirContrato, excluirTaxa, salvarContrato, salvarTaxa } from "@/lib/maquininhas/acoes";
import type { ResultadoAcao } from "@/lib/acoes";
import { BANDEIRAS_COMUNS, MODALIDADES, ROTULO_MODALIDADE, ROTULO_TIPO_ADQUIRENTE, TIPOS_ADQUIRENTE, type TipoAdquirente } from "@/lib/maquininhas/rotulos";

export interface Adquirente {
  codigo: string;
  nome: string;
  tipo: TipoAdquirente;
}

export interface Contrato {
  id: string;
  adquirente_codigo: string | null;
  adquirente_nome: string;
  tipo: TipoAdquirente;
  apelido: string | null;
  codigo_estabelecimento: string | null;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  aluguel_mensal: number | null;
  observacao: string | null;
  ativo: boolean;
}

export interface Taxa {
  id: string;
  bandeira: string | null;
  modalidade: string;
  parcelas_de: number;
  parcelas_ate: number;
  taxa_percentual: number;
  tarifa_fixa: number;
  prazo_dias: number | null;
  observacao: string | null;
}

const percentual = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

/** Lista de adquirentes do catálogo, separadas por tipo, e a opção "outra". */
export function OpcoesAdquirente({ catalogo }: { catalogo: Adquirente[] }) {
  return (
    <>
      <option value="">Escolha...</option>
      {TIPOS_ADQUIRENTE.map((t) => (
        <optgroup key={t} label={ROTULO_TIPO_ADQUIRENTE[t]}>
          {catalogo
            .filter((a) => a.tipo === t)
            .map((a) => (
              <option key={a.codigo} value={a.codigo}>
                {a.nome}
              </option>
            ))}
        </optgroup>
      ))}
      <option value="outra">Outra (não está na lista)</option>
    </>
  );
}

const RAPIDAS: Record<TipoAdquirente, { campo: string; rotulo: string; ajuda?: string }[]> = {
  cartao: [
    { campo: "rapida_debito", rotulo: "Débito" },
    { campo: "rapida_credito", rotulo: "Crédito à vista" },
    { campo: "rapida_parcelado_6", rotulo: "Parcelado 2x a 6x" },
    { campo: "rapida_parcelado_12", rotulo: "Parcelado 7x a 12x" },
    { campo: "rapida_pix", rotulo: "Pix" },
    { campo: "rapida_voucher", rotulo: "Voucher / benefício" },
  ],
  frota: [{ campo: "rapida_frota", rotulo: "Taxa de administração (frota)" }],
  beneficio: [{ campo: "rapida_voucher", rotulo: "Taxa de administração (voucher)" }],
  convenio: [
    { campo: "rapida_outros", rotulo: "Taxa do convênio (à vista)" },
    { campo: "rapida_parcelado_6", rotulo: "Parcelado 2x a 6x" },
    { campo: "rapida_parcelado_12", rotulo: "Parcelado 7x a 12x" },
  ],
};

function FormContrato({
  empresaId,
  contrato,
  catalogo,
  aoSalvar,
}: {
  empresaId: string;
  contrato: Contrato | null;
  catalogo: Adquirente[];
  aoSalvar: () => void;
}) {
  const acao = salvarContrato.bind(null, empresaId, contrato?.id ?? null);
  const c = contrato;
  const [escolha, setEscolha] = React.useState(c ? (c.adquirente_codigo ?? "outra") : "");
  const [tipoOutra, setTipoOutra] = React.useState<TipoAdquirente>(c?.tipo ?? "cartao");
  const tipo: TipoAdquirente = escolha === "outra" ? tipoOutra : (catalogo.find((a) => a.codigo === escolha)?.tipo ?? "cartao");
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} className="space-y-3">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Adquirente" htmlFor="ct-adq" erro={estado.erros?.adquirente} obrigatorio>
              <Select id="ct-adq" name="adquirente" value={escolha} onChange={(e) => setEscolha(e.target.value)}>
                <OpcoesAdquirente catalogo={catalogo} />
              </Select>
            </Campo>
            <Campo rotulo="Apelido" htmlFor="ct-apelido" ajuda="Ex.: maquininha do balcão, loja 2.">
              <Input id="ct-apelido" name="apelido" maxLength={80} defaultValue={c?.apelido ?? ""} />
            </Campo>
          </div>
          {escolha === "outra" ? (
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Campo rotulo="Nome da adquirente" htmlFor="ct-nome" erro={estado.erros?.adquirente_nome} obrigatorio>
                <Input id="ct-nome" name="adquirente_nome" maxLength={80} defaultValue={c && !c.adquirente_codigo ? c.adquirente_nome : ""} />
              </Campo>
              <Campo rotulo="Tipo" htmlFor="ct-tipo" erro={estado.erros?.tipo} obrigatorio>
                <Select id="ct-tipo" name="tipo" value={tipoOutra} onChange={(e) => setTipoOutra(e.target.value as TipoAdquirente)}>
                  {TIPOS_ADQUIRENTE.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO_ADQUIRENTE[t]}
                    </option>
                  ))}
                </Select>
              </Campo>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Taxas valem desde" htmlFor="ct-ini" erro={estado.erros?.vigencia_inicio} obrigatorio>
              <Input id="ct-ini" name="vigencia_inicio" type="date" defaultValue={c?.vigencia_inicio ?? ""} />
            </Campo>
            <Campo rotulo="Até" htmlFor="ct-fim" erro={estado.erros?.vigencia_fim} ajuda="Em branco: sem prazo.">
              <Input id="ct-fim" name="vigencia_fim" type="date" defaultValue={c?.vigencia_fim ?? ""} />
            </Campo>
            <Campo rotulo="Aluguel por mês" htmlFor="ct-aluguel" erro={estado.erros?.aluguel_mensal}>
              <CampoValor id="ct-aluguel" name="aluguel_mensal" valorInicial={c?.aluguel_mensal ?? null} />
            </Campo>
          </div>
          <Campo rotulo="Código do estabelecimento" htmlFor="ct-ec" ajuda="Número do cliente na adquirente (EC), se houver." className="sm:max-w-72">
            <Input id="ct-ec" name="codigo_estabelecimento" maxLength={40} defaultValue={c?.codigo_estabelecimento ?? ""} />
          </Campo>
          {!c && escolha ? (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Taxas combinadas (%)</legend>
              <p className="mb-2 text-xs text-muted-foreground">
                Valem para todas as bandeiras. Se alguma bandeira tem taxa diferente, inclua depois no contrato. Se a antecipação é automática, informe a
                taxa total (venda + antecipação).
              </p>
              <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                {RAPIDAS[tipo].map((r) => (
                  <Campo key={r.campo} rotulo={r.rotulo} htmlFor={`ct-${r.campo}`} erro={estado.erros?.[r.campo]}>
                    <Input id={`ct-${r.campo}`} name={r.campo} inputMode="decimal" placeholder="ex.: 2,39" maxLength={8} />
                  </Campo>
                ))}
              </div>
            </fieldset>
          ) : null}
          <Campo rotulo="Observação" htmlFor="ct-obs">
            <Textarea id="ct-obs" name="observacao" rows={2} maxLength={1000} defaultValue={c?.observacao ?? ""} />
          </Campo>
          {c ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="ativo" defaultChecked={c.ativo} /> Contrato ativo (desmarque quando deixar de usar esta maquininha)
            </label>
          ) : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{c ? "Salvar alterações" : "Cadastrar contrato"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function NovoContrato({ empresaId, catalogo }: { empresaId: string; catalogo: Adquirente[] }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus /> Novo contrato
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Novo contrato de maquininha" descricao="As taxas combinadas com a adquirente, para conferir o que é cobrado em cada venda." largura="lg">
          <FormContrato empresaId={empresaId} contrato={null} catalogo={catalogo} aoSalvar={() => setAberto(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function FormTaxa({ empresaId, contratoId, taxa, aoSalvar }: { empresaId: string; contratoId: string; taxa: Taxa | null; aoSalvar: () => void }) {
  const acao = salvarTaxa.bind(null, empresaId, contratoId, taxa?.id ?? null);
  const [modalidade, setModalidade] = React.useState(taxa?.modalidade ?? "credito_vista");
  const idLista = React.useId();
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} className="space-y-3">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Modalidade" htmlFor="tx-mod" erro={estado.erros?.modalidade} obrigatorio>
              <Select id="tx-mod" name="modalidade" value={modalidade} onChange={(e) => setModalidade(e.target.value)}>
                {MODALIDADES.map((m) => (
                  <option key={m} value={m}>
                    {ROTULO_MODALIDADE[m]}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Bandeira" htmlFor="tx-band" erro={estado.erros?.bandeira} ajuda="Em branco: vale para todas as bandeiras.">
              <Input id="tx-band" name="bandeira" list={idLista} maxLength={40} defaultValue={taxa?.bandeira ?? ""} placeholder="Todas" />
              <datalist id={idLista}>
                {BANDEIRAS_COMUNS.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </Campo>
          </div>
          {modalidade === "credito_parcelado" ? (
            <div className="grid grid-cols-2 gap-3 sm:max-w-80 [&>*]:min-w-0">
              <Campo rotulo="De (parcelas)" htmlFor="tx-de" erro={estado.erros?.parcelas_de}>
                <Input id="tx-de" name="parcelas_de" type="number" min={2} max={99} defaultValue={taxa?.parcelas_de && taxa.parcelas_de > 1 ? taxa.parcelas_de : 2} />
              </Campo>
              <Campo rotulo="Até (parcelas)" htmlFor="tx-ate" erro={estado.erros?.parcelas_ate}>
                <Input id="tx-ate" name="parcelas_ate" type="number" min={2} max={99} defaultValue={taxa?.parcelas_ate && taxa.parcelas_ate > 1 ? taxa.parcelas_ate : 6} />
              </Campo>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Taxa (%)" htmlFor="tx-taxa" erro={estado.erros?.taxa_percentual} obrigatorio>
              <Input id="tx-taxa" name="taxa_percentual" inputMode="decimal" maxLength={8} placeholder="ex.: 2,39" defaultValue={percentual(taxa?.taxa_percentual)} />
            </Campo>
            <Campo rotulo="Tarifa por venda" htmlFor="tx-tarifa" erro={estado.erros?.tarifa_fixa} ajuda="Valor fixo cobrado em cada venda, se houver.">
              <CampoValor id="tx-tarifa" name="tarifa_fixa" valorInicial={taxa?.tarifa_fixa || null} />
            </Campo>
            <Campo rotulo="Prazo de recebimento (dias)" htmlFor="tx-prazo" erro={estado.erros?.prazo_dias}>
              <Input id="tx-prazo" name="prazo_dias" type="number" min={0} max={400} defaultValue={taxa?.prazo_dias ?? ""} />
            </Campo>
          </div>
          <Campo rotulo="Observação" htmlFor="tx-obs">
            <Input id="tx-obs" name="observacao" maxLength={300} defaultValue={taxa?.observacao ?? ""} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{taxa ? "Salvar taxa" : "Incluir taxa"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function NovaTaxa({ empresaId, contrato }: { empresaId: string; contrato: Contrato }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="contorno" tamanho="sm" onClick={() => setAberto(true)}>
        <Plus /> Incluir taxa
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo={`Nova taxa — ${contrato.adquirente_nome}`} descricao="Uma linha por tipo de venda; a taxa por bandeira vale mais que a de todas as bandeiras." largura="lg">
          <FormTaxa empresaId={empresaId} contratoId={contrato.id} taxa={null} aoSalvar={() => setAberto(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Confirmação de exclusão aberta a partir de um menu (controlada pelo estado). */
export function DialogoExcluir({
  aberto,
  aoMudar,
  titulo,
  descricao,
  acao,
}: {
  aberto: boolean;
  aoMudar: (v: boolean) => void;
  titulo: string;
  descricao?: string;
  acao: () => Promise<ResultadoAcao>;
}) {
  const [pendente, iniciar] = React.useTransition();
  const router = useRouter();
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent titulo={titulo} descricao={descricao}>
        <div className="flex justify-end gap-2">
          <Button variante="contorno" onClick={() => aoMudar(false)}>
            Cancelar
          </Button>
          <Button
            variante="perigo"
            disabled={pendente}
            onClick={() =>
              iniciar(async () => {
                const r = await acao();
                if (r.ok) {
                  toast.success(r.mensagem ?? "Excluído.");
                  aoMudar(false);
                  router.refresh();
                } else toast.error(r.mensagem ?? "Não foi possível excluir.");
              })
            }
          >
            {pendente ? "Aguarde..." : "Excluir"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AcoesContrato({ empresaId, contrato, catalogo }: { empresaId: string; contrato: Contrato; catalogo: Adquirente[] }) {
  const [editar, setEditar] = React.useState(false);
  const [excluir, setExcluir] = React.useState(false);
  return (
    <>
      <Menu>
        <MenuGatilho asChild>
          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Ações do contrato ${contrato.adquirente_nome}`}>
            <MoreHorizontal />
          </Button>
        </MenuGatilho>
        <MenuConteudo>
          <MenuItem onSelect={() => setEditar(true)}>
            <Pencil /> Editar contrato
          </MenuItem>
          <MenuItem onSelect={() => setExcluir(true)} className="text-perigo">
            <Trash2 /> Excluir contrato
          </MenuItem>
        </MenuConteudo>
      </Menu>
      <Dialog open={editar} onOpenChange={setEditar}>
        <DialogContent titulo={`Contrato — ${contrato.adquirente_nome}`} largura="lg">
          <FormContrato empresaId={empresaId} contrato={contrato} catalogo={catalogo} aoSalvar={() => setEditar(false)} />
        </DialogContent>
      </Dialog>
      <DialogoExcluir
        aberto={excluir}
        aoMudar={setExcluir}
        titulo={`Excluir o contrato ${contrato.adquirente_nome}?`}
        descricao="As taxas deste contrato são apagadas e as vendas ficam sem contrato para conferir. Se a maquininha só deixou de ser usada, prefira desmarcar “Contrato ativo”."
        acao={() => excluirContrato(empresaId, contrato.id)}
      />
    </>
  );
}

export function AcoesTaxa({ empresaId, contratoId, taxa }: { empresaId: string; contratoId: string; taxa: Taxa }) {
  const [editar, setEditar] = React.useState(false);
  const [excluir, setExcluir] = React.useState(false);
  return (
    <>
      <Menu>
        <MenuGatilho asChild>
          <Button variante="fantasma" tamanho="iconeSm" aria-label="Ações da taxa">
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
        <DialogContent titulo="Editar taxa" largura="lg">
          <FormTaxa empresaId={empresaId} contratoId={contratoId} taxa={taxa} aoSalvar={() => setEditar(false)} />
        </DialogContent>
      </Dialog>
      <DialogoExcluir aberto={excluir} aoMudar={setExcluir} titulo="Excluir esta taxa?" acao={() => excluirTaxa(empresaId, taxa.id)} />
    </>
  );
}
