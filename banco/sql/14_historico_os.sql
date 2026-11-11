-- Tabela 14 de 17: historico_os
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.14, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS).
-- Regras do MER v1.4 (RN21): eventos relevantes da OS; registros permanentes, sem edicao ou exclusao
-- pela interface (correcoes geram novo evento). id_usuario aceita NULL para eventos automaticos.
-- Nao ha triggers: o backend registra os eventos na camada de servicos.
-- ACESSORIO (decisao D7, P4): inclusao de acessorio depois da abertura. ESTADO DE DESTINO: no banco
-- principal depende da migracao banco/migracoes/20261109_03_historico_evento_acessorio.sql.
-- ABATIMENTO (R1, A6): registro e cancelamento de abatimentos. ESTADO DE DESTINO: depende da
-- migracao banco/migracoes/20261109_04_abatimento_formal.sql.
CREATE TABLE IF NOT EXISTS historico_os (
  id_historico INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  id_usuario INT NULL,
  tipo_evento ENUM('CRIACAO', 'ATRIBUICAO_TECNICO', 'DIAGNOSTICO', 'GARANTIA', 'ORCAMENTO', 'REPARO', 'ENCERRAMENTO', 'PAGAMENTO', 'EXPEDICAO', 'ACESSORIO', 'ABATIMENTO') NOT NULL,
  descricao TEXT NOT NULL,
  data_evento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dados_anteriores JSON NULL,
  dados_novos JSON NULL,
  PRIMARY KEY (id_historico),
  KEY idx_historico_os (id_os),
  KEY idx_historico_usuario (id_usuario),
  CONSTRAINT fk_historico_os_ordem_servico FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_historico_os_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Linha do tempo de eventos de cada ordem de servico';
