-- Tabela 16 de 17: reembolso
-- Fonte: decisoes aprovadas em 09/11/2026 (documentacao/PROPOSTA_REEMBOLSO_PARCIAL.md), complemento ao MER v1.4.
-- Seguro para reexecutar (IF NOT EXISTS). No banco principal foi criada pela migracao
-- banco/migracoes/20261109_02_avaliacao_reembolso_parcial.sql (aplicada em 09/11/2026).
-- Cada devolucao (parcial ou integral) de um pagamento CONFIRMADO (D5, D6).
-- Soma por pagamento <= valor do pagamento (validado no backend, com bloqueio).
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS reembolso (
  id_reembolso INT NOT NULL AUTO_INCREMENT,
  id_pagamento INT NOT NULL,
  id_avaliacao INT NULL,
  valor DECIMAL(10,2) NOT NULL,
  justificativa TEXT NOT NULL,
  id_usuario INT NOT NULL,
  data_reembolso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_reembolso),
  KEY idx_reembolso_pagamento (id_pagamento),
  KEY idx_reembolso_avaliacao (id_avaliacao),
  KEY idx_reembolso_usuario (id_usuario),
  CONSTRAINT fk_reembolso_pagamento FOREIGN KEY (id_pagamento) REFERENCES pagamento (id_pagamento) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_reembolso_avaliacao FOREIGN KEY (id_avaliacao) REFERENCES avaliacao_reembolso (id_avaliacao) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_reembolso_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_reembolso_valor CHECK (valor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Reembolsos (parciais ou integrais) de pagamentos confirmados';
