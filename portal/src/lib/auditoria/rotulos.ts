/** Rótulos do histórico de auditoria (ações e entidades registradas pelo banco). */

/** Ações registradas pelo gatilho genérico (app.tg_auditoria) e pelos eventos explícitos. */
export const ACOES_AUDITORIA: Record<string, { rotulo: string; tom: "neutro" | "info" | "sucesso" | "alerta" | "perigo" }> = {
  inserir: { rotulo: "Inclusão", tom: "sucesso" },
  alterar: { rotulo: "Alteração", tom: "info" },
  excluir: { rotulo: "Exclusão", tom: "perigo" },
  login: { rotulo: "Login", tom: "neutro" },
  logout: { rotulo: "Saída", tom: "neutro" },
  mfa_ativado: { rotulo: "2FA ativado", tom: "sucesso" },
  mfa_removido: { rotulo: "2FA removido", tom: "alerta" },
  senha_alterada: { rotulo: "Senha alterada", tom: "alerta" },
  senha_redefinida: { rotulo: "Senha redefinida", tom: "alerta" },
  convite: { rotulo: "Convite enviado", tom: "info" },
  convite_reenviado: { rotulo: "Link de acesso reenviado", tom: "info" },
  desativar_usuario: { rotulo: "Usuário desativado", tom: "perigo" },
  anonimizar_usuario: { rotulo: "Usuário anonimizado (LGPD)", tom: "perigo" },
  exportar_dados_pessoais: { rotulo: "Exportação de dados pessoais", tom: "alerta" },
  encerrar_sessao: { rotulo: "Sessão encerrada", tom: "neutro" },
  encerrar_sessoes: { rotulo: "Sessões encerradas", tom: "alerta" },
  exportacao: { rotulo: "Exportação", tom: "info" },
  download_lote: { rotulo: "Download em lote", tom: "info" },
  visualizacao_relatorio: { rotulo: "Relatório visualizado", tom: "neutro" },
  expurgar_documentos: { rotulo: "Expurgo de documentos", tom: "perigo" },
  ignorar_movimento: { rotulo: "Movimento ignorado", tom: "alerta" },
  reativar_movimento: { rotulo: "Movimento reativado", tom: "info" },
  acesso_negado: { rotulo: "Acesso negado", tom: "perigo" },
};

/** Tabelas auditadas e entidades dos eventos explícitos. */
export const ENTIDADES_AUDITORIA: Record<string, string> = {
  escritorio: "Configurações do escritório",
  perfis: "Usuários",
  empresas: "Empresas",
  empresa_contatos: "Contatos da empresa",
  empresa_membros: "Acessos e permissões",
  convites: "Convites",
  sessoes: "Sessões",
  documentos: "Documentos",
  checklist_modelos: "Modelos de checklist",
  checklist_itens: "Itens do checklist",
  competencias: "Competências / fechamento",
  contas_financeiras: "Contas financeiras",
  categorias_financeiras: "Categorias financeiras",
  lancamentos: "Lançamentos",
  baixas: "Baixas (pagamentos)",
  transferencias: "Transferências",
  estoques: "Estoques",
  importacoes: "Importações",
  movimentos_bancarios: "Movimentos bancários",
  conciliacoes: "Conciliações",
  relatorios_publicados: "Relatórios",
};

export function rotuloAcao(acao: string) {
  return ACOES_AUDITORIA[acao]?.rotulo ?? acao;
}

export function rotuloEntidade(entidade: string) {
  return ENTIDADES_AUDITORIA[entidade] ?? entidade;
}
