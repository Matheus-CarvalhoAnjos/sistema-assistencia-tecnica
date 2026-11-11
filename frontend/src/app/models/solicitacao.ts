/** Item do catálogo de acessórios (GET /api/acessorios devolve só os ativos). */
export interface Acessorio {
  id_acessorio: number;
  descricao: string;
  preco_atual: number | string | null;
  ativo: number;
}

export interface AcessorioRecebidoEntrada {
  id_acessorio: number;
  quantidade: number;
  observacoes: string | null;
}

export interface EquipamentoEntrada {
  tipo_equipamento: string;
  marca: string;
  modelo: string;
  numero_serie: string | null;
  estado_fisico: string;
  observacoes: string | null;
  acessorios: AcessorioRecebidoEntrada[];
}

/** Corpo de POST /api/solicitacoes (o atendente vem do token). */
export interface SolicitacaoEntrada {
  id_cliente: number;
  descricao_inicial: string;
  itens: EquipamentoEntrada[];
}

export interface AcessorioRecebido extends AcessorioRecebidoEntrada {
  id_acessorio_recebido: number;
  descricao_acessorio: string | null;
}

export interface EquipamentoCriado extends Omit<EquipamentoEntrada, 'acessorios'> {
  id_item: number;
  /** Número da Ordem de Serviço gerada para o equipamento. */
  id_os: number;
  garantia_status: string;
  acessorios: AcessorioRecebido[];
}

export interface SolicitacaoCriada {
  id_solicitacao: number;
  id_cliente: number;
  id_atendente: number;
  descricao_inicial: string;
  data_abertura: string;
  itens: EquipamentoCriado[];
}

export interface RespostaSolicitacao {
  mensagem: string;
  solicitacao: SolicitacaoCriada;
}
