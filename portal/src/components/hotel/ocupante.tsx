"use client";

import * as React from "react";
import { UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Select } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarCpf } from "@/lib/formatos";
import { informarOcupante } from "@/lib/hotel/acoes";
import { TIPOS_DOCUMENTO } from "@/lib/hotel/rotulos";

export interface PessoaOpcao {
  id: string;
  nome: string;
  cpf: string | null;
  documento: string | null;
}

/**
 * Reserva no nome de uma empresa: quem se hospedou por ela (uma pessoa já
 * cadastrada ou cadastrada na hora, com CPF ou documento para a ficha).
 */
export function DialogoOcupante({
  empresaId,
  reservaId,
  empresa,
  pessoas,
  trocar = false,
}: {
  empresaId: string;
  reservaId: string;
  empresa: string;
  pessoas: PessoaOpcao[];
  trocar?: boolean;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [modo, setModo] = React.useState<"lista" | "novo">(pessoas.length ? "lista" : "novo");
  const [busca, setBusca] = React.useState("");
  const termo = busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const filtradas = pessoas.filter((p) => !termo || p.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && (p.cpf ?? "").includes(digitos))).slice(0, 100);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={trocar ? "fantasma" : "primario"} tamanho="sm">
          <UserCheck /> {trocar ? "Trocar" : "Informar quem se hospedou"}
        </Button>
      </DialogTrigger>
      <DialogContent titulo="Quem se hospedou pela empresa" descricao={`A pessoa que dormiu no hotel pela ${empresa}. Os dados dela vão para a ficha de registro.`}>
        <FormularioAcao acao={informarOcupante.bind(null, empresaId, reservaId)} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <input type="hidden" name="modo" value={modo} />
              <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
                <button type="button" className={`flex-1 rounded-md px-3 py-1 ${modo === "lista" ? "bg-card shadow" : ""}`} onClick={() => setModo("lista")}>
                  Já cadastrada
                </button>
                <button type="button" className={`flex-1 rounded-md px-3 py-1 ${modo === "novo" ? "bg-card shadow" : ""}`} onClick={() => setModo("novo")}>
                  Cadastrar pessoa
                </button>
              </div>
              {modo === "lista" ? (
                <>
                  <Campo rotulo="Buscar pelo nome ou CPF" htmlFor="oc-busca">
                    <Input id="oc-busca" value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
                  </Campo>
                  <Campo rotulo="Pessoa" htmlFor="oc-hospede" obrigatorio erro={estado.erros?.hospede_id}>
                    <Select id="oc-hospede" name="hospede_id" defaultValue="">
                      <option value="">Escolha...</option>
                      {filtradas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                          {p.cpf ? ` — CPF ${formatarCpf(p.cpf)}` : p.documento ? ` — doc. ${p.documento}` : " — sem documento"}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                </>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome completo" htmlFor="oc-nome" obrigatorio erro={estado.erros?.oc_nome} className="sm:col-span-2">
                    <Input id="oc-nome" name="oc_nome" maxLength={120} autoComplete="off" />
                  </Campo>
                  <Campo rotulo="CPF" htmlFor="oc-cpf" erro={estado.erros?.oc_cpf} ajuda="Sem CPF (estrangeiro), informe outro documento.">
                    <Input id="oc-cpf" name="oc_cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" />
                  </Campo>
                  <Campo rotulo="Telefone (WhatsApp)" htmlFor="oc-tel" erro={estado.erros?.oc_telefone}>
                    <Input id="oc-tel" name="oc_telefone" inputMode="tel" maxLength={16} placeholder="(63) 99999-0000" />
                  </Campo>
                  <Campo rotulo="Outro documento" htmlFor="oc-doc-tipo">
                    <Select id="oc-doc-tipo" name="oc_documento_tipo" defaultValue="">
                      <option value="">—</option>
                      {Object.entries(TIPOS_DOCUMENTO).map(([v, r]) => (
                        <option key={v} value={v}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                  <Campo rotulo="Número do documento" htmlFor="oc-doc">
                    <Input id="oc-doc" name="oc_documento" maxLength={30} />
                  </Campo>
                </div>
              )}
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
