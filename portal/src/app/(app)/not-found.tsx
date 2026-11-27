import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/feedback";

/** Página inexistente ou de uma empresa/registro a que o usuário não tem acesso. */
export default function NaoEncontradaApp() {
  return (
    <EstadoVazio
      icone={SearchX}
      titulo="Página não encontrada"
      descricao="Ela não existe ou pertence a uma empresa que você não tem permissão para acessar. Se precisar desse acesso, fale com o escritório."
      acao={
        <Button asChild>
          <Link href="/painel">Voltar ao início</Link>
        </Button>
      }
      className="mt-8"
    />
  );
}
