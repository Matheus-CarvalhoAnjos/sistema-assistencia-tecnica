-- Tabela 10 de 17: resposta_orcamento
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.10, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: no maximo uma resposta final por orcamento (id_orcamento UNIQUE); decisao APROVADO ou REJEITADO,
-- registrada por ADMINISTRADOR ou ATENDENTE (validado no backend).
CREATE TABLE IF NOT EXISTS resposta_orcamento (
  id_resposta INT NOT NULL AUTO_INCREMENT,
  id_orcamento INT NOT NULL,
  id_usuario INT NOT NULL,
  decisao ENUM('APROVADO', 'REJEITADO') NOT NULL,
  data_resposta DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  observacoes TEXT NULL,
  PRIMARY KEY (id_resposta),
  CONSTRAINT uq_resposta_orcamento_orcamento UNIQUE (id_orcamento),
  CONSTRAINT fk_resposta_orcamento_orcamento FOREIGN KEY (id_orcamento) REFERENCES orcamento (id_orcamento) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_resposta_orcamento_usuario FOREIGN KEY (id_usuario) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Decisao final do cliente sobre um orcamento';
