"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, KeyRound, LogOut, MoreVertical, Pencil, Plus, Power, ShieldOff, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Alerta, EstadoVazio } from "@/components/ui/feedback";
import { formatarDataHora, formatarDocumento } from "@/lib/formatos";
import { TODAS_PERMISSOES, type Permissao } from "@/lib/permissoes";
import type { ResultadoAcao } from "@/lib/acoes";
import {
  administrarUsuario,
  atualizarPermissoesMembro,
  encerrarSessoesUsuario,
  reenviarAcesso,
  revogarMembro,
  vincularMembroExistente,
} from "@/lib/usuarios/acoes";
import { LinkCompartilhavel } from "./convite";
import { SeletorPermissoes } from "./seletor-permissoes";

export interface UsuarioEquipe {
  id: string;
  nome: string;
  email: string;
  tipo: "admin" | "equipe";
  ativo: boolean;
  cargo: string | null;
}

/** Ações do administrador sobre uma pessoa da equipe (perfil, acesso, sessões). */
export function AcoesUsuarioEquipe({ usuario, ehProprio }: { usuario: UsuarioEquipe; ehProprio: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [editando, setEditando] = useState(false);
  const [tipo, setTipo] = useState<UsuarioEquipe["tipo"]>(usuario.tipo);
  const [cargo, setCargo] = useState(usuario.cargo ?? "");
  const [link, setLink] = useState<string | null>(null);

  const executar = async (acao: () => Promise<ResultadoAcao>, aoSucesso?: (r: ResultadoAcao) => void) => {
    const r = await acao();
    if (r.ok) {
      if (r.mensagem) toast.success(r.mensagem);
      aoSucesso?.(r);
      router.refresh();
    } else toast.error(r.mensagem ?? "Não foi possível concluir a operação.");
    return r.ok;
  };

  return (
    <>
      {usuario.ativo ? (
        <Button variante="contorno" onClick={() => setEditando(true)}>
          <Pencil /> Editar perfil
        </Button>
      ) : null}
      {usuario.ativo && !ehProprio ? (
        <Button
          variante="contorno"
          disabled={pendente}
          onClick={() =>
            iniciar(async () => {
              await executar(
                () => reenviarAcesso(usuario.id, null),
                (r) => {
                  const d = r.dados as { link?: string; emailEnviado?: boolean } | undefined;
                  if (d?.link && !d.emailEnviado) setLink(d.link);
                },
              );
            })
          }
        >
          <KeyRound /> Reenviar link de acesso
        </Button>
      ) : null}
      {usuario.ativo && !ehProprio ? (
        <Confirmacao
          gatilho={
            <Button variante="contorno">
              <LogOut /> Encerrar sessões
            </Button>
          }
          titulo={`Encerrar as sessões de ${usuario.nome}?`}
          descricao="A pessoa precisará entrar novamente em todos os dispositivos. O acesso não é bloqueado."
          textoConfirmar="Encerrar sessões"
          variante="perigo"
          aoConfirmar={() => executar(() => encerrarSessoesUsuario(usuario.id))}
        />
      ) : null}
      {!ehProprio ? (
        <Confirmacao
          gatilho={
            <Button variante={usuario.ativo ? "fantasma" : "primario"}>
              <Power /> {usuario.ativo ? "Desativar acesso" : "Reativar acesso"}
            </Button>
          }
          titulo={usuario.ativo ? `Desativar o acesso de ${usuario.nome}?` : `Reativar o acesso de ${usuario.nome}?`}
          descricao={
            usuario.ativo
              ? "O login é bloqueado e todas as sessões são encerradas imediatamente. Histórico, vínculos e registros são preservados."
              : "A pessoa volta a entrar com a senha atual (ou pelo link de acesso). Os vínculos com empresas que estavam ativos voltam a valer."
          }
          textoConfirmar={usuario.ativo ? "Desativar" : "Reativar"}
          variante={usuario.ativo ? "perigo" : "primario"}
          aoConfirmar={() => executar(() => administrarUsuario(usuario.id, usuario.tipo, !usuario.ativo, usuario.cargo ?? undefined))}
        />
      ) : null}

      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent titulo={`Perfil de ${usuario.nome}`} descricao={usuario.email}>
          <div className="space-y-4">
            <Campo
              rotulo="Perfil de acesso"
              htmlFor="equipe-tipo"
              ajuda={ehProprio ? "Você não pode rebaixar o próprio usuário." : "Administradores acessam todas as empresas e gerenciam a equipe e as configurações."}
            >
              <Select id="equipe-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as UsuarioEquipe["tipo"])} disabled={ehProprio}>
                <option value="equipe">Equipe contábil</option>
                <option value="admin">Administrador do escritório</option>
              </Select>
            </Campo>
            <Campo rotulo="Cargo" htmlFor="equipe-cargo" ajuda="Opcional. Ex.: Contador, Assistente fiscal, Departamento pessoal.">
              <Input id="equipe-cargo" value={cargo} maxLength={80} onChange={(e) => setCargo(e.target.value)} />
            </Campo>
            <div className="flex justify-end gap-2">
              <Button variante="contorno" onClick={() => setEditando(false)}>
                Cancelar
              </Button>
              <Button
                disabled={pendente}
                onClick={() =>
                  iniciar(async () => {
                    await executar(() => administrarUsuario(usuario.id, tipo, usuario.ativo, cargo.trim()), () => setEditando(false));
                  })
                }
              >
                {pendente ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(link)} onOpenChange={(v) => !v && setLink(null)}>
        {link ? (
          <DialogContent titulo="Novo link de acesso" descricao="O e-mail não foi enviado. Compartilhe o link com a pessoa.">
            <LinkCompartilhavel link={link} nome={usuario.nome} />
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

export interface VinculoEquipe {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  empresa_documento: string;
  empresa_ativa: boolean;
  permissoes: Permissao[];
  ativo: boolean;
  convidado_em: string;
  revogado_em: string | null;
  motivo_revogacao: string | null;
}

/** Empresas que uma pessoa da equipe acessa, com as permissões em cada uma. */
export function AcessosEmpresasEquipe({
  usuario,
  vinculos,
  empresasDisponiveis,
  podeGerenciar,
}: {
  usuario: UsuarioEquipe;
  vinculos: VinculoEquipe[];
  empresasDisponiveis: { id: string; nome: string }[];
  podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<VinculoEquipe | null>(null);
  const [revogando, setRevogando] = useState<VinculoEquipe | null>(null);
  const [motivo, setMotivo] = useState("");
  const [vinculando, setVinculando] = useState(false);
  const [mostrarRevogados, setMostrarRevogados] = useState(false);
  const [pendente, iniciar] = useTransition();
  const lista = vinculos.filter((v) => mostrarRevogados || v.ativo);
  const gerenciar = podeGerenciar && usuario.ativo;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={mostrarRevogados} onChange={(e) => setMostrarRevogados(e.target.checked)} />
          Mostrar acessos revogados
        </label>
        {gerenciar ? (
          <Button tamanho="sm" onClick={() => setVinculando(true)} disabled={!empresasDisponiveis.length}>
            <Plus /> Vincular a uma empresa
          </Button>
        ) : null}
      </div>

      {!lista.length ? (
        <EstadoVazio
          icone={Building2}
          titulo={vinculos.length ? "Nenhum acesso ativo" : "Nenhuma empresa vinculada"}
          descricao={
            gerenciar
              ? "Vincule esta pessoa às empresas que ela atenderá. As permissões podem ser ajustadas por empresa."
              : "Esta pessoa ainda não atende nenhuma empresa visível para você."
          }
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th className="hidden md:table-cell">Permissões</Th>
              <Th className="hidden sm:table-cell">Desde</Th>
              <Th>Situação</Th>
              {gerenciar ? <Th className="w-10" /> : null}
            </tr>
          </THead>
          <TBody>
            {lista.map((v) => (
              <Tr key={v.id}>
                <Td>
                  <Link href={`/escritorio/empresas/${v.empresa_id}`} className="font-medium text-titulo hover:underline">
                    {v.empresa_nome}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatarDocumento(v.empresa_documento)}
                    {v.empresa_ativa ? "" : " · empresa inativa"}
                  </p>
                </Td>
                <Td className="hidden md:table-cell">
                  <p className="text-xs text-muted-foreground">
                    {v.permissoes.length === TODAS_PERMISSOES.length ? "Todas as permissões" : `${v.permissoes.length} de ${TODAS_PERMISSOES.length} permissões`}
                  </p>
                </Td>
                <Td className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">{formatarDataHora(v.convidado_em)}</Td>
                <Td>
                  {v.ativo ? (
                    <Badge variante="sucesso">Ativo</Badge>
                  ) : (
                    <Badge variante="neutro" title={v.motivo_revogacao ?? undefined}>
                      Revogado
                    </Badge>
                  )}
                </Td>
                {gerenciar ? (
                  <Td>
                    {v.ativo ? (
                      <Menu>
                        <MenuGatilho asChild>
                          <Button variante="fantasma" tamanho="iconeSm" aria-label={`Ações para ${v.empresa_nome}`}>
                            <MoreVertical />
                          </Button>
                        </MenuGatilho>
                        <MenuConteudo>
                          <MenuItem onSelect={() => setEditando(v)}>
                            <SlidersHorizontal /> Editar permissões
                          </MenuItem>
                          <MenuItem className="text-perigo" onSelect={() => setRevogando(v)}>
                            <ShieldOff /> Revogar acesso
                          </MenuItem>
                        </MenuConteudo>
                      </Menu>
                    ) : null}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {editando ? <DialogPermissoesEquipe usuario={usuario} vinculo={editando} aoFechar={() => setEditando(null)} /> : null}

      <Dialog open={vinculando} onOpenChange={setVinculando}>
        <DialogContent
          titulo={`Vincular ${usuario.nome} a uma empresa`}
          descricao="A pessoa recebe as permissões padrão da equipe. Depois, ajuste-as em Editar permissões, se necessário."
        >
          <FormularioAcao acao={vincularMembroExistente} aoSucesso={() => setVinculando(false)} className="space-y-4">
            {({ pendente: enviando }) => (
              <>
                <input type="hidden" name="user_id" value={usuario.id} />
                <input type="hidden" name="papel" value="equipe" />
                <Campo rotulo="Empresa" htmlFor="vinculo-empresa" obrigatorio>
                  <Select id="vinculo-empresa" name="empresa_id" defaultValue="" required>
                    <option value="" disabled>
                      Selecione...
                    </option>
                    {empresasDisponiveis.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={enviando} textoPendente="Vinculando...">
                    <Plus /> Vincular
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(revogando)} onOpenChange={(v) => !v && setRevogando(null)}>
        {revogando ? (
          <DialogContent
            titulo={`Revogar o acesso a ${revogando.empresa_nome}`}
            descricao={`${usuario.nome} deixa de acessar esta empresa imediatamente. O histórico é preservado.`}
          >
            <div className="space-y-4">
              <Campo rotulo="Motivo" htmlFor="motivo-revogacao-equipe" obrigatorio>
                <Textarea id="motivo-revogacao-equipe" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
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
                      const r = await revogarMembro(revogando.empresa_id, revogando.id, motivo);
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
    </div>
  );
}

function DialogPermissoesEquipe({ usuario, vinculo, aoFechar }: { usuario: UsuarioEquipe; vinculo: VinculoEquipe; aoFechar: () => void }) {
  const [permissoes, setPermissoes] = useState(new Set<Permissao>(vinculo.permissoes));
  const acao = atualizarPermissoesMembro.bind(null, vinculo.empresa_id, vinculo.id);
  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent largura="lg" titulo={`Permissões de ${usuario.nome}`} descricao={vinculo.empresa_nome}>
        <FormularioAcao acao={acao} aoSucesso={aoFechar} className="space-y-4">
          {({ pendente }) => (
            <>
              <input type="hidden" name="papel" value="equipe" />
              {!permissoes.size ? <Alerta tom="alerta">Sem nenhuma permissão, a pessoa não conseguirá abrir a empresa.</Alerta> : null}
              <SeletorPermissoes selecionadas={permissoes} aoMudar={setPermissoes} apenasCliente={false} />
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
