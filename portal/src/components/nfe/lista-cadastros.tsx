"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { FormDestinatario, FormTransportador, type Destinatario, type Transportador } from "./cadastros";
import { INDICADOR_IE } from "@/lib/nfe-emissao/rotulos";
import { formatarDocumento } from "@/lib/formatos";

const semAcento = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function ClientesNfe({ empresaId, clientes }: { empresaId: string; clientes: Destinatario[] }) {
  const [editando, setEditando] = React.useState<Destinatario | "novo" | null>(null);
  const [busca, setBusca] = React.useState("");
  const termo = semAcento(busca.trim());
  const digitos = busca.replace(/\D/g, "");
  const lista = termo
    ? clientes.filter((c) => semAcento(c.nome).includes(termo) || (digitos.length >= 3 && (c.documento ?? "").includes(digitos)))
    : clientes;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CNPJ ou CPF" className="sm:max-w-xs" aria-label="Buscar cliente" />
        <Button onClick={() => setEditando("novo")}>
          <Plus /> Novo cliente
        </Button>
      </div>
      {lista.length ? (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Cliente</Th>
                <Th>Documento</Th>
                <Th>Cidade</Th>
                <Th>ICMS</Th>
                <Th className="text-right">Ações</Th>
              </Tr>
            </THead>
            <TBody>
              {lista.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.nome}</Td>
                  <Td className="numero whitespace-nowrap">{c.documento ? (c.tipo === "estrangeiro" ? c.documento : formatarDocumento(c.documento)) : "—"}</Td>
                  <Td>{c.tipo === "estrangeiro" ? `${c.cidade_exterior ?? ""} (${c.pais ?? "exterior"})` : `${c.municipio ?? ""}/${c.uf ?? ""}`}</Td>
                  <Td className="text-sm text-muted-foreground">
                    {c.indicador_ie === 1 ? `IE ${c.inscricao_estadual}` : INDICADOR_IE[c.indicador_ie as keyof typeof INDICADOR_IE]}
                  </Td>
                  <Td className="text-right">
                    <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(c)}>
                      <Pencil /> Editar
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <EstadoVazio titulo={busca ? "Nenhum cliente encontrado" : "Nenhum cliente"} descricao="Cadastre os compradores. Com o CNPJ, o portal busca o nome e o endereço na Receita." />
      )}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent largura="lg" titulo={editando === "novo" ? "Novo cliente" : "Editar cliente"} descricao="Dados do comprador que saem na nota.">
          {editando !== null ? <FormDestinatario empresaId={empresaId} inicial={editando === "novo" ? null : editando} aoSalvar={() => setEditando(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TransportadoresNfe({ empresaId, transportadores }: { empresaId: string; transportadores: Transportador[] }) {
  const [editando, setEditando] = React.useState<Transportador | "novo" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variante="contorno" onClick={() => setEditando("novo")}>
          <Plus /> Novo transportador
        </Button>
      </div>
      {transportadores.length ? (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Transportador</Th>
                <Th>Documento</Th>
                <Th>Veículo</Th>
                <Th className="text-right">Ações</Th>
              </Tr>
            </THead>
            <TBody>
              {transportadores.map((t) => (
                <Tr key={t.id}>
                  <Td className="font-medium">{t.nome}</Td>
                  <Td className="numero whitespace-nowrap">{formatarDocumento(t.documento)}</Td>
                  <Td>{t.placa ? `${t.placa}${t.placa_uf ? `/${t.placa_uf}` : ""}` : "—"}</Td>
                  <Td className="text-right">
                    <Button variante="fantasma" tamanho="sm" onClick={() => setEditando(t)}>
                      <Pencil /> Editar
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      ) : (
        <EstadoVazio titulo="Nenhum transportador" descricao="Cadastre o caminhoneiro ou a transportadora para preencher a nota mais rápido." />
      )}
      <Dialog open={editando !== null} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent largura="lg" titulo={editando === "novo" ? "Novo transportador" : "Editar transportador"}>
          {editando !== null ? <FormTransportador empresaId={empresaId} inicial={editando === "novo" ? null : editando} aoSalvar={() => setEditando(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
