// Tipos mínimos da biblioteca de cifragem usada pelo web-push (só nos testes).
declare module "http_ece" {
  import type { ECDH } from "node:crypto";
  const ece: {
    decrypt(conteudo: Buffer, parametros: { version: "aes128gcm"; privateKey: ECDH; authSecret: string }): Buffer;
  };
  export default ece;
}
