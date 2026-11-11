# Avaliação financeira e reembolso parcial — proposta aprovada

**Situação:** decisões aprovadas em 09/11/2026. Implementação feita **somente no banco de teste** (`*_teste`), backend e frontend. **Nenhuma migração foi executada no banco principal** `assistencia_tecnica`.
Referência: MER v1.4 consolidado (08/11/2026).

## 1. Decisões aprovadas

| # | Tema | Decisão |
|---|---|---|
| 1 | Obrigatoriedade | Toda OS encerrada por **IMPOSSIBILIDADE_TECNICA durante EM_REPARO** com **pelo menos um pagamento CONFIRMADO** passa obrigatoriamente por avaliação financeira, registrada **mesmo quando o valor definido for zero** |
| 2 | Revisão | A avaliação original **não é editada nem excluída**. Correções geram um **novo registro de revisão**, que preserva a avaliação anterior e registra a justificativa da correção, o responsável e a data |
| 3 | Abrangência | Obrigatória **somente** para IMPOSSIBILIDADE_TECNICA durante EM_REPARO. Não se estende a desistência, rejeição de orçamento nem OS FINALIZADA |
| 4 | Orçamento aprovado | Permanece **APROVADO** como registro histórico; a avaliação não altera o orçamento |
| 5 | Reembolso em OS FINALIZADA | Mantido como hoje, **sem automação**, com justificativa, responsável, data e evento no histórico |
| 6 | Reembolso parcial | Permitido, limitado ao **valor ainda disponível para devolução** |

Base: Opção C (encerramento preserva orçamento aprovado e pagamentos confirmados; sem reembolso automático; ADM ou ATD avalia cada caso; reembolso é operação separada).

## 2. Por que o modelo atual não basta

- `pagamento` só registra **um reembolso integral** (status `REEMBOLSADO` + `data_reembolso`, `id_usuario_reembolso`, `justificativa_reembolso`), conforme RN16.
- A decisão financeira pertence à **OS** (pode ser R$ 0 e abranger vários pagamentos) e precisa de histórico de revisões. Não há onde guardá-la.

## 3. Modelo (MER) — duas entidades novas, sem alterar as existentes

### 3.1 AVALIACAO_REEMBOLSO (decisão, imutável)

| Coluna | Tipo | Regra |
|---|---|---|
| `id_avaliacao` | INT PK AUTO_INCREMENT | |
| `id_os` | INT NOT NULL, FK `ordem_servico` | OS avaliada |
| `id_avaliacao_revisada` | INT NULL, FK `avaliacao_reembolso`, **UNIQUE** | NULL = avaliação original; preenchido = revisão do registro indicado. UNIQUE impede duas revisões do mesmo registro (cadeia linear) |
| `id_os_original` | INT **gerada** (`id_os` quando `id_avaliacao_revisada` é NULL), **UNIQUE** | Garante **no banco** uma única avaliação original por OS, inclusive com requisições simultâneas |
| `valor_definido` | DECIMAL(10,2) NOT NULL, CHECK `>= 0` | Valor definido para eventual reembolso (pode ser 0) |
| `justificativa` | TEXT NOT NULL | Justificativa da decisão |
| `motivo_revisao` | TEXT NULL | Obrigatório nas revisões (justificativa da correção); NULL na original (validado no backend) |
| `id_usuario` | INT NOT NULL, FK `usuario` | Responsável (ADM ou ATD ativo) |
| `data_avaliacao` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

A **avaliação vigente** é a última da cadeia (a que não foi revisada). Nenhuma linha é alterada ou excluída pela aplicação.

### 3.2 REEMBOLSO (execução, zero ou mais por pagamento)

| Coluna | Tipo | Regra |
|---|---|---|
| `id_reembolso` | INT PK AUTO_INCREMENT | |
| `id_pagamento` | INT NOT NULL, FK `pagamento` | Somente pagamento CONFIRMADO |
| `id_avaliacao` | INT NULL, FK `avaliacao_reembolso` | Avaliação vigente quando o reembolso cumpre uma avaliação |
| `valor` | DECIMAL(10,2) NOT NULL, CHECK `> 0` | ≤ valor disponível do pagamento |
| `justificativa` | TEXT NOT NULL | |
| `id_usuario` | INT NOT NULL, FK `usuario` | |
| `data_reembolso` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

### 3.3 Alterações em tabelas existentes

| Tabela | Alteração | Motivo |
|---|---|---|
| `historico_os` | **Nenhuma** para esta proposta. Avaliação, revisão e reembolso são eventos `PAGAMENTO` (dado financeiro, já oculto do técnico) | Não criar tipo de evento sem necessidade |
| `pagamento` | **Nenhuma coluna**. `REEMBOLSADO` passa a significar "valor inteiro devolvido" (soma dos reembolsos = valor). Enquanto houver saldo a devolver, o pagamento continua `CONFIRMADO`. As colunas `data_reembolso`, `id_usuario_reembolso` e `justificativa_reembolso` passam a ser um **resumo de compatibilidade**, preenchido quando o pagamento fica `REEMBOLSADO` (dados do reembolso que completou o valor). A fonte da verdade é `reembolso` | Compatibilidade com RN16 e com os dados existentes |

Migração dos reembolsos antigos: cada pagamento `REEMBOLSADO` com usuário registrado ganha uma linha em `reembolso` com o valor integral (o banco principal não tem pagamentos hoje).

## 4. Regras de negócio

**R1 — OS que exige avaliação:** `tipo_encerramento = IMPOSSIBILIDADE_TECNICA`, existe orçamento `APROVADO` (prova de que a OS estava em EM_REPARO: só a aprovação leva a EM_REPARO e a impossibilidade só é aceita até EM_REPARO) e existe pagamento `CONFIRMADO`. Calculado, sem coluna nova.

**R2 — Registrar avaliação original:** ADM ou ATD ativo; somente em OS que exige avaliação (R1); uma por OS; `valor_definido` entre 0 e o **total disponível para devolução** (soma, nos pagamentos CONFIRMADO, de valor − já reembolsado); justificativa obrigatória.

**R3 — Revisão:** ADM ou ATD ativo; refere-se à avaliação vigente; exige `motivo_revisao`; o novo valor fica entre o **já reembolsado sob avaliação** e esse valor somado ao disponível. A avaliação anterior permanece intacta.

**R4 — Reembolso (todas as OS):** ADM ou ATD ativo; pagamento CONFIRMADO; `valor` opcional (sem valor = todo o disponível, comportamento atual), > 0, até 2 casas e ≤ disponível do pagamento; justificativa obrigatória; gera evento `PAGAMENTO`. Quando a soma atinge o valor do pagamento, ele passa a `REEMBOLSADO`.

**R5 — Reembolso em OS que exige avaliação:** só depois de registrada a avaliação; soma dos reembolsos sob avaliação ≤ `valor_definido` vigente; o reembolso guarda a avaliação vigente.

**R6 — Saldo (RN14 revisada):** total pago = Σ (valor − reembolsado) dos pagamentos CONFIRMADO; REEMBOLSADO conta 0. O limite de novos pagamentos (RN15) e a quitação da expedição (RN20) usam esse valor.

> **Regra R1 do projeto — abatimento formal (implementada em ambiente de teste em 09/11/2026; não confundir com a regra R1 desta proposta, "OS que exige avaliação"):** o *total devido* passa a ser o orçamento aprovado menos os abatimentos aprovados, registrados na entidade `ABATIMENTO`, separada de `REEMBOLSO`. O total pago (R6) não muda: o reembolso altera o total pago e o abatimento altera o total devido. Especificação completa: `REGRAS_DECISOES_PENDENCIAS.md`, seção 3.5.

**R7 — Concorrência:** avaliação e reembolso bloqueiam a OS e os pagamentos (`SELECT ... FOR UPDATE`) na mesma transação do histórico.

**R8 — Visibilidade:** avaliação e reembolsos só para ADM e ATD; o técnico continua sem acesso a dados financeiros (P3).

## 5. API

| Método | Rota | Perfis | Corpo |
|---|---|---|---|
| GET | `/ordens-servico/:id/avaliacao-financeira` | ADM, ATD | — → `{ obrigatoria, pendente, vigente, avaliacoes[], total_disponivel, total_reembolsado_avaliacao }` |
| POST | `/ordens-servico/:id/avaliacao-financeira` | ADM, ATD | `{ valor_definido, justificativa }` |
| POST | `/ordens-servico/:id/avaliacao-financeira/revisoes` | ADM, ATD | `{ valor_definido, justificativa, motivo_revisao }` |
| PATCH | `/pagamentos/:id/reembolso` | ADM, ATD | `{ justificativa_reembolso, valor? }` |
| GET | `/ordens-servico/:id/pagamentos` | ADM, ATD | Cada pagamento traz `reembolsos[]`, `valor_reembolsado` e `valor_disponivel_reembolso` |

## 6. Avaliação pendente e devolução do equipamento

**Q1 (decidida em 09/11/2026): a avaliação financeira pendente NÃO bloqueia a expedição nem a devolução do equipamento.**
- A expedição é registrada e atualizada normalmente; a entrega ou a retirada pode ser concluída com a avaliação pendente.
- ADMINISTRADOR e ATENDENTE veem o aviso de pendência financeira na OS (seção de avaliação e seção de expedição).
- O reembolso continua bloqueado até o registro da avaliação.
- A expedição não altera o status da OS encerrada sem reparo (continua ENCERRADA_SEM_REPARO).
- Devolução física e avaliação financeira são fluxos separados: a avaliação pode ser registrada antes ou depois da devolução.

Testes: integração real "Q1" (retirada concluída com avaliação pendente, OS continua ENCERRADA_SEM_REPARO, reembolso recusado com 409, avaliação registrada depois libera o reembolso) e testes de tela (aviso exibido para o atendente, botão de devolução habilitado, sem aviso para o técnico nem depois da avaliação).

## 7. Arquivos

- Migração: `banco/migracoes/20261109_02_avaliacao_reembolso_parcial.sql` (executada somente em banco `_teste`).
- Scripts de destino: `banco/sql/15_avaliacao_reembolso.sql`, `banco/sql/16_reembolso.sql`; `banco/esquema_esperado.json`.
