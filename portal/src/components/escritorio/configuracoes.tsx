"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUp, MailCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Confirmacao } from "@/components/ui/dialog";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";
import { formatarCep, formatarCnpj, formatarCompetencia, formatarData, formatarTelefone } from "@/lib/formatos";
import {
  enviarLogo,
  expurgarDocumentos,
  removerLogo,
  responderPedidoLgpd,
  salvarDadosEscritorio,
  salvarLembretes,
  salvarRetencao,
  salvarSeguranca,
  testarEmail,
} from "@/lib/escritorio/acoes";

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
  nome_sistema: string;
  descricao_sistema: string;
  mensagem_login: string;
}

export function FormDadosEscritorio({ esc }: { esc: DadosEscritorio }) {
  return (
    <FormularioAcao acao={salvarDadosEscritorio} className="space-y-6">
      {({ estado, pendente }) => {
        const erro = (k: string) => estado.erros?.[k];
        return (
          <>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold text-titulo">Empresa</legend>
              <Campo rotulo="Nome fantasia" htmlFor="es-fantasia" erro={erro("nome_fantasia")} obrigatorio>
                <Input id="es-fantasia" name="nome_fantasia" defaultValue={esc.nome_fantasia} />
              </Campo>
              <Campo rotulo="Razão social" htmlFor="es-razao" erro={erro("razao_social")} obrigatorio>
                <Input id="es-razao" name="razao_social" defaultValue={esc.razao_social} />
              </Campo>
              <Campo rotulo="CNPJ" htmlFor="es-cnpj" erro={erro("cnpj")} obrigatorio>
                <Input id="es-cnpj" name="cnpj" defaultValue={formatarCnpj(esc.cnpj)} inputMode="numeric" />
              </Campo>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-6">
              <legend className="mb-2 text-sm font-semibold text-titulo">Endereço</legend>
              <Campo rotulo="Logradouro" htmlFor="es-log" erro={erro("logradouro")} className="sm:col-span-4">
                <Input id="es-log" name="logradouro" defaultValue={esc.logradouro ?? ""} />
              </Campo>
              <Campo rotulo="Número" htmlFor="es-num" erro={erro("numero")} className="sm:col-span-2">
                <Input id="es-num" name="numero" defaultValue={esc.numero ?? ""} />
              </Campo>
              <Campo rotulo="Complemento" htmlFor="es-comp" erro={erro("complemento")} className="sm:col-span-2">
                <Input id="es-comp" name="complemento" defaultValue={esc.complemento ?? ""} />
              </Campo>
              <Campo rotulo="Bairro" htmlFor="es-bairro" erro={erro("bairro")} className="sm:col-span-2">
                <Input id="es-bairro" name="bairro" defaultValue={esc.bairro ?? ""} />
              </Campo>
              <Campo rotulo="CEP" htmlFor="es-cep" erro={erro("cep")} className="sm:col-span-2">
                <Input id="es-cep" name="cep" defaultValue={esc.cep ? formatarCep(esc.cep) : ""} inputMode="numeric" />
              </Campo>
              <Campo rotulo="Cidade" htmlFor="es-cidade" erro={erro("cidade")} className="sm:col-span-4">
                <Input id="es-cidade" name="cidade" defaultValue={esc.cidade ?? ""} />
              </Campo>
              <Campo rotulo="UF" htmlFor="es-uf" erro={erro("uf")} className="sm:col-span-2">
                <Input id="es-uf" name="uf" defaultValue={esc.uf ?? ""} maxLength={2} className="uppercase" />
              </Campo>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold text-titulo">Contatos (aparecem na tela de entrada e nos relatórios)</legend>
              <Campo rotulo="E-mail" htmlFor="es-email" erro={erro("email")}>
                <Input id="es-email" name="email" type="email" defaultValue={esc.email ?? ""} />
              </Campo>
              <Campo rotulo="Telefone" htmlFor="es-tel" erro={erro("telefone")}>
                <Input id="es-tel" name="telefone" defaultValue={esc.telefone ? formatarTelefone(esc.telefone) : ""} inputMode="tel" />
              </Campo>
              <Campo rotulo="WhatsApp" htmlFor="es-wpp" erro={erro("whatsapp")} ajuda="Número para os clientes falarem com o escritório.">
                <Input id="es-wpp" name="whatsapp" defaultValue={esc.whatsapp ? formatarTelefone(esc.whatsapp) : ""} inputMode="tel" />
              </Campo>
              <Campo rotulo="Site" htmlFor="es-site" erro={erro("site")}>
                <Input id="es-site" name="site" defaultValue={esc.site ?? ""} placeholder="https://" />
              </Campo>
              <Campo rotulo="Instagram" htmlFor="es-insta" erro={erro("instagram")} ajuda="Somente o usuário, sem @.">
                <Input id="es-insta" name="instagram" defaultValue={esc.instagram ?? ""} />
              </Campo>
            </fieldset>
            <fieldset className="grid gap-4">
              <legend className="mb-2 text-sm font-semibold text-titulo">Portal</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Nome do portal" htmlFor="es-sistema" erro={erro("nome_sistema")} obrigatorio>
                  <Input id="es-sistema" name="nome_sistema" defaultValue={esc.nome_sistema} maxLength={60} />
                </Campo>
                <Campo rotulo="Descrição curta" htmlFor="es-desc" erro={erro("descricao_sistema")} obrigatorio>
                  <Input id="es-desc" name="descricao_sistema" defaultValue={esc.descricao_sistema} maxLength={160} />
                </Campo>
              </div>
              <Campo rotulo="Mensagem da tela de entrada" htmlFor="es-msg" erro={erro("mensagem_login")} obrigatorio>
                <Textarea id="es-msg" name="mensagem_login" defaultValue={esc.mensagem_login} rows={3} maxLength={400} />
              </Campo>
            </fieldset>
            <div className="flex justify-end">
              <BotaoEnviar pendente={pendente}>Salvar dados do escritório</BotaoEnviar>
            </div>
          </>
        );
      }}
    </FormularioAcao>
  );
}

export function FormLogo({ logoUrl }: { logoUrl: string | null }) {
  const [previa, setPrevia] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-56 items-center justify-center rounded-lg border border-dashed border-border bg-muted p-3">
          {previa || logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previa ?? logoUrl ?? ""}
              alt={previa ? "Prévia da nova logomarca" : "Logomarca atual"}
              className="max-h-full max-w-full object-contain"
              onError={() => setPrevia(null)}
            />
          ) : (
            <span className="text-xs text-muted-foreground">Usando a logomarca provisória</span>
          )}
        </div>
        {logoUrl && !previa ? (
          <BotaoAcao variante="fantasma" tamanho="sm" acao={() => removerLogo()} confirmar={{ titulo: "Remover a logomarca?", descricao: "O portal volta a usar a logomarca provisória.", textoConfirmar: "Remover" }}>
            <Trash2 /> Remover
          </BotaoAcao>
        ) : null}
      </div>
      <FormularioAcao acao={enviarLogo} resetarAoSucesso aoSucesso={() => setPrevia(null)} className="flex flex-wrap items-end gap-3">
        {({ estado, pendente }) => (
          <>
            <Campo rotulo="Nova logomarca" htmlFor="es-logo" erro={estado.erros?.logo} ajuda="PNG ou JPG, até 2 MB. Prefira fundo transparente (PNG) e formato horizontal.">
              <Input
                id="es-logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setPrevia(f && (f.type === "image/png" || f.type === "image/jpeg") ? URL.createObjectURL(f) : null);
                }}
              />
            </Campo>
            <BotaoEnviar pendente={pendente} textoPendente="Enviando...">
              <ImageUp /> Enviar logomarca
            </BotaoEnviar>
          </>
        )}
      </FormularioAcao>
    </div>
  );
}

export function FormSeguranca({
  esc,
}: {
  esc: { exigir_2fa_equipe: boolean; exigir_2fa_clientes: boolean; upload_tamanho_maximo_mb: number; zip_max_arquivos: number; zip_max_tamanho_mb: number };
}) {
  const router = useRouter();
  return (
    <FormularioAcao acao={salvarSeguranca} aoSucesso={() => router.refresh()} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-titulo">Verificação em duas etapas obrigatória</legend>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="exigir_2fa_equipe" defaultChecked={esc.exigir_2fa_equipe} className="mt-0.5" />
              <span>
                <span className="font-medium">Para a equipe do escritório (recomendado)</span>
                <span className="block text-xs text-muted-foreground">Quem ainda não cadastrou o aplicativo autenticador será levado ao cadastro no próximo acesso — inclusive você.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox name="exigir_2fa_clientes" defaultChecked={esc.exigir_2fa_clientes} className="mt-0.5" />
              <span>
                <span className="font-medium">Para os clientes</span>
                <span className="block text-xs text-muted-foreground">Aumenta a proteção, mas exige que cada cliente instale um aplicativo autenticador no celular.</span>
              </span>
            </label>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-titulo">Limites de envio de arquivos</legend>
            <Campo rotulo="Tamanho máximo por arquivo (MB)" htmlFor="es-up" erro={estado.erros?.upload_tamanho_maximo_mb}>
              <Input id="es-up" name="upload_tamanho_maximo_mb" type="number" min={1} max={500} defaultValue={esc.upload_tamanho_maximo_mb} />
            </Campo>
            <Campo rotulo="Arquivos por ZIP" htmlFor="es-zipn" erro={estado.erros?.zip_max_arquivos}>
              <Input id="es-zipn" name="zip_max_arquivos" type="number" min={1} max={20000} defaultValue={esc.zip_max_arquivos} />
            </Campo>
            <Campo rotulo="Tamanho máximo do ZIP descompactado (MB)" htmlFor="es-zipt" erro={estado.erros?.zip_max_tamanho_mb}>
              <Input id="es-zipt" name="zip_max_tamanho_mb" type="number" min={1} max={2000} defaultValue={esc.zip_max_tamanho_mb} />
            </Campo>
          </fieldset>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar segurança</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormLembretes({
  esc,
  whatsappToken,
}: {
  esc: {
    lembretes_dias: number[];
    lembretes_email_ativo: boolean;
    lembretes_whatsapp_ativo: boolean;
    whatsapp_phone_number_id: string | null;
    whatsapp_template_lembrete: string | null;
    whatsapp_template_idioma: string;
  };
  whatsappToken: boolean;
}) {
  const dias = esc.lembretes_dias.map((d) => (d > 0 ? `+${d}` : String(d))).join(", ");
  return (
    <FormularioAcao acao={salvarLembretes} className="space-y-6">
      {({ estado, pendente }) => (
        <>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-titulo">Quando avisar</legend>
            <Campo
              rotulo="Dias em relação ao prazo do documento"
              htmlFor="es-dias"
              erro={estado.erros?.lembretes_dias}
              ajuda="Negativo = antes do prazo, 0 = no dia, positivo = depois. Ex.: -5, -2, 0, +2, +5"
            >
              <div>
                <Input id="es-dias" name="lembretes_dias" defaultValue={dias} className="max-w-sm" />
              </div>
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="lembretes_email_ativo" defaultChecked={esc.lembretes_email_ativo} /> Enviar lembretes por e-mail
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="lembretes_whatsapp_ativo" defaultChecked={esc.lembretes_whatsapp_ativo} /> Enviar lembretes por WhatsApp (quando a integração estiver conectada)
            </label>
            <p className="text-xs text-muted-foreground">Os lembretes também aparecem no sino de avisos do portal. Clientes que desativarem os avisos nas preferências não recebem.</p>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold text-titulo">
              WhatsApp Business (API oficial da Meta){" "}
              {whatsappToken ? <Badge variante="info">token cadastrado</Badge> : <Badge variante="neutro">sem token</Badge>}
            </legend>
            <Campo rotulo="Identificador do número (Phone Number ID)" htmlFor="es-wid" erro={estado.erros?.whatsapp_phone_number_id}>
              <Input id="es-wid" name="whatsapp_phone_number_id" defaultValue={esc.whatsapp_phone_number_id ?? ""} inputMode="numeric" />
            </Campo>
            <Campo rotulo="Nome do modelo aprovado" htmlFor="es-wtpl" erro={estado.erros?.whatsapp_template_lembrete} ajuda="Modelo com 4 variáveis: {{1}} empresa, {{2}} mês, {{3}} quantidade de documentos pendentes e {{4}} link do portal.">
              <Input id="es-wtpl" name="whatsapp_template_lembrete" defaultValue={esc.whatsapp_template_lembrete ?? ""} />
            </Campo>
            <Campo rotulo="Idioma do modelo" htmlFor="es-widioma" erro={estado.erros?.whatsapp_template_idioma}>
              <Input id="es-widioma" name="whatsapp_template_idioma" defaultValue={esc.whatsapp_template_idioma} />
            </Campo>
          </fieldset>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar lembretes</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function BotaoTestarEmail() {
  return (
    <BotaoAcao tamanho="sm" variante="contorno" acao={() => testarEmail()}>
      <MailCheck /> Enviar e-mail de teste para mim
    </BotaoAcao>
  );
}

export function ResponderPedido({ pedidoId, statusAtual }: { pedidoId: string; statusAtual: string }) {
  const [aberto, setAberto] = useState(false);
  const acao = responderPedidoLgpd.bind(null, pedidoId);
  if (!aberto) {
    return (
      <Button tamanho="sm" variante={statusAtual === "aberta" ? "primario" : "contorno"} onClick={() => setAberto(true)}>
        {statusAtual === "aberta" ? "Responder" : "Atualizar resposta"}
      </Button>
    );
  }
  return (
    <FormularioAcao acao={acao} aoSucesso={() => setAberto(false)} className="mt-2 space-y-3 rounded-lg border border-border p-3">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Situação" htmlFor={`lg-st-${pedidoId}`} erro={estado.erros?.status}>
            <Select id={`lg-st-${pedidoId}`} name="status" defaultValue={statusAtual === "aberta" ? "concluida" : statusAtual}>
              <option value="em_andamento">Em andamento</option>
              <option value="concluida">Concluído (atendido)</option>
              <option value="recusada">Não atendido (explique o motivo)</option>
            </Select>
          </Campo>
          <Campo rotulo="Resposta ao titular" htmlFor={`lg-rs-${pedidoId}`} erro={estado.erros?.resposta} ajuda="O titular vê esta resposta em Minha conta e recebe um aviso.">
            <Textarea id={`lg-rs-${pedidoId}`} name="resposta" rows={3} maxLength={4000} />
          </Campo>
          <div className="flex justify-end gap-2">
            <Button type="button" variante="fantasma" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoEnviar pendente={pendente}>Enviar resposta</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function FormRetencao({
  padrao,
  categorias,
}: {
  padrao: number;
  categorias: { codigo: string; nome: string; grupo: string; anos: number | null; observacao: string | null }[];
}) {
  return (
    <FormularioAcao acao={salvarRetencao} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <Campo
            rotulo="Prazo padrão de guarda (anos)"
            htmlFor="es-ret"
            erro={estado.erros?.retencao_padrao_anos}
            ajuda="Contado a partir do mês seguinte à competência do documento. Vale para as categorias sem prazo próprio."
          >
            <div>
              <Input id="es-ret" name="retencao_padrao_anos" type="number" min={1} max={50} defaultValue={padrao} className="max-w-32" />
            </div>
          </Campo>
          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Prazos por tipo de documento ({categorias.filter((c) => c.anos !== null).length} com prazo próprio)</summary>
            <Table className="border-0">
              <THead>
                <tr>
                  <Th>Tipo de documento</Th>
                  <Th className="w-36">Anos (vazio = padrão)</Th>
                </tr>
              </THead>
              <TBody>
                {categorias.map((c) => (
                  <Tr key={c.codigo}>
                    <Td>
                      <p className="text-sm">{c.nome}</p>
                      {c.observacao ? <p className="text-xs text-muted-foreground">{c.observacao}</p> : null}
                    </Td>
                    <Td>
                      <Input name={`anos:${c.codigo}`} type="number" min={1} max={50} defaultValue={c.anos ?? ""} placeholder={String(padrao)} aria-label={`Anos de guarda para ${c.nome}`} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </details>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar prazos</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function ListaExpurgo({
  documentos,
}: {
  documentos: { documento_id: string; empresa_nome: string; categoria_codigo: string; competencia: string; nome_original: string; anos_retencao: number; vence_em: string }[];
}) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [motivo, setMotivo] = useState("");
  const todos = documentos.length > 0 && marcados.size === documentos.length;
  return (
    <div className="space-y-3">
      <Table>
        <THead>
          <tr>
            <Th className="w-8">
              <Checkbox aria-label="Marcar todos" checked={todos} onChange={(e) => setMarcados(e.target.checked ? new Set(documentos.map((d) => d.documento_id)) : new Set())} />
            </Th>
            <Th>Documento</Th>
            <Th className="hidden sm:table-cell">Empresa</Th>
            <Th className="hidden md:table-cell">Competência</Th>
            <Th>Guardar até</Th>
          </tr>
        </THead>
        <TBody>
          {documentos.map((d) => (
            <Tr key={d.documento_id}>
              <Td>
                <Checkbox
                  aria-label={`Marcar ${d.nome_original}`}
                  checked={marcados.has(d.documento_id)}
                  onChange={(e) => {
                    const n = new Set(marcados);
                    if (e.target.checked) n.add(d.documento_id);
                    else n.delete(d.documento_id);
                    setMarcados(n);
                  }}
                />
              </Td>
              <Td className="max-w-64 truncate text-sm" title={d.nome_original}>
                {d.nome_original}
              </Td>
              <Td className="hidden text-sm sm:table-cell">{d.empresa_nome}</Td>
              <Td className="hidden text-sm md:table-cell">{formatarCompetencia(d.competencia)}</Td>
              <Td className="whitespace-nowrap text-sm">
                {formatarData(d.vence_em)} <span className="text-xs text-muted-foreground">({d.anos_retencao} anos)</span>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <div className="flex justify-end">
        <Confirmacao
          gatilho={
            <Button variante="perigo" disabled={!marcados.size}>
              <Trash2 /> Eliminar {marcados.size ? `${marcados.size} documento(s)` : "selecionados"}
            </Button>
          }
          titulo={`Eliminar ${marcados.size} documento(s) definitivamente?`}
          descricao="Os arquivos são apagados do armazenamento e não podem ser recuperados. Fica guardado apenas o registro de que existiram e de quem autorizou a eliminação."
          textoConfirmar="Eliminar definitivamente"
          variante="perigo"
          aoConfirmar={async () => {
            const r = await expurgarDocumentos([...marcados], motivo);
            if (!r.ok) {
              toast.error(r.mensagem);
              return false;
            }
            toast.success(r.mensagem);
            setMarcados(new Set());
            setMotivo("");
            router.refresh();
            return true;
          }}
        >
          <Campo rotulo="Motivo" htmlFor="exp-motivo" obrigatorio ajuda="Ex.: prazo de guarda encerrado conforme a política do escritório.">
            <Textarea id="exp-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </Campo>
        </Confirmacao>
      </div>
    </div>
  );
}
