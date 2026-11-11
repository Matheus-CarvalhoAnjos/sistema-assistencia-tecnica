export type TipoPessoa = 'FISICA' | 'JURIDICA';

/** Cliente como devolvido pela API (documentos, CEP e telefone só com dígitos). */
export interface Cliente {
  id_cliente: number;
  tipo_pessoa: TipoPessoa;
  nome_razao_social: string;
  cpf_cnpj: string;
  telefone: string;
  /** Opcional (MER v1.4). */
  email: string | null;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Corpo enviado em POST /api/clientes e PUT /api/clientes/:id. */
export type ClienteEntrada = Omit<Cliente, 'id_cliente'>;

/** Resposta de cadastro e edição. */
export interface RespostaCliente {
  mensagem: string;
  cliente: Cliente;
}

export const UFS: readonly string[] = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];
