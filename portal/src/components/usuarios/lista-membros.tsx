"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MoreVertical, ShieldOff, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Select, Textarea } from "@/components/ui/form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import { formatarDataHora, formatarRelativo } from "@/lib/formatos";
import { ROTULO_PAPEL, type Permissao } from "@/lib/permissoes";
import { atualizarPermissoesMembro, reenviarAcesso, revogarMembro } from "@/lib/usuarios/acoes";
import { LinkCompartilhavel } from "./convite";
import { SeletorPermissoes } from "./seletor-permissoes";

export interface MembroLista {
  id: string;
  user_id: string;
  papel: string;
  permissoes: Permissao[];
  ativo: boolean;
  convidado_em: string;
  revogado_em: string | null;
  motivo_revogacao: string | null;
  nome: string;
  email: string;
  ultimo_acesso_em: string | null;
}

export function ListaMembros({
  empresaId,
  membros,
  podeGerenciar,
  usuarioAtualId,
  ehCliente,
}: {
  empresaId: string;
  membros: MembroLista[];
  podeGerenciar: boolean;
  usuarioAtualId: string;
  ehCliente: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<MembroLista | null>(null);
  const [revogando, setRevogando] = useState<MembroLista | null>(null);
  const [motivo, setMotivo] = useState("");
  const [link, setLink] = useState<{ link: string; nome: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const [mostrarRevogados, setMostrarRevogados] = useState(false);
  const lista = membros.filter((m) => mostrarRevogados || m.ativo);

  if (!membros.length) {
    return <EstadoVazio titulo="Nenhum usuário vinculado" descricao="Convide o empresário e, se desejar, colaboradores da empresa." />;
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={mostrarRevogados} onChange={(e) => setMostrarRevogados(e.target.checked)} />
        Mostrar acessos revogados
      </label>
      <Table>
        <THead>
          <tr>
            <Th>Usuário</Th>
            <Th>Papel</Th>
            <Th className="hidden md:table-cell">Permissões</Th>
            <Th className="hidden sm:table-cell">Último acesso</Th>
            <Th>Situação</Th>
            {podeGerenciar ? <Th className="w-10" /> : null}
          </tr>
        </THead>
        <TBody>
          {lista.map((m) => {
            const editavel = podeGerenciar && m.user_id !== usuarioAtualId && m.ativo && !(ehCliente && m.papel !== "cliente_colaborador");
            return (
              <Tr key={m.id}>
                <Td>
                  <p className="font-medium">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </Td>
                <Td className="whitespace-nowrap text-sm">{ROTULO_PAPEL[m.papel] ?? m.papel}</Td>
                <Td className="hidden md:table-cell">
                  <p className="max-w-xs text-xs text-muted-foreground">{m.permissoes.length} permissão(ões)</p>
                </Td>
                <Td className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                  {m.ultimo_acesso_em ? <span title={formatarDataHora(m.ultimo_acesso_em)}>{formatarRelativo(m.ultimo_acesso_em)}</span> : "Nunca acessou"}
                </Td>
                <Td>
                  {m.ativo ? (
                    <Badge variante="sucesso">Ativo</Badge>
                  ) : (
                    <Badge variante="neutro" title={m.motivo_revogacao ?? undefined}>
                      Revogado
                    </Badge>
                  )}
                </Td>
                {podeGerenciar ? (
                  <Td>
                    {editavel ? (
                      <Menu>
                        <MenuGatilho asChild>
                          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Ações para ${m.nome}`}>
                            <MoreVertical />
                          </Button>
                        </MenuGatilho>
                        <MenuConteudo>
                          <MenuItem onSelect={() => setEditando(m)}>
                            <SlidersHorizontal /> Editar permissões
                          </MenuItem>
                          <MenuItem
                            disabled={pendente}
                            onSelect={() =>
                              iniciar(async () => {
                                const r = await reenviarAcesso(m.user_id, empresaId);
                                if (!r.ok) toast.error(r.mensagem);
                                else {
                                  toast.success(r.mensagem);
                                  const d = r.dados as { link?: string; emailEnviado?: boolean } | undefined;
                                  if (d?.link && !d.emailEnviado) setLink({ link: d.link, nome: m.nome });
                                }
                              })
                            }
                          >
                            <KeyRound /> Reenviar link de acesso
                          </MenuItem>
                          <MenuItem className="text-perigo" onSelect={() => setRevogando(m)}>
                            <ShieldOff /> Revogar acesso
                          </MenuItem>
                        </MenuConteudo>
                      </Menu>
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            );
          })}
        </TBody>
      </Table>

      {editando ? (
        <DialogPermissoes empresaId={empresaId} membro={editando} ehCliente={ehCliente} aoFechar={() => setEditando(null)} />
      ) : null}

      <Dialog open={Boolean(revogando)} onOpenChange={(v) => !v && setRevogando(null)}>
        {revogando ? (
          <DialogContent titulo={`Revogar o acesso de ${revogando.nome}`} descricao="O acesso é bloqueado imediatamente. O histórico é preservado.">
            <div className="space-y-4">
              <Campo rotulo="Motivo" htmlFor="motivo-revogacao" obrigatorio>
                <Textarea id="motivo-revogacao" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </Campo>
              <div className="flex justify-end gap-2">
                <Button variante="contorno" onClick={() => setRevogando(null)}>
                  Cancelar
                </Button>
                <Button
                  variante="perigo"
                  disabled={pendente || !motivo.trim()}
                  onClick={() =>
                    iniciar(async () => {
                      const r = await revogarMembro(empresaId, revogando.id, motivo);
                      if (r.ok) {
                        toast.success(r.mensagem);
                        setRevogando(null);
                        setMotivo("");
                        router.refresh();
                      } else toast.error(r.mensagem);
                    })
                  }
                >
                  Revogar acesso
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(link)} onOpenChange={(v) => !v && setLink(null)}>
        {link ? (
          <DialogContent titulo="Novo link de acesso" descricao="O e-mail não foi enviado. Compartilhe o link com o usuário.">
            <LinkCompartilhavel link={link.link} nome={link.nome} />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

export function DialogPermissoes({
  empresaId,
  membro,
  ehCliente,
  aoFechar,
}: {
  empresaId: string;
  membro: MembroLista;
  ehCliente: boolean;
  aoFechar: () => void;
}) {
  const [permissoes, setPermissoes] = useState(new Set<Permissao>(membro.permissoes));
  const [papel, setPapel] = useState(membro.papel);
  const acao = atualizarPermissoesMembro.bind(null, empresaId, membro.id);
  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent largura="lg" titulo={`Permissões de ${membro.nome}`} descricao={membro.email}>
        <FormularioAcao acao={acao} aoSucesso={aoFechar} className="space-y-4">
          {({ pendente }) => (
            <>
              {membro.papel === "equipe" ? (
                <input type="hidden" name="papel" value="equipe" />
              ) : (
                <Campo rotulo="Papel" htmlFor="papel-membro">
                  <Select id="papel-membro" name="papel" value={papel} onChange={(e) => setPapel(e.target.value)} disabled={ehCliente}>
                    <option value="cliente_titular">Cliente empresário (titular)</option>
                    <option value="cliente_colaborador">Colaborador do cliente</option>
                  </Select>
                  {ehCliente ? <input type="hidden" name="papel" value={papel} /> : null}
                </Campo>
              )}
              <SeletorPermissoes selecionadas={permissoes} aoMudar={setPermissoes} apenasCliente={membro.papel !== "equipe"} />
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente}>Salvar permissões</BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
