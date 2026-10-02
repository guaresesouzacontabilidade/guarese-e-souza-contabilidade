/** Rótulos em linguagem simples para o registro de atividades (auditoria). */
export const ROTULO_ACAO: Record<string, string> = {
  inserir: "Criou",
  alterar: "Alterou",
  excluir: "Excluiu",
  login: "Entrou no portal",
  logout: "Saiu do portal",
  encerrar_sessao: "Encerrou uma sessão",
  encerrar_sessoes: "Encerrou as sessões de um usuário",
  senha_alterada: "Trocou a senha",
  senha_redefinida: "Redefiniu a senha",
  mfa_removido: "Desativou a verificação em duas etapas",
  convite: "Convidou um usuário",
  convite_reenviado: "Gerou novo link de acesso",
  desativar_usuario: "Desativou um usuário",
  anonimizar_usuario: "Anonimizou um usuário (LGPD)",
  exportar_dados_pessoais: "Baixou os próprios dados (LGPD)",
  expurgar_documentos: "Eliminou documentos com prazo de guarda vencido",
  exportacao: "Exportou um relatório",
  download_lote: "Baixou documentos em lote",
};

export const ROTULO_ENTIDADE: Record<string, string> = {
  baixas: "pagamento/recebimento",
  categorias_financeiras: "categoria financeira",
  checklist_itens: "item do checklist",
  checklist_modelos: "modelo de checklist",
  competencias: "competência (fechamento)",
  conciliacoes: "conciliação",
  contas_financeiras: "conta financeira",
  convites: "convite",
  documentos: "documento",
  empresa_contatos: "contato da empresa",
  empresa_membros: "acesso de usuário à empresa",
  empresas: "empresa",
  escritorio: "configurações do escritório",
  estoques: "estoque",
  importacoes: "importação",
  lancamentos: "lançamento financeiro",
  perfis: "usuário",
  relatorios: "relatório",
  relatorios_publicados: "relatório publicado",
  sessoes: "sessão",
  transferencias: "transferência",
};

export const ACOES_SEGURANCA = [
  "login",
  "logout",
  "encerrar_sessao",
  "encerrar_sessoes",
  "senha_alterada",
  "senha_redefinida",
  "mfa_removido",
  "convite",
  "convite_reenviado",
  "desativar_usuario",
  "anonimizar_usuario",
  "exportar_dados_pessoais",
];

export function descreverEvento(acao: string, entidade: string) {
  if (acao === "inserir" || acao === "alterar" || acao === "excluir") return `${ROTULO_ACAO[acao]} ${ROTULO_ENTIDADE[entidade] ?? entidade}`;
  return ROTULO_ACAO[acao] ?? `${acao.replace(/_/g, " ")} (${ROTULO_ENTIDADE[entidade] ?? entidade})`;
}
