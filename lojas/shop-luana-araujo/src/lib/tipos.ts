/** Dados que o portal entrega ao site (rotas /api/vitrine do Portal Guarese's ON). */

export interface Entrega {
  id: string;
  nome: string;
  /** null = frete combinado pelo WhatsApp */
  valor: number | null;
  detalhe?: string;
  /** Pede o endereço de entrega */
  endereco?: boolean;
}

export type FormaPagamento = "pix" | "cartao_credito" | "cartao_debito" | "dinheiro";

export interface Loja {
  nome: string;
  slug: string;
  endereco_site: string | null;
  whatsapp: string | null;
  instagram: string | null;
  email: string | null;
  endereco_loja: string | null;
  cidade: string | null;
  horario: string | null;
  aviso: string | null;
  sobre: string | null;
  politica_trocas: string | null;
  entregas: Entrega[];
  pagamentos: FormaPagamento[];
  pedido_minimo: number | null;
  razao_social: string | null;
  cnpj: string | null;
}

export interface Categoria {
  id: string;
  pai_id: string | null;
  nome: string;
  slug: string;
  ordem: number;
}

/** Foto: endereço-base; o tamanho é escolhido pelo carregador de imagens (-p 480 px, -g 1200 px). */
export type Foto = string;

export interface ProdutoResumo {
  id: string;
  nome: string;
  preco: number;
  preco_de: number | null;
  categoria_id: string | null;
  fotos: Foto[];
  destaque: boolean;
  disponivel: boolean;
  ultimas: boolean;
  /** Quantidade de opções (cor, tom, tamanho) para escolher */
  opcoes: number;
  publicado_em: string;
}

export interface ProdutoDetalhe extends Omit<ProdutoResumo, "opcoes"> {
  descricao: string | null;
  rotulo_variacao: string;
  variacoes: string[];
  /** Quantidade máxima por pedido (estoque, até 99) */
  maximo: number;
  codigo: string;
}

/** Banner de campanha no ar (o portal só manda os ligados e dentro do período). */
export interface Banner {
  id: string;
  /** Nome do banner: texto alternativo da imagem */
  titulo: string;
  /** Endereço-base das imagens (-p.webp e -g.webp) */
  computador: Foto;
  /** Igual a `computador` quando o banner não tem imagem própria para celular */
  celular: Foto;
  /** Página do site aberta ao tocar (/c/..., /p/... ou /busca?q=...) */
  link: string | null;
}

export interface Vitrine {
  aberta: boolean;
  loja: Loja;
  /** Banners de campanha no ar, na ordem */
  banners?: Banner[];
  categorias: Categoria[];
  produtos: ProdutoResumo[];
}

export interface ItemPedido {
  produto_id: string;
  quantidade: number;
  variacao?: string | null;
}

export interface DadosPedido {
  nome: string;
  telefone: string;
  entrega: string;
  endereco?: string;
  pagamento: FormaPagamento;
  troco_para?: number | null;
  observacao?: string;
  itens: ItemPedido[];
  total_visto: number;
}

export interface PedidoRegistrado {
  numero: number;
  subtotal: number;
  frete: number;
  frete_a_combinar: boolean;
  total: number;
  entrega: string;
  endereco: string | null;
  pagamento: string;
  troco_para: number | null;
  whatsapp: string;
  nome: string;
  itens: { nome: string; quantidade: number; preco: number; total: number; variacao: string | null; rotulo_variacao: string }[];
}
