-- Migração: avaliação financeira e reembolso parcial (decisões D1–D6 de 09/11/2026)
-- Situação: EXECUTADA NO BANCO PRINCIPAL em 09/11/2026 17:02 (autorizada; backup antes: assistencia_tecnica_20261109_170123_antes_migracoes.sql). A guarda abaixo impede reexecução.
-- Aditiva: cria duas tabelas e copia os reembolsos integrais antigos; não altera nem apaga dados existentes.
-- Detalhes: documentacao/PROPOSTA_REEMBOLSO_PARCIAL.md
-- Arquivo: 20261109_02_avaliacao_reembolso_parcial.sql (nome anterior: 20261110_avaliacao_reembolso_parcial.sql; renomeado em 09/11/2026 para a data real de criação e a ordem de execução).

-- ===== GUARDA DE PRÉ-CONDIÇÃO (não remover) =====
-- Executa somente depois da migração 1 (sem solicitacao.status) e se avaliacao_reembolso e reembolso ainda não existem.
-- Se o banco não estiver exatamente no estado esperado, a execução para aqui com o erro
-- "PROCEDURE ...migracao_20261109_02_bloqueada_ja_aplicada_ou_fora_de_ordem does not exist" e NADA desta migração é aplicado.
-- (O cliente mysql e o executor Node param no primeiro erro; não usar --force.)
SET @migracao_ok = (SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'solicitacao' AND COLUMN_NAME = 'status') = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('solicitacao')) = 1 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('avaliacao_reembolso', 'reembolso')) = 0);
SET @migracao_sql = IF(@migracao_ok = 1, 'DO 0', 'CALL migracao_20261109_02_bloqueada_ja_aplicada_ou_fora_de_ordem()');
PREPARE migracao_guarda FROM @migracao_sql;
EXECUTE migracao_guarda;
DEALLOCATE PREPARE migracao_guarda;
-- ===== FIM DA GUARDA =====

-- Decisão financeira da OS (original + revisões). Linhas imutáveis pela aplicação.
CREATE TABLE avaliacao_reembolso (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Avaliacao financeira de reembolso da OS (original e revisoes)';

-- Cada devolução de dinheiro (parcial ou integral) de um pagamento confirmado.
CREATE TABLE reembolso (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Reembolsos (parciais ou integrais) de pagamentos confirmados';

-- Reembolsos integrais antigos (RN16) passam a ter a linha correspondente.
INSERT INTO reembolso (id_pagamento, id_avaliacao, valor, justificativa, id_usuario, data_reembolso)
SELECT p.id_pagamento, NULL, p.valor,
       COALESCE(NULLIF(TRIM(p.justificativa_reembolso), ''), 'Reembolso integral registrado antes da migração.'),
       p.id_usuario_reembolso, COALESCE(p.data_reembolso, CURRENT_TIMESTAMP)
FROM pagamento p
WHERE p.status = 'REEMBOLSADO'
  AND p.id_usuario_reembolso IS NOT NULL;

-- Conferência: reembolsos antigos sem usuário (não copiados). Esperado: 0.
SELECT COUNT(*) AS reembolsos_antigos_sem_usuario
FROM pagamento
WHERE status = 'REEMBOLSADO' AND id_usuario_reembolso IS NULL;
