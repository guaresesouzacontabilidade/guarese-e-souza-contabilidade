/** Catálogo de permissões (espelha app.permissoes_validas() no banco). */
export const TODAS_PERMISSOES = [
  "empresa.ver",
  "empresa.editar",
  "usuarios.gerenciar",
  "documentos.ver",
  "documentos.enviar",
  "documentos.baixar",
  "documentos.revisar",
  "documentos.publicar",
  "checklist.gerenciar",
  "financeiro.ver",
  "financeiro.editar",
  "financeiro.importar",
  "conciliacao.executar",
  "relatorios.ver",
  "relatorios.publicar",
  "fechamento.gerenciar",
  "fechamento.reabrir",
  "mensagens.usar",
  "calculos.ver",
  "calculos.gerenciar",
  "colaboradores.gerenciar",
  "certificado.gerenciar",
  "auditor.ver",
  "auditor.gerenciar",
  "maquininhas.ver",
  "maquininhas.gerenciar",
  "nfse.emitir",
  "nfse.configurar",
  "nfe.emitir",
  "nfe.configurar",
  "gestao.vender",
  "gestao.gerenciar",
] as const;

export type Permissao = (typeof TODAS_PERMISSOES)[number];

export const PERMISSOES_EXCLUSIVAS_EQUIPE: Permissao[] = [
  "documentos.revisar",
  "documentos.publicar",
  "checklist.gerenciar",
  "relatorios.publicar",
  "fechamento.gerenciar",
  "fechamento.reabrir",
  "calculos.gerenciar",
  "auditor.gerenciar",
  "nfse.configurar",
  "nfe.configurar",
];

export const GRUPOS_PERMISSOES: { grupo: string; itens: { chave: Permissao; rotulo: string; descricao: string }[] }[] = [
  {
    grupo: "Empresa",
    itens: [
      { chave: "empresa.ver", rotulo: "Visualizar", descricao: "Ver o cadastro da empresa." },
      { chave: "empresa.editar", rotulo: "Editar cadastro", descricao: "Alterar dados cadastrais e contatos." },
      { chave: "usuarios.gerenciar", rotulo: "Gerenciar usuários", descricao: "Convidar e revogar acessos." },
      {
        chave: "certificado.gerenciar",
        rotulo: "Certificado e notas automáticas",
        descricao: "Cadastrar ou remover o certificado digital A1 e configurar a busca automática de notas.",
      },
    ],
  },
  {
    grupo: "Documentos",
    itens: [
      { chave: "documentos.ver", rotulo: "Visualizar", descricao: "Ver a lista e o andamento dos documentos." },
      { chave: "documentos.enviar", rotulo: "Enviar", descricao: "Enviar documentos e responder pendências." },
      { chave: "documentos.baixar", rotulo: "Baixar", descricao: "Abrir e baixar arquivos." },
      { chave: "documentos.revisar", rotulo: "Aprovar (conferência)", descricao: "Conferir, aprovar e pedir correções." },
      { chave: "documentos.publicar", rotulo: "Publicar ao cliente", descricao: "Disponibilizar guias, folhas e relatórios." },
      { chave: "checklist.gerenciar", rotulo: "Gerenciar checklist", descricao: "Configurar itens e revisar “não se aplica”." },
    ],
  },
  {
    grupo: "Financeiro",
    itens: [
      { chave: "financeiro.ver", rotulo: "Visualizar", descricao: "Ver painel, lançamentos e saldos." },
      { chave: "financeiro.editar", rotulo: "Editar", descricao: "Registrar e alterar lançamentos." },
      { chave: "financeiro.importar", rotulo: "Importar", descricao: "Importar extratos e planilhas." },
      { chave: "conciliacao.executar", rotulo: "Conciliar", descricao: "Confirmar e desfazer conciliações." },
    ],
  },
  {
    grupo: "Relatórios e fechamento",
    itens: [
      { chave: "relatorios.ver", rotulo: "Visualizar relatórios", descricao: "Consultar e baixar relatórios." },
      { chave: "relatorios.publicar", rotulo: "Publicar relatórios", descricao: "Revisar e publicar relatórios." },
      { chave: "fechamento.gerenciar", rotulo: "Conduzir fechamento", descricao: "Executar as etapas do fechamento mensal." },
      { chave: "fechamento.reabrir", rotulo: "Reabrir competência", descricao: "Reabrir competência fechada (com justificativa)." },
    ],
  },
  {
    grupo: "Cálculos",
    itens: [
      { chave: "calculos.ver", rotulo: "Previsões e simulações", descricao: "Ver a previsão de impostos e simular rescisões." },
      { chave: "colaboradores.gerenciar", rotulo: "Cadastrar colaboradores", descricao: "Cadastrar e alterar os colaboradores (salário, admissão)." },
      { chave: "calculos.gerenciar", rotulo: "Configurar cálculos", descricao: "Definir parâmetros, receitas informadas e ajustes da previsão." },
    ],
  },
  {
    grupo: "Auditor fiscal",
    itens: [
      { chave: "auditor.ver", rotulo: "Economia de impostos", descricao: "Ver as oportunidades de economia que o escritório publicou e pedir que ele cuide delas." },
      { chave: "auditor.gerenciar", rotulo: "Conduzir o auditor", descricao: "Analisar as notas, revisar os achados e publicar ao cliente." },
    ],
  },
  {
    grupo: "Maquininhas",
    itens: [
      { chave: "maquininhas.ver", rotulo: "Conferência das taxas", descricao: "Ver as vendas das maquininhas e as taxas cobradas acima do contrato." },
      {
        chave: "maquininhas.gerenciar",
        rotulo: "Contratos e relatórios",
        descricao: "Cadastrar os contratos com as taxas combinadas e conferir as colunas dos relatórios de vendas.",
      },
    ],
  },
  {
    grupo: "Notas de serviço",
    itens: [
      { chave: "nfse.emitir", rotulo: "Emitir notas", descricao: "Pedir notas fiscais de serviço (emitidas na hora pelo Emissor Nacional), baixar e cancelar." },
      {
        chave: "nfse.configurar",
        rotulo: "Configurar a emissão",
        descricao: "Cadastrar os serviços e códigos de tributação, a numeração e ligar a emissão da empresa.",
      },
    ],
  },
  {
    grupo: "Notas de produto (NF-e)",
    itens: [
      {
        chave: "nfe.emitir",
        rotulo: "Emitir NF-e",
        descricao: "Emitir notas de produto com as operações cadastradas pelo escritório, cadastrar clientes e transportadores, cancelar e corrigir (carta de correção).",
      },
      {
        chave: "nfe.configurar",
        rotulo: "Configurar a NF-e",
        descricao: "Cadastrar as inscrições e séries, os produtos e as operações (CFOP, CST, alíquotas, IBS/CBS, DIFAL, FETHAB), anexar as guias e ligar a emissão.",
      },
    ],
  },
  {
    grupo: "Gestão da loja",
    itens: [
      {
        chave: "gestao.vender",
        rotulo: "Vender no caixa",
        descricao: "Abrir e fechar o próprio caixa, vender, fazer orçamentos, sangrias e suprimentos (só nas empresas com a gestão da loja contratada).",
      },
      {
        chave: "gestao.gerenciar",
        rotulo: "Gerenciar a loja",
        descricao: "Cadastrar produtos e preços, lançar estoque e inventário, cancelar vendas, dar descontos sem limite, ver os relatórios e as configurações da loja.",
      },
    ],
  },
  {
    grupo: "Comunicação",
    itens: [{ chave: "mensagens.usar", rotulo: "Mensagens", descricao: "Usar a central de mensagens." }],
  },
];

export const PERMISSOES_PADRAO: Record<"equipe" | "cliente_titular" | "cliente_colaborador", Permissao[]> = {
  equipe: TODAS_PERMISSOES.filter((p) => p !== "fechamento.reabrir"),
  cliente_titular: [
    "empresa.ver", "usuarios.gerenciar", "documentos.ver", "documentos.enviar", "documentos.baixar",
    "financeiro.ver", "financeiro.editar", "financeiro.importar", "relatorios.ver", "mensagens.usar",
    "calculos.ver", "colaboradores.gerenciar", "certificado.gerenciar", "auditor.ver",
    "maquininhas.ver", "maquininhas.gerenciar", "nfse.emitir", "nfe.emitir",
    "gestao.vender", "gestao.gerenciar",
  ],
  cliente_colaborador: ["empresa.ver", "documentos.ver", "documentos.enviar", "mensagens.usar"],
};

export const ROTULO_PAPEL: Record<string, string> = {
  admin: "Administrador do escritório",
  equipe: "Equipe contábil",
  cliente_titular: "Cliente empresário",
  cliente_colaborador: "Colaborador do cliente",
  cliente: "Cliente",
};
