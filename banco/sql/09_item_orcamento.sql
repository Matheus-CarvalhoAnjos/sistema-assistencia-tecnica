-- Tabela 09 de 17: item_orcamento
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.9, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: itens PECA ou SERVICO; o subtotal (quantidade x valor_unitario) e derivado e nao e armazenado.
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS item_orcamento (
  id_item_orcamento INT NOT NULL AUTO_INCREMENT,
  id_orcamento INT NOT NULL,
  tipo_item ENUM('PECA', 'SERVICO') NOT NULL,
  descricao VARCHAR(255) NOT NULL,
  quantidade INT NOT NULL,
  valor_unitario DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id_item_orcamento),
  CONSTRAINT fk_item_orcamento_orcamento FOREIGN KEY (id_orcamento) REFERENCES orcamento (id_orcamento) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_item_orcamento_quantidade CHECK (quantidade > 0),
  CONSTRAINT chk_item_orcamento_valor CHECK (valor_unitario >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Pecas e servicos de cada orcamento';
