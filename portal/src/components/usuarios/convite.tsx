"use client";

import { useState } from "react";
import { Copy, MessageCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Campo, Input, Select } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { PERMISSOES_PADRAO, type Permissao } from "@/lib/permissoes";
import type { ResultadoAcao } from "@/lib/acoes";
import { convidarUsuario, type DadosConvite } from "@/lib/usuarios/acoes";
import { SeletorPermissoes } from "./seletor-permissoes";

export function LinkCompartilhavel({ link, nome }: { link: string; nome?: string }) {
  const texto = `Olá${nome ? `, ${nome.split(" ")[0]}` : ""}! Este é o seu link de acesso ao Portal Guarese's ON (uso único): ${link}`;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
      <p className="text-xs text-muted-foreground">Link de acesso (uso único). Compartilhe somente com o convidado:</p>
      <code className="block break-all rounded bg-card p-2 text-xs">{link}</code>
      <div className="flex flex-wrap gap-2">
        <Button tamanho="sm" variante="contorno" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copiado."))}>
          <Copy /> Copiar link
        </Button>
        <Button tamanho="sm" variante="contorno" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> Enviar pelo WhatsApp
          </a>
        </Button>
      </div>
    </div>
  );
}

/**
 * Convite de usuário. Com empresaId: convida cliente (titular/colaborador).
 * Sem empresaId: convida pessoa da equipe (somente administrador).
 */
export function ConvidarUsuario({
  empresaId,
  podeTitular = true,
  limitePermissoes,
  rotuloBotao = "Convidar usuário",
}: {
  empresaId?: string;
  podeTitular?: boolean;
  limitePermissoes?: Permissao[];
  rotuloBotao?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ehEquipe = !empresaId;
  const papelInicial = ehEquipe ? "equipe" : podeTitular ? "cliente_titular" : "cliente_colaborador";
  const [papel, setPapel] = useState<string>(papelInicial);
  const [tipo, setTipo] = useState<string>("equipe");
  const limite = limitePermissoes ? new Set(limitePermissoes) : undefined;
  const padrao = (p: string) =>
    new Set((PERMISSOES_PADRAO[p as keyof typeof PERMISSOES_PADRAO] ?? []).filter((x) => !limite || limite.has(x)) as Permissao[]);
  const [permissoes, setPermissoes] = useState<Set<Permissao>>(padrao(papelInicial));
  const [resultado, setResultado] = useState<{ link?: string; nome?: string } | null>(null);

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setResultado(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> {rotuloBotao}
        </Button>
      </DialogTrigger>
      <DialogContent
        largura="lg"
        titulo={ehEquipe ? "Convidar pessoa da equipe" : "Convidar usuário para a empresa"}
        descricao="O convidado recebe um link para definir a própria senha. Senhas nunca são armazenadas pelo portal."
      >
        {resultado ? (
          <div className="space-y-4">
            <Alerta tom="sucesso">Convite registrado.</Alerta>
            {resultado.link ? <LinkCompartilhavel link={resultado.link} nome={resultado.nome} /> : null}
            <div className="flex justify-end">
              <Button variante="contorno" onClick={() => setResultado(null)}>
                Convidar outra pessoa
              </Button>
            </div>
          </div>
        ) : (
          <FormularioAcao
            acao={convidarUsuario as (a: ResultadoAcao, f: FormData) => Promise<ResultadoAcao>}
            resetarAoSucesso
            aoSucesso={(e) => {
              const d = e.dados as DadosConvite | undefined;
              if (d?.link && !d.emailEnviado) setResultado({ link: d.link });
              else setAberto(false);
            }}
            className="space-y-4"
          >
            {({ estado, pendente }) => (
              <>
                {empresaId ? <input type="hidden" name="empresa_id" value={empresaId} /> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Nome" htmlFor="convite-nome" obrigatorio erro={estado.erros?.nome}>
                    <Input id="convite-nome" name="nome" autoComplete="off" />
                  </Campo>
                  <Campo rotulo="E-mail" htmlFor="convite-email" obrigatorio erro={estado.erros?.email}>
                    <Input id="convite-email" name="email" type="email" autoComplete="off" />
                  </Campo>
                  {ehEquipe ? (
                    <Campo rotulo="Perfil" htmlFor="convite-tipo">
                      <Select id="convite-tipo" name="tipo_usuario" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                        <option value="equipe">Equipe contábil</option>
                        <option value="admin">Administrador do escritório</option>
                      </Select>
                    </Campo>
                  ) : (
                    <>
                      <input type="hidden" name="tipo_usuario" value="cliente" />
                      <Campo rotulo="Papel na empresa" htmlFor="convite-papel">
                        <Select
                          id="convite-papel"
                          name="papel"
                          value={papel}
                          onChange={(e) => {
                            setPapel(e.target.value);
                            setPermissoes(padrao(e.target.value));
                          }}
                        >
                          {podeTitular ? <option value="cliente_titular">Cliente empresário (titular)</option> : null}
                          <option value="cliente_colaborador">Colaborador do cliente</option>
                        </Select>
                      </Campo>
                    </>
                  )}
                </div>
                {!ehEquipe ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Permissões nesta empresa</p>
                    <SeletorPermissoes selecionadas={permissoes} aoMudar={setPermissoes} apenasCliente limite={limite} />
                  </div>
                ) : (
                  <Alerta tom="info">
                    Depois do convite, vincule a pessoa às empresas que ela poderá acessar (página da empresa → Usuários, ou Equipe e permissões).
                    {tipo === "admin" ? " Administradores acessam todas as empresas." : ""}
                  </Alerta>
                )}
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Enviando convite...">
                    <UserPlus /> Enviar convite
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        )}
      </DialogContent>
    </Dialog>
  );
}
