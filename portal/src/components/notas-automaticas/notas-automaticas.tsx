"use client";

import * as React from "react";
import { BadgeCheck, CalendarRange, FileDown, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import {
  apagarNotasAnteriores,
  buscarNotasAgora,
  cadastrarCertificado,
  confirmarOperacoes,
  definirMesInicial,
  pedirXmlCompletos,
  pedirXmlCompletosCarteira,
  removerCertificado,
  salvarPreferenciasNotas,
} from "@/lib/notas-automaticas/acoes";
import { formatarMoeda } from "@/lib/dinheiro";
import { formatarData } from "@/lib/formatos";

export type OpcaoMes = { valor: string; rotulo: string };

const AJUDA_MES =
  "Notas emitidas antes deste mês não são trazidas. Na SEFAZ, as NF-e (produtos) ficam disponíveis por cerca de 3 meses; as NFS-e (serviços), por mais tempo.";

function OpcoesMes({ meses }: { meses: OpcaoMes[] }) {
  return (
    <>
      {meses.map((m) => (
        <option key={m.valor} value={m.valor}>
          {m.rotulo}
        </option>
      ))}
      <option value="tudo">Tudo o que estiver disponível</option>
    </>
  );
}

/**
 * Cadastro (ou troca) do certificado A1. A senha vai só para o servidor abrir o arquivo; não é guardada.
 * No primeiro cadastro escolhe-se o mês inicial da busca (padrão: o mês anterior).
 */
export function FormCertificado({
  empresaId,
  textoAutorizacao,
  troca = false,
  meses = [],
  mesPadrao,
}: {
  empresaId: string;
  textoAutorizacao: string;
  troca?: boolean;
  meses?: OpcaoMes[];
  mesPadrao?: string;
}) {
  const [aberto, setAberto] = React.useState(!troca);
  const formulario = (
    <FormularioAcao acao={cadastrarCertificado.bind(null, empresaId)} resetarAoSucesso aoSucesso={() => troca && setAberto(false)} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Campo rotulo="Arquivo do certificado A1" htmlFor="cert-arquivo" erro={estado.erros?.arquivo} ajuda="Arquivo .pfx ou .p12 do e-CNPJ da empresa." obrigatorio>
              <Input id="cert-arquivo" name="arquivo" type="file" accept=".pfx,.p12,application/x-pkcs12" />
            </Campo>
            <Campo rotulo="Senha do certificado" htmlFor="cert-senha" erro={estado.erros?.senha} ajuda="Usada só para abrir o arquivo agora; o portal não guarda a senha." obrigatorio>
              <Input id="cert-senha" name="senha" type="password" autoComplete="off" />
            </Campo>
            {!troca && meses.length ? (
              <Campo rotulo="Trazer notas a partir de" htmlFor="cert-desde" erro={estado.erros?.buscar_desde} ajuda={AJUDA_MES}>
                <Select id="cert-desde" name="buscar_desde" defaultValue={mesPadrao}>
                  <OpcoesMes meses={meses} />
                </Select>
              </Campo>
            ) : null}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="autorizacao" className="mt-0.5" />
            <span>{textoAutorizacao}</span>
          </label>
          {estado.erros?.autorizacao ? <p className="text-sm text-perigo">{estado.erros.autorizacao[0]}</p> : null}
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Conferindo o certificado...">
              <KeyRound /> {troca ? "Trocar certificado" : "Cadastrar certificado"}
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
  if (!troca) return formulario;
  return (
    <>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <KeyRound /> Trocar certificado
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Trocar o certificado A1" descricao="Use quando o certificado for renovado. O anterior é apagado do portal." largura="lg">
          {formulario}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RemoverCertificado({ empresaId }: { empresaId: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="perigo" onClick={() => setAberto(true)}>
        <Trash2 /> Remover certificado
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo="Remover o certificado?"
          descricao="A busca automática é desligada e o certificado guardado é apagado do portal. As notas já trazidas continuam em Documentos."
        >
          <FormularioAcao acao={removerCertificado.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ pendente }) => (
              <>
                <Campo rotulo="Motivo (opcional)" htmlFor="cert-motivo">
                  <Textarea id="cert-motivo" name="motivo" rows={2} maxLength={500} />
                </Campo>
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo">
                    Remover certificado
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PreferenciasNotas({
  empresaId,
  nfe,
  nfse,
  ciencia,
  pausada,
}: {
  empresaId: string;
  nfe: boolean;
  nfse: boolean;
  ciencia: boolean;
  pausada: boolean;
}) {
  return (
    <FormularioAcao acao={salvarPreferenciasNotas.bind(null, empresaId)} className="space-y-3">
      {({ pendente }) => (
        <>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="nfe" defaultChecked={nfe} className="mt-0.5" />
            <span>
              <span className="font-medium">NF-e recebidas (SEFAZ)</span>
              <span className="block text-xs text-muted-foreground">Notas em que a empresa é destinatária ou autorizada a baixar o XML, e os cancelamentos delas.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="nfse" defaultChecked={nfse} className="mt-0.5" />
            <span>
              <span className="font-medium">NFS-e (Ambiente Nacional)</span>
              <span className="block text-xs text-muted-foreground">Notas de serviço emitidas e tomadas pela empresa, dos municípios ligados ao padrão nacional.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="ciencia" defaultChecked={ciencia} className="mt-0.5" />
            <span>
              <span className="font-medium">Registrar a ciência da emissão automaticamente</span>
              <span className="block text-xs text-muted-foreground">
                Sem a ciência, a SEFAZ entrega só o resumo das NF-e recebidas (fornecedor, valor e data). A ciência apenas informa que a empresa
                tomou conhecimento da nota — não confirma nem recusa a operação — e libera o XML completo, que o portal baixa sozinho.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="pausada" defaultChecked={pausada} className="mt-0.5" />
            <span>
              <span className="font-medium">Pausar a busca</span>
              <span className="block text-xs text-muted-foreground">O certificado continua guardado; nenhuma consulta é feita até tirar a pausa.</span>
            </span>
          </label>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar preferências</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function BotaoBuscarAgora({ empresaId }: { empresaId: string }) {
  return (
    <BotaoAcao acao={buscarNotasAgora.bind(null, empresaId)} variante="contorno">
      <RefreshCw /> Buscar agora
    </BotaoAcao>
  );
}

/** Mês inicial da busca (quem gerencia o certificado). */
export function MesInicialNotas({ empresaId, atual, meses }: { empresaId: string; atual: string | null; meses: OpcaoMes[] }) {
  return (
    <FormularioAcao acao={definirMesInicial.bind(null, empresaId)} className="flex flex-wrap items-end gap-3">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Trazer notas a partir de" htmlFor="mes-inicial" erro={estado.erros?.buscar_desde} ajuda={AJUDA_MES} className="min-w-0 flex-1 sm:max-w-md">
            <Select id="mes-inicial" name="buscar_desde" defaultValue={atual ? atual.slice(0, 7) : "tudo"}>
              <OpcoesMes meses={meses} />
            </Select>
          </Campo>
          <BotaoEnviar pendente={pendente} variante="contorno">
            <CalendarRange /> Salvar mês inicial
          </BotaoEnviar>
        </>
      )}
    </FormularioAcao>
  );
}

/** Administrador: apaga de vez as notas automáticas anteriores ao mês inicial. */
export function ApagarNotasAnteriores({ empresaId, quantidade, mesInicial }: { empresaId: string; quantidade: number; mesInicial: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="perigo" tamanho="sm" onClick={() => setAberto(true)}>
        <Trash2 /> Apagar notas anteriores
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo={`Apagar ${quantidade === 1 ? "1 arquivo anterior" : `${quantidade} arquivos anteriores`} a ${mesInicial}?`}
          descricao="Saem do portal, de vez: os XML trazidos pela busca automática antes do mês inicial, as notas lidas deles, os resumos de NF-e, os lançamentos sugeridos a partir dessas notas e os achados do auditor ainda não publicados. Nada muda na SEFAZ, na prefeitura nem no computador de ninguém."
          largura="lg"
        >
          <FormularioAcao acao={apagarNotasAnteriores.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Motivo" htmlFor="apagar-motivo" erro={estado.erros?.motivo} obrigatorio>
                  <Textarea id="apagar-motivo" name="motivo" rows={2} maxLength={500} placeholder="Ex.: começar a usar o portal a partir deste mês" />
                </Campo>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="confirmo" className="mt-0.5" />
                  <span>Entendo que a exclusão é definitiva (não há lixeira). As NFS-e podem voltar se o mês inicial recuar; as NF-e, não.</span>
                </label>
                {estado.erros?.confirmo ? <p className="text-sm text-perigo">{estado.erros.confirmo[0]}</p> : null}
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Apagando...">
                    <Trash2 /> Apagar de vez
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}

const CONFIRMAR_CIENCIA = {
  titulo: "Pedir os XML completos?",
  descricao:
    "O portal registra na SEFAZ a ciência da emissão das NF-e recebidas só em resumo. A ciência só informa que a empresa tomou conhecimento da nota — não confirma nem recusa a operação — e libera o XML completo. A partir daí, as próximas NF-e recebidas também terão a ciência registrada sozinhas (dá para desligar em “O que buscar”). A SEFAZ aceita a ciência até 10 dias depois da emissão da nota; para as mais antigas, peça o XML ao fornecedor.",
  textoConfirmar: "Pedir os XML",
};

/** Liga a ciência automática da empresa para a SEFAZ liberar o XML completo das NF-e só em resumo. */
export function BotaoPedirXml({ empresaId, pausada }: { empresaId: string; pausada?: boolean }) {
  return (
    <BotaoAcao
      acao={pedirXmlCompletos.bind(null, empresaId)}
      variante="contorno"
      tamanho="sm"
      confirmar={{
        ...CONFIRMAR_CIENCIA,
        descricao: pausada ? `${CONFIRMAR_CIENCIA.descricao} A busca, que está pausada, volta a funcionar.` : CONFIRMAR_CIENCIA.descricao,
      }}
    >
      <FileDown /> Pedir os XML completos
    </BotaoAcao>
  );
}

/** Escritório: liga a ciência automática nas empresas da carteira com certificado válido. */
export function BotaoPedirXmlCarteira() {
  return (
    <BotaoAcao
      acao={pedirXmlCompletosCarteira}
      variante="contorno"
      confirmar={{
        titulo: "Pedir os XML completos de todas as empresas?",
        descricao: `${CONFIRMAR_CIENCIA.descricao} Vale para todas as empresas com certificado digital válido; as que estão com a busca pausada continuam pausadas.`,
        textoConfirmar: "Pedir para todas",
      }}
    >
      <FileDown /> Pedir os XML de todas as empresas
    </BotaoAcao>
  );
}

export interface NotaParaConfirmar {
  chave: string;
  fornecedor: string | null;
  valor: number | null;
  emissao: string | null;
}

/**
 * Confirmação da operação (evento 210200) de uma ou várias notas: declaração
 * obrigatória — da própria empresa (cliente) ou de que o cliente autorizou (escritório).
 */
export function ConfirmarOperacao({
  empresaId,
  empresaNome,
  notas,
  equipe,
  rotulo,
}: {
  empresaId: string;
  empresaNome: string;
  notas: NotaParaConfirmar[];
  equipe: boolean;
  rotulo: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  const total = notas.reduce((t, n) => t + (n.valor ?? 0), 0);
  return (
    <>
      <Button variante="contorno" tamanho="sm" onClick={() => setAberto(true)}>
        <BadgeCheck /> {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          titulo={notas.length === 1 ? "Confirmar a operação desta nota?" : `Confirmar a operação de ${notas.length} notas?`}
          descricao="A confirmação da operação é uma declaração oficial da empresa na SEFAZ, feita com o certificado digital dela, de que recebeu a mercadoria ou o serviço da nota. Com ela, a SEFAZ libera o XML completo. Faça só para operações que realmente aconteceram: depois de registrada, não dá para desfazer pelo portal."
          largura="lg"
        >
          <FormularioAcao acao={confirmarOperacoes.bind(null, empresaId)} aoSucesso={() => setAberto(false)} className="space-y-3">
            {({ estado, pendente }) => (
              <>
                {notas.map((n) => (
                  <input key={n.chave} type="hidden" name="chave" value={n.chave} />
                ))}
                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Fornecedor</th>
                        <th className="px-3 py-1.5 font-medium">Emissão</th>
                        <th className="px-3 py-1.5 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notas.map((n) => (
                        <tr key={n.chave} className="border-t border-border">
                          <td className="px-3 py-1.5">{n.fornecedor ?? "—"}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{n.emissao ? formatarData(n.emissao.slice(0, 10)) : "—"}</td>
                          <td className="numero px-3 py-1.5 text-right whitespace-nowrap">{n.valor != null ? formatarMoeda(n.valor) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {notas.length > 1 ? (
                  <p className="text-sm">
                    Total das notas: <strong className="numero">{formatarMoeda(total)}</strong>
                  </p>
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox name="declaro" className="mt-0.5" />
                  <span>
                    {equipe
                      ? `O cliente ${empresaNome} confirmou ao escritório que recebeu as mercadorias ou os serviços ${notas.length === 1 ? "desta nota" : "destas notas"} e autorizou a confirmação da operação na SEFAZ.`
                      : `Declaro que ${empresaNome} recebeu as mercadorias ou os serviços ${notas.length === 1 ? "desta nota" : "destas notas"}.`}
                  </span>
                </label>
                {estado.erros?.declaro ? <p className="text-sm text-perigo">{estado.erros.declaro[0]}</p> : null}
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Pedindo...">
                    <BadgeCheck /> Confirmar a operação
                  </BotaoEnviar>
                </div>
              </>
            )}
          </FormularioAcao>
        </DialogContent>
      </Dialog>
    </>
  );
}
