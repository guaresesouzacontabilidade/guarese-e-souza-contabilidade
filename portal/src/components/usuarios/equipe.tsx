"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, LogOut, MoreVertical, Power, PowerOff, Search, ShieldOff, SlidersHorizontal, Smartphone, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao, Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuConteudo, MenuGatilho, MenuItem } from "@/components/ui/menu";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarData } from "@/lib/formatos";
import { PERMISSOES_PADRAO, ROTULO_PAPEL, type Permissao } from "@/lib/permissoes";
import {
  alterarSituacaoUsuario,
  anonimizarUsuario,
  editarUsuario,
  encerrarSessoesUsuario,
  redefinirDuasEtapas,
  reenviarAcesso,
  revogarMembro,
  vincularEquipeEmpresas,
} from "@/lib/usuarios/acoes";
import { LinkCompartilhavel } from "./convite";
import { DialogPermissoes, type MembroLista } from "./lista-membros";
import { SeletorPermissoes } from "./seletor-permissoes";

export function FormEditarUsuario({ usuarioId, tipo, cargo, proprio }: { usuarioId: string; tipo: string; cargo: string | null; proprio: boolean }) {
  const acao = editarUsuario.bind(null, usuarioId);
  return (
    <FormularioAcao acao={acao} className="grid gap-4 sm:grid-cols-2">
      {({ estado, pendente }) => (
        <>
          {tipo === "cliente" ? (
            <input type="hidden" name="tipo" value="cliente" />
          ) : (
            <Campo
              rotulo="Perfil"
              htmlFor="us-tipo"
              erro={estado.erros?.tipo}
              ajuda={proprio ? "Você não pode rebaixar o próprio usuário." : "Administradores acessam todas as empresas e as configurações do escritório."}
            >
              <Select id="us-tipo" name={proprio ? undefined : "tipo"} defaultValue={tipo} disabled={proprio}>
                <option value="equipe">Equipe contábil</option>
                <option value="admin">Administrador do escritório</option>
              </Select>
              {proprio ? <input type="hidden" name="tipo" value={tipo} /> : null}
            </Campo>
          )}
          <Campo rotulo="Cargo ou função" htmlFor="us-cargo" erro={estado.erros?.cargo} ajuda="Ex.: Contador, Assistente fiscal, Departamento pessoal.">
            <Input id="us-cargo" name="cargo" defaultValue={cargo ?? ""} maxLength={80} />
          </Campo>
          <div className="flex justify-end sm:col-span-2">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

/** Ações de acesso de um usuário: novo link, sessões, desativar/reativar e anonimização (LGPD). */
export function AcoesUsuario({
  usuarioId,
  nome,
  ativo,
  anonimizado,
  proprio,
  tem2fa = false,
}: {
  usuarioId: string;
  nome: string;
  ativo: boolean;
  anonimizado: boolean;
  proprio: boolean;
  tem2fa?: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  if (anonimizado) return <p className="text-sm text-muted-foreground">Os dados pessoais deste usuário foram anonimizados. Nenhuma ação disponível.</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {ativo ? (
        <Button
          variante="contorno"
          tamanho="sm"
          disabled={pendente}
          onClick={() =>
            iniciar(async () => {
              const r = await reenviarAcesso(usuarioId, null);
              if (!r.ok) return void toast.error(r.mensagem);
              toast.success(r.mensagem);
              const d = r.dados as { link?: string; emailEnviado?: boolean } | undefined;
              if (d?.link && !d.emailEnviado) setLink(d.link);
            })
          }
        >
          <KeyRound /> Gerar novo link de acesso
        </Button>
      ) : null}
      {ativo ? (
        <BotaoAcao
          tamanho="sm"
          variante="contorno"
          acao={() => encerrarSessoesUsuario(usuarioId)}
          confirmar={{ titulo: `Encerrar as sessões de ${nome}?`, descricao: "Todos os dispositivos conectados precisarão entrar de novo.", textoConfirmar: "Encerrar sessões" }}
        >
          <LogOut /> Encerrar sessões
        </BotaoAcao>
      ) : null}
      {ativo && tem2fa && !proprio ? (
        <BotaoAcao
          tamanho="sm"
          variante="contorno"
          acao={() => redefinirDuasEtapas(usuarioId)}
          confirmar={{
            titulo: `Redefinir a verificação em duas etapas de ${nome}?`,
            descricao: "Use quando a pessoa perdeu ou trocou o celular. O autenticador atual deixa de valer, as sessões são encerradas e, no próximo acesso, ela cadastra o autenticador de novo.",
            textoConfirmar: "Redefinir",
          }}
        >
          <Smartphone /> Redefinir duas etapas
        </BotaoAcao>
      ) : null}
      {!proprio ? (
        ativo ? (
          <BotaoAcao
            tamanho="sm"
            variante="contorno"
            acao={() => alterarSituacaoUsuario(usuarioId, false)}
            confirmar={{
              titulo: `Desativar o acesso de ${nome}?`,
              descricao: "O login é bloqueado na hora e as sessões abertas são encerradas. O histórico é preservado e o acesso pode ser reativado depois.",
              textoConfirmar: "Desativar",
              perigo: true,
            }}
          >
            <PowerOff /> Desativar acesso
          </BotaoAcao>
        ) : (
          <BotaoAcao tamanho="sm" acao={() => alterarSituacaoUsuario(usuarioId, true)}>
            <Power /> Reativar acesso
          </BotaoAcao>
        )
      ) : null}
      {!proprio ? (
        <Confirmacao
          gatilho={
            <Button variante="fantasma" tamanho="sm" className="text-perigo">
              <UserX /> Anonimizar dados (LGPD)
            </Button>
          }
          titulo={`Anonimizar os dados de ${nome}?`}
          descricao="Use quando houver pedido de exclusão dos dados pessoais. Nome, e-mail e telefone são removidos e o acesso é bloqueado para sempre. Documentos e lançamentos da empresa continuam guardados pelo prazo legal. Não pode ser desfeito."
          textoConfirmar="Anonimizar"
          variante="perigo"
          aoConfirmar={async () => {
            const r = await anonimizarUsuario(usuarioId, motivo);
            if (!r.ok) {
              toast.error(r.mensagem);
              return false;
            }
            toast.success(r.mensagem);
            setMotivo("");
            router.refresh();
            return true;
          }}
        >
          <Campo rotulo="Motivo" htmlFor="anon-motivo" obrigatorio ajuda="Ex.: pedido de exclusão recebido em 02/10/2026.">
            <Textarea id="anon-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
        </Confirmacao>
      ) : null}

      <Dialog open={Boolean(link)} onOpenChange={(v) => !v && setLink(null)}>
        {link ? (
          <DialogContent titulo="Novo link de acesso" descricao="O e-mail não foi enviado (envio de e-mail não configurado). Compartilhe o link com a pessoa.">
            <LinkCompartilhavel link={link} nome={nome} />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

export interface VinculoUsuario {
  id: string;
  empresa_id: string;
  empresa_nome: string;
  papel: string;
  permissoes: Permissao[];
  ativo: boolean;
  convidado_em: string;
  revogado_em: string | null;
  motivo_revogacao: string | null;
}

/** Empresas às quais o usuário está vinculado, com edição de permissões e revogação. */
export function VinculosUsuario({
  usuario,
  vinculos,
  editavel,
}: {
  usuario: { id: string; nome: string; email: string; ultimo_acesso_em: string | null };
  vinculos: VinculoUsuario[];
  editavel: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<VinculoUsuario | null>(null);
  const [revogando, setRevogando] = useState<VinculoUsuario | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pendente, iniciar] = useTransition();
  const [mostrarRevogados, setMostrarRevogados] = useState(false);
  const lista = vinculos.filter((v) => mostrarRevogados || v.ativo);
  const revogados = vinculos.length - vinculos.filter((v) => v.ativo).length;

  const comoMembro = (v: VinculoUsuario): MembroLista => ({
    id: v.id,
    user_id: usuario.id,
    papel: v.papel,
    permissoes: v.permissoes,
    ativo: v.ativo,
    convidado_em: v.convidado_em,
    revogado_em: v.revogado_em,
    motivo_revogacao: v.motivo_revogacao,
    nome: `${usuario.nome} — ${v.empresa_nome}`,
    email: usuario.email,
    ultimo_acesso_em: usuario.ultimo_acesso_em,
    // (usado só para editar permissões; o WhatsApp é cadastrado na página da empresa)
    telefone: null,
    whatsapp_avisos: false,
  });

  return (
    <div className="space-y-3">
      {revogados ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={mostrarRevogados} onChange={(e) => setMostrarRevogados(e.target.checked)} />
          Mostrar vínculos revogados ({revogados})
        </label>
      ) : null}
      {lista.length ? (
        <Table>
          <THead>
            <tr>
              <Th>Empresa</Th>
              <Th>Papel</Th>
              <Th className="hidden sm:table-cell">Permissões</Th>
              <Th className="hidden md:table-cell">Desde</Th>
              {editavel ? <Th className="w-10" /> : null}
            </tr>
          </THead>
          <TBody>
            {lista.map((v) => (
              <Tr key={v.id}>
                <Td>
                  <Link href={`/escritorio/empresas/${v.empresa_id}?aba=usuarios`} className="font-medium text-titulo hover:underline">
                    {v.empresa_nome}
                  </Link>
                  {!v.ativo ? (
                    <p className="text-xs text-muted-foreground">
                      Revogado em {formatarData(v.revogado_em)}
                      {v.motivo_revogacao ? ` — ${v.motivo_revogacao}` : ""}
                    </p>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap text-sm">{ROTULO_PAPEL[v.papel] ?? v.papel}</Td>
                <Td className="hidden text-xs text-muted-foreground sm:table-cell">{v.permissoes.length} permissão(ões)</Td>
                <Td className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">{formatarData(v.convidado_em)}</Td>
                {editavel ? (
                  <Td className="text-right">
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
                    ) : (
                      <Badge variante="neutro">Revogado</Badge>
                    )}
                  </Td>
                ) : null}
              </Tr>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma empresa vinculada.</p>
      )}

      {editando ? <DialogPermissoes empresaId={editando.empresa_id} membro={comoMembro(editando)} ehCliente={false} aoFechar={() => setEditando(null)} /> : null}

      <Dialog open={Boolean(revogando)} onOpenChange={(v) => !v && setRevogando(null)}>
        {revogando ? (
          <DialogContent titulo={`Revogar o acesso à ${revogando.empresa_nome}`} descricao="O acesso a esta empresa é bloqueado imediatamente. O histórico é preservado.">
            <div className="space-y-4">
              <Campo rotulo="Motivo" htmlFor="motivo-vinculo" obrigatorio>
                <Textarea id="motivo-vinculo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
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
                      if (!r.ok) return void toast.error(r.mensagem);
                      toast.success(r.mensagem);
                      setRevogando(null);
                      setMotivo("");
                      router.refresh();
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

/** Vincula uma pessoa da equipe a várias empresas de uma vez. */
export function VincularEmpresas({ usuarioId, empresas }: { usuarioId: string; empresas: { id: string; nome: string; documento: string }[] }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [permissoes, setPermissoes] = useState<Set<Permissao>>(new Set(PERMISSOES_PADRAO.equipe));
  const acao = vincularEquipeEmpresas.bind(null, usuarioId);
  const termo = busca.trim().toLowerCase();
  const visiveis = empresas.filter((e) => !termo || e.nome.toLowerCase().includes(termo) || e.documento.includes(termo.replace(/\D/g, "") || "§"));

  // Com o formulário aberto, ele continua montado mesmo que a lista esvazie
  // após vincular (senão a confirmação de sucesso não aparece).
  if (!aberto) {
    if (!empresas.length) return <p className="text-sm text-muted-foreground">Esta pessoa já está vinculada a todas as empresas ativas.</p>;
    return (
      <Button variante="contorno" onClick={() => setAberto(true)}>
        Vincular a empresas
      </Button>
    );
  }
  return (
    <FormularioAcao
      acao={acao}
      aoSucesso={() => {
        setAberto(false);
        setMarcadas(new Set());
      }}
      className="space-y-4 rounded-lg border border-border p-4"
    >
      {({ pendente }) => (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Empresas ({marcadas.size} selecionada(s))</p>
              <div className="flex gap-2">
                <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setMarcadas(new Set([...marcadas, ...visiveis.map((e) => e.id)]))}>
                  Marcar todas
                </Button>
                <Button type="button" variante="fantasma" tamanho="sm" onClick={() => setMarcadas(new Set())}>
                  Limpar
                </Button>
              </div>
            </div>
            {empresas.length > 8 ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar empresas" className="pl-9" aria-label="Filtrar empresas" />
              </div>
            ) : null}
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {empresas.map((e) => (
                <label key={e.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted ${visiveis.includes(e) ? "" : "hidden"}`}>
                  <Checkbox
                    name="empresas"
                    value={e.id}
                    checked={marcadas.has(e.id)}
                    onChange={(ev) => {
                      const n = new Set(marcadas);
                      if (ev.target.checked) n.add(e.id);
                      else n.delete(e.id);
                      setMarcadas(n);
                    }}
                  />
                  <span className="min-w-0 truncate">{e.nome}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Permissões nestas empresas</p>
            <SeletorPermissoes selecionadas={permissoes} aoMudar={setPermissoes} apenasCliente={false} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoEnviar pendente={pendente} disabled={!marcadas.size} textoPendente="Vinculando...">
              Vincular {marcadas.size ? `(${marcadas.size})` : ""}
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
