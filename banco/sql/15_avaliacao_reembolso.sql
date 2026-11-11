-- Tabela 15 de 17: avaliacao_reembolso
-- Fonte: decisoes aprovadas em 09/11/2026 (documentacao/PROPOSTA_REEMBOLSO_PARCIAL.md), complemento ao MER v1.4.
-- Seguro para reexecutar (IF NOT EXISTS). No banco principal foi criada pela migracao
-- banco/migracoes/20261109_02_avaliacao_reembolso_parcial.sql (aplicada em 09/11/2026).
-- Decisao financeira da OS encerrada por impossibilidade tecnica em EM_REPARO (D1-D4).
-- Linhas imutaveis: correcao = nova linha com id_avaliacao_revisada e motivo_revisao.
-- id_os_original (gerada, UNIQUE) garante uma unica avaliacao original por OS.
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS avaliacao_reembolso (
  id_avaliacao INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  id_avaliacao_revisada INT NULL,
  id_os_original INT GENERATED ALWAYS AS (CASE WHEN id_avaliacao_revisada IS NULL THEN id_os ELSE NULL END) STORED,
  valor_definido DECIMAL(10,2) NOT NULL,
  justificativa TEXT NOT NULL,
  motivo_revisao TEXT NULL,
  id_usuario INT NOT NULL,
  data_avaliacao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_avaliacao),
  UNIQUE KEY uq_avaliacao_revisada (id_avaliacao_revisada),
  UNIQUE KEY uq_avaliacao_original_por_os (id_os_original),
  KEY idx_avaliacao_os (id_os),
  KEY idx_avaliacao_usuario (id_usuario),
  CONSTRAINT fk_avaliacao_os FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_avaliacao_revisada FOREIGN KEY (id_avaliacao_revisada) REFERENCES avaliacao_reembolso (id_avaliacao) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_avaliacao_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_avaliacao_valor CHECK (valor_definido >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Avaliacao financeira de reembolso da OS (original e revisoes)';
