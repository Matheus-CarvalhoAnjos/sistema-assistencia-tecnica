-- Migração: remover a coluna legada solicitacao.status (MER v1.4, RN22)
-- Situação: EXECUTADA NO BANCO PRINCIPAL em 09/11/2026 17:02 (autorizada; backup antes: assistencia_tecnica_20261109_170123_antes_migracoes.sql). A guarda abaixo impede reexecução.
-- Executar no banco principal somente com autorização e depois do backup descrito em
-- documentacao/MIGRACOES_BACKUP_RECUPERACAO.md.
--
-- RN22: SOLICITACAO não possui status próprio; o andamento é acompanhado pelas OS.
--
-- Dependências já resolvidas (09/11/2026):
--   - backend: solicitacaoRepository não lê nem grava mais a coluna (criação, listagem e detalhes);
--   - frontend: o model SolicitacaoCriada não tem mais o campo status;
--   - nenhuma FK, índice, CHECK, view, trigger ou procedure usa a coluna (conferido no INFORMATION_SCHEMA).
--
-- banco/sql/04_solicitacao.sql e banco/esquema_esperado.json JÁ descrevem o estado sem a coluna.
--
-- Os valores atuais da coluna não têm significado de negócio (todos recebem o padrão 'RECEBIDA').
-- Para guardar uma cópia antes de remover:
--   CREATE TABLE solicitacao_status_backup AS SELECT id_solicitacao, status FROM solicitacao;
-- Arquivo: 20261109_01_remover_status_solicitacao.sql (nome anterior: 20261109_remover_status_solicitacao.sql; renomeado em 09/11/2026 para a data real de criação e a ordem de execução).

-- ===== GUARDA DE PRÉ-CONDIÇÃO (não remover) =====
-- Executa somente se solicitacao.status ainda existe (migração 1 ainda não aplicada).
-- Se o banco não estiver exatamente no estado esperado, a execução para aqui com o erro
-- "PROCEDURE ...migracao_20261109_01_bloqueada_ja_aplicada_ou_fora_de_ordem does not exist" e NADA desta migração é aplicado.
-- (O cliente mysql e o executor Node param no primeiro erro; não usar --force.)
SET @migracao_ok = (SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'solicitacao' AND COLUMN_NAME = 'status') = 1);
SET @migracao_sql = IF(@migracao_ok = 1, 'DO 0', 'CALL migracao_20261109_01_bloqueada_ja_aplicada_ou_fora_de_ordem()');
PREPARE migracao_guarda FROM @migracao_sql;
EXECUTE migracao_guarda;
DEALLOCATE PREPARE migracao_guarda;
-- ===== FIM DA GUARDA =====

-- Conferência prévia (somente leitura): deve retornar 0 linhas além da própria tabela
SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'solicitacao'
  AND COLUMN_NAME = 'status';

ALTER TABLE solicitacao DROP COLUMN status;
