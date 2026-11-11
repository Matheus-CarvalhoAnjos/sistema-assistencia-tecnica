# Especificação Técnica — Módulo 3: Ordens de Serviço

> **Atualização 09/11/2026:** este documento é histórico. A situação atual (regras do MER v1.4, decisões resolvidas, pendências e o que está implementado) está em [../REGRAS_DECISOES_PENDENCIAS.md](../REGRAS_DECISOES_PENDENCIAS.md), e a API em [../API.md](../API.md).

**Projeto:** Sistema de Assistência Técnica · **Versão:** 1.0 · **Data:** 07/11/2026
**Situação do documento:** proposta para aprovação. Nada aqui foi implementado.

> **Atualização 07/11/2026 — módulo implementado (consulta e atribuição).** Backend: `GET /api/ordens-servico` com dados do cliente e filtros `status`, `id_tecnico`, `sem_tecnico`, `busca`, `data_inicio`, `data_fim` (técnico: sempre as próprias OS, sem `id_solicitacao`); `GET /api/ordens-servico/:id` devolve os detalhes da seção 7.4; `PATCH /:id/tecnico` devolve os detalhes e recusa OS encerrada com 409 (A6); `GET /api/usuarios?perfil=TECNICO&ativo=1` (A5); descrição dos acessórios recebidos mantida (ACR-3). Frontend: dashboard (Início) com dados reais, indicadores clicáveis e filtros; versão "Minhas Ordens de Serviço" para o técnico; página `/ordens-servico/:id` com técnico responsável (atribuir/trocar para ADMIN e ATENDENTE, alerta de técnico inativo), cliente, solicitação de origem (só ADMIN/ATENDENTE), equipamento, acessórios, resumo do atendimento e histórico. Testes: `backend/test/ordensServico.test.js`, `frontend/src/pages/dashboard/dashboard.spec.ts`, `frontend/src/pages/ordens-servico/ordem-servico-detalhe.spec.ts`.
> **Decisões aplicadas sem mudar regras existentes:** D-OS-1 = 404; D-OS-2 = não remover técnico; D-OS-4 = histórico derivado (sem tabela nova); D-OS-9 = técnico vê só o nome do cliente. **Mantidas como estavam (continuam pendentes):** D-OS-3 (EM_ANALISE), D-OS-5 (garantia só ADMIN/ATENDENTE), D-OS-6, D-OS-7, D-OS-8 (técnico vê pagamentos das próprias OS).
> **D-OS-11 resolvido (07/11/2026, com autorização do usuário):** OS nº 1 reatribuída de Tiago Técnico (ID 2, inativo) para Tecnico Teste (ID 7) pela própria API (`PATCH /api/ordens-servico/1/tecnico`).

Legenda: **IMPLEMENTADO** · **PARCIALMENTE IMPLEMENTADO** · **NÃO IMPLEMENTADO** · **PRECISA DE REVISÃO** · **DECISÃO PENDENTE**. Itens **(proposta)** não existem no projeto.

---

## 1. Fontes analisadas

| Fonte | O que foi verificado |
|---|---|
| `backend/src/routes/ordemServicoRoutes.js`, `execucaoRoutes.js`, `orcamentoRoutes.js`, `respostaOrcamentoRoutes.js`, `pagamentoRoutes.js`, `pagamentoStatusRoutes.js`, `expedicaoRoutes.js`, `expedicaoStatusRoutes.js` | Todas as rotas sob `/api/ordens-servico`, `/api/orcamentos`, `/api/pagamentos`, `/api/expedicoes` |
| `backend/src/controllers/ordemServicoController.js` e os controllers de execução, orçamento, pagamento e expedição | Quais handlers passam `req.usuario` ao service |
| `backend/src/services/ordemServicoService.js`, `execucaoService.js`, `orcamentoService.js`, `pagamentoService.js`, `expedicaoService.js` | Regras, transições e checagens de técnico |
| `backend/src/repositories/ordemServicoRepository.js`, `orcamentoRepository.js`, `expedicaoRepository.js`, `pagamentoRepository.js`, `execucaoRepository.js` | SQL e mudanças de status |
| `backend/src/models/ordemServico.js` | Campos devolvidos pela API |
| `backend/test/phase2.test.js`, `phase3.test.js` | O que já é testado |
| Banco (somente leitura): `ordem_servico` e tabelas ligadas | Enum de status, nulabilidade, dados |
| `banco/sql/07_ordem_servico.sql` | Script versionado |
| MER, Validação do MER, Especificações (seção 8), `Decisao_tecnico_opcional_na_OS.txt`, Guia Mestre (seções 6, 7 e 9), `MATUTADA/IMPLEMENTATION_LOG.md` | Regras, status e decisões |
| `frontend/src/pages/dashboard/*` | Estrutura visual da tabela de OS |
| **Chamadas reais à API (somente leitura)** com as contas de teste | Confirmação de exposição de dados (seção 3) |

---

## 2. Situação atual por funcionalidade

| Funcionalidade | Situação | Evidência |
|---|---|---|
| Criação automática da OS na abertura da solicitação | **IMPLEMENTADO** | `solicitacaoRepository.criar` |
| Criação manual de OS para um item (`POST /api/ordens-servico`) | **IMPLEMENTADO** | Bloqueia uma 2ª OS ativa para o mesmo item (409) com `FOR UPDATE` |
| Listagem de OS | **PRECISA DE REVISÃO** | Sem filtro por técnico; perde os dados do equipamento e do técnico (falhas A1 e A2) |
| Detalhes da OS | **PRECISA DE REVISÃO** | Mesmos problemas; não traz cliente nem solicitação |
| Pesquisa e filtros | **NÃO IMPLEMENTADO** | — |
| Dados do cliente na OS | **NÃO IMPLEMENTADO** | Nenhuma consulta de OS faz JOIN com `solicitacao`/`cliente` |
| Dados do equipamento na OS | **PARCIALMENTE IMPLEMENTADO** | O SQL busca `tipo_equipamento`, `marca` e `modelo`, mas o model descarta (A2) |
| Acessórios recebidos da OS | **PARCIALMENTE IMPLEMENTADO** | `GET /api/ordens-servico/:id/acessorios` existe; sem controle por técnico; sem a descrição |
| Histórico da OS | **NÃO IMPLEMENTADO** | Não existe tabela de histórico; ver D-OS-4 |
| Atribuir técnico | **IMPLEMENTADO** (com ressalvas) | `PATCH /:id/tecnico` exige perfil TECNICO e técnico ativo; não verifica o status da OS (A6) |
| Trocar técnico responsável | **PARCIALMENTE IMPLEMENTADO** | O mesmo PATCH sobrescreve; não permite remover o técnico (voltar a NULL) |
| Técnico consulta só as suas OS | **NÃO IMPLEMENTADO** | Confirmado em chamada real (seção 3) |
| Status atual | **IMPLEMENTADO** | Coluna `status` (ENUM com 8 valores) |
| Garantia do equipamento | **IMPLEMENTADO** — perfis **PRECISA DE REVISÃO** | `PATCH /:id/garantia` só para ADMIN/ATENDENTE (D-OS-5) |
| Orçamento, execução, pagamento e expedição por OS | **IMPLEMENTADO** no backend | Rotas `/:id_os/...` (ver seção 7) |
| Interface Angular de OS | **NÃO IMPLEMENTADO** | O dashboard tem a tabela "Ordens de Serviço" vazia, sem chamada à API |
| Testes de OS | **PARCIALMENTE IMPLEMENTADO** | Os testes cobrem execução, orçamento, pagamento e expedição; não há testes de listagem, detalhes, atribuição nem autorização por rota |

---

## 3. Falhas de autorização e exposição de dados (prioridade máxima)

> **Atualização 07/11/2026:** A1, A2, A3 e A4 foram **corrigidas** (o técnico recebe 404 para OS de outro técnico ou sem técnico; a listagem do técnico é filtrada; o model mantém equipamento e técnico; o orçamento precisa pertencer à OS do caminho; acessórios por equipamento exigem OS atribuída ao técnico). A5, A6 e A7 continuam pendentes. As tabelas abaixo descrevem o estado **anterior** à correção.

Ambiente do teste: OS nº 1 atribuída ao técnico **ID 2** (Tiago, hoje inativo). Chamadas feitas com o token do **Tecnico Teste (ID 7)**, que **não** é o responsável.

| Nº | Chamada do TÉCNICO ID 7 | Resultado real | Deveria ser |
|---|---|---|---|
| A1a | `GET /api/ordens-servico` | **200**, lista inclui a OS 1 (do técnico 2) | Só OS com `id_tecnico = 7` |
| A1b | `GET /api/ordens-servico/1` | **200** | 403 ou 404 |
| A1c | `GET /api/ordens-servico/1/acessorios` | **200** | 403 ou 404 |
| A1d | `GET /api/ordens-servico/1/orcamentos` | **200** | 403 ou 404 |
| A1e | `GET /api/ordens-servico/1/pagamentos` | **200** (com resumo financeiro) | 403 ou 404 |
| A1f | `GET /api/ordens-servico/1/expedicao` | **200** | 403 ou 404 |
| A1g | `GET /api/ordens-servico/1/execucao` | 404 (só porque não há execução) | 403 ou 404 por regra, não por acaso |

**Causa:** os handlers de leitura (`listarTodos`, `buscarPorId`, `listarAcessoriosRecebidos`; `execucaoController.buscarPorOs`; `orcamentoController.listarPorOs` e `buscarPorId`; `pagamentoController.listarPorOs`; `expedicaoController.buscarPorOs`) **não passam `req.usuario`** ao service. A checagem "técnico atribuído" só existe nas **escritas** (`execucaoService._validarAcessoTecnico` e `orcamentoService` com perfil TECNICO).

**Outras falhas relacionadas:**

| Nº | Falha | Evidência |
|---|---|---|
| A2 | O model `OrdemServico` só copia as colunas da tabela, então `tipo_equipamento`, `marca`, `modelo` e `nome_tecnico` buscados pelo SQL **são descartados** | Resposta real da listagem traz só `id_os, id_item, id_tecnico, data_abertura, status, data_encerramento, motivo_encerramento` |
| A3 | `GET /api/ordens-servico/:id_os/orcamentos/:id_orcamento` ignora o `id_os`: `orcamentoService.buscarPorId` busca só pelo `id_orcamento` | Um orçamento pode ser lido por um caminho de OS diferente da sua |
| A4 | O TÉCNICO pode **registrar** acessórios em qualquer OS (`POST /:id/acessorios`) | Rota com os 3 perfis; sem checagem de atribuição |
| A5 | `GET /api/usuarios` (usado para escolher o técnico) devolve **todos** os usuários, com e-mail e perfil, para ADMIN e ATENDENTE | Não há filtro por perfil |
| A6 | A atribuição de técnico não verifica o status: é possível trocar o técnico de uma OS `FINALIZADA` ou `ENCERRADA_SEM_REPARO` | `ordemServicoService.atribuirTecnico` |
| A7 | A OS nº 1 está atribuída a um técnico **inativo** (Tiago); a execução fica bloqueada (409) até a OS ser reatribuída | `execucaoService._validarAcessoTecnico` exige técnico ativo |

---

## 4. Status da Ordem de Serviço

### 4.1 Status existentes — comparação

| Status | Especificações (seção 8) | MER complementar | Banco real (ENUM) | Usado pelo código |
|---|---|---|---|---|
| RECEBIDA | sim | sim | sim | sim (criação) |
| EM_ANALISE | sim | sim | sim | **só** como retorno quando o orçamento vence |
| AGUARDANDO_ORCAMENTO | **descartado** ("o técnico elabora o orçamento ao terminar a análise") | não | **não existe** | não |
| AGUARDANDO_APROVACAO | sim | sim | sim | sim (orçamento emitido) |
| APROVADA | não | não | **não existe** | não — a aprovação é do **orçamento** (`orcamento.status = APROVADO`) e leva a OS a `EM_REPARO` |
| EM_REPARO | sim | sim | sim | sim |
| CONCLUIDA | sim | sim | sim | sim |
| AGUARDANDO_EXPEDICAO | sim | sim | sim | sim |
| FINALIZADA | sim | sim | sim | sim |
| ENCERRADA_SEM_REPARO | (pendente nas Especificações) | sim | sim | sim |

### 4.2 Transições implementadas hoje

| De | Para | Ação (endpoint) | Perfis | Condições | Onde está o código |
|---|---|---|---|---|---|
| — | RECEBIDA | Abrir solicitação (`POST /api/solicitacoes`) ou criar OS (`POST /api/ordens-servico`) | ADMIN, ATENDENTE | Item sem outra OS ativa (só na criação manual) | `solicitacaoRepository.criar`, `ordemServicoRepository.criar` |
| RECEBIDA ou EM_ANALISE | AGUARDANDO_APROVACAO | Emitir orçamento (`POST /:id_os/orcamentos`) | ADMIN, TÉCNICO atribuído | Técnico atribuído e ativo; garantia ≠ PENDENTE; nenhum orçamento pendente vigente | `orcamentoRepository` (transação) |
| AGUARDANDO_APROVACAO | EM_ANALISE | Orçamento vence (verificado ao ler, criar ou responder) | automático | `data_validade <= agora` | `orcamentoRepository` |
| AGUARDANDO_APROVACAO | EM_REPARO | Resposta APROVADO (`PATCH /api/orcamentos/:id/resposta`) | ADMIN, ATENDENTE | Orçamento pendente e vigente | `orcamentoRepository` |
| AGUARDANDO_APROVACAO | ENCERRADA_SEM_REPARO | Resposta REJEITADO | ADMIN, ATENDENTE | idem; grava `data_encerramento` e `motivo_encerramento = 'Orçamento rejeitado.'` | `orcamentoRepository` |
| EM_REPARO | CONCLUIDA | Concluir reparo (`PATCH /:id_os/execucao/concluir`) | ADMIN, TÉCNICO atribuído | Execução com `data_conclusao` | `execucaoService.concluirReparo` |
| CONCLUIDA | AGUARDANDO_EXPEDICAO | Registrar expedição (`POST /:id_os/expedicao`) | ADMIN, ATENDENTE | Orçamento aprovado e totalmente pago (pagamentos CONFIRMADOS) | `expedicaoRepository` |
| AGUARDANDO_EXPEDICAO | FINALIZADA | Expedição ENTREGUE (`PATCH /api/expedicoes/:id_os/status`) | ADMIN, ATENDENTE | — ; grava `data_encerramento` | `expedicaoRepository` |
| ENCERRADA_SEM_REPARO | (permanece) | Registrar expedição de devolução | ADMIN, ATENDENTE | Sem exigência de pagamento | `expedicaoRepository` |

**Estados finais:** `FINALIZADA` e `ENCERRADA_SEM_REPARO`. Uma OS nesses estados não é considerada "ativa" (permite nova OS para o mesmo equipamento).

### 4.3 Lacunas e inconsistências

| Nº | Problema | Impacto |
|---|---|---|
| S1 | Nenhuma ação leva `RECEBIDA → EM_ANALISE` | O dashboard sempre mostraria 0 OS "Em análise", salvo orçamentos vencidos; o status não informa que o técnico começou |
| S2 | Equipamento em garantia (`SIM`) também passa por orçamento e aprovação, com serviço a custo zero | Pode ser intencional (peças continuam cobradas); precisa de confirmação (D-OS-6) |
| S3 | Não há como encerrar uma OS sem orçamento (cliente desiste antes, equipamento sem conserto) | A OS fica ativa indefinidamente (D-OS-7) |
| S4 | Execução pode ser registrada em qualquer status não final, inclusive `RECEBIDA` e `AGUARDANDO_APROVACAO` | Não é erro, mas não altera o status (ligado a S1) |
| S5 | `FALHA_ENTREGA` na expedição não muda o status da OS | Comportamento a confirmar |
| S6 | Os status de OS não têm CHECK no script versionado igual ao banco: banco usa ENUM, script usa `VARCHAR + CHECK` | Mesmo conjunto de valores; diferença só de implementação |

### 4.4 Fluxo proposto (para aprovação)

```
RECEBIDA ──(técnico registra diagnóstico)──▶ EM_ANALISE                      [proposta S1]
RECEBIDA / EM_ANALISE ──(orçamento emitido)──▶ AGUARDANDO_APROVACAO          [existente]
AGUARDANDO_APROVACAO ──(orçamento vence)──▶ EM_ANALISE                       [existente]
AGUARDANDO_APROVACAO ──(aprovado)──▶ EM_REPARO                               [existente]
AGUARDANDO_APROVACAO ──(rejeitado)──▶ ENCERRADA_SEM_REPARO  (final)          [existente]
EM_REPARO ──(reparo concluído com data de conclusão)──▶ CONCLUIDA            [existente]
CONCLUIDA ──(expedição registrada, orçamento quitado)──▶ AGUARDANDO_EXPEDICAO [existente]
AGUARDANDO_EXPEDICAO ──(entregue)──▶ FINALIZADA  (final)                     [existente]
RECEBIDA / EM_ANALISE ──(encerrar sem reparo, com motivo)──▶ ENCERRADA_SEM_REPARO [proposta S3, D-OS-7]
```

**Proposta S1 (D-OS-3):** ao registrar a execução (`POST /:id_os/execucao`) com a OS em `RECEBIDA`, mudar para `EM_ANALISE` na mesma operação. É a alternativa que não cria endpoint novo e corresponde ao fluxo documentado ("o técnico analisa e registra o diagnóstico").

---

## 5. Matriz de permissões

### 5.1 Situação atual × proposta

| Ação | ADMINISTRADOR | ATENDENTE | TÉCNICO — hoje | TÉCNICO — proposta |
|---|---|---|---|---|
| Listar OS | todas | todas | **todas** (A1a) | só as atribuídas a ele |
| Ver detalhes da OS | sim | sim | **qualquer** (A1b) | só as atribuídas; outra → 404 |
| Ver OS sem técnico | sim | sim | **sim** | não |
| Criar OS manual | sim | sim | não | não |
| Atribuir/trocar técnico | sim | sim | não | não |
| Remover técnico (voltar a NULL) | não existe | não existe | não | **D-OS-2** |
| Definir garantia | sim | sim | não | **D-OS-5** (recomendado: sim, nas atribuídas) |
| Ver acessórios recebidos | sim | sim | **qualquer** (A1c) | só nas atribuídas |
| Registrar acessórios | sim | sim | **qualquer** (A4) | conforme D-SOL-8 |
| Ver/registrar execução | ver: todos; registrar: ADMIN e técnico atribuído | ver: sim; registrar: não | ver: **qualquer**; registrar: só atribuída | ver e registrar: só atribuída |
| Ver orçamentos | sim | sim | **qualquer** (A1d) | só nas atribuídas |
| Emitir orçamento | sim | não | só atribuída | só atribuída |
| Registrar resposta do cliente | sim | sim | não | não |
| Ver pagamentos | sim | sim | **qualquer** (A1e) | **D-OS-8** (recomendado: não) |
| Registrar/confirmar pagamento | sim | sim | não | não |
| Ver/registrar expedição | ver: sim; registrar: sim | ver: sim; registrar: sim | ver: **qualquer** | **D-OS-8** (recomendado: ver só nas atribuídas) |

### 5.2 Resposta para OS de outro técnico — 403 ou 404?
**Recomendação:** responder **404 "Ordem de serviço não encontrada."** Assim o técnico não descobre se o número existe (evita enumeração). Aprovação em **D-OS-1**.

---

## 6. Requisitos funcionais

### RF-OS-01 — Listar OS (ADMINISTRADOR, ATENDENTE)
- **Fonte de dados:** `GET /api/ordens-servico` com filtros (proposta).
- **Colunas:** nº da OS, cliente, equipamento (tipo · marca · modelo), técnico (ou "Sem técnico"), status, data de abertura.
- **Filtros:** status; técnico; "sem técnico"; busca por nº da OS, nome do cliente ou nº de série; período de abertura.
- **Critérios:** dados reais da API; estado vazio sem dados fictícios (Guia Mestre, seção 9).

### RF-OS-02 — Minhas OS (TÉCNICO)
- **Fonte:** o mesmo endpoint; o **backend** aplica `id_tecnico = usuário logado` e ignora filtros de técnico enviados pelo técnico.
- **Tela:** "Minhas Ordens de Serviço", sem filtro de técnico e sem a opção "sem técnico".
- **Critério:** com outra OS de outro técnico no banco, ela nunca aparece nem por URL direta.

### RF-OS-03 — Detalhes da OS
- **Conteúdo:** cabeçalho (nº, status, datas, motivo de encerramento); equipamento (todos os campos de `item_solicitacao`, inclusive garantia); cliente (ver D-OS-9 para o técnico); solicitação de origem (nº, data, descrição inicial — **só ADMIN/ATENDENTE**, conforme a regra "técnico não vê Solicitações"); técnico responsável; acessórios recebidos; resumos de execução, orçamentos, pagamentos e expedição conforme a matriz.

### RF-OS-04 — Atribuir / trocar técnico (ADMINISTRADOR, ATENDENTE)
- **Fluxo:** nos detalhes, painel "Técnico responsável" com lista de técnicos **ativos** e botão "Atribuir"/"Trocar".
- **Regras:** só perfil TECNICO e ativo (já implementado); bloquear em `FINALIZADA` e `ENCERRADA_SEM_REPARO` (proposta A6); trocar o técnico não altera orçamentos já emitidos (o `id_tecnico` do orçamento é histórico); a execução já registrada passa a ser do novo técnico na próxima atualização (comportamento atual de `execucaoService.atualizar`).
- **Critério:** atribuir um ATENDENTE → 403 (mensagem atual); técnico inativo → 404 (mensagem atual).

### RF-OS-05 — Histórico da OS
- **Situação:** não existe tabela de histórico.
- **Proposta mínima (sem alterar o MER):** linha do tempo **derivada** dos registros existentes: abertura (`ordem_servico.data_abertura`), diagnóstico (`execucao.data_inicio`), orçamentos (`orcamento.data_emissao`, status), respostas (`resposta_orcamento.data_resposta`, decisão, quem registrou), conclusão (`execucao.data_conclusao`), pagamentos (`pagamento.data_pagamento`, status), expedição (`expedicao.data_envio`, `data_entrega`) e encerramento (`ordem_servico.data_encerramento`).
- **Limitação:** a troca de técnico e mudanças de status sem registro associado **não aparecem** — ver D-OS-4.

### RF-OS-06 — Status e indicadores
- Indicadores do dashboard (já desenhados em `dashboard.ts`, com os 8 códigos de status) alimentados por contagem real — proposta: `GET /api/ordens-servico/resumo` ou contagem no frontend a partir da listagem.

---

## 7. Backend

### 7.1 Endpoints existentes

| Método | Rota | Perfis na rota | Passa o usuário ao service? |
|---|---|---|---|
| POST | `/api/ordens-servico` | ADMIN, ATENDENTE | não precisa |
| GET | `/api/ordens-servico` | ADMIN, ATENDENTE, TÉCNICO | **não** (A1a) |
| GET | `/api/ordens-servico/:id` | 3 perfis | **não** (A1b) |
| PATCH | `/api/ordens-servico/:id/tecnico` | ADMIN, ATENDENTE | não precisa |
| PATCH | `/api/ordens-servico/:id/garantia` | ADMIN, ATENDENTE | não precisa |
| GET | `/api/ordens-servico/:id/acessorios` | 3 perfis | **não** (A1c) |
| POST | `/api/ordens-servico/:id/acessorios` | 3 perfis | **não** (A4) |
| GET | `/api/ordens-servico/:id_os/execucao` | 3 perfis | **não** |
| POST / PATCH | `/api/ordens-servico/:id_os/execucao`, `/execucao/concluir` | ADMIN, TÉCNICO | sim |
| GET | `/api/ordens-servico/:id_os/orcamentos` | 3 perfis | **não** (A1d) |
| GET | `/api/ordens-servico/:id_os/orcamentos/:id_orcamento` | 3 perfis | **não**; ignora `id_os` (A3) |
| POST | `/api/ordens-servico/:id_os/orcamentos` | ADMIN, TÉCNICO | sim |
| PATCH | `/api/orcamentos/:id_orcamento/resposta` | ADMIN, ATENDENTE | sim |
| GET | `/api/ordens-servico/:id_os/pagamentos` | 3 perfis | **não** (A1e) |
| POST | `/api/ordens-servico/:id_os/pagamentos` | ADMIN, ATENDENTE | não |
| PATCH | `/api/pagamentos/:id_pagamento/status` | ADMIN, ATENDENTE | não |
| GET | `/api/ordens-servico/:id_os/expedicao` | 3 perfis | **não** (A1f) |
| POST | `/api/ordens-servico/:id_os/expedicao` | ADMIN, ATENDENTE | sim |
| PATCH | `/api/expedicoes/:id_os/status` | ADMIN, ATENDENTE | sim |

### 7.2 Correção central proposta — controle de acesso por OS
- **Proposta:** um método `verificarAcessoOs(id_os, usuario)` em `ordemServicoService` (ou um middleware `autorizarAcessoOs` em `middlewares/`) que:
  1. carrega a OS (404 se não existir);
  2. se `usuario.perfil === "TECNICO"` e `ordem.id_tecnico !== usuario.id_usuario` → **404** (D-OS-1);
  3. devolve a OS para o handler.
- **Aplicar em:** todas as rotas `GET` com `:id`/`:id_os` listadas em 7.1 e no `POST /:id/acessorios`.
- **Listagem:** `ordemServicoRepository.listarTodos(filtros)` recebe `id_tecnico` obrigatório quando o perfil é TÉCNICO.
- **A3:** `orcamentoService.buscarPorId(id_os, id_orcamento)` passa a exigir que o orçamento pertença à OS do caminho.

### 7.3 Listagem — contrato proposto
`GET /api/ordens-servico?status=EM_REPARO&id_tecnico=7&sem_tecnico=false&busca=dell&data_inicio=2026-11-01&data_fim=2026-11-30`

| Parâmetro | ADMIN/ATENDENTE | TÉCNICO |
|---|---|---|
| `status` (um ou vários separados por vírgula) | aceito | aceito |
| `id_tecnico` | aceito | **ignorado** (sempre o próprio) |
| `sem_tecnico=true` | aceito | **ignorado** |
| `busca` (nº OS, nome do cliente, nº de série, modelo) | aceito | aceito, só nas suas |
| `data_inicio`, `data_fim` | aceito | aceito |

Resposta 200 (proposta; mantém array como hoje, com os campos que hoje são descartados):
```json
[
  {
    "id_os": 1,
    "id_item": 1,
    "status": "RECEBIDA",
    "data_abertura": "2026-10-28T02:32:57.000Z",
    "data_encerramento": null,
    "motivo_encerramento": null,
    "id_tecnico": 2,
    "nome_tecnico": "Tiago Técnico",
    "tipo_equipamento": "Notebook",
    "marca": "Dell",
    "modelo": "Inspiron 15",
    "numero_serie": null,
    "garantia_status": "PENDENTE",
    "id_solicitacao": 1,
    "id_cliente": 1,
    "nome_cliente": "Maria Cliente"
  }
]
```
Para o TÉCNICO, `id_solicitacao` não é devolvido (regra de Solicitações), e `id_cliente`/`nome_cliente` dependem de D-OS-9.

### 7.4 Detalhes — contrato proposto
`GET /api/ordens-servico/1` (ADMIN/ATENDENTE):
```json
{
  "id_os": 1,
  "status": "RECEBIDA",
  "data_abertura": "2026-10-28T02:32:57.000Z",
  "data_encerramento": null,
  "motivo_encerramento": null,
  "tecnico": { "id_usuario": 2, "nome": "Tiago Técnico", "ativo": false },
  "equipamento": {
    "id_item": 1, "tipo_equipamento": "Notebook", "marca": "Dell", "modelo": "Inspiron 15",
    "numero_serie": null, "estado_fisico": "Arranhões na tampa", "garantia_status": "PENDENTE", "observacoes": null
  },
  "cliente": { "id_cliente": 1, "nome_razao_social": "Maria Cliente", "telefone": "11999990000", "email": "maria@teste.com" },
  "solicitacao": { "id_solicitacao": 1, "data_abertura": "2026-10-28T02:32:43.000Z", "descricao_inicial": "Notebook não liga" },
  "acessorios": []
}
```
- `tecnico.ativo` permite à interface alertar "Técnico inativo — reatribua" (caso A7).
- Orçamentos, execução, pagamentos e expedição continuam em seus endpoints (carregados pela tela sob demanda), para não duplicar regras.
- Para o TÉCNICO: sem `solicitacao`; `cliente` conforme D-OS-9.

### 7.5 Atribuição — contrato
`PATCH /api/ordens-servico/1/tecnico` (existente)
```json
{ "id_tecnico": 7 }
```
Resposta 200 (atual; passará a trazer os campos enriquecidos):
```json
{ "mensagem": "Técnico atribuído com sucesso.", "ordem": { "id_os": 1, "id_tecnico": 7, "status": "RECEBIDA", "...": "..." } }
```
Erros atuais: 400 "ID do técnico inválido."; 404 "Ordem de serviço não encontrada." / "Técnico não encontrado ou inativo."; 403 "Somente usuários com perfil TECNICO podem ser atribuídos a uma ordem de serviço."
Erro proposto: 409 "Não é possível alterar o técnico de uma ordem de serviço encerrada." (A6).

### 7.6 Lista de técnicos para atribuição (proposta)
`GET /api/usuarios?perfil=TECNICO&ativo=1` (ADMIN, ATENDENTE) devolvendo só `id_usuario` e `nome`. Hoje `GET /api/usuarios` devolve todos os usuários com e-mail (A5).

### 7.7 Alterações por camada (proposta)
| Camada | Arquivo | Alteração |
|---|---|---|
| Model | `models/ordemServico.js` | Incluir os campos do JOIN (corrige A2); remover `id_item_ativo` se D-OS-10 não criar a coluna |
| Repository | `repositories/ordemServicoRepository.js` | `listarTodos(filtros)` com JOIN em `solicitacao`/`cliente` e filtros; `buscarDetalhes(id)` |
| Service | `services/ordemServicoService.js` | `verificarAcessoOs`; regras de A6; filtros por perfil |
| Controllers | `ordemServicoController`, `execucaoController`, `orcamentoController`, `pagamentoController`, `expedicaoController` | Passar `req.usuario` nas leituras |
| Service | `services/orcamentoService.js` | `buscarPorId` validar `id_os` (A3) |
| Service | `services/execucaoService.js` | Transição RECEBIDA → EM_ANALISE (se D-OS-3 aprovada) |
| Rotas/Service | `routes/usuarioRoutes.js`, `services/usuarioService.js`, `repositories/usuarioRepository.js` | Filtro `perfil`/`ativo` (A5) |

---

## 8. Frontend

### 8.1 Decisão de navegação já registrada
O Guia Mestre (seção 9) define: **não** criar item "Ordens de Serviço" no menu; a tabela de OS é o foco da página **Início** e a linha leva aos detalhes. Esta especificação segue essa decisão.

### 8.2 Rotas (proposta)
| Rota | Componente | Guards | Perfis |
|---|---|---|---|
| `/` (existente) | `DashboardPage` (existente) passa a carregar dados | `authGuard` (existente) | todos — conteúdo varia por perfil |
| `/ordens-servico/:id` | `OrdemServicoDetalhePage` (proposta) | `authGuard` | todos; o backend decide o acesso (404 para OS de outro técnico) |

### 8.3 Serviços e models (proposta)
- `frontend/src/app/services/ordem-servico.service.ts` — `listar(filtros)`, `buscarPorId(id)`, `atribuirTecnico(id, idTecnico)`, `listarAcessorios(id)`.
- `frontend/src/app/services/usuario.service.ts` — `listarTecnicosAtivos()`.
- `frontend/src/app/models/ordem-servico.ts`, com o tipo `StatusOs` com os 8 valores do banco.
- Um componente reutilizável `StatusBadge` (proposta) com rótulos em português ("Recebida", "Em análise"…), usando as cores da paleta aprovada.

### 8.4 Dashboard — ADMINISTRADOR e ATENDENTE
- **Indicadores:** os 8 cartões já desenhados em `dashboard.ts`, com contagens reais.
- **Tabela "Ordens de Serviço":** as colunas já existentes no HTML (Nº da OS · Cliente · Equipamento · Técnico · Status · Ação).
- **Filtros acima da tabela:** status (múltipla escolha), técnico (lista + "Sem técnico"), busca, período.
- **Destaque:** OS sem técnico e OS com técnico inativo.
- **Ação:** "Abrir" leva a `/ordens-servico/:id`.
- **Estados:** carregando; vazio ("Nenhuma Ordem de Serviço encontrada", mantendo o padrão visual atual); erro com "Tentar novamente".
- O selo "Sem conexão de dados" atual passa a refletir o estado real da chamada.

### 8.5 Dashboard — TÉCNICO
- **Título:** "Minhas Ordens de Serviço".
- **Indicadores:** só das suas OS.
- **Tabela:** sem a coluna "Técnico"; sem filtro de técnico.
- **Ordenação sugerida:** em análise e em reparo primeiro.
- Não há tela que liste todas as OS para o técnico; a URL de outra OS resulta na página "não encontrada".

### 8.6 Detalhes da OS
Layout em seções (cartões na paleta aprovada):
1. **Cabeçalho:** "OS nº X", selo de status, data de abertura, data e motivo de encerramento (se houver).
2. **Equipamento:** tipo, marca, modelo, número de série, estado físico, observações, garantia.
3. **Cliente:** nome e contato (conforme D-OS-9 para o técnico).
4. **Solicitação de origem** (só ADMIN/ATENDENTE): nº, data e descrição inicial, com link para os detalhes da solicitação.
5. **Técnico responsável:** nome ou "Sem técnico"; para ADMIN/ATENDENTE, painel com seletor de técnicos ativos e botão "Atribuir"/"Trocar" (desabilitado em OS encerradas); alerta se o técnico estiver inativo.
6. **Acessórios recebidos:** descrição, quantidade e observação.
7. **Linha do tempo** (RF-OS-05).
8. **Resumos somente leitura** de execução, orçamentos, pagamentos e expedição, conforme a matriz. As ações dessas áreas (registrar diagnóstico, emitir orçamento etc.) pertencem aos módulos seguintes e não fazem parte deste módulo.

### 8.7 Erros na interface
- 404 → página "Ordem de serviço não encontrada" com link para o Início (também para o técnico que tentar outra OS).
- 403/409 na atribuição → mensagem da API no painel do técnico.
- 401 → o interceptor existente encerra a sessão.

---

## 9. Integração com outros módulos

| Módulo | Ligação | Dependência / risco |
|---|---|---|
| Solicitações | A OS nasce na abertura (mesma transação) | Mudanças no contrato da solicitação precisam devolver `id_os` |
| Clientes | Cliente chega à OS via `item_solicitacao → solicitacao → cliente` | JOIN de 3 níveis; dados do cliente para o técnico (D-OS-9) |
| Equipamentos | `ordem_servico.id_item` | Garantia é do equipamento, não da OS: um equipamento com várias OS compartilha a garantia |
| Acessórios recebidos | Por `id_item`, não por OS | Todas as OS do mesmo equipamento mostram os mesmos acessórios |
| Orçamentos | `orcamento.id_os`; resposta muda o status da OS | Vencimento é verificado "sob demanda" (ao ler/criar/responder), não por agendamento |
| Execução | `execucao.id_os` UNIQUE (uma por OS) | Concluir exige `data_conclusao`; o técnico precisa estar ativo (A7) |
| Pagamentos | `pagamento.id_os` | Saldo calculado a partir do orçamento aprovado |
| Expedição | `expedicao.id_os` UNIQUE | Exige quitação ou OS encerrada sem reparo |

---

## 10. Testes

### 10.1 Backend (proposta: `backend/test/ordens-servico.test.js`, com repositories simulados, no padrão de `phase2.test.js`)
| Caso | Esperado |
|---|---|
| Listagem por ADMINISTRADOR | todas as OS |
| Listagem por ATENDENTE | todas as OS |
| Listagem por TÉCNICO | só `id_tecnico` = ele, mesmo enviando `id_tecnico` de outro |
| TÉCNICO consultando OS de outro técnico (detalhe e cada sub-rota GET) | 404 |
| TÉCNICO consultando OS sem técnico | 404 |
| TÉCNICO registrando acessório em OS de outro | 404/403 |
| Orçamento lido por `id_os` errado (A3) | 404 |
| Detalhes trazem equipamento, cliente e técnico (A2) | campos presentes |
| Atribuir usuário ATENDENTE | 403 |
| Atribuir técnico inativo | 404 |
| Atribuir técnico válido | 200 e `id_tecnico` atualizado |
| Trocar técnico em OS FINALIZADA | 409 (proposta A6) |
| Filtros por status, técnico, sem técnico, busca e período | resultados corretos |
| Transição RECEBIDA → EM_ANALISE ao registrar diagnóstico | status atualizado (se D-OS-3) |
| Transições existentes (orçamento, resposta, conclusão, expedição) | já cobertas em `phase2/phase3`; manter |
| Sem token / token de usuário inativo | 401 |

### 10.2 Frontend
- Dashboard: chama a API, mostra estados, aplica filtros; versão do técnico sem coluna/filtro de técnico.
- Detalhes: seções por perfil; painel de atribuição só para ADMIN/ATENDENTE; 404 tratado.
- `OrdemServicoService`: parâmetros de filtro corretos.

### 10.3 Critério de conclusão
Nenhuma rota de leitura expõe OS de outro técnico (testado por rota); listagem e detalhes com dados completos; atribuição funcionando pela interface; dashboard com dados reais; testes e build passando.

---

## 11. Decisões pendentes deste módulo

| Código | Questão | Alternativas | Recomendação |
|---|---|---|---|
| D-OS-1 | Resposta ao técnico para OS de outro | (a) 403; (b) 404 | (b) 404 — não revela a existência |
| D-OS-2 | Permitir remover o técnico (voltar a "sem técnico") | (a) não; (b) sim, só antes de existir execução | (a) por ora; trocar já resolve a maioria dos casos |
| D-OS-3 | Uso de EM_ANALISE | (a) ao registrar a execução; (b) ao atribuir o técnico; (c) botão "Iniciar análise" | (a) — sem endpoint novo e fiel ao fluxo documentado |
| D-OS-4 | Histórico da OS | (a) linha do tempo derivada (sem mudar o banco); (b) nova tabela de histórico (muda o MER) | (a) agora; (b) só se a faculdade exigir trilha completa |
| D-OS-5 | Quem define a garantia | (a) ADMIN/ATENDENTE (atual); (b) incluir o TÉCNICO atribuído | (b) — as Especificações dizem que o técnico "verifica a garantia" |
| D-OS-6 | Garantia SIM exige orçamento e aprovação? | (a) manter (peças cobradas); (b) criar caminho direto para EM_REPARO | Confirmar a regra com a faculdade |
| D-OS-7 | Encerrar OS sem orçamento | (a) não permitir; (b) ação "Encerrar sem reparo" com motivo (ADMIN/ATENDENTE) | (b) — cobre desistência e equipamento sem conserto; MER já prevê `motivo_encerramento` |
| D-OS-8 | Técnico vê pagamentos/expedição? | (a) não; (b) só leitura nas atribuídas | Pagamentos: (a). Expedição: (b) |
| D-OS-9 | Dados do cliente para o técnico | (a) só nome; (b) nome e contato | (a) — minimiza exposição; o contato com o cliente é do atendimento |
| D-OS-10 | Unicidade de OS ativa por equipamento no banco | ver `Pendencias_e_Decisoes_Tecnicas.md` (D-BD-3) | — |
| D-OS-11 | OS nº 1 atribuída a técnico inativo (A7) | (a) reatribuir para o Tecnico Teste; (b) deixar | Alteração de dado — só com aprovação explícita |
