-- Tabela 03 de 17: acessorio
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.5, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: catalogo de tipos de acessorio; preco de referencia opcional (>= 0); ativo indica se pode ser selecionado.
CREATE TABLE IF NOT EXISTS acessorio (
  id_acessorio INT NOT NULL AUTO_INCREMENT,
  descricao VARCHAR(150) NOT NULL,
  preco_atual DECIMAL(10,2) NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_acessorio),
  CONSTRAINT chk_acessorio_preco CHECK (preco_atual >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Tipos de acessorio que podem ser recebidos';
