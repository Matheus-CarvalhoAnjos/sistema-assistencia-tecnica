-- Tabela 11 de 17: execucao
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.11, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: no maximo uma execucao por OS (id_os UNIQUE); criada no primeiro diagnostico valido (RN03),
-- com data_inicio obrigatoria; id_tecnico preserva o tecnico que iniciou (RN04).
CREATE TABLE IF NOT EXISTS execucao (
  id_execucao INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  id_tecnico INT NOT NULL,
  diagnostico TEXT NOT NULL,
  laudo_tecnico TEXT NULL,
  resultado TEXT NULL,
  data_inicio DATETIME NOT NULL,
  data_conclusao DATETIME NULL,
  PRIMARY KEY (id_execucao),
  CONSTRAINT uq_execucao_os UNIQUE (id_os),
  CONSTRAINT fk_execucao_os FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_execucao_tecnico FOREIGN KEY (id_tecnico) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Diagnostico, laudo e resultado tecnico de cada OS';
