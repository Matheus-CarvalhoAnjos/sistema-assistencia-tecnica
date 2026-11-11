-- Tabela 04 de 17: solicitacao
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.3, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS).
-- Regras do MER v1.4: pertence a um CLIENTE e registra o ATENDENTE (USUARIO) que abriu;
-- descricao_inicial e obrigatoria (RN25).
-- RN22: a solicitacao NAO possui status proprio; o andamento e acompanhado pelas OS.
-- A coluna legada "status" foi retirada deste script. No banco principal ela foi removida pela
-- migracao banco/migracoes/20261109_01_remover_status_solicitacao.sql (aplicada em 09/11/2026).
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS solicitacao (
  id_solicitacao INT NOT NULL AUTO_INCREMENT,
  id_cliente INT NOT NULL,
  id_atendente INT NOT NULL,
  data_abertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  descricao_inicial TEXT NOT NULL,
  PRIMARY KEY (id_solicitacao),
  CONSTRAINT fk_solicitacao_cliente FOREIGN KEY (id_cliente) REFERENCES cliente (id_cliente) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_solicitacao_atendente FOREIGN KEY (id_atendente) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Solicitacao de assistencia aberta por um atendente para um cliente';
