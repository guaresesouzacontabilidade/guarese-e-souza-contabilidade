import type { EntradaCte } from "@/lib/cte-emissao/calculo";
import { dvChave } from "@/lib/fiscal/chave";

const base = "5126101144477700016155001000000015148213765";
/** Chave (fictícia) da NF-e do milho transportado, com o dígito verificador certo. */
export const CHAVE_NFE_MILHO = base.slice(0, 43) + dvChave(base.slice(0, 43));

/** Frete de milho de Água Boa (MT) para Rio Verde (GO), pago pelo destinatário (contribuinte), ICMS 12% e IBS/CBS de 2026. */
export const freteMilho: EntradaCte = {
  ambiente: "homologacao",
  emitidoEm: new Date("2026-10-20T15:00:00Z"),
  serie: 1,
  numero: 27,
  codigoNumerico: "73519284",
  natureza: "Prestação de serviço de transporte",
  cfop: "6353",
  emitente: {
    documento: "55777088000144",
    nome: "Transportadora Fictícia VAP Ltda",
    fantasia: "VAP Fictícia",
    inscricaoEstadual: "13.765.432-1",
    crt: 3,
    endereco: { logradouro: "Rodovia BR-158", numero: "KM 12", bairro: "Distrito Industrial", codigoMunicipio: "5100201", municipio: "Água Boa", uf: "MT", cep: "78635-000", telefone: "(66) 3468-1111" },
  },
  rntrc: "12345678",
  tomador: { papel: 3, indicadorIe: 1 },
  remetente: {
    tipo: "cnpj",
    documento: "11444777000161",
    nome: "Fazenda Exemplo Grãos Ltda",
    indicadorIe: 1,
    inscricaoEstadual: "13.123.456-7",
    telefone: "(66) 3468-0000",
    endereco: { logradouro: "Estrada Vicinal", numero: "SN", bairro: "Zona Rural", codigoMunicipio: "5100201", municipio: "Água Boa", uf: "MT", cep: "78635-000" },
  },
  destinatario: {
    tipo: "cnpj",
    documento: "66223344000178",
    nome: "Granja Exemplo S.A.",
    indicadorIe: 1,
    inscricaoEstadual: "10.123.456-7",
    email: "compras@granja.test",
    endereco: { logradouro: "Avenida Presidente Vargas", numero: "100", bairro: "Centro", codigoMunicipio: "5218805", municipio: "Rio Verde", uf: "GO", cep: "75901-000" },
  },
  inicio: { codigoMunicipio: "5100201", municipio: "Água Boa", uf: "MT" },
  fim: { codigoMunicipio: "5218805", municipio: "Rio Verde", uf: "GO" },
  valorPrestacao: "4500.00",
  valorReceber: "4500.00",
  componentes: [
    { nome: "FRETE PESO", valor: 4000 },
    { nome: "PEDAGIO", valor: 500 },
  ],
  icms: { cst: "00", aliquota: 12 },
  ibscbs: { cst: "000", classificacao: "000001", reducaoIbs: 0, reducaoCbs: 0, excluirIcms: true },
  carga: { valor: "34500.00", produto: "MILHO EM GRAOS", outras: "A GRANEL", pesoKg: "30000" },
  nfes: [CHAVE_NFE_MILHO],
  observacoes: "Ordem de carregamento 12 – placa ABC1D23",
  responsavelTecnico: { cnpj: "77889911000146", contato: "Escritório de contabilidade fictício", email: "contato@escritorio.test", telefone: "63999990000" },
  autorizadosXml: ["77889911000146"],
};
