"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, CalendarPlus, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { arquivarVencimento, excluirVencimento, salvarVencimento } from "@/lib/vencimentos/acoes";
import { situacaoVencimento, TIPOS_VENCIMENTO } from "@/lib/vencimentos/rotulos";
import { formatarData } from "@/lib/formatos";
import type { ResultadoAcao } from "@/lib/acoes";

export interface Vencimento {
  id: string;
  tipo: string;
  descricao: string;
  numero: string | null;
  orgao: string | null;
  emissao: string | null;
  validade: string;
  responsavel: "escritorio" | "cliente";
  documento_id: string | null;
  documento_nome: string | null;
  situacao: "ativo" | "arquivado";
  observacao: string | null;
}

export interface DocumentoOpcao {
  id: string;
  nome: string;
}

function FormVencimento({
  empresaId,
  item,
  documentos,
  renovar,
  aoSalvar,
}: {
  empresaId: string;
  item: Vencimento | null;
  documentos: DocumentoOpcao[];
  renovar?: boolean;
  aoSalvar: () => void;
}) {
  const acao = salvarVencimento.bind(null, empresaId, item?.id ?? null);
  const [tipo, setTipo] = React.useState(item?.tipo ?? "certificado_digital");
  return (
    <FormularioAcao acao={acao} aoSucesso={aoSalvar} className="space-y-3">
      {({ estado, pendente }: { estado: ResultadoAcao; pendente: boolean }) => (
        <>
          {renovar ? (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              Informe a nova validade (e, se quiser, o novo documento). Os avisos recomeçam a contar pela nova data.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Tipo" htmlFor="vc-tipo" erro={estado.erros?.tipo} ajuda={TIPOS_VENCIMENTO[tipo]?.ajuda}>
              <Select id="vc-tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(TIPOS_VENCIMENTO).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t.rotulo}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo rotulo="Descrição" htmlFor="vc-desc" erro={estado.erros?.descricao} ajuda="Ex.: Certificado A1 da empresa, Alvará 2026.">
              <Input id="vc-desc" name="descricao" maxLength={120} defaultValue={item?.descricao ?? ""} placeholder={TIPOS_VENCIMENTO[tipo]?.rotulo} />
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
            <Campo rotulo="Emissão" htmlFor="vc-emissao" erro={estado.erros?.emissao}>
              <Input id="vc-emissao" name="emissao" type="date" defaultValue={renovar ? "" : (item?.emissao ?? "")} />
            </Campo>
            <Campo rotulo="Validade" htmlFor="vc-validade" erro={estado.erros?.validade} obrigatorio>
              <Input id="vc-validade" name="validade" type="date" defaultValue={renovar ? "" : (item?.validade ?? "")} />
            </Campo>
            <Campo rotulo="Quem renova" htmlFor="vc-resp" erro={estado.erros?.responsavel}>
              <Select id="vc-resp" name="responsavel" defaultValue={item?.responsavel ?? "escritorio"}>
                <option value="escritorio">Escritório</option>
                <option value="cliente">A empresa</option>
              </Select>
            </Campo>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Número" htmlFor="vc-num">
              <Input id="vc-num" name="numero" maxLength={80} defaultValue={item?.numero ?? ""} />
            </Campo>
            <Campo rotulo="Órgão emissor" htmlFor="vc-orgao">
              <Input id="vc-orgao" name="orgao" maxLength={120} defaultValue={item?.orgao ?? ""} placeholder="Ex.: Prefeitura de Porto Nacional" />
            </Campo>
          </div>
          <Campo rotulo="Documento no portal (opcional)" htmlFor="vc-doc" ajuda="Envie o arquivo em Enviar documentos e escolha-o aqui.">
            <Select id="vc-doc" name="documento_id" defaultValue={renovar ? "" : (item?.documento_id ?? "")}>
              <option value="">Nenhum</option>
              {documentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nome}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Observação" htmlFor="vc-obs">
            <Textarea id="vc-obs" name="observacao" rows={2} maxLength={500} defaultValue={item?.observacao ?? ""} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>{renovar ? "Salvar renovação" : item ? "Salvar" : "Cadastrar"}</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function NovoVencimento({ empresaId, documentos }: { empresaId: string; documentos: DocumentoOpcao[] }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <CalendarPlus /> Novo vencimento
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Novo vencimento" descricao="Certificado, alvará, licença ou certidão com data de validade." largura="lg">
          <FormVencimento empresaId={empresaId} item={null} documentos={documentos} aoSalvar={() => setAberto(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Acoes({ empresaId, item, documentos, podeExcluir }: { empresaId: string; item: Vencimento; documentos: DocumentoOpcao[]; podeExcluir: boolean }) {
  const [modo, setModo] = React.useState<"editar" | "renovar" | "excluir" | null>(null);
  const [pendente, iniciar] = React.useTransition();
  const router = useRouter();
  const executar = (fn: () => Promise<ResultadoAcao>) =>
    iniciar(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.mensagem ?? "Pronto.");
        setModo(null);
        router.refresh();
      } else toast.error(r.mensagem ?? "Não foi possível concluir.");
    });
  return (
    <>
      <Menu>
        <MenuGatilho asChild>
          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Ações para ${item.descricao}`}>
            <MoreHorizontal />
          </Button>
        </MenuGatilho>
        <MenuConteudo>
          {item.situacao === "ativo" ? (
            <MenuItem onSelect={() => setModo("renovar")}>
              <RefreshCw /> Renovar
            </MenuItem>
          ) : null}
          <MenuItem onSelect={() => setModo("editar")}>
            <Pencil /> Editar
          </MenuItem>
          <MenuItem onSelect={() => executar(() => arquivarVencimento(empresaId, item.id, item.situacao === "ativo"))} disabled={pendente}>
            {item.situacao === "ativo" ? <Archive /> : <ArchiveRestore />} {item.situacao === "ativo" ? "Arquivar (não precisa mais)" : "Reativar"}
          </MenuItem>
          {podeExcluir ? (
            <MenuItem onSelect={() => setModo("excluir")} className="text-perigo">
              <Trash2 /> Excluir
            </MenuItem>
          ) : null}
        </MenuConteudo>
      </Menu>
      <Dialog open={modo === "editar" || modo === "renovar"} onOpenChange={(v) => !v && setModo(null)}>
        <DialogContent titulo={modo === "renovar" ? `Renovar: ${item.descricao}` : `Editar: ${item.descricao}`} largura="lg">
          <FormVencimento empresaId={empresaId} item={item} documentos={documentos} renovar={modo === "renovar"} aoSalvar={() => setModo(null)} />
        </DialogContent>
      </Dialog>
      <Dialog open={modo === "excluir"} onOpenChange={(v) => !v && setModo(null)}>
        <DialogContent titulo={`Excluir ${item.descricao}?`} descricao="O registro e o histórico de avisos são apagados. Para só parar os avisos, use Arquivar.">
          <div className="flex justify-end gap-2">
            <Button variante="contorno" onClick={() => setModo(null)}>
              Cancelar
            </Button>
            <Button variante="perigo" disabled={pendente} onClick={() => executar(() => excluirVencimento(empresaId, item.id))}>
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ListaVencimentos({
  empresaId,
  itens,
  documentos,
  hoje,
  podeEditar,
  podeExcluir,
}: {
  empresaId: string;
  itens: Vencimento[];
  documentos: DocumentoOpcao[];
  hoje: string;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Documento</Th>
          <Th className="hidden md:table-cell">Validade</Th>
          <Th>Situação</Th>
          <Th className="hidden lg:table-cell">Quem renova</Th>
          {podeEditar ? <Th className="w-12" /> : null}
        </Tr>
      </THead>
      <TBody>
        {itens.map((v) => {
          const s = situacaoVencimento(v.validade, hoje);
          return (
            <Tr key={v.id} className={v.situacao === "arquivado" ? "opacity-60" : undefined}>
              <Td>
                <span className="font-medium">{v.descricao}</span>
                <span className="block text-xs text-muted-foreground">
                  {TIPOS_VENCIMENTO[v.tipo]?.rotulo ?? v.tipo}
                  {v.numero ? ` · nº ${v.numero}` : ""}
                  {v.orgao ? ` · ${v.orgao}` : ""}
                </span>
                {v.documento_id ? (
                  <Link href={`/e/${empresaId}/documentos/${v.documento_id}`} className="text-xs text-primary hover:underline">
                    {v.documento_nome ?? "Ver documento"}
                  </Link>
                ) : null}
                <span className="block text-xs text-muted-foreground md:hidden">Validade {formatarData(v.validade)}</span>
              </Td>
              <Td className="hidden md:table-cell">{formatarData(v.validade)}</Td>
              <Td>{v.situacao === "arquivado" ? <Badge variante="neutro">Arquivado</Badge> : <Badge variante={s.tom}>{s.rotulo}</Badge>}</Td>
              <Td className="hidden lg:table-cell text-sm">{v.responsavel === "cliente" ? "A empresa" : "Escritório"}</Td>
              {podeEditar ? (
                <Td className="text-right">
                  <Acoes empresaId={empresaId} item={v} documentos={documentos} podeExcluir={podeExcluir} />
                </Td>
              ) : null}
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
