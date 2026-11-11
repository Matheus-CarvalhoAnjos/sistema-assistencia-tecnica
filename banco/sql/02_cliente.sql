-- Tabela 02 de 17: cliente
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.2, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: cpf_cnpj obrigatorio e UNIQUE (RN25), somente digitos; e-mail opcional; cliente sem login.
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS cliente (
  id_cliente INT NOT NULL AUTO_INCREMENT,
  tipo_pessoa VARCHAR(10) NOT NULL,
  nome_razao_social VARCHAR(200) NOT NULL,
  cpf_cnpj VARCHAR(14) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  email VARCHAR(150) NULL,
  cep VARCHAR(8) NOT NULL,
  logradouro VARCHAR(150) NOT NULL,
  numero VARCHAR(10) NOT NULL,
  complemento VARCHAR(100) NULL,
  bairro VARCHAR(100) NOT NULL,
  cidade VARCHAR(100) NOT NULL,
  uf CHAR(2) NOT NULL,
  PRIMARY KEY (id_cliente),
  CONSTRAINT uq_cliente_cpf_cnpj UNIQUE (cpf_cnpj),
  CONSTRAINT ck_cliente_tipo_pessoa CHECK (tipo_pessoa IN ('FISICA', 'JURIDICA')),
  CONSTRAINT ck_cliente_cpf_cnpj CHECK (cpf_cnpj REGEXP '^[0-9]+$' AND ((tipo_pessoa = 'FISICA' AND CHAR_LENGTH(cpf_cnpj) = 11) OR (tipo_pessoa = 'JURIDICA' AND CHAR_LENGTH(cpf_cnpj) = 14))),
  CONSTRAINT ck_cliente_cep CHECK (cep REGEXP '^[0-9]{8}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Clientes (pessoa fisica ou juridica); sem login nesta versao';
