-- Tabela 17 de 17: abatimento
-- Fonte: regra R1 (decisoes A1-A8, C1, C2 de 09/11/2026), documentacao/REGRAS_DECISOES_PENDENCIAS.md, secao 3.5.
-- Seguro para reexecutar (IF NOT EXISTS). No banco principal foi criada pela migracao
-- banco/migracoes/20261109_04_abatimento_formal.sql (aplicada em 09/11/2026).
-- Abatimento formal: reduz o total devido sem alterar o orcamento aprovado. Nasce APROVADO; o
-- cancelamento preserva o registro. Coerencia de status e de OS x orcamento validada no backend.
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS abatimento (
  id_abatimento INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  id_orcamento INT NOT NULL,
  valor DECIMAL(10,2) NOT NULL,
  motivo TEXT NOT NULL,
  status ENUM('APROVADO', 'CANCELADO') NOT NULL DEFAULT 'APROVADO',
  id_usuario_registro INT NOT NULL,
  data_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_usuario_cancelamento INT NULL,
  data_cancelamento DATETIME NULL,
  justificativa_cancelamento TEXT NULL,
  PRIMARY KEY (id_abatimento),
  KEY idx_abatimento_os (id_os),
  KEY idx_abatimento_orcamento (id_orcamento),
  KEY idx_abatimento_usuario_registro (id_usuario_registro),
  KEY idx_abatimento_usuario_cancelamento (id_usuario_cancelamento),
  CONSTRAINT fk_abatimento_os FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_abatimento_orcamento FOREIGN KEY (id_orcamento) REFERENCES orcamento (id_orcamento) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_abatimento_usuario_registro FOREIGN KEY (id_usuario_registro) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_abatimento_usuario_cancelamento FOREIGN KEY (id_usuario_cancelamento) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_abatimento_valor CHECK (valor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Abatimentos formais do total devido da OS (R1)';
