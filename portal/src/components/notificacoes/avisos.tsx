"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellOff, BellRing, Loader2, Share, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BotaoAcao } from "@/components/ui/acao";
import { formatarData, formatarRelativo } from "@/lib/formatos";
import { enviarAvisoTeste, removerAparelho } from "@/lib/notificacoes/acoes-aparelhos";
import { ativarAvisos, desativarAvisos, enderecoDesteAparelho, estadoDoAparelho, type EstadoAparelho } from "./aparelho";

export interface AparelhoAvisos {
  id: string;
  endpoint: string;
  descricao: string | null;
  created_at: string;
  ultimo_envio_em: string | null;
}

function useEstadoAparelho(usuarioId: string, chavePublica: string | null) {
  const [estado, setEstado] = useState<EstadoAparelho>("carregando");
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    estadoDoAparelho(usuarioId, chavePublica)
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado("sem_suporte"));
    return () => {
      vivo = false;
    };
  }, [usuarioId, chavePublica, versao]);
  const atualizar = useCallback(() => setVersao((v) => v + 1), []);
  return { estado, atualizar };
}

function useAtivacao(usuarioId: string, chavePublica: string | null, aoMudar: () => void) {
  const router = useRouter();
  const [pendente, setPendente] = useState(false);
  async function executar(acao: () => Promise<{ ok: boolean; mensagem: string }>) {
    setPendente(true);
    try {
      const r = await acao();
      if (r.ok) toast.success(r.mensagem);
      else toast.error(r.mensagem);
    } catch {
      toast.error("O navegador não conseguiu ativar os avisos. Tente de novo em instantes.");
    } finally {
      setPendente(false);
      aoMudar();
      router.refresh();
    }
  }
  return {
    pendente,
    ativar: () => chavePublica && executar(() => ativarAvisos(usuarioId, chavePublica)),
    desativar: () => executar(desativarAvisos),
  };
}

/** Convite discreto no sino: aparece só enquanto o aparelho não recebe avisos. */
export function ConviteAvisos({ usuarioId, chavePublica, aoNavegar }: { usuarioId: string; chavePublica: string | null; aoNavegar: () => void }) {
  const { estado, atualizar } = useEstadoAparelho(usuarioId, chavePublica);
  const { pendente, ativar } = useAtivacao(usuarioId, chavePublica, atualizar);
  if (estado === "inativo") {
    return (
      <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3 py-2.5">
        <BellRing className="size-4 shrink-0 text-primary" aria-hidden />
        <p className="flex-1 text-xs text-muted-foreground">Receba estes avisos no celular ou no computador, mesmo com o portal fechado.</p>
        <Button tamanho="sm" onClick={ativar} disabled={pendente}>
          {pendente ? <Loader2 className="animate-spin" /> : null}
          Ativar
        </Button>
      </div>
    );
  }
  if (estado === "instalar_iphone") {
    return (
      <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3 py-2.5">
        <Smartphone className="size-4 shrink-0 text-primary" aria-hidden />
        <Link href="/conta#avisos" onClick={aoNavegar} className="flex-1 text-xs text-primary hover:underline">
          Como receber estes avisos no iPhone
        </Link>
      </div>
    );
  }
  return null;
}

const SITUACAO: Record<Exclude<EstadoAparelho, "carregando">, string> = {
  ativo: "Este aparelho recebe os seus avisos, mesmo com o portal fechado.",
  inativo: "Este aparelho ainda não recebe os avisos fora do portal.",
  bloqueado:
    "As notificações deste site estão bloqueadas neste navegador. Para liberar: toque no cadeado (ou nos “três pontinhos”) ao lado do endereço do site → Notificações → Permitir. Depois volte aqui e toque em “Ativar neste aparelho”.",
  instalar_iphone: "No iPhone e no iPad, os avisos só funcionam com o portal instalado na Tela de Início.",
  sem_suporte: "Este navegador não recebe notificações de sites. Use o Chrome, o Edge, o Firefox ou o Safari atualizados.",
  nao_configurado:
    "As notificações no aparelho ainda não foram ligadas no servidor do portal. Enquanto isso, os avisos continuam aparecendo no sino.",
};

/** Ativação neste aparelho, aviso de teste e lista dos aparelhos (Minha conta). */
export function AvisosNoAparelho({ usuarioId, chavePublica, aparelhos }: { usuarioId: string; chavePublica: string | null; aparelhos: AparelhoAvisos[] }) {
  const { estado, atualizar } = useEstadoAparelho(usuarioId, chavePublica);
  const { pendente, ativar, desativar } = useAtivacao(usuarioId, chavePublica, atualizar);
  const [endereco, setEndereco] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    enderecoDesteAparelho()
      .then((e) => vivo && setEndereco(e))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [estado]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3">
        <p className="flex items-start gap-2 text-sm">
          {estado === "ativo" ? <BellRing className="mt-0.5 size-4 shrink-0 text-sucesso" aria-hidden /> : <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span>{estado === "carregando" ? "Verificando este aparelho…" : SITUACAO[estado]}</span>
        </p>
        {estado === "instalar_iphone" ? (
          <ol className="mt-2 list-decimal space-y-1 pl-9 text-sm text-muted-foreground">
            <li>Abra o portal no Safari.</li>
            <li>
              Toque em Compartilhar <Share className="inline size-3.5 align-[-2px]" aria-label="(ícone de compartilhar)" /> e depois em “Adicionar à Tela de Início”.
            </li>
            <li>Abra o portal pelo novo ícone, entre com seu e-mail e senha e volte a esta página.</li>
            <li>Toque em “Ativar neste aparelho” e permita as notificações. (Requer iOS 16.4 ou mais recente.)</li>
          </ol>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {estado === "inativo" ? (
            <Button onClick={ativar} disabled={pendente}>
              {pendente ? <Loader2 className="animate-spin" /> : <BellRing />}
              Ativar neste aparelho
            </Button>
          ) : null}
          {estado === "ativo" ? (
            <>
              <BotaoAcao acao={enviarAvisoTeste} variante="contorno">
                Enviar aviso de teste
              </BotaoAcao>
              <Button variante="fantasma" onClick={desativar} disabled={pendente}>
                {pendente ? <Loader2 className="animate-spin" /> : <BellOff />}
                Desativar neste aparelho
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {aparelhos.length ? (
        <div>
          <p className="mb-2 text-sm font-medium">Aparelhos que recebem seus avisos</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {aparelhos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {a.descricao ?? "Aparelho"} {a.endpoint === endereco ? <Badge variante="info">este aparelho</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ativado em {formatarData(a.created_at)}
                    {a.ultimo_envio_em ? ` · último aviso ${formatarRelativo(a.ultimo_envio_em)}` : ""}
                  </p>
                </div>
                <BotaoAcao
                  acao={() => removerAparelho({ id: a.id })}
                  aoSucesso={atualizar}
                  variante="fantasma"
                  tamanho="sm"
                  confirmar={{
                    titulo: "Parar de enviar avisos para este aparelho?",
                    descricao: "Você pode ativar de novo a qualquer momento, abrindo o portal nele.",
                    textoConfirmar: "Remover",
                    perigo: true,
                  }}
                >
                  <Trash2 /> Remover
                </BotaoAcao>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Ao sair do portal num aparelho, ele para de receber os avisos até você entrar de novo.
          </p>
        </div>
      ) : null}
    </div>
  );
}
