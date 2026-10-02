"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { formatarTelefone } from "@/lib/formatos";
import { alterarSenha, encerrarOutrasSessoes, encerrarSessao, registrarMfaRemovido, salvarPerfil, salvarPreferencias, solicitarLgpd } from "@/lib/conta/acoes";

export function FormPerfil({ nome, telefone }: { nome: string; telefone: string | null }) {
  return (
    <FormularioAcao acao={salvarPerfil} className="grid gap-4 sm:grid-cols-2">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Nome" htmlFor="pf-nome" erro={estado.erros?.nome} obrigatorio>
            <Input id="pf-nome" name="nome" defaultValue={nome} autoComplete="name" maxLength={120} />
          </Campo>
          <Campo rotulo="Telefone / WhatsApp" htmlFor="pf-tel" erro={estado.erros?.telefone} ajuda="Com DDD. Usado apenas para contato do escritório.">
            <Input id="pf-tel" name="telefone" defaultValue={telefone ? formatarTelefone(telefone) : ""} autoComplete="tel" inputMode="tel" />
          </Campo>
          <div className="sm:col-span-2 flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export interface PreferenciasArquivos {
  admin: boolean;
  arquivos: "todas" | "responsavel" | "nenhuma";
  arquivosEmail: boolean;
}

export function FormAvisos({
  email,
  escritorio,
  whatsapp,
}: {
  email: boolean;
  escritorio?: PreferenciasArquivos;
  /** Somente clientes: avisos do escritório também por WhatsApp. */
  whatsapp?: { ativo: boolean; telefone: string | null };
}) {
  return (
    <FormularioAcao acao={salvarPreferencias} className="space-y-4">
      {({ pendente }) => (
        <>
          {escritorio ? (
            <div className="space-y-3">
              <Campo
                rotulo="Avisar quando um cliente enviar arquivos"
                htmlFor="pref-arquivos"
                ajuda="Vários arquivos seguidos da mesma empresa viram um único aviso (“enviou 5 arquivos”)."
              >
                <Select id="pref-arquivos" name="aviso_arquivos" defaultValue={escritorio.arquivos}>
                  <option value="todas">{escritorio.admin ? "De todas as empresas" : "De todas as empresas que acompanho"}</option>
                  <option value="responsavel">Só das empresas em que sou o contador responsável</option>
                  <option value="nenhuma">Não avisar</option>
                </Select>
              </Campo>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox name="aviso_arquivos_email" defaultChecked={escritorio.arquivosEmail} className="mt-0.5" />
                <span>
                  <span className="font-medium">Também mandar um resumo dos arquivos por e-mail</span>
                  <span className="block text-xs text-muted-foreground">
                    Enviado 10 minutos depois do primeiro arquivo, já contando os que chegarem nesse intervalo. Depende do servidor de e-mail estar configurado.
                  </span>
                </span>
              </label>
            </div>
          ) : null}
          {whatsapp ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="whatsapp_avisos" defaultChecked={whatsapp.ativo} className="mt-0.5" />
              <span>
                <span className="font-medium">Receber avisos por WhatsApp</span>
                <span className="block text-xs text-muted-foreground">
                  {whatsapp.telefone ? `No número ${formatarTelefone(whatsapp.telefone)}` : "Informe seu WhatsApp em “Seus dados” para ativar"}: novos documentos, mensagens e
                  solicitações do escritório. Vários avisos seguidos chegam numa única mensagem.
                </span>
              </span>
            </label>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="email_notificacoes" defaultChecked={email} className="mt-0.5" />
            <span>
              <span className="font-medium">Receber avisos por e-mail</span>
              <span className="block text-xs text-muted-foreground">
                {escritorio
                  ? "Avisos importantes do portal (por exemplo, documento recebido após o fechamento). Desmarcado, nenhum e-mail de aviso é enviado."
                  : "Novos documentos do escritório, pedidos de correção, respostas e relatórios publicados."}
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormSenha() {
  return (
    <FormularioAcao acao={alterarSenha} resetarAoSucesso atualizarAoSucesso={false} className="grid gap-4 sm:grid-cols-3">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Senha atual" htmlFor="sn-atual" erro={estado.erros?.atual} obrigatorio>
            <Input id="sn-atual" name="atual" type="password" autoComplete="current-password" />
          </Campo>
          <Campo rotulo="Nova senha" htmlFor="sn-nova" erro={estado.erros?.senha} ajuda="Mínimo de 10 caracteres, com maiúsculas, minúsculas e números." obrigatorio>
            <Input id="sn-nova" name="senha" type="password" autoComplete="new-password" />
          </Campo>
          <Campo rotulo="Repita a nova senha" htmlFor="sn-conf" erro={estado.erros?.confirmacao} obrigatorio>
            <Input id="sn-conf" name="confirmacao" type="password" autoComplete="new-password" />
          </Campo>
          <div className="sm:col-span-3 flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Trocando...">
              Trocar senha
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function RemoverMfa({ fatorId, obrigatorio }: { fatorId: string; obrigatorio: boolean }) {
  const router = useRouter();
  if (obrigatorio) {
    return <p className="text-xs text-muted-foreground">O escritório exige a verificação em duas etapas para o seu perfil, por isso ela não pode ser desativada.</p>;
  }
  return (
    <Confirmacao
      gatilho={
        <Button variante="contorno" tamanho="sm">
          <ShieldOff /> Desativar
        </Button>
      }
      titulo="Desativar a verificação em duas etapas?"
      descricao="Sua conta ficará protegida apenas pela senha. Recomendamos manter a verificação ativa."
      textoConfirmar="Desativar"
      variante="perigo"
      aoConfirmar={async () => {
        const supabase = criarClienteNavegador();
        const { error } = await supabase.auth.mfa.unenroll({ factorId: fatorId });
        if (error) {
          toast.error(/aal2|assurance/i.test(error.message) ? "Por segurança, entre novamente com o código do aplicativo antes de desativar." : "Não foi possível desativar.");
          return false;
        }
        await registrarMfaRemovido();
        toast.success("Verificação em duas etapas desativada.");
        router.refresh();
        return true;
      }}
    />
  );
}

export function BotaoEncerrarSessao({ sessaoId }: { sessaoId: string }) {
  return (
    <BotaoAcao tamanho="sm" variante="contorno" acao={() => encerrarSessao(sessaoId)} confirmar={{ titulo: "Encerrar esta sessão?", descricao: "O dispositivo precisará entrar novamente.", textoConfirmar: "Encerrar" }}>
      <LogOut /> Encerrar
    </BotaoAcao>
  );
}

export function BotaoEncerrarOutras() {
  return (
    <BotaoAcao
      tamanho="sm"
      variante="contorno"
      acao={() => encerrarOutrasSessoes()}
      confirmar={{ titulo: "Sair de todos os outros dispositivos?", descricao: "Use se esqueceu o portal aberto em outro computador ou celular.", textoConfirmar: "Encerrar as outras" }}
    >
      <LogOut /> Sair dos outros dispositivos
    </BotaoAcao>
  );
}

const TIPOS = [
  ["acesso", "Quero saber quais dados meus o portal guarda"],
  ["correcao", "Corrigir dados incorretos"],
  ["portabilidade", "Receber uma cópia dos meus dados"],
  ["anonimizacao", "Anonimizar dados desnecessários"],
  ["exclusao", "Excluir meus dados pessoais"],
  ["revogacao_consentimento", "Revogar um consentimento"],
  ["informacao", "Outra dúvida sobre privacidade"],
] as const;

export function FormLgpd() {
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <Button variante="contorno" onClick={() => setAberto(true)}>
        Fazer um pedido sobre meus dados
      </Button>
    );
  }
  return (
    <FormularioAcao acao={solicitarLgpd} resetarAoSucesso aoSucesso={() => setAberto(false)} className="space-y-3 rounded-lg border border-border p-4">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Tipo de pedido" htmlFor="lg-tipo" erro={estado.erros?.tipo} obrigatorio>
            <Select id="lg-tipo" name="tipo" defaultValue="acesso">
              {TIPOS.map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </Select>
          </Campo>
          <Campo rotulo="Descreva o pedido" htmlFor="lg-desc" erro={estado.erros?.descricao} obrigatorio>
            <Textarea id="lg-desc" name="descricao" rows={3} maxLength={4000} />
          </Campo>
          <p className="text-xs text-muted-foreground">
            Documentos fiscais e contábeis da empresa podem precisar ser guardados pelo prazo exigido em lei mesmo após um pedido de exclusão; nesses
            casos o escritório explica o motivo na resposta.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoEnviar pendente={pendente}>Enviar pedido</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
