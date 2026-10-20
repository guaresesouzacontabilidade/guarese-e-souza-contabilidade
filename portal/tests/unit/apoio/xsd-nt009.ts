import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Esquemas para conferir a DPS no leiaute da NT 009 v1.01 (Anexo VI
 * v1.04.01, de 01/10/2026). O governo publicou só a planilha do leiaute, sem
 * XSD: esta cópia dos esquemas 1.01 é ajustada AQUI, só para os testes, com a
 * ordem e a ocorrência dos campos que o portal envia, conforme a planilha:
 *  - infDPS: finNFSe (1-1) depois de cMotivoEmisTI; indDest (1-1) e dest
 *    (0-1) depois de toma;
 *  - regTrib: regApIBSCBSSN (0-1) antes de regEspTrib (que passa a 0-1);
 *  - cServ: cTribNac, cTribMun, cNBS, cAtvSN, cIntContrib e, por último,
 *    xDescServ;
 *  - IBSCBS: indFinal, cIndOp (0-1), ..., valores/trib com CST, cClassTrib
 *    e gIBSCBS (0-1, todos os filhos opcionais).
 * Também tira as âncoras ^ e $ do padrão da série (ver nfse-dps.test.ts).
 */
export function esquemasNt009(): string {
  const pasta = mkdtempSync(join(tmpdir(), "nfse-xsd-nt009-"));
  cpSync(resolve("tests/fixtures/nfse-xsd-1.01"), pasta, { recursive: true });

  const arqSimples = join(pasta, "tiposSimples_v1.01.xsd");
  let simples = readFileSync(arqSimples, "utf8").replace('pattern value="^0{0,4}\\d{1,5}$"', 'pattern value="0{0,4}\\d{1,5}"');
  simples = simples.replace(
    "</xs:schema>",
    `  <xs:simpleType name="TSNt009RegApIBSCBSSN"><xs:restriction base="xs:string"><xs:enumeration value="1"/><xs:enumeration value="2"/><xs:enumeration value="3"/></xs:restriction></xs:simpleType>
  <xs:simpleType name="TSNt009CAtvSN"><xs:restriction base="xs:string"><xs:pattern value="0[7-9]|1[0-4]|90"/></xs:restriction></xs:simpleType>
  <xs:simpleType name="TSNt009TpAjuste"><xs:restriction base="xs:string"><xs:pattern value="[0-9]{2}"/></xs:restriction></xs:simpleType>
</xs:schema>`,
  );
  writeFileSync(arqSimples, simples);

  const arqComplexos = join(pasta, "tiposComplexos_v1.01.xsd");
  let tipos = readFileSync(arqComplexos, "utf8");
  const trocarTipo = (nome: string, sequencia: string) => {
    const re = new RegExp(`<xs:complexType name="${nome}">[\\s\\S]*?</xs:complexType>`);
    if (!re.test(tipos)) throw new Error(`Tipo ${nome} não encontrado nos esquemas.`);
    tipos = tipos.replace(re, `<xs:complexType name="${nome}"><xs:sequence>${sequencia}</xs:sequence></xs:complexType>`);
  };
  const inserirAntes = (marca: string, trecho: string) => {
    if (!tipos.includes(marca)) throw new Error(`Trecho não encontrado nos esquemas: ${marca}`);
    tipos = tipos.replace(marca, trecho + marca);
  };

  inserirAntes(
    '<xs:element minOccurs="0" name="chNFSeRej"',
    '<xs:element name="finNFSe" type="TSRTCFinNFSe"/><xs:element name="tpNFSeDebito" type="TSNt009TpAjuste" minOccurs="0"/><xs:element name="tpNFSeCredito" type="TSNt009TpAjuste" minOccurs="0"/>',
  );
  inserirAntes('<xs:element name="interm" type="TCInfoPessoa" minOccurs="0">', '<xs:element name="indDest" type="TSRTCIndDest"/><xs:element name="dest" type="TCRTCInfoDest" minOccurs="0"/>');
  trocarTipo(
    "TCRegTrib",
    '<xs:element name="opSimpNac" type="TSOpSimpNac"/><xs:element name="regApTribSN" type="TSRegimeApuracaoSimpNac" minOccurs="0"/>' +
      '<xs:element name="regApIBSCBSSN" type="TSNt009RegApIBSCBSSN" minOccurs="0"/><xs:element name="regEspTrib" type="TSRegEspTrib" minOccurs="0"/>',
  );
  trocarTipo(
    "TCCServ",
    '<xs:element name="cTribNac" type="TSCodTribNac"/><xs:element name="cTribMun" type="TCCodTribMun" minOccurs="0"/><xs:element name="cNBS" type="TSCodNBS" minOccurs="0"/>' +
      '<xs:element name="cAtvSN" type="TSNt009CAtvSN" minOccurs="0"/><xs:element name="cIntContrib" type="TSCodigoInternoContribuinte" minOccurs="0"/><xs:element name="xDescServ" type="TSDesc2000"/>',
  );
  trocarTipo(
    "TCRTCInfoIBSCBS",
    '<xs:element name="indFinal" type="TSRTCIndFinal" minOccurs="0"/><xs:element name="cIndOp" type="TSRTCCodIndOp" minOccurs="0"/>' +
      '<xs:element name="tpOper" type="TSRTCTpOper" minOccurs="0"/><xs:element name="gRefNFSe" type="TCInfoRefNFSe" minOccurs="0"/>' +
      '<xs:element name="tpEnteGov" type="TSRTCTpEnteGov" minOccurs="0"/><xs:element name="imovel" type="TCRTCInfoImovel" minOccurs="0"/>' +
      '<xs:element name="valores" type="TCRTCInfoValoresIBSCBS"/>',
  );
  trocarTipo(
    "TCRTCInfoTributosIBSCBS",
    '<xs:element name="CST" type="TSRTCCodSitTrib"/><xs:element name="cClassTrib" type="TSRTCCodClassTrib"/><xs:element name="gIBSCBS" type="TCNt009GIBSCBS" minOccurs="0"/>',
  );
  tipos = tipos.replace(
    "</xs:schema>",
    '  <xs:complexType name="TCNt009GIBSCBS"><xs:sequence><xs:element name="cCredPres" type="TSRTCCodCredPres" minOccurs="0"/>' +
      '<xs:element name="gTribRegular" type="TCRTCInfoTributosTribRegular" minOccurs="0"/><xs:element name="gDif" type="TCRTCInfoTributosDif" minOccurs="0"/></xs:sequence></xs:complexType>\n</xs:schema>',
  );
  writeFileSync(arqComplexos, tipos);
  return pasta;
}
