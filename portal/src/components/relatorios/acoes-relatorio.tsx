"use client";

import { useRouter } from "next/navigation";
import { RefreshCw, Send, Trash2 } from "lucide-react";
import { BotaoAcao, BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { Campo, Input, Select, Textarea } from "@/components/ui/form";
import { atualizarNumeros, criarRascunho, excluirRascunho, publicarRelatorio, salvarTextos } from "@/lib/relatorios/acoes";
import { cn } from "@/lib/utils";

type Opcao = { valor: string; rotulo: string };

export function FormNovoRelatorio({
  empresaId,
  tipos,
  opcoes,
  periodoInicial,
}: {
  empresaId: string;
  tipos: { valor: string; rotulo: string; descricao: string }[];
  opcoes: { meses: Opcao[]; trimestres: Opcao[]; anos: Opcao[]; doze: Opcao };
  periodoInicial: string;
}) {
  return (
    <FormularioAcao acao={criarRascunho.bind(null, empresaId)} className="space-y-5">
      {({ estado, pendente }) => (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Tipo de relatório</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {tipos.map((t, i) => (
                <label key={t.valor} className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-bege/50">
                  <input type="radio" name="tipo" value={t.valor} defaultChecked={i === 0} className="mt-1 size-4 accent-[var(--primary)]" />
                  <span>
                    <span className="block text-sm font-medium">{t.rotulo}</span>
                    <span className="block text-xs text-muted-foreground">{t.descricao}</span>
                  </span>
                </label>
              ))}
            </div>
            {estado.erros?.tipo ? <p className="text-sm text-perigo">{estado.erros.tipo[0]}</p> : null}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Período" htmlFor="rel-periodo" erro={estado.erros?.periodo} obrigatorio>
              <Select id="rel-periodo" name="periodo" defaultValue={periodoInicial.startsWith("12m") ? "12m" : periodoInicial}>
                <optgroup label="Mês">
                  {opcoes.meses.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Trimestre">
                  {opcoes.trimestres.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Ano">
                  {opcoes.anos.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Outros">
                  <option value={opcoes.doze.valor}>{opcoes.doze.rotulo}</option>
                </optgroup>
              </Select>
            </Campo>
            <Campo rotulo="Título (opcional)" htmlFor="rel-titulo" ajuda="Se ficar em branco, usamos o tipo e o período." erro={estado.erros?.titulo}>
              <Input id="rel-titulo" name="titulo" maxLength={160} />
            </Campo>
          </div>
          <p className="text-sm text-muted-foreground">
            O rascunho guarda os números de agora. Você revisa o texto, acrescenta comentários e só então publica — o cliente não vê rascunhos.
          </p>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente} textoPendente="Calculando os números...">
              Gerar rascunho
            </BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function EditarTextos({
  empresaId,
  relatorioId,
  titulo,
  resumo,
  comentarios,
}: {
  empresaId: string;
  relatorioId: string;
  titulo: string;
  resumo: string;
  comentarios: string;
}) {
  return (
    <FormularioAcao acao={salvarTextos.bind(null, empresaId, relatorioId)} className="space-y-4">
      {({ estado, pendente }) => (
        <>
          <Campo rotulo="Título" htmlFor="ed-titulo" erro={estado.erros?.titulo} obrigatorio>
            <Input id="ed-titulo" name="titulo" defaultValue={titulo} maxLength={160} />
          </Campo>
          <Campo
            rotulo="Resumo para o cliente"
            htmlFor="ed-resumo"
            ajuda="Começa com o resumo automático. Ajuste a linguagem como preferir; deixe uma linha em branco entre parágrafos."
            erro={estado.erros?.resumo}
          >
            <Textarea id="ed-resumo" name="resumo" defaultValue={resumo} rows={9} maxLength={8000} />
          </Campo>
          <Campo rotulo="Comentários do contador (opcional)" htmlFor="ed-coment" ajuda="Orientações, alertas e próximos passos." erro={estado.erros?.comentarios}>
            <Textarea id="ed-coment" name="comentarios" defaultValue={comentarios} rows={5} maxLength={8000} />
          </Campo>
          <div className="flex justify-end">
            <BotaoEnviar pendente={pendente}>Salvar rascunho</BotaoEnviar>
          </div>
        </>
      )}
    </FormularioAcao>
  );
}

export function AcoesRascunho({ empresaId, relatorioId, revisado, className }: { empresaId: string; relatorioId: string; revisado: boolean; className?: string }) {
  const router = useRouter();
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <BotaoAcao variante="contorno" acao={() => atualizarNumeros(empresaId, relatorioId)}>
        <RefreshCw /> Atualizar números
      </BotaoAcao>
      <BotaoAcao
        variante="perigo"
        acao={() => excluirRascunho(empresaId, relatorioId)}
        aoSucesso={() => router.push(`/e/${empresaId}/relatorios/publicados`)}
        confirmar={{ titulo: "Excluir este rascunho?", descricao: "O rascunho será apagado. Relatórios já publicados não são afetados.", textoConfirmar: "Excluir", perigo: true }}
      >
        <Trash2 /> Excluir rascunho
      </BotaoAcao>
      <BotaoAcao
        acao={() => publicarRelatorio(empresaId, relatorioId)}
        confirmar={{
          titulo: "Publicar para o cliente?",
          descricao: revisado
            ? "O período está fechado: o relatório será publicado como REVISADO. Os responsáveis pela empresa recebem um aviso no portal."
            : "O período ainda não está fechado: o relatório será publicado como PRELIMINAR (os números podem mudar). Os responsáveis pela empresa recebem um aviso no portal.",
          textoConfirmar: "Publicar",
        }}
      >
        <Send /> Publicar
      </BotaoAcao>
    </div>
  );
}
