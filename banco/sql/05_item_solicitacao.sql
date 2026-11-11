-- Tabela 05 de 17: item_solicitacao
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.4, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS).
-- Regras do MER v1.4: cada equipamento recebido e um registro proprio; marca e modelo sao texto
-- (sem tabelas separadas); numero_serie e observacoes sao opcionais.
-- garantia_status NAO pertence a esta tabela: a garantia e verificada por OS (RN05; ver 07_ordem_servico.sql).
-- Tamanhos conforme o banco real (decisao D-SOL-5).
CREATE TABLE IF NOT EXISTS item_solicitacao (
  id_item INT NOT NULL AUTO_INCREMENT,
  id_solicitacao INT NOT NULL,
  tipo_equipamento VARCHAR(100) NOT NULL,
  marca VARCHAR(100) NOT NULL,
  modelo VARCHAR(100) NOT NULL,
  numero_serie VARCHAR(100) NULL,
  estado_fisico TEXT NOT NULL,
  observacoes TEXT NULL,
  PRIMARY KEY (id_item),
  CONSTRAINT fk_item_solicitacao_solicitacao FOREIGN KEY (id_solicitacao) REFERENCES solicitacao (id_solicitacao) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Equipamentos de uma solicitacao';
