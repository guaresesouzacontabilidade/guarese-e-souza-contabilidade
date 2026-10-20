import { assinatura, NS_NFSE, type ChavesAssinatura } from "@/lib/nfse-emissao/dps";

/**
 * NFS-e FICTÍCIA no formato da Sefin Nacional (leiaute 1.01), montada a partir
 * de uma DPS assinada. Só para os testes automáticos (o servidor local que faz
 * o papel do Emissor Nacional e o DANFSe); nunca é usada fora dos testes.
 */
export function nfseFicticia(dpsAssinada: string, p: { cnpj: string; numero: number; ambiente: 1 | 2; chaves: ChavesAssinatura }) {
  const dps = dpsAssinada.replace(` xmlns="${NS_NFSE}"`, "");
  const chave = `1718204${2}2${p.cnpj}${String(p.numero).padStart(13, "0")}2610${"123456789"}7`;
  if (!/^[0-9]{50}$/.test(chave)) throw new Error("chave fictícia inválida");
  const id = `NFS${chave}`;
  const filhos =
    "<xLocEmi>Porto Nacional</xLocEmi><xLocPrestacao>Porto Nacional</xLocPrestacao>" +
    `<nNFSe>${p.numero}</nNFSe><cLocIncid>1718204</cLocIncid><xLocIncid>Porto Nacional</xLocIncid>` +
    "<xTribNac>Assessoria ou consultoria de qualquer natureza, não contida em outros itens desta lista.</xTribNac>" +
    "<verAplic>SefinNacional_teste</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><procEmi>1</procEmi><cStat>100</cStat>" +
    "<dhProc>2026-10-20T10:30:05-03:00</dhProc><nDFSe>900001</nDFSe>" +
    `<emit><CNPJ>${p.cnpj}</CNPJ><xNome>EMPRESA FICTICIA DE TESTES LTDA</xNome><enderNac><xLgr>Rua Ficticia</xLgr><nro>10</nro>` +
    "<xBairro>Centro</xBairro><cMun>1718204</cMun><UF>TO</UF><CEP>77500000</CEP></enderNac></emit>" +
    "<valores><vBC>1500.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>30.00</vISSQN><vLiq>1500.00</vLiq></valores>" +
    dps;
  const xml = `<NFSe xmlns="${NS_NFSE}" versao="1.01"><infNFSe Id="${id}">${filhos}</infNFSe>${assinatura(
    `<infNFSe xmlns="${NS_NFSE}" Id="${id}">${filhos}</infNFSe>`,
    id,
    p.chaves,
  )}</NFSe>`;
  return { chave, xml };
}
