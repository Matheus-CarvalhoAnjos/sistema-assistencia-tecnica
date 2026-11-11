import { AcessorioRecebido } from './solicitacao';

export type StatusOs =
  | 'RECEBIDA'
  | 'EM_ANALISE'
  | 'AGUARDANDO_APROVACAO'
  | 'EM_REPARO'
  | 'CONCLUIDA'
  | 'AGUARDANDO_EXPEDICAO'
  | 'FINALIZADA'
  | 'ENCERRADA_SEM_REPARO';

/** Status na ordem do fluxo, com o rótulo e o tom usados nos indicadores. */
export const STATUS_OS: readonly { codigo: StatusOs; titulo: string; tom: 'blue' | 'green' | 'neutral' }[] = [
  { codigo: 'RECEBIDA', titulo: 'Recebida', tom: 'blue' },
  { codigo: 'EM_ANALISE', titulo: 'Em análise', tom: 'blue' },
  { codigo: 'AGUARDANDO_APROVACAO', titulo: 'Aguardando aprovação', tom: 'neutral' },
  { codigo: 'EM_REPARO', titulo: 'Em reparo', tom: 'green' },
  { codigo: 'CONCLUIDA', titulo: 'Concluída', tom: 'green' },
  { codigo: 'AGUARDANDO_EXPEDICAO', titulo: 'Aguardando expedição', tom: 'blue' },
  { codigo: 'FINALIZADA', titulo: 'Finalizada', tom: 'neutral' },
  { codigo: 'ENCERRADA_SEM_REPARO', titulo: 'Encerrada sem reparo', tom: 'neutral' },
];

export const STATUS_FINAIS: readonly StatusOs[] = ['FINALIZADA', 'ENCERRADA_SEM_REPARO'];

/** Status das OS ainda não finalizadas (todos, exceto os de encerramento). */
export const STATUS_NAO_FINALIZADOS: readonly StatusOs[] = STATUS_OS.map((s) => s.codigo).filter(
  (codigo) => !STATUS_FINAIS.includes(codigo),
);

export function rotuloStatus(status: string): string {
  return STATUS_OS.find((s) => s.codigo === status)?.titulo ?? status;
}

/** Linha da listagem GET /api/ordens-servico. */
export interface OrdemServicoResumo {
  id_os: number;
  id_item: number;
  id_tecnico: number | null;
  nome_tecnico: string | null;
  status: StatusOs;
  data_abertura: string;
  data_encerramento: string | null;
  motivo_encerramento: string | null;
  tipo_equipamento: string;
  marca: string;
  modelo: string;
  numero_serie: string | null;
  garantia_status: string;
  /** Ausente para o perfil TECNICO. */
  id_solicitacao?: number;
  id_cliente: number;
  nome_cliente: string;
}

export interface FiltrosOs {
  /** Um status ou uma lista (a API aceita status separados por vírgula). */
  status?: StatusOs | '' | readonly StatusOs[];
  id_tecnico?: number | null;
  sem_tecnico?: boolean;
  busca?: string;
}

/** Resposta de GET /api/ordens-servico/:id. */
export interface OrdemServicoDetalhes {
  id_os: number;
  status: StatusOs;
  data_abertura: string;
  data_encerramento: string | null;
  motivo_encerramento: string | null;
  /** IMPOSSIBILIDADE_TECNICA, DESISTENCIA_CLIENTE ou ORCAMENTO_REJEITADO (null enquanto aberta). */
  tipo_encerramento?: TipoEncerramento | 'ORCAMENTO_REJEITADO' | null;
  tecnico: { id_usuario: number; nome: string; ativo: boolean } | null;
  equipamento: {
    id_item: number;
    tipo_equipamento: string;
    marca: string;
    modelo: string;
    numero_serie: string | null;
    estado_fisico: string;
    garantia_status: string;
    observacoes: string | null;
  };
  /** Para o TECNICO vem só com id e nome. */
  cliente: { id_cliente: number; nome_razao_social: string; telefone?: string; email?: string };
  /** Ausente para o perfil TECNICO. */
  solicitacao?: { id_solicitacao: number; data_abertura: string; descricao_inicial: string };
  acessorios: AcessorioRecebido[];
}

export interface Execucao {
  id_execucao: number;
  id_tecnico?: number;
  diagnostico: string;
  laudo_tecnico: string | null;
  resultado: string | null;
  data_inicio: string | null;
  data_conclusao: string | null;
}

export type TipoItemOrcamento = 'PECA' | 'SERVICO';

export interface ItemOrcamento {
  id_item_orcamento?: number;
  tipo_item: TipoItemOrcamento;
  descricao: string;
  quantidade: number;
  valor_unitario: number | string;
}

export interface Orcamento {
  id_orcamento: number;
  id_tecnico?: number;
  data_emissao: string;
  data_validade: string;
  valor_total: number | string;
  /** PENDENTE, APROVADO, REJEITADO, VENCIDO ou CANCELADO. */
  status: string;
  itens?: ItemOrcamento[];
  resposta: { decisao: string; data_resposta: string; observacoes: string | null } | null;
}

export type DecisaoOrcamento = 'APROVADO' | 'REJEITADO';
export type TipoEncerramento = 'IMPOSSIBILIDADE_TECNICA' | 'DESISTENCIA_CLIENTE';
export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'TRANSFERENCIA';
export type FormaEntrega = 'RETIRADA' | 'ENVIO';
export type StatusExpedicao = 'PENDENTE' | 'EM_TRANSITO' | 'AGUARDANDO_RETIRADA' | 'ENTREGUE' | 'RETIRADO';

export const FORMAS_PAGAMENTO: readonly { codigo: FormaPagamento; titulo: string }[] = [
  { codigo: 'PIX', titulo: 'Pix' },
  { codigo: 'DINHEIRO', titulo: 'Dinheiro' },
  { codigo: 'CARTAO_DEBITO', titulo: 'Cartão de débito' },
  { codigo: 'CARTAO_CREDITO', titulo: 'Cartão de crédito' },
  { codigo: 'TRANSFERENCIA', titulo: 'Transferência' },
];

/** Próximo status de cada forma de entrega (RN19). */
export const PROXIMO_STATUS_EXPEDICAO: Readonly<Record<FormaEntrega, Partial<Record<StatusExpedicao, StatusExpedicao>>>> = {
  ENVIO: { PENDENTE: 'EM_TRANSITO', EM_TRANSITO: 'ENTREGUE' },
  RETIRADA: { AGUARDANDO_RETIRADA: 'RETIRADO' },
};

export const ROTULOS_STATUS_EXPEDICAO: Readonly<Record<string, string>> = {
  PENDENTE: 'Pendente de envio',
  EM_TRANSITO: 'Em trânsito',
  AGUARDANDO_RETIRADA: 'Aguardando retirada',
  ENTREGUE: 'Entregue',
  RETIRADO: 'Retirado pelo cliente',
};

/** Evento de GET /api/ordens-servico/:id/historico (RN21). */
export interface EventoHistorico {
  id_historico: number;
  id_os: number;
  id_usuario: number | null;
  nome_usuario: string | null;
  tipo_evento: string;
  descricao: string;
  data_evento: string;
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
}

/** Resposta de PATCH /api/ordens-servico/:id/encerramento. */
export interface RespostaEncerramento {
  mensagem: string;
  encerramento: { orcamentos_cancelados: number[]; pagamentos_cancelados: number[] };
  ordem: OrdemServicoDetalhes;
}

export interface Pagamento {
  id_pagamento: number;
  /** null enquanto o pagamento está PENDENTE (preenchida na confirmação). */
  data_pagamento: string | null;
  valor: number | string;
  forma_pagamento: string;
  /** PENDENTE, CONFIRMADO, CANCELADO ou REEMBOLSADO. */
  status: string;
  /** Resumo de compatibilidade, preenchido quando a devolução fica integral (REEMBOLSADO). */
  data_reembolso: string | null;
  id_usuario_reembolso: number | null;
  justificativa_reembolso: string | null;
  /** Devoluções parciais ou integrais (D6). */
  reembolsos?: Reembolso[];
  valor_reembolsado?: number;
  /** Quanto ainda pode ser devolvido (0 quando não está CONFIRMADO). */
  valor_disponivel_reembolso?: number;
}

export interface Reembolso {
  id_reembolso: number;
  id_pagamento: number;
  id_avaliacao: number | null;
  valor: number | string;
  justificativa: string;
  id_usuario: number;
  nome_usuario: string | null;
  data_reembolso: string;
}

/** Abatimento formal (R1): reduz o total devido; separado do reembolso. */
export interface Abatimento {
  id_abatimento: number;
  id_os: number;
  id_orcamento: number;
  valor: number | string;
  motivo: string;
  status: 'APROVADO' | 'CANCELADO';
  id_usuario_registro: number;
  nome_usuario_registro: string | null;
  data_registro: string;
  id_usuario_cancelamento: number | null;
  nome_usuario_cancelamento: string | null;
  data_cancelamento: string | null;
  justificativa_cancelamento: string | null;
}

/** Registro da avaliação financeira (original ou revisão; nunca alterado). */
export interface AvaliacaoReembolso {
  id_avaliacao: number;
  id_avaliacao_revisada: number | null;
  tipo: 'ORIGINAL' | 'REVISAO';
  valor_definido: number;
  justificativa: string;
  motivo_revisao: string | null;
  id_usuario: number;
  nome_usuario: string | null;
  data_avaliacao: string;
}

/** Situação da avaliação financeira da OS (D1–D4). */
export interface AvaliacaoFinanceira {
  id_os: number;
  /** IMPOSSIBILIDADE_TECNICA durante EM_REPARO com pagamento confirmado. */
  obrigatoria: boolean;
  pendente: boolean;
  vigente: AvaliacaoReembolso | null;
  avaliacoes: AvaliacaoReembolso[];
  total_disponivel: number;
  total_reembolsado_avaliacao: number;
  saldo_a_reembolsar: number | null;
}

export interface PagamentosOs {
  pagamentos: Pagamento[];
  resumo: {
    tem_orcamento_aprovado: boolean;
    /** Total original: valor do orçamento aprovado (nunca alterado). */
    total_orcado: number;
    /** R1: soma dos abatimentos aprovados. */
    total_abatido?: number;
    /** R1: total original − total abatido (base do saldo e da quitação). */
    total_devido?: number;
    total_pago: number;
    pagamentos_pendentes: number;
    saldo_devedor: number;
  };
}

export interface Expedicao {
  id_expedicao: number;
  /** Preenchida quando o ENVIO é despachado (EM_TRANSITO); null na RETIRADA. */
  data_envio: string | null;
  /** RETIRADA ou ENVIO. */
  forma_entrega: string | null;
  codigo_rastreio: string | null;
  /** ENVIO: PENDENTE → EM_TRANSITO → ENTREGUE. RETIRADA: AGUARDANDO_RETIRADA → RETIRADO. */
  status: string;
  data_entrega: string | null;
}

export interface UsuarioResumo {
  id_usuario: number;
  nome: string;
  perfil: string;
  ativo: number | boolean;
}
