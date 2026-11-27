"use client";

import * as React from "react";
import Link from "next/link";
import { PawPrint, Search } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Campo, Input, Textarea } from "@/components/ui/form";
import { BotaoEnviar, FormularioAcao } from "@/components/ui/acao";
import { EstadoVazio } from "@/components/ui/feedback";
import type { ResultadoAcao } from "@/lib/acoes";
import { ESPECIES } from "@/lib/veterinaria/rotulos";

/** Tela mostrada quando a empresa não usa a clínica (ou a pessoa não tem acesso). */
export function ClinicaIndisponivel({ empresaId, equipe, ativa }: { empresaId: string; equipe: boolean; ativa: boolean }) {
  if (ativa) {
    return (
      <EstadoVazio
        icone={PawPrint}
        titulo="Você não tem acesso à clínica"
        descricao="Peça ao responsável pela empresa para liberar a permissão “Vender no caixa” (recepção e veterinários) ou “Gerenciar a loja” (responsável) para você."
      />
    );
  }
  return (
    <EstadoVazio
      icone={PawPrint}
      titulo="Gestão da clínica veterinária não contratada"
      descricao="Serviço opcional do escritório para clínicas e consultórios veterinários: agenda, prontuário, receitas, vacinas com lembretes, atestados e contas — tudo ligado à contabilidade. Fale com o escritório para aderir."
      acao={
        equipe ? (
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/configuracoes`}>Ligar a gestão da clínica</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/** Aviso para quem não é veterinário ligado ao próprio usuário (os atos clínicos são assinados por ele). */
export function AvisoSemVeterinario({ gerente, empresaId }: { gerente: boolean; empresaId: string }) {
  return (
    <p className="rounded-lg border border-alerta/40 bg-alerta/10 px-3 py-2 text-sm">
      Prontuário, receitas, vacinas aplicadas e atestados são registrados pelo médico-veterinário com o próprio usuário.{" "}
      {gerente ? (
        <>
          Ligue o seu usuário ao seu CRMV em{" "}
          <Link href={`/e/${empresaId}/veterinaria/configuracoes`} className="font-medium underline">
            Configurações da clínica
          </Link>
          .
        </>
      ) : (
        "Peça ao responsável pela clínica para ligar o seu usuário ao seu CRMV."
      )}
    </p>
  );
}

/** Pede o motivo e executa a ação (cancelar, estornar...). */
export function DialogoMotivo({
  acao,
  titulo,
  descricao,
  rotuloBotao,
  textoConfirmar = "Confirmar",
  variante = "fantasma",
  tamanho = "sm",
  icone,
}: {
  acao: (a: ResultadoAcao, fd: FormData) => Promise<ResultadoAcao>;
  titulo: string;
  descricao?: string;
  rotuloBotao: string;
  textoConfirmar?: string;
  variante?: ButtonProps["variante"];
  tamanho?: ButtonProps["tamanho"];
  icone?: React.ReactNode;
}) {
  const [aberto, setAberto] = React.useState(false);
  const id = React.useId();
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variante={variante} tamanho={tamanho}>
          {icone} {rotuloBotao}
        </Button>
      </DialogTrigger>
      <DialogContent titulo={titulo} descricao={descricao}>
        <FormularioAcao acao={acao} aoSucesso={() => setAberto(false)} className="space-y-4">
          {({ pendente }) => (
            <>
              <Campo rotulo="Motivo" htmlFor={`${id}-motivo`} obrigatorio>
                <Textarea id={`${id}-motivo`} name="motivo" rows={3} maxLength={300} required />
              </Campo>
              <div className="flex justify-end">
                <BotaoEnviar pendente={pendente} variante="perigo" textoPendente="Aguarde...">
                  {textoConfirmar}
                </BotaoEnviar>
              </div>
            </>
          )}
        </FormularioAcao>
      </DialogContent>
    </Dialog>
  );
}

export interface PacienteBusca {
  id: string;
  nome: string;
  especie: string;
  tutor: string;
  tutor_id: string;
}

/**
 * Escolha do animal com busca (nome do animal, do tutor, CPF, telefone ou
 * microchip). Grava o id no campo escondido `name`.
 */
export function BuscaPaciente({
  empresaId,
  name = "paciente_id",
  inicial,
  aoEscolher,
  erro,
}: {
  empresaId: string;
  name?: string;
  inicial?: PacienteBusca | null;
  aoEscolher?: (p: PacienteBusca | null) => void;
  erro?: string | string[];
}) {
  const [escolhido, setEscolhido] = React.useState<PacienteBusca | null>(inicial ?? null);
  const [busca, setBusca] = React.useState("");
  const [lista, setLista] = React.useState<PacienteBusca[]>([]);
  const [carregando, setCarregando] = React.useState(false);
  const id = React.useId();

  const buscando = !escolhido && busca.trim().length >= 2;
  const resultados = buscando ? lista : [];

  React.useEffect(() => {
    if (!buscando) return;
    const controle = new AbortController();
    const t = setTimeout(async () => {
      setCarregando(true);
      try {
        const r = await fetch(`/api/veterinaria/${empresaId}/pacientes?busca=${encodeURIComponent(busca.trim())}`, { signal: controle.signal });
        if (r.ok) setLista((await r.json()) as PacienteBusca[]);
      } catch {
        // busca cancelada
      } finally {
        setCarregando(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controle.abort();
    };
  }, [busca, buscando, empresaId]);

  const escolher = (p: PacienteBusca | null) => {
    setEscolhido(p);
    setBusca("");
    aoEscolher?.(p);
  };

  return (
    <Campo rotulo="Animal" htmlFor={`${id}-busca`} erro={erro}>
      <input type="hidden" name={name} value={escolhido?.id ?? ""} />
      {escolhido ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <span>
            <strong>{escolhido.nome}</strong> <span className="text-muted-foreground">({ESPECIES[escolhido.especie] ?? escolhido.especie}) · tutor: {escolhido.tutor}</span>
          </span>
          <Button type="button" variante="fantasma" tamanho="sm" onClick={() => escolher(null)}>
            Trocar
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${id}-busca`}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome do animal ou do tutor, CPF, telefone ou microchip"
            className="pl-9"
            autoComplete="off"
          />
          {busca.trim().length >= 2 ? (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg" role="listbox">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => escolher(p)}>
                    <strong>{p.nome}</strong> <span className="text-muted-foreground">({ESPECIES[p.especie] ?? p.especie}) · {p.tutor}</span>
                  </button>
                </li>
              ))}
              {!resultados.length ? <li className="px-3 py-2 text-sm text-muted-foreground">{carregando ? "Buscando..." : "Nenhum animal encontrado."}</li> : null}
            </ul>
          ) : null}
        </div>
      )}
    </Campo>
  );
}
