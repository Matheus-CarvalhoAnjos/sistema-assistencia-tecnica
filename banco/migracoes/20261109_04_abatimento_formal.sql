-- Migração 4: abatimento formal (regra R1; decisões A1–A8, C1, C2 de 09/11/2026)
-- Situação: EXECUTADA NO BANCO PRINCIPAL em 09/11/2026 17:02 (autorizada; backup antes: assistencia_tecnica_20261109_170123_antes_migracoes.sql). A guarda abaixo impede reexecução.
-- Aditiva: cria a tabela abatimento e acrescenta ABATIMENTO ao domínio de historico_os.tipo_evento.
-- Executar DEPOIS da migração 20261109_03_historico_evento_acessorio.sql (o ENUM abaixo mantém ACESSORIO).
-- Especificação: documentacao/REGRAS_DECISOES_PENDENCIAS.md, seção 3.5.
-- Arquivo: 20261109_04_abatimento_formal.sql (nome anterior: 20261110_abatimento_formal.sql; renomeado em 09/11/2026 para a data real de criação e a ordem de execução).

-- ===== GUARDA DE PRÉ-CONDIÇÃO (não remover) =====
-- Executa somente depois da migração 3 (tipo_evento com ACESSORIO e sem ABATIMENTO) e se a tabela abatimento ainda não existe.
-- Se o banco não estiver exatamente no estado esperado, a execução para aqui com o erro
-- "PROCEDURE ...migracao_20261109_04_bloqueada_ja_aplicada_ou_fora_de_ordem does not exist" e NADA desta migração é aplicado.
-- (O cliente mysql e o executor Node param no primeiro erro; não usar --force.)
SET @migracao_ok = (SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('avaliacao_reembolso', 'reembolso')) = 2 AND (SELECT UPPER(REPLACE(COLUMN_TYPE, ' ', '')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_os' AND COLUMN_NAME = 'tipo_evento') LIKE '%''ACESSORIO''%' AND (SELECT UPPER(REPLACE(COLUMN_TYPE, ' ', '')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_os' AND COLUMN_NAME = 'tipo_evento') NOT LIKE '%''ABATIMENTO''%' AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('abatimento')) = 0);
SET @migracao_sql = IF(@migracao_ok = 1, 'DO 0', 'CALL migracao_20261109_04_bloqueada_ja_aplicada_ou_fora_de_ordem()');
PREPARE migracao_guarda FROM @migracao_sql;
EXECUTE migracao_guarda;
DEALLOCATE PREPARE migracao_guarda;
-- ===== FIM DA GUARDA =====

-- Abatimento formal: reduz o total devido da OS sem alterar o orçamento aprovado (R1).
-- Nasce APROVADO (A1); cancelamento preserva o registro (A5). Coerência "CANCELADO ⇔ campos de
-- cancelamento preenchidos" e "orçamento aprovado da mesma OS" são validadas no backend.
CREATE TABLE abatimento (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Abatimentos formais do total devido da OS (R1)';

-- Novo tipo de evento (A6). Mantém todos os valores anteriores, inclusive ACESSORIO (migração 3).
ALTER TABLE historico_os
  MODIFY tipo_evento ENUM('CRIACAO', 'ATRIBUICAO_TECNICO', 'DIAGNOSTICO', 'GARANTIA', 'ORCAMENTO', 'REPARO', 'ENCERRAMENTO', 'PAGAMENTO', 'EXPEDICAO', 'ACESSORIO', 'ABATIMENTO') NOT NULL;
