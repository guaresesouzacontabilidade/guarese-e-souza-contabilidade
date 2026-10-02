"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input, Select } from "@/components/ui/form";
import { dec, formatarMoeda } from "@/lib/dinheiro";
import { formatarCompetencia, formatarData } from "@/lib/formatos";
import { classificarMovimento } from "@/lib/conciliacao/acoes";

export interface OpcoesClassificacao {
  categorias: { id: string; codigo: string; nome: string; natureza: string }[];
  contrapartes: { id: string; nome: string }[];
  centros: { id: string; nome: string }[];
  documentos: { id: string; nome: string; competencia: string; categoria: string }[];
}

/**
 * Movimentação sem lançamento correspondente (ex.: tarifa, pagamento sem
 * boleto cadastrado): cria o lançamento já pago e concilia de uma vez.
 */
export function ClassificarMovimento({
  empresaId,
  movimento,
  opcoes,
  aoFechar,
}: {
  empresaId: string;
  movimento: { id: string; data: string; valor: string; descricao: string; conta_nome: string };
  opcoes: OpcoesClassificacao;
  aoFechar: () => void;
}) {
  const entrada = dec(movimento.valor).isPositive();
  const natureza = entrada ? "receita" : "despesa";
  const categorias = opcoes.categorias.filter((c) => c.natureza === natureza);
  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent
        largura="lg"
        titulo="Classificar movimentação"
        descricao={`${formatarData(movimento.data)} · ${movimento.conta_nome} · ${formatarMoeda(movimento.valor, { sinal: true })} — cria o lançamento já ${entrada ? "recebido" : "pago"} e concilia.`}
      >
        <FormularioAcao acao={classificarMovimento.bind(null, empresaId)} aoSucesso={aoFechar} className="space-y-4">
          {({ estado, pendente }) => (
            <>
              <input type="hidden" name="movimento_id" value={movimento.id} />
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">No extrato: </span>
                <span className="font-medium">{movimento.descricao}</span>
              </p>
              <Campo rotulo={`Categoria de ${natureza}`} htmlFor="cl-categoria" erro={estado.erros?.categoria_id} obrigatorio>
                <Select id="cl-categoria" name="categoria_id" defaultValue="" required>
                  <option value="">Selecione...</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} · {c.nome}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo rotulo="Descrição do lançamento" htmlFor="cl-descricao" erro={estado.erros?.descricao}>
                <Input id="cl-descricao" name="descricao" defaultValue={movimento.descricao} maxLength={300} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo={entrada ? "Cliente / pagador (opcional)" : "Fornecedor / favorecido (opcional)"} htmlFor="cl-contraparte">
                  <Select id="cl-contraparte" name="contraparte_id" defaultValue="">
                    <option value="">Não informar</option>
                    {opcoes.contrapartes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo
                  rotulo="Data de competência"
                  htmlFor="cl-competencia"
                  ajuda="Quando a receita ou despesa aconteceu (padrão: data do extrato)."
                  erro={estado.erros?.data_competencia}
                >
                  <Input id="cl-competencia" name="data_competencia" type="date" defaultValue={movimento.data} />
                </Campo>
              </div>
              {opcoes.centros.length ? (
                <Campo rotulo="Centro de custo (opcional)" htmlFor="cl-centro">
                  <Select id="cl-centro" name="centro_custo_id" defaultValue="">
                    <option value="">Não informar</option>
                    {opcoes.centros.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </Select>
                </Campo>
              ) : null}
              <Campo
                rotulo="Comprovante (opcional)"
                htmlFor="cl-documento"
                ajuda="Documentos enviados nos últimos meses que ainda não estão ligados a nenhum lançamento."
              >
                <Select id="cl-documento" name="documento_id" defaultValue="">
                  <option value="">Sem comprovante</option>
                  {opcoes.documentos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome} · {d.categoria} · {formatarCompetencia(d.competencia)}
                    </option>
                  ))}
                </Select>
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} textoPendente="Classificando...">
                  Classificar e conciliar
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}
