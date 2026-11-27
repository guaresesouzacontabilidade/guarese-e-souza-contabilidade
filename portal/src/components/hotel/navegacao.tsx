import Link from "next/link";
import { BedDouble } from "lucide-react";
import { EstadoVazio } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";

/** Tela mostrada quando a empresa não usa o hotel (ou a pessoa não tem acesso). */
export function HotelIndisponivel({ empresaId, equipe, ativo }: { empresaId: string; equipe: boolean; ativo: boolean }) {
  if (ativo) {
    return (
      <EstadoVazio
        icone={BedDouble}
        titulo="Você não tem acesso ao hotel"
        descricao="Peça ao responsável pela empresa para liberar a permissão “Vender no caixa” (recepção) ou “Gerenciar a loja” (gerente) para você."
      />
    );
  }
  return (
    <EstadoVazio
      icone={BedDouble}
      titulo="Gestão do hotel não contratada"
      descricao="Serviço opcional do escritório para hotéis e pousadas: reservas, quartos, check-in e check-out, conta do hóspede, restaurante e bar — tudo ligado à contabilidade. Fale com o escritório para aderir."
      acao={
        equipe ? (
          <Button asChild>
            <Link href={`/e/${empresaId}/loja/configuracoes`}>Ligar a gestão do hotel</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
