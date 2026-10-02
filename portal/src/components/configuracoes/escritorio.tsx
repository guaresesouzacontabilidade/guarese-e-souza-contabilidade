"use client";

import { useState } from "react";
import { ImageUp, Save, Trash2 } from "lucide-react";
import { Campo, Checkbox, Input, Textarea } from "@/components/ui/form";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { formatarCep, formatarCnpj, formatarTelefone } from "@/lib/formatos";
import {
  enviarLogo,
  removerLogo,
  salvarDadosEscritorio,
  salvarLembretes,
  salvarPortal,
  salvarSeguranca,
} from "@/app/(app)/escritorio/configuracoes/acoes";

type Erros = Record<string, string[] | undefined> | undefined;

function CampoTexto({
  nome,
  rotulo,
  inicial,
  erros,
  obrigatorio,
  ajuda,
  className,
  ...props
}: {
  nome: string;
  rotulo: string;
  inicial?: string | number | null;
  erros: Erros;
  obrigatorio?: boolean;
  ajuda?: React.ReactNode;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "defaultValue">) {
  const id = `cfg-${nome}`;
  return (
    <Campo rotulo={rotulo} htmlFor={id} obrigatorio={obrigatorio} erro={erros?.[nome]} ajuda={ajuda} className={className}>
      <Input id={id} name={nome} defaultValue={inicial ?? ""} aria-invalid={Boolean(erros?.[nome])} {...props} />
    </Campo>
  );
}

function Opcao({ nome, rotulo, descricao, inicial }: { nome: string; rotulo: string; descricao?: string; inicial: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
      <Checkbox name={nome} defaultChecked={inicial} className="mt-0.5" />
      <span>
        <span className="font-medium">{rotulo}</span>
        {descricao ? <span className="block text-xs text-muted-foreground">{descricao}</span> : null}
      </span>
    </label>
  );
}

function Rodape({ pendente, texto = "Salvar alterações" }: { pendente: boolean; texto?: string }) {
  return (
    <div className="flex justify-end">
      <BotaoEnviar pendente={pendente}>
        <Save /> {texto}
      </BotaoEnviar>
    </div>
  );
}

export interface DadosEscritorio {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  site: string | null;
  instagram: string | null;
}

export function FormularioDadosEscritorio({ inicial }: { inicial: DadosEscritorio }) {
  return (
    <FormularioAcao acao={salvarDadosEscritorio} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CampoTexto nome="nome_fantasia" rotulo="Nome fantasia" inicial={inicial.nome_fantasia} erros={estado.erros} obrigatorio />
            <CampoTexto nome="razao_social" rotulo="Razão social" inicial={inicial.razao_social} erros={estado.erros} obrigatorio className="lg:col-span-2" />
            <CampoTexto nome="cnpj" rotulo="CNPJ" inicial={formatarCnpj(inicial.cnpj)} erros={estado.erros} obrigatorio inputMode="numeric" placeholder="00.000.000/0000-00" />
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-titulo">Endereço</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              <CampoTexto nome="logradouro" rotulo="Logradouro" inicial={inicial.logradouro} erros={estado.erros} className="lg:col-span-3" />
              <CampoTexto nome="numero" rotulo="Número" inicial={inicial.numero} erros={estado.erros} />
              <CampoTexto nome="complemento" rotulo="Complemento" inicial={inicial.complemento} erros={estado.erros} className="lg:col-span-2" />
              <CampoTexto nome="bairro" rotulo="Bairro" inicial={inicial.bairro} erros={estado.erros} className="lg:col-span-2" />
              <CampoTexto nome="cidade" rotulo="Cidade" inicial={inicial.cidade} erros={estado.erros} className="lg:col-span-2" />
              <CampoTexto nome="uf" rotulo="UF" inicial={inicial.uf} erros={estado.erros} maxLength={2} />
              <CampoTexto nome="cep" rotulo="CEP" inicial={inicial.cep ? formatarCep(inicial.cep) : ""} erros={estado.erros} inputMode="numeric" />
            </div>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-titulo">Contato e redes</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <CampoTexto nome="email" rotulo="E-mail" type="email" inicial={inicial.email} erros={estado.erros} />
              <CampoTexto nome="telefone" rotulo="Telefone" inicial={inicial.telefone} erros={estado.erros} />
              <CampoTexto
                nome="whatsapp"
                rotulo="WhatsApp de atendimento"
                inicial={inicial.whatsapp ? formatarTelefone(inicial.whatsapp) : ""}
                erros={estado.erros}
                inputMode="tel"
                ajuda="Exibido aos clientes como canal de contato."
              />
              <CampoTexto nome="site" rotulo="Site" inicial={inicial.site} erros={estado.erros} placeholder="https://" />
              <CampoTexto nome="instagram" rotulo="Instagram" inicial={inicial.instagram} erros={estado.erros} placeholder="@perfil" />
            </div>
          </section>
          <Rodape pendente={pendente} />
        </>
      )}
    </FormularioAcao>
  );
}

export function FormularioPortal({ inicial }: { inicial: { nome_sistema: string; descricao_sistema: string; mensagem_login: string } }) {
  return (
    <FormularioAcao acao={salvarPortal} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <CampoTexto nome="nome_sistema" rotulo="Nome do portal" inicial={inicial.nome_sistema} erros={estado.erros} obrigatorio maxLength={80} />
          <CampoTexto
            nome="descricao_sistema"
            rotulo="Descrição curta"
            inicial={inicial.descricao_sistema}
            erros={estado.erros}
            obrigatorio
            maxLength={200}
            ajuda="Aparece abaixo do nome do portal na tela de entrada."
          />
          <Campo rotulo="Mensagem de boas-vindas (tela de entrada)" htmlFor="cfg-mensagem_login" obrigatorio erro={estado.erros?.mensagem_login}>
            <Textarea id="cfg-mensagem_login" name="mensagem_login" rows={4} maxLength={600} defaultValue={inicial.mensagem_login} />
          </Campo>
          <Rodape pendente={pendente} />
        </>
      )}
    </FormularioAcao>
  );
}

export function EnviarLogo({ temLogo }: { temLogo: boolean }) {
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <FormularioAcao acao={enviarLogo} resetarAoSucesso aoSucesso={() => setNomeArquivo(null)} className="space-y-3">
        {({ estado, pendente }) => (
          <>
            <Campo
              rotulo="Arquivo da logomarca"
              htmlFor="cfg-logo"
              erro={estado.erros?.logo}
              ajuda="PNG, JPG, WEBP ou SVG, até 2 MB. Prefira fundo transparente e formato horizontal."
            >
              <Input
                id="cfg-logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="h-auto py-2"
                onChange={(e) => setNomeArquivo(e.target.files?.[0]?.name ?? null)}
              />
            </Campo>
            <div className="flex flex-wrap justify-end gap-2">
              <BotaoEnviar pendente={pendente} textoPendente="Enviando..." disabled={!nomeArquivo}>
                <ImageUp /> Enviar logomarca
              </BotaoEnviar>
            </div>
          </>
        )}
      </FormularioAcao>
      {temLogo ? (
        <div className="flex justify-end">
          <BotaoAcao
            variante="fantasma"
            acao={removerLogo}
            confirmar={{
              titulo: "Remover a logomarca?",
              descricao: "O portal volta a exibir a logomarca provisória.",
              textoConfirmar: "Remover",
              perigo: true,
            }}
          >
            <Trash2 /> Remover logomarca
          </BotaoAcao>
        </div>
      ) : null}
    </div>
  );
}

export function FormularioSeguranca({
  inicial,
}: {
  inicial: { exigir_2fa_equipe: boolean; exigir_2fa_clientes: boolean; upload_tamanho_maximo_mb: number; zip_max_arquivos: number; zip_max_tamanho_mb: number };
}) {
  return (
    <FormularioAcao acao={salvarSeguranca} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-titulo">Verificação em duas etapas (2FA)</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <Opcao
                nome="exigir_2fa_equipe"
                rotulo="Exigir 2FA da equipe do escritório"
                descricao="Administradores e equipe só acessam após cadastrar e confirmar o código do aplicativo autenticador."
                inicial={inicial.exigir_2fa_equipe}
              />
              <Opcao
                nome="exigir_2fa_clientes"
                rotulo="Exigir 2FA dos clientes"
                descricao="Empresários e colaboradores precisarão cadastrar o 2FA no próximo acesso."
                inicial={inicial.exigir_2fa_clientes}
              />
            </div>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-titulo">Limites de envio de documentos</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoTexto nome="upload_tamanho_maximo_mb" rotulo="Tamanho máximo por arquivo (MB)" type="number" min={1} max={500} inicial={inicial.upload_tamanho_maximo_mb} erros={estado.erros} />
              <CampoTexto nome="zip_max_arquivos" rotulo="Arquivos por ZIP (máximo)" type="number" min={1} max={20000} inicial={inicial.zip_max_arquivos} erros={estado.erros} />
              <CampoTexto nome="zip_max_tamanho_mb" rotulo="Tamanho máximo do ZIP (MB)" type="number" min={1} max={2000} inicial={inicial.zip_max_tamanho_mb} erros={estado.erros} />
            </div>
          </section>
          <Rodape pendente={pendente} />
        </>
      )}
    </FormularioAcao>
  );
}

export function FormularioLembretes({
  inicial,
}: {
  inicial: {
    lembretes_dias: number[];
    lembretes_email_ativo: boolean;
    lembretes_whatsapp_ativo: boolean;
    whatsapp_phone_number_id: string | null;
    whatsapp_template_lembrete: string | null;
    whatsapp_template_idioma: string;
  };
}) {
  return (
    <FormularioAcao acao={salvarLembretes} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-titulo">Lembretes automáticos de documentos</h3>
            <CampoTexto
              nome="lembretes_dias"
              rotulo="Dias de envio em relação ao prazo"
              inicial={inicial.lembretes_dias.join(", ")}
              erros={estado.erros}
              placeholder="-5, -2, 0, 2, 5"
              ajuda="Números negativos = dias antes do prazo; 0 = no dia; positivos = dias após (atraso). Deixe vazio para não enviar lembretes automáticos."
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Opcao
                nome="lembretes_email_ativo"
                rotulo="Enviar lembretes por e-mail"
                descricao="Além do aviso no portal, os clientes recebem o lembrete no e-mail (exige SMTP configurado)."
                inicial={inicial.lembretes_email_ativo}
              />
              <Opcao
                nome="lembretes_whatsapp_ativo"
                rotulo="Enviar lembretes por WhatsApp"
                descricao="Para os contatos marcados para receber lembretes. Exige a API oficial do WhatsApp configurada."
                inicial={inicial.lembretes_whatsapp_ativo}
              />
            </div>
          </section>
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-titulo">WhatsApp Business (API oficial da Meta)</h3>
            <p className="text-xs text-muted-foreground">
              O token de acesso fica somente na variável de ambiente do servidor (WHATSAPP_TOKEN) e nunca é exibido ou gravado no banco.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <CampoTexto nome="whatsapp_phone_number_id" rotulo="Phone Number ID" inicial={inicial.whatsapp_phone_number_id} erros={estado.erros} inputMode="numeric" autoComplete="off" />
              <CampoTexto
                nome="whatsapp_template_lembrete"
                rotulo="Modelo (template) de lembrete"
                inicial={inicial.whatsapp_template_lembrete}
                erros={estado.erros}
                autoComplete="off"
                ajuda="Nome do modelo aprovado na Meta."
              />
              <CampoTexto nome="whatsapp_template_idioma" rotulo="Idioma do modelo" inicial={inicial.whatsapp_template_idioma} erros={estado.erros} placeholder="pt_BR" />
            </div>
          </section>
          <Rodape pendente={pendente} />
        </>
      )}
    </FormularioAcao>
  );
}
