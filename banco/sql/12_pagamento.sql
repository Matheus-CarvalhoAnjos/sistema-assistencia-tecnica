-- Tabela 12 de 17: pagamento
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.12, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: pagamentos parciais (RN15); data_pagamento e forma_pagamento ficam NULL enquanto PENDENTE;
-- valor > 0; reembolso integral e unico de pagamento CONFIRMADO, com data, usuario e justificativa (RN16).
-- Status: PENDENTE, CONFIRMADO, CANCELADO ou REEMBOLSADO. O saldo e calculado no backend (RN14).
CREATE TABLE IF NOT EXISTS pagamento (
  id_pagamento INT NOT NULL AUTO_INCREMENT,
  id_os INT NOT NULL,
  data_pagamento DATETIME NULL,
  valor DECIMAL(10,2) NOT NULL,
  forma_pagamento VARCHAR(50) NULL,
  status ENUM('PENDENTE', 'CONFIRMADO', 'CANCELADO', 'REEMBOLSADO') NOT NULL DEFAULT 'PENDENTE',
  data_reembolso DATETIME NULL,
  id_usuario_reembolso INT NULL,
  justificativa_reembolso TEXT NULL,
  PRIMARY KEY (id_pagamento),
  CONSTRAINT fk_pagamento_os FOREIGN KEY (id_os) REFERENCES ordem_servico (id_os) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pagamento_usuario_reembolso FOREIGN KEY (id_usuario_reembolso) REFERENCES usuario (id_usuario) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_pagamento_valor_positivo CHECK (valor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Pagamentos de cada ordem de servico';
