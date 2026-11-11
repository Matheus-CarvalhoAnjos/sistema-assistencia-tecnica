PROJETO ASSISTÊNCIA TÉCNICA

MODELO ENTIDADE-RELACIONAMENTO / Versão consolidada 1.5 — proposta consolidada para validação final

Atualizada em 09/11/2026 • Incorpora avaliação financeira, reembolso parcial, abatimento formal e eventos de acessório e abatimento no histórico, sobre a versão 1.4 (08/11/2026)

> **Versão anterior preservada:** o MER v1.4 está em `documentacao/mer/historico/` (`.docx` e `.drawio` originais, cópias idênticas conferidas por SHA-256, e uma transcrição em texto). Nenhuma informação da v1.4 foi descartada: o texto da v1.4 continua neste documento, e cada ponto alterado traz a marca **(v1.5)** e a redação anterior.
>
> **Situação física:** o modelo v1.5 corresponde aos scripts `banco/sql/01–17`, a `banco/esquema_esperado.json` e, **desde 09/11/2026 17:02, ao banco principal `assistencia_tecnica`**: as 4 migrações da seção 13 foram executadas com autorização, e a verificação deu 17 tabelas OK. O banco tem também a tabela auxiliar `solicitacao_status_backup`, que não faz parte do modelo.

## 1. Objetivo e situação deste documento

Esta versão atualiza o MER v1.3 com decisões de simplificação e consistência funcional. Mantém as 14 entidades existentes e incorpora as regras aprovadas para garantia por ordem de serviço, pagamentos parciais, validade de orçamento, encerramento e expedição. É uma proposta consolidada para validação acadêmica e técnica. *(texto da v1.4)*

**(v1.5)** A versão 1.5 parte da v1.4 e acrescenta três entidades, que passam a ser 17: AVALIACAO_REEMBOLSO, REEMBOLSO e ABATIMENTO. Também amplia o domínio de HISTORICO_OS.tipo_evento com ACESSORIO e ABATIMENTO e redefine o cálculo financeiro (RN14). As entidades e os atributos da v1.4 não foram removidos nem renomeados. As decisões incorporadas foram aprovadas em 09/11/2026: D1–D10, A1–A8, C1 e C2. Os registros dessas decisões estão em `documentacao/REGRAS_DECISOES_PENDENCIAS.md` e `documentacao/PROPOSTA_REEMBOLSO_PARCIAL.md`.

O MER poderá ser considerado definitivo após a conferência com o enunciado e a rubrica da faculdade. Os tipos SQL e as restrições físicas serão detalhados na etapa seguinte, antes da criação do banco. Esta atualização não autoriza alterações no banco MySQL ou no código. *(texto da v1.4)*

**(v1.5)** Os tipos físicos já foram definidos nos scripts `banco/sql`. Este documento não autoriza a execução de migrações no banco principal: essa execução depende de autorização própria (seção 13).

## 2. Escopo considerado

- Aplicação web interna utilizada por funcionários da assistência técnica.

- Perfis: ADMINISTRADOR, ATENDENTE e TECNICO. Cliente é cadastrado, mas não possui login nesta versão.

- Cada equipamento recebido gera sua própria ORDEM_SERVICO. Uma SOLICITACAO pode conter vários equipamentos.

- O técnico não acessa o módulo SOLICITACAO; trabalha nas OS atribuídas.

- Chat em tempo real, portal do cliente, transporte de entrada e envio de imagens não estão confirmados no escopo atual.

- Tecnologias: Angular, Node.js, Express, API REST e MySQL, com arquitetura em camadas.

- **(v1.5)** O técnico não tem acesso a dados financeiros: pagamentos, reembolsos, avaliação financeira, abatimentos e os eventos PAGAMENTO e ABATIMENTO do histórico (decisões P3 e C2).

## 3. Convenções e decisões gerais

- PK = chave primária; FK = chave estrangeira; UNIQUE = valor único; NULL permitido = atributo opcional.

- Marca e modelo permanecem como campos de texto em ITEM_SOLICITACAO; não serão criadas tabelas separadas.

- Um mesmo equipamento pode ter várias OS ao longo do tempo; id_item em ORDEM_SERVICO não é UNIQUE.

- Cada equipamento tem sua própria OS por atendimento, mas o histórico de atendimentos anteriores permanece.

- ACESSORIO_RECEBIDO permite linhas repetidas para o mesmo par id_item/id_acessorio; não criar UNIQUE composto. Cada ocorrência pode ser registrada separadamente.

- Valores financeiros devem usar DECIMAL(10,2). A definição física dos demais tipos SQL, nulabilidade e restrições será apresentada na etapa de DDL.

- **(v1.5)** Os registros financeiros novos não são excluídos nem editados de forma destrutiva. AVALIACAO_REEMBOLSO é imutável: a correção gera uma revisão. REEMBOLSO é imutável. ABATIMENTO só pode ser cancelado logicamente, preservando o registro.

- **(v1.5)** Total devido, total pago e saldo continuam sendo calculados pelo backend em um único ponto, sem armazenar saldo (RN14).

## 4. Entidades, atributos e restrições

### 4.1 USUARIO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_usuario | PK | Identificador do usuário. |
| nome | Obrigatório | Nome completo. |
| email | UNIQUE; obrigatório | E-mail utilizado para acesso. |
| senha_hash | Obrigatório | Hash da senha; nunca armazenar senha em texto puro. |
| perfil | Domínio controlado | ADMINISTRADOR, ATENDENTE ou TECNICO. |
| ativo | Obrigatório | Indica se o usuário pode acessar o sistema. |

### 4.2 CLIENTE

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_cliente | PK | Identificador do cliente. |
| tipo_pessoa | Obrigatório | FISICA ou JURIDICA. |
| nome_razao_social | Obrigatório | Nome ou razão social. |
| cpf_cnpj | UNIQUE; obrigatório | Documento obrigatório e sem duplicidade. |
| telefone | Conforme cadastro | Telefone de contato. |
| email | Opcional | E-mail de contato. |
| cep, logradouro, numero, complemento, bairro, cidade, uf | Conforme cadastro | Endereço do cliente. |

### 4.3 SOLICITACAO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_solicitacao | PK | Identificador da solicitação. |
| id_cliente | FK → CLIENTE | Cliente solicitante. |
| id_atendente | FK → USUARIO | Funcionário responsável pela abertura. |
| data_abertura | Obrigatório | Data e hora da abertura. |
| descricao_inicial | NOT NULL | Descrição inicial obrigatória. |

**(v1.5)** O modelo não tem atributo status (RN22). O banco principal ainda tem a coluna física `solicitacao.status`, herança da versão anterior do banco. A migração 1 a remove (seção 13); até lá a aplicação não a utiliza.

### 4.4 ITEM_SOLICITACAO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_item | PK | Identificador do equipamento recebido. |
| id_solicitacao | FK → SOLICITACAO | Solicitação relacionada. |
| tipo_equipamento | Obrigatório | Categoria/tipo do equipamento. |
| marca | Texto | Marca informada no cadastro; sem tabela separada. |
| modelo | Texto | Modelo informado no cadastro; sem tabela separada. |
| numero_serie | Opcional | Número de série, quando existente. |
| estado_fisico | Obrigatório | Condição física no recebimento. |
| observacoes | Opcional | Observações sobre o equipamento. |

### 4.5 ACESSORIO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_acessorio | PK | Identificador do tipo de acessório. |
| descricao | Obrigatório | Descrição do acessório. |
| preco_atual | Opcional | Preço de referência, se aplicável. |
| ativo | Obrigatório | Indica se pode ser selecionado. |

### 4.6 ACESSORIO_RECEBIDO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_acessorio_recebido | PK | Identificador de cada ocorrência de acessório. |
| id_item | FK → ITEM_SOLICITACAO | Equipamento relacionado. |
| id_acessorio | FK → ACESSORIO | Tipo de acessório recebido. |
| quantidade | INT; CHECK > 0 | Quantidade nesta ocorrência; pode ser 1. |
| observacoes | Opcional | Condição ou observações. |

**(v1.5)** A estrutura não muda. Depois da abertura, acessórios podem ser incluídos e alterados, mas não excluídos (RN32). Cada inclusão ou alteração gera o evento ACESSORIO na OS atual do equipamento.

### 4.7 ORDEM_SERVICO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_os | PK | Identificador da ordem de serviço. |
| id_item | FK → ITEM_SOLICITACAO; NÃO UNIQUE | Equipamento atendido; pode ter várias OS ao longo do tempo. |
| garantia_status | ENUM: PENDENTE, SIM, NAO | Situação da garantia verificada para esta OS. Nova OS pode herdar o estado da OS anterior do mesmo equipamento; sem registro anterior, inicia PENDENTE. |
| id_tecnico | FK → USUARIO; NULL permitido | Técnico atualmente responsável; pode ficar vazio até a atribuição. |
| data_abertura | Obrigatório | Data e hora de criação da OS. |
| status | Domínio controlado | RECEBIDA, EM_ANALISE, AGUARDANDO_APROVACAO, EM_REPARO, CONCLUIDA, AGUARDANDO_EXPEDICAO, FINALIZADA ou ENCERRADA_SEM_REPARO. |
| data_encerramento | Opcional | Data e hora do encerramento sem reparo. |
| tipo_encerramento | Opcional; domínio controlado | IMPOSSIBILIDADE_TECNICA, DESISTENCIA_CLIENTE ou ORCAMENTO_REJEITADO. |
| motivo_encerramento | Obrigatório no encerramento sem reparo | Justificativa textual. |
| id_usuario_encerramento | FK → USUARIO; obrigatório no encerramento | Usuário que registrou o encerramento. |

### 4.8 ORCAMENTO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_orcamento | PK | Identificador do orçamento. |
| id_os | FK → ORDEM_SERVICO | OS relacionada. |
| id_tecnico | FK → USUARIO | Técnico que elaborou este orçamento; autoria preservada. |
| data_emissao | Obrigatório | Data e hora de emissão. |
| data_validade | Obrigatório | Validade de três dias, conforme regra de referência. |
| valor_total | Obrigatório; armazenado | Total registrado na emissão, correspondente à soma dos itens. |
| status | Domínio controlado | PENDENTE, APROVADO, REJEITADO, VENCIDO ou CANCELADO. |

**(v1.5)** O orçamento aprovado nunca é alterado por operações financeiras (RN24 e AB5): avaliação, reembolso e abatimento não mudam `valor_total`, `status` nem os itens. O valor aprovado passa a ser chamado de **total original** no cálculo financeiro (RN14).

### 4.9 ITEM_ORCAMENTO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_item_orcamento | PK | Identificador do item. |
| id_orcamento | FK → ORCAMENTO | Orçamento relacionado. |
| tipo_item | Domínio controlado | PECA ou SERVICO. |
| descricao | Obrigatório | Descrição da peça ou serviço. |
| quantidade | Obrigatório | Quantidade prevista. |
| valor_unitario | Obrigatório | Valor unitário. |
| subtotal | Derivado | Quantidade × valor unitário; cálculo derivado. |

### 4.10 RESPOSTA_ORCAMENTO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_resposta | PK | Identificador da resposta. |
| id_orcamento | FK + UNIQUE | No máximo uma resposta final por orçamento. |
| id_usuario | FK → USUARIO | Funcionário ADMINISTRADOR ou ATENDENTE que registrou a decisão. |
| decisao | Domínio controlado | APROVADO ou REJEITADO. |
| data_resposta | Obrigatório | Data e hora da decisão. |
| observacoes | Opcional | Observações do atendimento. |

### 4.11 EXECUCAO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_execucao | PK | Identificador do registro técnico. |
| id_os | FK + UNIQUE → ORDEM_SERVICO | No máximo um registro consolidado por OS. |
| id_tecnico | FK → USUARIO; obrigatório | Técnico que iniciou a execução; preserva autoria original. |
| diagnostico | Obrigatório na criação | Diagnóstico válido; somente o técnico atualmente atribuído pode registrar/editar. |
| laudo_tecnico | Opcional | Laudo técnico. **(v1.5)** Editável pelo técnico atualmente atribuído até a OS ser FINALIZADA (RN33). |
| resultado | Opcional | Resultado do atendimento. |
| data_inicio | Obrigatório na criação | Data e hora do primeiro diagnóstico válido, quando a OS passa para EM_ANALISE. |
| data_conclusao | Opcional | Data e hora da conclusão do reparo. |

### 4.12 PAGAMENTO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_pagamento | PK | Identificador do pagamento. |
| id_os | FK → ORDEM_SERVICO | OS à qual o pagamento pertence. |
| data_pagamento | NULL enquanto PENDENTE | Data e hora da confirmação do pagamento. |
| valor | Obrigatório; CHECK > 0 | Valor do pagamento; não pode ultrapassar o saldo restante da OS. |
| forma_pagamento | NULL enquanto PENDENTE | Forma utilizada, informada na confirmação. |
| status | ENUM controlado | PENDENTE, CONFIRMADO, CANCELADO ou REEMBOLSADO. **(v1.5)** REEMBOLSADO significa que o valor inteiro foi devolvido (soma dos REEMBOLSOs = valor). Com devolução parcial, o pagamento continua CONFIRMADO. |
| data_reembolso | Opcional | Data e hora do reembolso integral. **(v1.5)** Resumo de compatibilidade: dados do reembolso que completou o valor. A fonte da verdade é REEMBOLSO. |
| id_usuario_reembolso | FK → USUARIO; opcional | ADMINISTRADOR ou ATENDENTE responsável pelo reembolso. **(v1.5)** Resumo de compatibilidade, como data_reembolso. |
| justificativa_reembolso | Obrigatória no reembolso | Justificativa do reembolso integral. **(v1.5)** Resumo de compatibilidade, como data_reembolso. |

### 4.13 EXPEDICAO

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_expedicao | PK | Identificador da expedição. |
| id_os | FK + UNIQUE → ORDEM_SERVICO | No máximo um registro de devolução por OS. |
| id_usuario | FK → USUARIO | ADMINISTRADOR ou ATENDENTE que criou o registro; autoria preservada. |
| forma_entrega | ENUM: RETIRADA, ENVIO | Forma de devolução. **(v1.5, observação física)** A coluna aceita NULL no banco para preservar registros anteriores à migração `20261103_forma_entrega_expedicao.sql`; o backend exige o valor em novos registros. |
| data_envio | Obrigatória quando ENVIO for despachado | Data em que o equipamento foi efetivamente enviado. |
| codigo_rastreio | Opcional | Código de rastreamento, quando aplicável. |
| status | Domínio controlado | ENVIO: PENDENTE → EM_TRANSITO → ENTREGUE. RETIRADA: AGUARDANDO_RETIRADA → RETIRADO. |
| data_entrega | Opcional | Data em que o equipamento foi efetivamente entregue ou retirado. |

### 4.14 HISTORICO_OS

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_historico | PK | Identificador do evento. |
| id_os | FK → ORDEM_SERVICO | OS à qual o evento pertence. |
| id_usuario | FK → USUARIO; NULL permitido | Usuário responsável; NULL para evento automático. |
| tipo_evento | Domínio controlado | Categoria: CRIACAO, ATRIBUICAO_TECNICO, DIAGNOSTICO, GARANTIA, ORCAMENTO, REPARO, ENCERRAMENTO, PAGAMENTO, EXPEDICAO, **ACESSORIO** ou **ABATIMENTO** **(v1.5)**. *Redação v1.4: "… ENCERRAMENTO, PAGAMENTO ou EXPEDICAO" (9 valores).* |
| descricao | Obrigatório | Descrição legível do acontecimento. |
| data_evento | Obrigatório | Data e hora do evento. |
| dados_anteriores | JSON opcional | Valores anteriores quando necessário. |
| dados_novos | JSON opcional | Novos valores quando necessário. |

**(v1.5)** Uso dos tipos de evento:

| tipo_evento | Origem | Visível ao TECNICO |
|---|---|---|
| ACESSORIO | Inclusão ou alteração de acessório recebido depois da abertura (D7, RN32), com valores anteriores e novos | Sim |
| ABATIMENTO | Registro e cancelamento de abatimento (A6), com id_abatimento, valor, motivo ou justificativa do cancelamento, status, total devido e saldo antes e depois | **Não** (C2) |
| PAGAMENTO | Já existente. Na v1.5 também registra avaliação financeira, revisão de avaliação e reembolso parcial ou integral | **Não** (P3) |

### 4.15 AVALIACAO_REEMBOLSO (v1.5 — nova)

Decisão financeira da OS encerrada por impossibilidade técnica durante EM_REPARO (D1–D4). Linhas imutáveis; a correção gera uma revisão.

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_avaliacao | PK | Identificador da avaliação. |
| id_os | FK → ORDEM_SERVICO; obrigatório | OS avaliada. |
| id_avaliacao_revisada | FK → AVALIACAO_REEMBOLSO (autorrelacionamento); UNIQUE; NULL permitido | NULL = avaliação original; preenchido = revisão do registro indicado. A UNIQUE impede duas revisões do mesmo registro (cadeia linear). |
| id_os_original | Derivado (coluna gerada); UNIQUE | Igual a id_os quando a avaliação é original; NULL nas revisões. Garante no banco uma única avaliação original por OS, inclusive com requisições simultâneas. |
| valor_definido | DECIMAL(10,2); obrigatório; CHECK ≥ 0 | Valor definido para eventual reembolso; pode ser zero. |
| justificativa | Obrigatório | Justificativa da decisão. |
| motivo_revisao | Obrigatório nas revisões; NULL na original | Justificativa da correção (validado no backend). |
| id_usuario | FK → USUARIO; obrigatório | ADMINISTRADOR ou ATENDENTE ativo responsável. |
| data_avaliacao | Obrigatório | Data e hora do registro. |

A **avaliação vigente** é a última da cadeia, ou seja, a que não foi revisada.

### 4.16 REEMBOLSO (v1.5 — nova)

Cada devolução, parcial ou integral, de um pagamento CONFIRMADO (D5, D6). Substitui o reembolso único e integral da RN16 da v1.4 como fonte da verdade.

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_reembolso | PK | Identificador do reembolso. |
| id_pagamento | FK → PAGAMENTO; obrigatório | Pagamento devolvido; precisa estar CONFIRMADO. |
| id_avaliacao | FK → AVALIACAO_REEMBOLSO; NULL permitido | Avaliação vigente quando o reembolso cumpre uma avaliação financeira. |
| valor | DECIMAL(10,2); obrigatório; CHECK > 0 | Valor devolvido; ≤ valor ainda disponível do pagamento. |
| justificativa | Obrigatório | Justificativa do reembolso. |
| id_usuario | FK → USUARIO; obrigatório | ADMINISTRADOR ou ATENDENTE ativo responsável. |
| data_reembolso | Obrigatório | Data e hora do reembolso. |

Restrição validada no backend, com bloqueio: a soma dos reembolsos de um pagamento não ultrapassa o valor do pagamento.

### 4.17 ABATIMENTO (v1.5 — nova)

Abatimento formal: reduz o total devido da OS sem alterar o orçamento aprovado (regra R1; decisões A1–A8, C1 e C2). É separado de REEMBOLSO: o reembolso altera o total pago, e o abatimento altera o total devido.

| Atributo | Chave / regra | Descrição |
|---|---|---|
| id_abatimento | PK | Identificador do abatimento. |
| id_os | FK → ORDEM_SERVICO; obrigatório | OS do abatimento. |
| id_orcamento | FK → ORCAMENTO; obrigatório | Orçamento APROVADO da mesma OS ao qual o abatimento se refere. O backend confere, com bloqueio, se o orçamento pertence à OS e está APROVADO; não há FK composta (ver 7, I4). |
| valor | DECIMAL(10,2); obrigatório; CHECK > 0 | Valor abatido; ≤ disponível para novo abatimento (RN30). |
| motivo | Obrigatório | Motivo do abatimento. |
| status | ENUM: APROVADO, CANCELADO; padrão APROVADO | Nasce APROVADO, sem aprovação separada (A1); o cancelamento é lógico (A5). |
| id_usuario_registro | FK → USUARIO; obrigatório | ADMINISTRADOR ou ATENDENTE ativo que registrou. |
| data_registro | Obrigatório | Data e hora do registro. |
| id_usuario_cancelamento | FK → USUARIO; NULL permitido | Preenchido somente no cancelamento. |
| data_cancelamento | NULL permitido | Preenchido somente no cancelamento. |
| justificativa_cancelamento | NULL permitido; obrigatória no cancelamento | Justificativa do cancelamento (backend). |

O backend valida a coerência "CANCELADO ⇔ campos de cancelamento preenchidos", seguindo o padrão do projeto de não usar CHECK em colunas com FK.

## 5. Relacionamentos e cardinalidades

| Relacionamento | Cardinalidade | Interpretação |
|---|---|---|
| CLIENTE — SOLICITACAO | 1:N | Um cliente pode ter várias solicitações; cada solicitação pertence a um cliente. |
| USUARIO (ATENDENTE) — SOLICITACAO | 1:N | Um atendente pode abrir várias solicitações; cada solicitação registra o responsável pela abertura. |
| SOLICITACAO — ITEM_SOLICITACAO | 1:N | Uma solicitação contém um ou mais equipamentos; cada equipamento pertence a uma solicitação. |
| ITEM_SOLICITACAO — ORDEM_SERVICO | 1:N ao longo do tempo | Um equipamento pode ter várias OS ao longo do tempo; cada OS registra sua própria situação de garantia. |
| USUARIO (TECNICO) — ORDEM_SERVICO | 1:N; OS com 0..1 técnico atual | Um técnico pode responder por várias OS; a OS pode aguardar atribuição. |
| ORDEM_SERVICO — ORCAMENTO | 1:N | Uma OS pode ter orçamentos sucessivos; anteriores são preservados. Só um pode ficar PENDENTE por vez. |
| ORCAMENTO — ITEM_ORCAMENTO | 1:N | Cada orçamento possui itens detalhados. |
| ORCAMENTO — RESPOSTA_ORCAMENTO | 1:0..1 | Cada orçamento pode ter no máximo uma resposta final. |
| ORDEM_SERVICO — EXECUCAO | 1:0..1 | Uma OS pode ter zero ou uma execução consolidada. |
| ORDEM_SERVICO — PAGAMENTO | 1:N | Uma OS pode ter vários pagamentos parciais; cada pagamento pertence a uma OS. |
| ORDEM_SERVICO — EXPEDICAO | 1:0..1 | Uma OS pode ter no máximo um registro de devolução. |
| ACESSORIO — ACESSORIO_RECEBIDO | 1:N | Um tipo de acessório pode aparecer em vários recebimentos. |
| ITEM_SOLICITACAO — ACESSORIO_RECEBIDO | 1:N | Um equipamento pode ter vários acessórios recebidos; ocorrências repetidas podem ser linhas separadas. |
| ORDEM_SERVICO — HISTORICO_OS | 1:N | Uma OS pode ter vários eventos; cada evento pertence a uma OS. |
| USUARIO — HISTORICO_OS | 1:N; usuário opcional no evento | Um usuário pode gerar vários eventos; eventos automáticos podem não ter usuário humano. |
| USUARIO — ORCAMENTO | 1:N | Um técnico pode elaborar vários orçamentos; o autor de cada orçamento é preservado. |
| USUARIO — EXECUCAO | 1:N | Um técnico pode iniciar várias execuções; o autor original é preservado. |
| USUARIO — RESPOSTA_ORCAMENTO | 1:N | Um administrador ou atendente pode registrar várias respostas. |
| USUARIO — PAGAMENTO (reembolso) | 1:N opcional | Um administrador ou atendente pode registrar vários reembolsos. **(v1.5)** Mantido como resumo de compatibilidade; o responsável por cada devolução está em REEMBOLSO. |
| **(v1.5)** ORDEM_SERVICO — AVALIACAO_REEMBOLSO | 1:N (no máximo 1 original + revisões) | Uma OS pode ter uma avaliação original e várias revisões; cada avaliação pertence a uma OS. |
| **(v1.5)** AVALIACAO_REEMBOLSO — AVALIACAO_REEMBOLSO (revisão) | 1:0..1 | Cada avaliação pode ser revisada no máximo uma vez; a revisão aponta para a avaliação que corrige (cadeia linear). |
| **(v1.5)** USUARIO — AVALIACAO_REEMBOLSO | 1:N | Um administrador ou atendente pode registrar várias avaliações e revisões. |
| **(v1.5)** PAGAMENTO — REEMBOLSO | 1:N (0..N por pagamento) | Um pagamento CONFIRMADO pode ter zero ou mais devoluções parciais; cada reembolso pertence a um pagamento. |
| **(v1.5)** AVALIACAO_REEMBOLSO — REEMBOLSO | 1:N opcional | Um reembolso pode cumprir a avaliação vigente; reembolsos fora de avaliação não têm vínculo. |
| **(v1.5)** USUARIO — REEMBOLSO | 1:N | Um administrador ou atendente pode registrar vários reembolsos. |
| **(v1.5)** ORDEM_SERVICO — ABATIMENTO | 1:N | Uma OS pode ter vários abatimentos (aprovados ou cancelados); cada abatimento pertence a uma OS. |
| **(v1.5)** ORCAMENTO — ABATIMENTO | 1:N | Os abatimentos referem-se ao orçamento APROVADO da OS; o orçamento não é alterado. |
| **(v1.5)** USUARIO — ABATIMENTO (registro) | 1:N | Um administrador ou atendente pode registrar vários abatimentos. |
| **(v1.5)** USUARIO — ABATIMENTO (cancelamento) | 1:N opcional | Um administrador ou atendente pode cancelar vários abatimentos, inclusive de outro autor (C1). |

## 6. Regras de negócio incorporadas

RN01 — Criação da OS: Cada equipamento recebido gera sua própria OS. A OS pode ser criada sem técnico atribuído.

RN02 — Atribuição: Somente usuários ativos com perfil TECNICO podem receber novas OS. A atribuição ou reatribuição não inicia automaticamente a análise.

RN03 — Início da análise: A OS permanece RECEBIDA até o técnico atualmente atribuído salvar o primeiro diagnóstico válido. Nesse momento, cria-se EXECUCAO, registra-se data_inicio e o status muda para EM_ANALISE.

RN04 — Autoria da execução: EXECUCAO.id_tecnico preserva o técnico que iniciou a execução. Após reatribuição, o novo técnico atribuído pode continuar e editar o diagnóstico. Alterações relevantes ficam no HISTORICO_OS.

RN05 — Garantia por OS: A situação da garantia (PENDENTE, SIM ou NAO) pertence à ORDEM_SERVICO, pois cada atendimento deve preservar sua própria verificação. A nova OS herda o estado da OS anterior do mesmo equipamento, quando houver; sem informação anterior, inicia PENDENTE. Somente o técnico atualmente atribuído pode alterar a situação. Não pode voltar para PENDENTE; correções SIM↔NAO ficam no histórico.

RN06 — Verificação da garantia: A garantia deve ser verificada durante EM_ANALISE, antes da emissão do orçamento. A data/hora e o usuário responsável ficam registrados no HISTORICO_OS. Serviço coberto pela garantia não gera cobrança pelos itens cobertos.

RN07 — Impossibilidade técnica: O técnico atribuído pode encerrar a OS por IMPOSSIBILIDADE_TECNICA em qualquer etapa anterior à conclusão, inclusive EM_REPARO. Exige diagnóstico e justificativa obrigatória. **(v1.5)** Se o encerramento ocorrer durante EM_REPARO e houver pagamento CONFIRMADO, a OS exige avaliação financeira (RN27). O orçamento aprovado e os pagamentos confirmados são preservados, sem reembolso automático (Opção C).

RN08 — Desistência do cliente: ADMINISTRADOR, ATENDENTE ou TÉCNICO com acesso à OS podem registrar DESISTENCIA_CLIENTE em RECEBIDA, EM_ANALISE ou AGUARDANDO_APROVACAO. Não é permitida após entrada em EM_REPARO. Exige justificativa.

RN09 — Rejeição do orçamento: Quando ADMINISTRADOR ou ATENDENTE registrar a rejeição definitiva, o orçamento recebe status REJEITADO e a OS é encerrada sem reparo com tipo_encerramento ORCAMENTO_REJEITADO. O evento e o usuário responsável ficam registrados no histórico.

RN10 — Orçamento vencido: A validade é de 72 horas corridas a partir da emissão. Ao ultrapassar data_validade sem resposta, o orçamento passa a VENCIDO. A OS não é encerrada automaticamente; o atendimento deve contatar o cliente e registrar nova proposta ou encerramento aplicável.

RN11 — Dados do encerramento: Todo encerramento sem reparo registra tipo, justificativa, data/hora e usuário responsável. Status final: ENCERRADA_SEM_REPARO.

RN12 — Orçamentos no encerramento: Orçamentos ainda PENDENTES passam para CANCELADO quando a OS é encerrada sem reparo. Orçamentos e respostas anteriores não são apagados.

RN13 — Pagamentos no encerramento: Pagamentos PENDENTES são cancelados. Pagamentos CONFIRMADOS permanecem registrados. Não são permitidas novas confirmações após encerramento sem reparo.

RN14 — Cálculo de pagamentos **(v1.5, redefinida pelas regras R1 e R6)**:

| Valor | Definição |
|---|---|
| Total original | valor_total do orçamento APROVADO da OS (armazenado na emissão; nunca sobrescrito). |
| Total abatido | Soma dos ABATIMENTOs APROVADO da OS; cancelados não contam. |
| **Total devido** | Total original − total abatido. |
| **Total pago** | Σ (valor − valor reembolsado) dos pagamentos CONFIRMADO. Pagamentos REEMBOLSADO, PENDENTE e CANCELADO contam zero. |
| **Saldo** | Total devido − total pago. |
| Disponível para novo pagamento ou novo abatimento | Total devido − total pago − pagamentos PENDENTE. |

O cálculo é feito pelo backend, em um único ponto, sem armazenar saldo. Invariante: com RN15 e RN30, o total pago nunca ultrapassa o total devido, e o abatimento nunca deixa o saldo negativo. O reembolso só aumenta o saldo; o cancelamento de abatimento aumenta o total devido e o saldo.
*Redação v1.4: "O total devido corresponde ao valor do orçamento aprovado. O total pago é a soma dos pagamentos CONFIRMADOS; pagamentos REEMBOLSADOS deixam de compor esse total. O saldo é total devido menos total pago. O cálculo é realizado pelo backend, sem armazenar saldo duplicado."*

RN15 — Pagamentos parciais e limite: São permitidos vários pagamentos parciais. O valor de cada confirmação não pode ultrapassar o saldo restante. Pagamentos PENDENTES ou CANCELADOS não entram no total pago. Serviço integralmente coberto pela garantia tem total devido igual a zero. **(v1.5)** O limite usa o total devido da RN14, já descontados os abatimentos. Na criação, o limite também desconta os pagamentos PENDENTE. Na confirmação, vale total pago + valor ≤ total devido.

RN16 — Reembolso: Somente pagamento CONFIRMADO pode ser reembolsado. Reembolso integral, único por pagamento, registrado em PAGAMENTO com status REEMBOLSADO, data, usuário ADMINISTRADOR/ATENDENTE e justificativa. O registro original é preservado. **(v1.5)** Substituída pela RN29: o reembolso pode ser parcial, cada devolução é uma linha em REEMBOLSO e PAGAMENTO passa a REEMBOLSADO só quando o valor inteiro foi devolvido. Os campos de reembolso em PAGAMENTO viram resumo de compatibilidade.

RN17 — Resposta do orçamento: Somente ADMINISTRADOR e ATENDENTE podem registrar aprovação/rejeição. Cada orçamento tem uma resposta final; uma nova proposta exige novo orçamento. Só pode existir um orçamento PENDENTE por OS.

RN18 — Expedição/devolução: Toda OS CONCLUIDA ou ENCERRADA_SEM_REPARO permite registrar devolução por RETIRADA ou ENVIO. ADMINISTRADOR e ATENDENTE podem criar/atualizar. id_usuario preserva o criador; atualizações relevantes ficam no histórico.

RN19 — Status da expedição: Para ENVIO, inicia em PENDENTE, passa a EM_TRANSITO quando despachado e termina em ENTREGUE. Para RETIRADA, inicia em AGUARDANDO_RETIRADA e termina em RETIRADO. Na OS reparada, entrega/retirada permite FINALIZADA. Na OS sem reparo, mantém ENCERRADA_SEM_REPARO.

RN20 — Condição para entrega: Em OS com cobrança, a devolução só pode ser concluída após saldo igual a zero. Em OS sem cobrança aplicável, a devolução pode ocorrer sem pagamento. **(v1.5)** O saldo é o da RN14 redefinida: abatimentos aprovados contam para a quitação, e um abatimento integral permite a entrega sem pagamento (A7). Um reembolso parcial antes da entrega faz o saldo voltar a existir e bloqueia a conclusão até novo pagamento ou abatimento. A avaliação financeira pendente não bloqueia a devolução (RN34).

RN21 — Histórico: HISTORICO_OS alimenta a timeline já existente. Registra eventos relevantes, não toda alteração irrelevante. Registros são permanentes: não podem ser editados ou excluídos pela interface; correções geram novo evento. Sempre que possível, evento e operação são persistidos na mesma transação. **(v1.5)** Novos tipos ACESSORIO e ABATIMENTO (4.14). Nas operações financeiras novas, o evento é gravado obrigatoriamente na mesma transação da operação: avaliação, revisão e reembolso geram PAGAMENTO, e o abatimento gera ABATIMENTO. Uma falha no histórico desfaz a operação.

RN22 — Solicitação: SOLICITACAO não possui status próprio. O andamento é acompanhado exclusivamente pelos status individuais das OS vinculadas.

RN23 — Acessórios recebidos: O mesmo tipo de acessório pode aparecer em linhas separadas para o mesmo equipamento. Não criar UNIQUE em (id_item, id_acessorio); quantidade deve ser inteiro maior que zero.

RN24 — Orçamento: id_tecnico identifica o autor que elaborou cada orçamento e não muda em caso de reatribuição. valor_total é armazenado na emissão e deve corresponder à soma dos itens; subtotal é derivado.

RN25 — Cliente e equipamento: CLIENTE.cpf_cnpj é obrigatório e UNIQUE. SOLICITACAO.descricao_inicial é obrigatória. Marca e modelo são campos de texto em ITEM_SOLICITACAO.

RN26 — Expedição única: Cada OS possui no máximo um registro EXPEDICAO (id_os UNIQUE). O registro é atualizado, e mudanças relevantes ficam na timeline; não há múltiplos registros de tentativas.

**Regras acrescentadas na v1.5**

RN27 — Avaliação financeira obrigatória (D1, D3, D4): toda OS encerrada por IMPOSSIBILIDADE_TECNICA durante EM_REPARO (o orçamento APROVADO comprova a etapa) que tenha pelo menos um pagamento CONFIRMADO exige uma avaliação financeira, registrada mesmo quando o valor definido for zero. Quem registra é ADMINISTRADOR ou ATENDENTE ativo. Há uma avaliação original por OS (garantida no banco por id_os_original UNIQUE). valor_definido fica entre 0 e o total disponível para devolução, e a justificativa é obrigatória. O orçamento continua APROVADO. A avaliação não se aplica a desistência, rejeição de orçamento nem OS FINALIZADA.

RN28 — Revisão da avaliação (D2): a avaliação nunca é editada nem excluída. Uma correção gera nova linha, ligada à avaliação vigente, com motivo_revisao, responsável e data. O novo valor fica entre o já reembolsado sob avaliação e esse valor somado ao disponível.

RN29 — Reembolso parcial (D5, D6; substitui a RN16): ADMINISTRADOR ou ATENDENTE ativo pode reembolsar um pagamento CONFIRMADO em qualquer etapa, inclusive em OS FINALIZADA, sem automação. Cada devolução tem valor > 0, até duas casas decimais e ≤ valor ainda disponível do pagamento (sem valor informado, devolve todo o disponível), além de justificativa obrigatória. Quando a soma atinge o valor do pagamento, ele passa a REEMBOLSADO. Na OS que exige avaliação, o reembolso só é permitido depois da avaliação, e a soma dos reembolsos sob avaliação não ultrapassa o valor_definido vigente. Nenhum reembolso altera ORDEM_SERVICO nem EXPEDICAO.

RN30 — Abatimento formal (R1; A1–A4, A7): ADMINISTRADOR ou ATENDENTE ativo registra o abatimento, que já nasce APROVADO, em OS EM_REPARO, CONCLUIDA ou AGUARDANDO_EXPEDICAO que tenha orçamento APROVADO. As exigências são: valor > 0, até duas casas decimais e ≤ total devido − total pago − pagamentos PENDENTE; motivo obrigatório; vínculo com o orçamento aprovado. O abatimento pode ser integral (total devido = 0). É bloqueado em FINALIZADA, ENCERRADA_SEM_REPARO e nas etapas sem orçamento aprovado. O TECNICO não registra, não cancela, não altera e não vê abatimentos.

RN31 — Cancelamento de abatimento (A5, C1): ADMINISTRADOR ou ATENDENTE ativo pode cancelar abatimentos de qualquer autor, com justificativa obrigatória, enquanto a OS não estiver FINALIZADA nem ENCERRADA_SEM_REPARO. O cancelamento é permitido com a expedição em andamento; nesse caso o saldo volta a existir e a conclusão fica bloqueada pela RN20. O registro original é preservado com responsável, data e justificativa do cancelamento. Um abatimento já cancelado não pode ser cancelado de novo. Nenhuma operação de abatimento altera ORDEM_SERVICO.status, ORCAMENTO ou EXPEDICAO (AB7).

RN32 — Acessórios depois da abertura (D7): ADMINISTRADOR e ATENDENTE incluem e alteram acessórios em qualquer OS ativa; o TECNICO, só na OS atribuída a ele. Essas operações ficam bloqueadas em CONCLUIDA, AGUARDANDO_EXPEDICAO, FINALIZADA e ENCERRADA_SEM_REPARO. Cada inclusão ou alteração gera o evento ACESSORIO na OS atual do equipamento, com valores anteriores e novos. A exclusão não foi aprovada.

RN33 — Laudo técnico (D8): o técnico atualmente atribuído edita o laudo até a OS ser FINALIZADA, inclusive em CONCLUIDA e AGUARDANDO_EXPEDICAO. Toda edição gera evento com dados anteriores e novos. A edição fica bloqueada em FINALIZADA e ENCERRADA_SEM_REPARO.

RN34 — Avaliação pendente e devolução (D10/Q1): a avaliação financeira pendente não bloqueia a expedição, a entrega nem a retirada. ADMINISTRADOR e ATENDENTE veem o aviso de pendência financeira. O reembolso continua bloqueado até a avaliação. A expedição não altera o status da OS encerrada sem reparo. Os fluxos físico e financeiro são separados.

RN35 — Visibilidade financeira (P3, C2): pagamentos, reembolsos, avaliação financeira, abatimentos e o resumo financeiro são restritos a ADMINISTRADOR e ATENDENTE; o TECNICO recebe 403. Os eventos PAGAMENTO e ABATIMENTO não aparecem no histórico exibido ao TECNICO.

RN36 — Concorrência financeira (R7, AB8): pagamento, confirmação, reembolso, avaliação, abatimento e expedição bloqueiam primeiro a OS (SELECT … FOR UPDATE) e depois os registros financeiros, sempre nessa ordem. Os valores são recalculados dentro da transação antes de gravar.

## 7. Restrições de integridade e observações

- USUARIO.email e CLIENTE.cpf_cnpj devem possuir UNIQUE; ambos são obrigatórios conforme as decisões atuais.

- RESPOSTA_ORCAMENTO.id_orcamento, EXECUCAO.id_os e EXPEDICAO.id_os devem possuir UNIQUE.

- ORDEM_SERVICO.id_tecnico aceita NULL até a atribuição. Quando preenchido, deve referenciar usuário ativo com perfil TECNICO.

- ORDEM_SERVICO.id_item não deve possuir UNIQUE, pois o equipamento pode retornar em atendimentos futuros.

- garantia_status fica em ORDEM_SERVICO, não em ITEM_SOLICITACAO. A verificação por atendimento é preservada no HISTORICO_OS.

- ACESSORIO_RECEBIDO não deve possuir UNIQUE composto por id_item e id_acessorio. quantidade deve ser inteira e maior que zero.

- Somente um orçamento por OS poderá estar PENDENTE. A aplicação deve verificar essa condição antes de emitir novo orçamento.

- Pagamentos parciais: total devido = orçamento aprovado; total pago = soma dos pagamentos CONFIRMADOS; REEMBOLSADO não conta; saldo = devido − pago. Não armazenar saldo duplicado. **(v1.5)** Substituído pela RN14 redefinida: total devido = orçamento aprovado − abatimentos APROVADO, e total pago = Σ (valor − reembolsado) dos CONFIRMADO.

- Valor de pagamento deve ser positivo e a confirmação não pode ultrapassar o saldo restante. data_pagamento e forma_pagamento podem ser NULL enquanto PENDENTE.

- Expedição só pode ser concluída quando o saldo estiver zerado, exceto quando não houver cobrança aplicável. A regra será validada no backend.

- HISTORICO_OS não deve permitir edição ou exclusão pela interface. A aplicação deverá gerar novo evento para correções.

- Regras de perfil, status e transições devem ser validadas no backend, não apenas na interface.

- Para simplificar o projeto, não serão criadas triggers ou procedures para as regras de negócio; a validação ficará na camada de serviços do backend. **(v1.5)** Os scripts de migração usam uma guarda de pré-condição (seção 13). Ela não é regra de negócio nem cria procedure: apenas interrompe a execução fora de ordem.

- Encerramento sem reparo, cancelamento de orçamento pendente e cancelamento de pagamento pendente devem ocorrer de forma consistente, preferencialmente na mesma transação.

- **(v1.5)** AVALIACAO_REEMBOLSO: valor_definido ≥ 0 (CHECK); id_avaliacao_revisada UNIQUE (cadeia linear); id_os_original gerada e UNIQUE (uma original por OS).

- **(v1.5)** REEMBOLSO: valor > 0 (CHECK). A regra Σ reembolsos do pagamento ≤ valor do pagamento é validada no backend, com bloqueio.

- **(v1.5)** ABATIMENTO: valor > 0 (CHECK); status APROVADO ou CANCELADO.
  - **I4:** como ORCAMENTO não tem chave única (id_orcamento, id_os), o banco não garante por FK composta que o orçamento do abatimento pertence à mesma OS. O backend garante isso, com bloqueio. Criar essa chave exigiria alterar uma tabela existente, o que não foi proposto.

- **(v1.5)** Todas as FKs das entidades novas usam ON DELETE RESTRICT e ON UPDATE RESTRICT, como as demais tabelas. A aplicação não exclui registros financeiros.

## 8. Pendências para validação final

| Ponto | O que falta validar |
|---|---|
| Exigências da faculdade | Conferir o MER com o enunciado, rubrica e padrão de notação exigidos pela disciplina. |
| Tipos físicos SQL | Definir tipos, tamanhos, precisão decimal, nulabilidade, DEFAULT, CHECK e regras de exclusão/atualização de FK na etapa de DDL. **(v1.5)** Definidos em `banco/sql/01–17` e `banco/esquema_esperado.json`. |
| Validade de orçamento | A regra foi operacionalizada como 72 horas corridas; confirmar se a faculdade exige contagem por dias-calendário. |
| Orçamento vencido | O status VENCIDO será identificado pelo backend ao consultar/realizar operações; não haverá rotina agendada ou trigger nesta versão. |
| Pagamentos e garantia | A regra de saldo foi definida; validar com o professor se o cálculo do total devido pelo orçamento aprovado atende ao enunciado. **(v1.5)** Validar também o total devido com abatimentos (RN14 redefinida). |
| Histórico | Confirmar se a faculdade exige campos adicionais ou retenção específica para trilha de auditoria. |
| Diagrama atualizado | Conferir a legibilidade visual do Draw.io v1.4 após abrir no diagrams.net. **(v1.5)** O diagrama `.drawio` ainda não foi atualizado com as três entidades novas: ver item seguinte. |
| **(v1.5)** Diagrama v1.5 | Acrescentar AVALIACAO_REEMBOLSO, REEMBOLSO e ABATIMENTO, com os relacionamentos da seção 5, a uma cópia do `.drawio` v1.4. O original fica preservado em `documentacao/mer/historico/`. |
| **(v1.5)** Banco principal | ~~Executar as migrações 1–4~~ Executadas em 09/11/2026 17:02, com autorização. |

## 9. Principais alterações em relação à versão 1.4 (v1.5)

- Três entidades novas, que passam a ser 17: AVALIACAO_REEMBOLSO (4.15), REEMBOLSO (4.16) e ABATIMENTO (4.17), com 11 relacionamentos novos (seção 5).

- HISTORICO_OS.tipo_evento passa de 9 para 11 valores, com ACESSORIO e ABATIMENTO.

- RN14 redefinida (regras R1 e R6):
  - total devido = orçamento aprovado − abatimentos aprovados;
  - total pago = confirmados − reembolsos.

  RN15 e RN20 passam a usar esse cálculo.

- RN16 substituída pela RN29 (reembolso parcial, uma linha por devolução). Os campos de reembolso em PAGAMENTO viram resumo de compatibilidade; REEMBOLSADO passa a significar devolução integral.

- Novas regras RN27–RN36:
  - avaliação financeira e revisão;
  - reembolso parcial;
  - abatimento e cancelamento;
  - acessórios depois da abertura;
  - laudo editável até a finalização;
  - avaliação pendente sem bloquear a devolução;
  - visibilidade financeira;
  - concorrência.

- SOLICITACAO: o modelo não muda (RN22 já existia). A remoção física de `solicitacao.status` é feita pela migração 1.

- EXPEDICAO.forma_entrega: registrada a observação física de que a coluna aceita NULL para registros antigos.

- Nenhuma entidade ou atributo da v1.4 foi removido ou renomeado.

## 10. Principais alterações da versão 1.4 em relação à versão 1.3 (preservado da v1.4)

- Garantia movida de ITEM_SOLICITACAO para ORDEM_SERVICO, preservando a situação por atendimento.

- Tipo de encerramento ampliado para incluir ORCAMENTO_REJEITADO; rejeição registrada encerra a OS sem reparo.

- Validade de orçamento definida operacionalmente como 72 horas corridas; orçamento vencido não encerra a OS automaticamente.

- Pagamentos parciais passam a ter cálculo explícito de total devido, total pago e saldo, sem armazenar saldo duplicado.

- Confirmação de pagamento limitada ao saldo restante; pagamentos pendentes não contam como pagos.

- Expedição passa a ter transições específicas para ENVIO e RETIRADA e depende da quitação quando houver cobrança.

- Campos de pagamento e execução ajustados para refletir o momento em que os dados passam a ser obrigatórios.

- Regras de negócio simplificadas para validação na camada de serviços do backend, sem procedures/triggers.

- Mantidas as 14 entidades; não foram adicionadas tabelas.

## 11. Conclusão e autorização

A versão 1.4 atualiza a proposta consolidada v1.3, mantendo as 14 entidades e registrando as decisões simplificadas descritas neste documento. Ainda depende da conferência com as exigências da faculdade e da aprovação final do modelo. Nenhuma alteração foi realizada no banco de dados, no backend ou no frontend. *(texto da v1.4)*

**(v1.5)** A versão 1.5 consolida o modelo implementado e validado em ambiente de teste, com 17 entidades. O backend, o frontend e os scripts `banco/sql` já correspondem a este modelo. O banco principal `assistencia_tecnica` foi migrado em 09/11/2026 17:02, com autorização e depois de um backup testado (seção 13). A validação acadêmica (seção 8) continua pendente.

## 12. Documentos de referência

- Especificações Atualizadas — Sistema de Assistência Técnica, versão 1.0, 15/10/2026.

- MER_Assistencia_Tecnica_Consolidado_v1.3 — proposta anterior.

- MERASSISTENCIA1.1_atualizado.docx — entidades, atributos, chaves e cardinalidades.

- Validação_de_MER.docx — análise das entidades, relacionamentos, cardinalidades e ressalvas.

- Decisões funcionais aprovadas durante a revisão do projeto em 08/11/2026 e atualização v1.4.

- **(v1.5)** MER_Assistencia_Tecnica_Consolidado_v1.4 (.docx/.drawio) — versão anterior, preservada em `documentacao/mer/historico/`.

- **(v1.5)** `documentacao/PROPOSTA_REEMBOLSO_PARCIAL.md` — D1–D6, D10/Q1; entidades AVALIACAO_REEMBOLSO e REEMBOLSO.

- **(v1.5)** `documentacao/REGRAS_DECISOES_PENDENCIAS.md` — D7, D8, P3, regra R1 (A1–A8, C1, C2), lista única de pendências.

- **(v1.5)** `banco/sql/01–17`, `banco/esquema_esperado.json` — modelo físico de destino.

## 13. Correspondência com o banco físico e migrações (v1.5)

| Entidade / mudança | Tabela | Script de destino | Migração (executada no principal em 09/11/2026 17:02) |
|---|---|---|---|
| SOLICITACAO sem status (RN22) | `solicitacao` | `04_solicitacao.sql` | `20261109_01_remover_status_solicitacao.sql` (remove coluna; **destrutiva**) |
| AVALIACAO_REEMBOLSO, REEMBOLSO | `avaliacao_reembolso`, `reembolso` | `15_…`, `16_…` | `20261109_02_avaliacao_reembolso_parcial.sql` (aditiva; copia reembolsos integrais antigos) |
| tipo_evento ACESSORIO | `historico_os` | `14_historico_os.sql` | `20261109_03_historico_evento_acessorio.sql` (aditiva) |
| ABATIMENTO, tipo_evento ABATIMENTO | `abatimento`, `historico_os` | `17_abatimento.sql`, `14_…` | `20261109_04_abatimento_formal.sql` (aditiva) |

A ordem de execução é a ordem alfabética dos nomes (`banco/migracoes/pendentes.json`). Cada migração tem uma guarda de pré-condição que interrompe a execução sem alterar nada quando é executada fora de ordem ou repetida. Por exemplo, a migração 3 executada depois da 4 removeria ABATIMENTO do ENUM; a guarda impede isso. Procedimento completo: `documentacao/MIGRACOES_BACKUP_RECUPERACAO.md`.
