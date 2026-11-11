-- Migração: tipo de evento ACESSORIO no histórico da OS (decisão D7, P4, de 09/11/2026)
-- Situação: EXECUTADA NO BANCO PRINCIPAL em 09/11/2026 17:02 (autorizada; backup antes: assistencia_tecnica_20261109_170123_antes_migracoes.sql). A guarda abaixo impede reexecução.
-- Aditiva: acrescenta um valor ao final do ENUM; os valores existentes e os dados não mudam.
-- Arquivo: 20261109_03_historico_evento_acessorio.sql (nome anterior: 20261110_historico_evento_acessorio.sql; renomeado em 09/11/2026 para a data real de criação e a ordem de execução).

-- ===== GUARDA DE PRÉ-CONDIÇÃO (não remover) =====
-- Executa somente depois da migração 2 e se historico_os.tipo_evento tem exatamente os 9 valores originais (sem ACESSORIO e sem ABATIMENTO). Impede que esta migração, repetida depois da 4, remova ABATIMENTO.
-- Se o banco não estiver exatamente no estado esperado, a execução para aqui com o erro
-- "PROCEDURE ...migracao_20261109_03_bloqueada_ja_aplicada_ou_fora_de_ordem does not exist" e NADA desta migração é aplicado.
-- (O cliente mysql e o executor Node param no primeiro erro; não usar --force.)
SET @migracao_ok = (SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('avaliacao_reembolso', 'reembolso')) = 2 AND (SELECT UPPER(REPLACE(COLUMN_TYPE, ' ', '')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_os' AND COLUMN_NAME = 'tipo_evento') = 'ENUM(''CRIACAO'',''ATRIBUICAO_TECNICO'',''DIAGNOSTICO'',''GARANTIA'',''ORCAMENTO'',''REPARO'',''ENCERRAMENTO'',''PAGAMENTO'',''EXPEDICAO'')');
SET @migracao_sql = IF(@migracao_ok = 1, 'DO 0', 'CALL migracao_20261109_03_bloqueada_ja_aplicada_ou_fora_de_ordem()');
PREPARE migracao_guarda FROM @migracao_sql;
EXECUTE migracao_guarda;
DEALLOCATE PREPARE migracao_guarda;
-- ===== FIM DA GUARDA =====

ALTER TABLE historico_os
  MODIFY tipo_evento ENUM('CRIACAO', 'ATRIBUICAO_TECNICO', 'DIAGNOSTICO', 'GARANTIA', 'ORCAMENTO', 'REPARO', 'ENCERRAMENTO', 'PAGAMENTO', 'EXPEDICAO', 'ACESSORIO') NOT NULL;
