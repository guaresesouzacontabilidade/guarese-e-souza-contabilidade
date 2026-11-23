import { receberAviso } from "../aviso";

/** O padrão da API Pix acrescenta "/pix" ao endereço cadastrado. */
export async function POST(req: Request, { params }: RouteContext<"/api/pix/sicredi/[segredo]/pix">) {
  return receberAviso(req, (await params).segredo);
}
