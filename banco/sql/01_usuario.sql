-- Tabela 01 de 17: usuario
-- Fonte: MER v1.4 consolidado (08/11/2026), secao 4.1, e estrutura real do banco (somente leitura).
-- Seguro para reexecutar (IF NOT EXISTS). Alinhado ao banco real em 09/11/2026.
-- Regras: e-mail UNIQUE; senha apenas como hash (nunca em texto puro); perfil ADMINISTRADOR, ATENDENTE ou TECNICO.
CREATE TABLE IF NOT EXISTS usuario (
  id_usuario INT NOT NULL AUTO_INCREMENT,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  perfil ENUM('ADMINISTRADOR', 'ATENDENTE', 'TECNICO') NOT NULL,
  ativo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id_usuario),
  CONSTRAINT uq_usuario_email UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Funcionarios com acesso ao sistema';
