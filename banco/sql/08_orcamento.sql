-- Tabela 08 de 17: orcamento
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.8, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: varios orcamentos por OS, somente um PENDENTE por vez (validado no backend, RN17);
-- validade de 72 horas (RN10); valor_total armazenado na emissao (RN24); id_tecnico preserva o autor.
-- Status: PENDENTE, APROVADO, REJEITADO, VENCIDO ou CANCELADO.
CREATE TABLE IF NOT EXISTS orcamento (
  id_orcamento INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  id_tecnico INT NOT NULL,
  data_emissao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  data_validade DATETIME NOT NULL,
  valor_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  status ENUM('PENDENTE', 'APROVADO', 'REJEITADO', 'VENCIDO', 'CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  PRIMARY KEY (id_orcamento),
  CONSTRAINT fk_orcamento_os FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_orcamento_tecnico FOREIGN KEY (id_tecnico) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_orcamento_validade CHECK (data_validade > data_emissao),
  CONSTRAINT chk_orcamento_valor CHECK (valor_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Orcamentos de cada ordem de servico (historico preservado)';
