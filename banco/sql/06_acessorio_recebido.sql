-- Tabela 06 de 17: acessorio_recebido
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.6, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS).
-- Regras do MER v1.4 (RN23): cada ocorrencia de acessorio e uma linha propria. O mesmo acessorio
-- pode aparecer em linhas separadas para o mesmo equipamento, por isso NAO ha UNIQUE (id_item, id_acessorio).
-- quantidade: INT com CHECK > 0, sem valor padrao (o backend sempre informa o valor).
CREATE TABLE IF NOT EXISTS acessorio_recebido (
  id_acessorio_recebido INT NOT NULL AUTO_INCREMENT,
  id_item INT NOT NULL,
  id_acessorio INT NOT NULL,
  quantidade INT NOT NULL,
  observacoes TEXT NULL,
  PRIMARY KEY (id_acessorio_recebido),
  CONSTRAINT fk_acessorio_recebido_item FOREIGN KEY (id_item) REFERENCES item_solicitacao (id_item) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_acessorio_recebido_acessorio FOREIGN KEY (id_acessorio) REFERENCES acessorio (id_acessorio) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_acessorio_recebido_quantidade CHECK (quantidade > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Acessorios recebidos junto com cada equipamento';
