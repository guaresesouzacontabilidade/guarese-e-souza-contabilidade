import { redirect } from "next/navigation";

/** Endereço usado nos avisos de resposta a pedidos LGPD. */
export default function PrivacidadeConta() {
  redirect("/conta#privacidade");
}
