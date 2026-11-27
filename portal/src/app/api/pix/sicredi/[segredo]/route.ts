import { receberAviso } from "./aviso";

export async function POST(req: Request, { params }: RouteContext<"/api/pix/sicredi/[segredo]">) {
  return receberAviso(req, (await params).segredo);
}
