-- Tabela 13 de 17: expedicao
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.13, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: no maximo uma expedicao por OS (id_os UNIQUE, RN26); id_usuario preserva quem registrou.
-- ENVIO: PENDENTE -> EM_TRANSITO -> ENTREGUE. RETIRADA: AGUARDANDO_RETIRADA -> RETIRADO (RN19, validado no backend).
CREATE TABLE IF NOT EXISTS expedicao (
  id_expedicao INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  id_usuario INT NOT NULL,
  data_envio DATETIME NULL,
  forma_entrega ENUM('RETIRADA', 'ENVIO') NULL,
  codigo_rastreio VARCHAR(100) NULL,
  status ENUM('PENDENTE', 'EM_TRANSITO', 'AGUARDANDO_RETIRADA', 'ENTREGUE', 'RETIRADO') NOT NULL,
  data_entrega DATETIME NULL,
  PRIMARY KEY (id_expedicao),
  CONSTRAINT uq_expedicao_os UNIQUE (id_os),
  CONSTRAINT fk_expedicao_os FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_expedicao_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Devolucao do equipamento ao cliente';
