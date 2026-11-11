-- ESTRUTURA (somente DDL, SEM DADOS) do banco principal imediatamente ANTES das migrações 20261109_01..04,
-- extraída com mysqldump --no-data em 09/11/2026 17:02 (login-path assistencia). A tabela auxiliar
-- solicitacao_status_backup, criada no passo 2 do procedimento, foi retirada deste arquivo.
-- Uso: testes de integração das guardas (backend/integracao/migracoes.integracao.js), que precisam do
-- estado anterior depois que o banco principal foi migrado. Executar SOMENTE em banco terminado em _teste.
-- MySQL dump 10.13  Distrib 8.0.46, for Win64 (x86_64)
--
-- Host: localhost    Database: assistencia_tecnica
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `acessorio`
--

DROP TABLE IF EXISTS `acessorio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acessorio` (
  `id_acessorio` int NOT NULL AUTO_INCREMENT,
  `descricao` varchar(150) NOT NULL,
  `preco_atual` decimal(10,2) DEFAULT NULL,
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_acessorio`),
  CONSTRAINT `chk_acessorio_preco` CHECK ((`preco_atual` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `acessorio_recebido`
--

DROP TABLE IF EXISTS `acessorio_recebido`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `acessorio_recebido` (
  `id_acessorio_recebido` int NOT NULL AUTO_INCREMENT,
  `id_item` int NOT NULL,
  `id_acessorio` int NOT NULL,
  `quantidade` int NOT NULL,
  `observacoes` text,
  PRIMARY KEY (`id_acessorio_recebido`),
  KEY `id_item` (`id_item`),
  KEY `id_acessorio` (`id_acessorio`),
  CONSTRAINT `acessorio_recebido_ibfk_1` FOREIGN KEY (`id_item`) REFERENCES `item_solicitacao` (`id_item`),
  CONSTRAINT `acessorio_recebido_ibfk_2` FOREIGN KEY (`id_acessorio`) REFERENCES `acessorio` (`id_acessorio`),
  CONSTRAINT `chk_acessorio_recebido_quantidade` CHECK ((`quantidade` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cliente`
--

DROP TABLE IF EXISTS `cliente`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cliente` (
  `id_cliente` int NOT NULL AUTO_INCREMENT,
  `tipo_pessoa` varchar(10) NOT NULL,
  `nome_razao_social` varchar(200) NOT NULL,
  `cpf_cnpj` varchar(14) NOT NULL,
  `telefone` varchar(20) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `cep` varchar(8) NOT NULL,
  `logradouro` varchar(150) NOT NULL,
  `numero` varchar(10) NOT NULL,
  `complemento` varchar(100) DEFAULT NULL,
  `bairro` varchar(100) NOT NULL,
  `cidade` varchar(100) NOT NULL,
  `uf` char(2) NOT NULL,
  PRIMARY KEY (`id_cliente`),
  UNIQUE KEY `uq_cliente_cpf_cnpj` (`cpf_cnpj`),
  CONSTRAINT `ck_cliente_cep` CHECK (regexp_like(`cep`,_utf8mb4'^[0-9]{8}$')),
  CONSTRAINT `ck_cliente_cpf_cnpj` CHECK ((regexp_like(`cpf_cnpj`,_utf8mb4'^[0-9]+$') and (((`tipo_pessoa` = _utf8mb4'FISICA') and (char_length(`cpf_cnpj`) = 11)) or ((`tipo_pessoa` = _utf8mb4'JURIDICA') and (char_length(`cpf_cnpj`) = 14))))),
  CONSTRAINT `ck_cliente_tipo_pessoa` CHECK ((`tipo_pessoa` in (_utf8mb4'FISICA',_utf8mb4'JURIDICA')))
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Clientes (pessoa fisica ou juridica); sem login nesta versao';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `execucao`
--

DROP TABLE IF EXISTS `execucao`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `execucao` (
  `id_execucao` int NOT NULL AUTO_INCREMENT,
  `id_os` int NOT NULL,
  `id_tecnico` int NOT NULL,
  `diagnostico` text NOT NULL,
  `laudo_tecnico` text,
  `resultado` text,
  `data_inicio` datetime NOT NULL,
  `data_conclusao` datetime DEFAULT NULL,
  PRIMARY KEY (`id_execucao`),
  UNIQUE KEY `id_os` (`id_os`),
  KEY `id_tecnico` (`id_tecnico`),
  CONSTRAINT `execucao_ibfk_1` FOREIGN KEY (`id_os`) REFERENCES `ordem_servico` (`id_os`),
  CONSTRAINT `execucao_ibfk_2` FOREIGN KEY (`id_tecnico`) REFERENCES `usuario` (`id_usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `expedicao`
--

DROP TABLE IF EXISTS `expedicao`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expedicao` (
  `id_expedicao` int NOT NULL AUTO_INCREMENT,
  `id_os` int NOT NULL,
  `id_usuario` int NOT NULL,
  `data_envio` datetime DEFAULT NULL,
  `forma_entrega` enum('RETIRADA','ENVIO') DEFAULT NULL,
  `codigo_rastreio` varchar(100) DEFAULT NULL,
  `status` enum('PENDENTE','EM_TRANSITO','AGUARDANDO_RETIRADA','ENTREGUE','RETIRADO') NOT NULL,
  `data_entrega` datetime DEFAULT NULL,
  PRIMARY KEY (`id_expedicao`),
  UNIQUE KEY `id_os` (`id_os`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `expedicao_ibfk_1` FOREIGN KEY (`id_os`) REFERENCES `ordem_servico` (`id_os`),
  CONSTRAINT `expedicao_ibfk_2` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `historico_os`
--

DROP TABLE IF EXISTS `historico_os`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `historico_os` (
  `id_historico` int NOT NULL AUTO_INCREMENT,
  `id_os` int NOT NULL,
  `id_usuario` int DEFAULT NULL,
  `tipo_evento` enum('CRIACAO','ATRIBUICAO_TECNICO','DIAGNOSTICO','GARANTIA','ORCAMENTO','REPARO','ENCERRAMENTO','PAGAMENTO','EXPEDICAO') NOT NULL,
  `descricao` text NOT NULL,
  `data_evento` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `dados_anteriores` json DEFAULT NULL,
  `dados_novos` json DEFAULT NULL,
  PRIMARY KEY (`id_historico`),
  KEY `idx_historico_os` (`id_os`),
  KEY `idx_historico_usuario` (`id_usuario`),
  CONSTRAINT `fk_historico_os_ordem_servico` FOREIGN KEY (`id_os`) REFERENCES `ordem_servico` (`id_os`),
  CONSTRAINT `fk_historico_os_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `item_orcamento`
--

DROP TABLE IF EXISTS `item_orcamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `item_orcamento` (
  `id_item_orcamento` int NOT NULL AUTO_INCREMENT,
  `id_orcamento` int NOT NULL,
  `tipo_item` enum('PECA','SERVICO') NOT NULL,
  `descricao` varchar(255) NOT NULL,
  `quantidade` int NOT NULL,
  `valor_unitario` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id_item_orcamento`),
  KEY `id_orcamento` (`id_orcamento`),
  CONSTRAINT `item_orcamento_ibfk_1` FOREIGN KEY (`id_orcamento`) REFERENCES `orcamento` (`id_orcamento`),
  CONSTRAINT `chk_item_orcamento_quantidade` CHECK ((`quantidade` > 0)),
  CONSTRAINT `chk_item_orcamento_valor` CHECK ((`valor_unitario` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `item_solicitacao`
--

DROP TABLE IF EXISTS `item_solicitacao`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `item_solicitacao` (
  `id_item` int NOT NULL AUTO_INCREMENT,
  `id_solicitacao` int NOT NULL,
  `tipo_equipamento` varchar(100) NOT NULL,
  `marca` varchar(100) NOT NULL,
  `modelo` varchar(100) NOT NULL,
  `numero_serie` varchar(100) DEFAULT NULL,
  `estado_fisico` text NOT NULL,
  `observacoes` text,
  PRIMARY KEY (`id_item`),
  KEY `id_solicitacao` (`id_solicitacao`),
  CONSTRAINT `item_solicitacao_ibfk_1` FOREIGN KEY (`id_solicitacao`) REFERENCES `solicitacao` (`id_solicitacao`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `orcamento`
--

DROP TABLE IF EXISTS `orcamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orcamento` (
  `id_orcamento` int NOT NULL AUTO_INCREMENT,
  `id_os` int NOT NULL,
  `id_tecnico` int NOT NULL,
  `data_emissao` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `data_validade` datetime NOT NULL,
  `valor_total` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` enum('PENDENTE','APROVADO','REJEITADO','VENCIDO','CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  PRIMARY KEY (`id_orcamento`),
  KEY `id_os` (`id_os`),
  KEY `id_tecnico` (`id_tecnico`),
  CONSTRAINT `orcamento_ibfk_1` FOREIGN KEY (`id_os`) REFERENCES `ordem_servico` (`id_os`),
  CONSTRAINT `orcamento_ibfk_2` FOREIGN KEY (`id_tecnico`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `chk_orcamento_validade` CHECK ((`data_validade` > `data_emissao`)),
  CONSTRAINT `chk_orcamento_valor` CHECK ((`valor_total` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ordem_servico`
--

DROP TABLE IF EXISTS `ordem_servico`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ordem_servico` (
  `id_os` int NOT NULL AUTO_INCREMENT,
  `id_item` int NOT NULL,
  `id_tecnico` int DEFAULT NULL,
  `data_abertura` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('RECEBIDA','EM_ANALISE','AGUARDANDO_APROVACAO','EM_REPARO','CONCLUIDA','AGUARDANDO_EXPEDICAO','FINALIZADA','ENCERRADA_SEM_REPARO') NOT NULL DEFAULT 'RECEBIDA',
  `data_encerramento` datetime DEFAULT NULL,
  `motivo_encerramento` text,
  `garantia_status` enum('PENDENTE','SIM','NAO') NOT NULL DEFAULT 'PENDENTE',
  `tipo_encerramento` enum('IMPOSSIBILIDADE_TECNICA','DESISTENCIA_CLIENTE','ORCAMENTO_REJEITADO') DEFAULT NULL,
  `id_usuario_encerramento` int DEFAULT NULL,
  PRIMARY KEY (`id_os`),
  KEY `id_item` (`id_item`),
  KEY `id_tecnico` (`id_tecnico`),
  KEY `fk_os_usuario_encerramento` (`id_usuario_encerramento`),
  CONSTRAINT `fk_os_usuario_encerramento` FOREIGN KEY (`id_usuario_encerramento`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `ordem_servico_ibfk_1` FOREIGN KEY (`id_item`) REFERENCES `item_solicitacao` (`id_item`),
  CONSTRAINT `ordem_servico_ibfk_2` FOREIGN KEY (`id_tecnico`) REFERENCES `usuario` (`id_usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pagamento`
--

DROP TABLE IF EXISTS `pagamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagamento` (
  `id_pagamento` int NOT NULL AUTO_INCREMENT,
  `id_os` int NOT NULL,
  `data_pagamento` datetime DEFAULT NULL,
  `valor` decimal(10,2) NOT NULL,
  `forma_pagamento` varchar(50) DEFAULT NULL,
  `status` enum('PENDENTE','CONFIRMADO','CANCELADO','REEMBOLSADO') NOT NULL DEFAULT 'PENDENTE',
  `data_reembolso` datetime DEFAULT NULL,
  `id_usuario_reembolso` int DEFAULT NULL,
  `justificativa_reembolso` text,
  PRIMARY KEY (`id_pagamento`),
  KEY `id_os` (`id_os`),
  KEY `fk_pagamento_usuario_reembolso` (`id_usuario_reembolso`),
  CONSTRAINT `fk_pagamento_usuario_reembolso` FOREIGN KEY (`id_usuario_reembolso`) REFERENCES `usuario` (`id_usuario`),
  CONSTRAINT `pagamento_ibfk_1` FOREIGN KEY (`id_os`) REFERENCES `ordem_servico` (`id_os`),
  CONSTRAINT `chk_pagamento_valor_positivo` CHECK ((`valor` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resposta_orcamento`
--

DROP TABLE IF EXISTS `resposta_orcamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resposta_orcamento` (
  `id_resposta` int NOT NULL AUTO_INCREMENT,
  `id_orcamento` int NOT NULL,
  `id_usuario` int NOT NULL,
  `decisao` enum('APROVADO','REJEITADO') NOT NULL,
  `data_resposta` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `observacoes` text,
  PRIMARY KEY (`id_resposta`),
  UNIQUE KEY `id_orcamento` (`id_orcamento`),
  KEY `id_usuario` (`id_usuario`),
  CONSTRAINT `resposta_orcamento_ibfk_1` FOREIGN KEY (`id_orcamento`) REFERENCES `orcamento` (`id_orcamento`),
  CONSTRAINT `resposta_orcamento_ibfk_2` FOREIGN KEY (`id_usuario`) REFERENCES `usuario` (`id_usuario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `solicitacao`
--

DROP TABLE IF EXISTS `solicitacao`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `solicitacao` (
  `id_solicitacao` int NOT NULL AUTO_INCREMENT,
  `id_cliente` int NOT NULL,
  `id_atendente` int NOT NULL,
  `data_abertura` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `descricao_inicial` text NOT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'RECEBIDA',
  PRIMARY KEY (`id_solicitacao`),
  KEY `id_cliente` (`id_cliente`),
  KEY `id_atendente` (`id_atendente`),
  CONSTRAINT `solicitacao_ibfk_1` FOREIGN KEY (`id_cliente`) REFERENCES `cliente` (`id_cliente`),
  CONSTRAINT `solicitacao_ibfk_2` FOREIGN KEY (`id_atendente`) REFERENCES `usuario` (`id_usuario`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `usuario`
--

DROP TABLE IF EXISTS `usuario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario` (
  `id_usuario` int NOT NULL AUTO_INCREMENT,
  `nome` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `senha_hash` varchar(255) NOT NULL,
  `perfil` enum('ADMINISTRADOR','ATENDENTE','TECNICO') NOT NULL,
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed
