-- Tabela 07 de 17: ordem_servico
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.7, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS).
-- Regras do MER v1.4:
-- - id_item NAO e UNIQUE: um equipamento pode ter varias OS ao longo do tempo (secao 7).
-- - id_tecnico aceita NULL ate a atribuicao (RN01). Quando preenchido, deve ser usuario ativo com
--   perfil TECNICO; isso e validado pelo backend.
-- - garantia_status pertence a OS: PENDENTE, SIM ou NAO (RN05).
-- - Encerramento sem reparo registra tipo_encerramento, motivo_encerramento, data_encerramento e
--   id_usuario_encerramento (RN11). A obrigatoriedade desses campos no encerramento e validada pelo backend.
-- - Nao ha triggers nem procedures; as regras ficam na camada de servicos do backend (secao 7).
-- Collation explicita (igual a do MySQL local; o padrao do TiDB seria utf8mb4_bin) e, so no TiDB,
-- AUTO_ID_CACHE=1 para IDs sequenciais como no MySQL. O MySQL trata /*T! ... */ como comentario.
CREATE TABLE IF NOT EXISTS ordem_servico (
  id_os INT NOT NULL AUTO_INCREMENT,
  id_item INT NOT NULL,
  id_tecnico INT NULL,
  data_abertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO', 'EM_REPARO', 'CONCLUIDA', 'AGUARDANDO_EXPEDICAO', 'FINALIZADA', 'ENCERRADA_SEM_REPARO') NOT NULL DEFAULT 'RECEBIDA',
  data_encerramento DATETIME NULL,
  motivo_encerramento TEXT NULL,
  garantia_status ENUM('PENDENTE', 'SIM', 'NAO') NOT NULL DEFAULT 'PENDENTE',
  tipo_encerramento ENUM('IMPOSSIBILIDADE_TECNICA', 'DESISTENCIA_CLIENTE', 'ORCAMENTO_REJEITADO') NULL,
  id_usuario_encerramento INT NULL,
  PRIMARY KEY (id_os),
  CONSTRAINT fk_ordem_servico_item FOREIGN KEY (id_item) REFERENCES item_solicitacao (id_item) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ordem_servico_tecnico FOREIGN KEY (id_tecnico) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_os_usuario_encerramento FOREIGN KEY (id_usuario_encerramento) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */ COMMENT='Ordem de servico: atendimento individual de cada equipamento';
