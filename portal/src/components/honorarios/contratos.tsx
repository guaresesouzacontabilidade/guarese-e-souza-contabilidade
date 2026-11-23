"use client";

import * as React from "react";
import { Ban, FilePenLine, FileSignature, FileX2, Mail, PenLine } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Campo, Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { Alerta } from "@/components/ui/feedback";
import { assinarContrato, cancelarContrato, gerarAditivo, gerarContrato, gerarDistrato, pedirCodigoContrato } from "@/lib/honorarios/acoes-contratos";

function Erro({ estado }: { estado: { ok: boolean; mensagem?: string } }) {
  return estado.mensagem && !estado.ok ? <Alerta tom="perigo">{estado.mensagem}</Alerta> : null;
}

function CamposOpcoes({ foro }: { foro: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Aviso prévio para encerrar" htmlFor="ct-aviso">
          <Select id="ct-aviso" name="aviso_previo_dias" defaultValue="30">
            <option value="30">30 dias</option>
            <option value="60">60 dias</option>
            <option value="90">90 dias</option>
          </Select>
        </Campo>
        <Campo rotulo="Documentos até o dia" htmlFor="ct-dia" ajuda="do mês seguinte">
          <Select id="ct-dia" name="dia_documentos" defaultValue="5">
            {Array.from({ length: 20 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Dia {d}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo rotulo="Foro (comarca)" htmlFor="ct-foro">
          <Input id="ct-foro" name="foro" defaultValue={foro} maxLength={80} />
        </Campo>
      </div>
      <Campo rotulo="Cláusula adicional (opcional)" htmlFor="ct-adicional" ajuda="Entra antes do foro. Linha em branco separa parágrafos.">
        <Textarea id="ct-adicional" name="adicional" rows={3} maxLength={4000} />
      </Campo>
    </>
  );
}

/** Gera o contrato pela ficha do cliente (os serviços marcados, valores e extras). */
export function GerarContrato({ empresaId, foro, rotulo = "Gerar contrato" }: { empresaId: string; foro: string; rotulo?: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <FileSignature /> {rotulo}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          largura="lg"
          titulo="Gerar contrato pela ficha"
          descricao="O texto sai com os serviços marcados na ficha, o valor, o vencimento, os extras, o 13º e o reajuste, e com as cláusulas exigidas pela Resolução CFC nº 1.590/2020. Você confere antes de enviar."
        >
          <FormularioAcao acao={gerarContrato.bind(null, empresaId)} manterAoErrar className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <CamposOpcoes foro={foro} />
                <Erro estado={estado} />
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Gerando...">
                    <FileSignature /> Gerar e conferir
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

export function GerarAditivo({ contratoId, foro, mesAtual }: { contratoId: string; foro: string; mesAtual: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="contorno" onClick={() => setAberto(true)}>
        <FilePenLine /> Gerar aditivo
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Aditivo pelas mudanças da ficha" descricao="Compara a ficha atual do cliente com o que foi assinado e escreve só o que mudou (valor, vencimento, serviços, extras, 13º, reajuste).">
          <FormularioAcao acao={gerarAditivo.bind(null, contratoId)} manterAoErrar className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <input type="hidden" name="foro" value={foro} />
                <Campo rotulo="Vale a partir de (competência)" htmlFor="ad-vig">
                  <Input id="ad-vig" name="vigencia" type="month" defaultValue={mesAtual.slice(0, 7)} />
                </Campo>
                <Erro estado={estado} />
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Gerando...">
                    Gerar aditivo
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

export function GerarDistrato({ contratoId, hoje, mesAnterior }: { contratoId: string; hoje: string; mesAnterior: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="fantasma" onClick={() => setAberto(true)}>
        <FileX2 /> Gerar distrato
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Distrato (encerramento)" descricao="Conforme a Resolução CFC nº 1.590/2020: fim das responsabilidades, obrigações das competências do contrato e devolução dos documentos.">
          <FormularioAcao acao={gerarDistrato.bind(null, contratoId)} manterAoErrar className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Campo rotulo="Encerra em" htmlFor="di-fim" erro={estado.erros?.data_fim}>
                    <Input id="di-fim" name="data_fim" type="date" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Última competência do escritório" htmlFor="di-ult" erro={estado.erros?.ultima_competencia}>
                    <Input id="di-ult" name="ultima_competencia" type="month" defaultValue={mesAnterior.slice(0, 7)} />
                  </Campo>
                  <Campo rotulo="Devolver documentos em (dias)" htmlFor="di-prazo" erro={estado.erros?.prazo_devolucao_dias}>
                    <Input id="di-prazo" name="prazo_devolucao_dias" inputMode="numeric" defaultValue="30" />
                  </Campo>
                </div>
                <Erro estado={estado} />
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} textoPendente="Gerando...">
                    Gerar distrato
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

export function CancelarContrato({ id }: { id: string }) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <Button variante="fantasma" onClick={() => setAberto(true)}>
        <Ban /> Cancelar
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent titulo="Cancelar este documento?" descricao="Ele continua na lista como cancelado e o cliente não consegue mais assinar.">
          <FormularioAcao acao={cancelarContrato.bind(null, id)} aoSucesso={() => setAberto(false)} className="space-y-4">
            {({ estado, pendente }) => (
              <>
                <Campo rotulo="Motivo" htmlFor="ct-motivo" erro={estado.erros?.motivo} obrigatorio>
                  <Textarea id="ct-motivo" name="motivo" rows={3} maxLength={300} />
                </Campo>
                <Erro estado={estado} />
                <div className="flex justify-end">
                  <BotaoEnviar pendente={pendente} variante="perigo">
                    Cancelar documento
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

/** Cliente: confirma nome, CPF e (com o e-mail ligado) o código enviado ao e-mail. */
export function AssinarContrato({ id, hash, comCodigo, nome }: { id: string; hash: string; comCodigo: boolean; nome: string }) {
  return (
    <FormularioAcao acao={assinarContrato.bind(null, id)} manterAoErrar className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <input type="hidden" name="hash" value={hash} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Seu nome completo" htmlFor="as-nome" erro={estado.erros?.nome} obrigatorio>
              <Input id="as-nome" name="nome" defaultValue={nome} maxLength={150} autoComplete="name" />
            </Campo>
            <Campo rotulo="Seu CPF" htmlFor="as-cpf" erro={estado.erros?.cpf} obrigatorio>
              <Input id="as-cpf" name="cpf" inputMode="numeric" maxLength={14} autoComplete="off" />
            </Campo>
          </div>
          {comCodigo ? (
            <div className="flex flex-wrap items-end gap-2">
              <Campo rotulo="Código enviado ao seu e-mail" htmlFor="as-codigo" erro={estado.erros?.codigo} obrigatorio className="w-48">
                <Input id="as-codigo" name="codigo" inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
              </Campo>
              <BotaoAcao variante="contorno" acao={() => pedirCodigoContrato(id)}>
                <Mail /> Enviar código
              </BotaoAcao>
            </div>
          ) : (
            <Alerta tom="info">O e-mail do portal está desconectado: a assinatura usa o seu acesso ao portal (senha) e os dados acima.</Alerta>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox name="li" />
            <span>Li o documento inteiro e concordo com os termos, assinando em nome da empresa.</span>
          </label>
          {estado.erros?.li ? <p className="text-xs text-perigo">{estado.erros.li[0]}</p> : null}
          <Erro estado={estado} />
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Assinando...">
              <PenLine /> Assinar
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}
