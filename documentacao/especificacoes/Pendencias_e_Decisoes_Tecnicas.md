# Pendências e Decisões Técnicas — antes de implementar os Módulos 1, 2 e 3

> **Atualização 09/11/2026:** este documento é histórico. A situação atual (regras do MER v1.4, decisões resolvidas, pendências e o que está implementado) está em [../REGRAS_DECISOES_PENDENCIAS.md](../REGRAS_DECISOES_PENDENCIAS.md), e a API em [../API.md](../API.md).

**Projeto:** Sistema de Assistência Técnica · **Versão:** 1.0 · **Data:** 07/11/2026

Este documento reúne as divergências entre documentação, código e banco, e as decisões que precisam de aprovação. **Nenhuma delas foi corrigida.** As decisões específicas de cada módulo (D-CLI, D-SOL, D-OS) estão detalhadas nas especificações e resumidas na seção 3.

Fontes: banco `assistencia_tecnica` (inspeção somente leitura), `banco/sql/*.sql`, `banco/relatorios/relatorio_20261027_200138.txt`, `backend/src/**`, `MATUTADA/IMPLEMENTATION_LOG.md` e os documentos do Pacote de Continuidade (Especificações, MER, Validação do MER, Guia Mestre, decisões em `02_Conversas_e_Anotacoes`).

---

## 1. Divergências estruturais

### D-BD-1 — Scripts SQL não correspondem ao banco real
- **Problema:** os scripts em `banco/sql/` (13 arquivos + `criar_tabelas.ps1`) descrevem um banco diferente do que está rodando.
- **Evidências:**
  - Relatório de 27/10/2026: só `usuario` existia e já divergia (nome `varchar(100)` × 150; perfil ENUM × VARCHAR+CHECK). As outras 12 tabelas foram criadas depois, por outro meio.
  - Banco real × script: `perfil` e `status` são ENUM no banco e VARCHAR+CHECK nos scripts; `solicitacao.status` tem default `RECEBIDA` (script: `ABERTA` + CHECK); `item_solicitacao` com colunas de 100 caracteres (script: 50/50/80/60); `ordem_servico.id_tecnico` NULL (script: NOT NULL); `ordem_servico.id_item_ativo` só no script; `acessorio_recebido.quantidade` com CHECK só no script; `expedicao.forma_entrega` só via migração `banco/migracoes/20261103_forma_entrega_expedicao.sql`.
- **Impacto:** quem recriar o ambiente pelos scripts terá um banco incompatível com o código (por exemplo, OS sem técnico falharia por `NOT NULL`).
- **Alternativas:** (a) gerar novos scripts a partir do banco real (`mysqldump --no-data`); (b) ajustar o banco para seguir os scripts; (c) manter como está.
- **Recomendação:** (a) — o banco real reflete as decisões mais recentes e é o que o código usa. Guardar os scripts antigos como histórico.
- **Aprovação:** **sim** (afeta documentação oficial e a forma de recriar o banco).

### D-BD-2 — Técnico obrigatório (MER) × opcional (banco e código)
- **Documentado:** MER complementar — "toda ordem de serviço deve ser criada com um técnico responsável"; cardinalidade "cada ordem exige um técnico".
- **Decisão mais recente:** `Decisao_tecnico_opcional_na_OS.txt` — OS pode nascer sem técnico; `id_tecnico` aceita NULL; atribuição posterior; só perfil TECNICO.
- **Implementado:** banco aceita NULL; abertura cria OS sem técnico; `PATCH /:id/tecnico` exige perfil TECNICO ativo.
- **Impacto:** documentação acadêmica contradiz o sistema.
- **Recomendação:** atualizar o MER (texto e diagrama Draw.io) para "0..1 técnico por OS; atribuição posterior". A Validação do MER já previa essa possibilidade.
- **Aprovação:** **sim** (MER).

### D-BD-3 — Uma OS ativa por equipamento
- **Documentado:** MER — um equipamento pode ter várias OS ao longo do tempo; rejeição exige nova OS (logo, só uma ativa por vez).
- **Script:** coluna gerada `id_item_ativo` com UNIQUE.
- **Banco real:** a coluna **não existe**; o model `OrdemServico` ainda lista `id_item_ativo`.
- **Código:** `POST /api/ordens-servico` verifica com `SELECT … FOR UPDATE` (proteção correta em uma transação). A abertura da solicitação cria OS para itens novos (sem risco de duplicidade).
- **Impacto:** baixo hoje; o risco é um caminho futuro criar OS sem passar pela verificação.
- **Alternativas:** (a) manter só no código; (b) criar a coluna gerada + UNIQUE (alteração de banco).
- **Recomendação:** (a) agora, com teste cobrindo; (b) quando D-BD-1 for resolvido.
- **Aprovação:** sim, se escolher (b).

### D-BD-4 — Restrições que existem só no código
- `acessorio_recebido.quantidade > 0`, status de pagamento e de expedição (VARCHAR livre), UF do cliente, unicidade da descrição do acessório.
- **Recomendação:** manter a validação no código (já existe, exceto UF) e decidir em D-BD-1 se o banco também terá CHECK/UNIQUE.
- **Aprovação:** sim, para mudanças no banco.

---

## 2. Divergências de regras e comportamento

### D-REG-1 — Status da solicitação (RECEBIDA × ABERTA)
- **Documentado:** MER lista `status` em SOLICITACAO sem valores; Validação do MER recomenda decidir se a solicitação precisa de status próprio; script SQL usa ABERTA/EM_ATENDIMENTO/FINALIZADA/CANCELADA.
- **Banco:** default `RECEBIDA`, sem CHECK; registro atual = `RECEBIDA`.
- **API:** responde `"ABERTA"` na criação (valor fixo), e nunca atualiza o status.
- **Impacto:** a interface mostraria um status diferente do gravado; filtros por status ficam sem sentido.
- **Alternativas e recomendação:** ver D-SOL-1 (recomendado: status **derivado** das OS, sem gravar).
- **Aprovação:** **sim** (MER e regra de negócio).

### D-REG-2 — Uso do status EM_ANALISE
- **Documentado:** Especificações e MER incluem EM_ANALISE entre RECEBIDA e AGUARDANDO_APROVACAO.
- **Implementado:** nenhuma ação leva a OS para EM_ANALISE; ela só aparece quando um orçamento vence.
- **Recomendação:** D-OS-3 (a) — mudar para EM_ANALISE ao registrar a execução/diagnóstico.
- **Aprovação:** **sim** (fluxo de status).

### D-REG-3 — Quem verifica a garantia
- **Documentado:** Especificações — o TÉCNICO "verifica a garantia"; fluxo item 4: "o técnico … determina a situação da garantia".
- **Implementado:** `PATCH /api/ordens-servico/:id/garantia` só para ADMINISTRADOR e ATENDENTE; a abertura da solicitação aceita `garantia_status`.
- **Recomendação:** permitir ao TÉCNICO atribuído (D-OS-5) e gravar PENDENTE na abertura (D-SOL-3).
- **Aprovação:** **sim**.
- **Situação atual (11/11/2026):** implementado — somente o **técnico atribuído** à OS altera a garantia (administrador e atendente → 403; técnico de outra OS → 404); administrador e atendente consultam a informação conforme suas permissões. Regras completas na seção [Regras atuais de garantia](#regras-atuais-de-garantia-11112026).

### D-REG-4 — Garantia SIM ainda exige orçamento e aprovação
- **Implementado:** com garantia SIM, os itens de SERVIÇO têm valor zero e as PEÇAS continuam cobradas; o fluxo passa por orçamento e resposta do cliente (testado em `phase2.test.js`).
- **Documentado:** RN08 — "não deve haver cobrança pelo serviço coberto pela garantia" (não diz se o orçamento é dispensado).
- **Recomendação:** confirmar com a faculdade (D-OS-6). Sem confirmação, manter.
- **Aprovação:** **sim**.
- **Situação atual (11/11/2026):** confirmado — com garantia `SIM`, os serviços cobertos não são cobrados (R$ 0,00) e as peças podem ser cobradas normalmente; o fluxo de orçamento e aprovação continua obrigatório.

### Regras atuais de garantia (11/11/2026)
Consolidam D-REG-3, D-REG-4, D-OS-5 e D-OS-6:
- A garantia é registrada individualmente por Ordem de Serviço (equipamento atendido nessa OS), com os estados `PENDENTE`, `SIM` e `NAO`.
- Somente o técnico atribuído à OS pode alterar a garantia. Administrador e atendente podem consultar a informação conforme suas permissões.
- A verificação ocorre durante `EM_ANALISE`, antes da emissão do orçamento. A garantia pode ser corrigida enquanto a OS estiver em `EM_ANALISE`, até a emissão do orçamento; depois da emissão do orçamento, fica fixa.
- Depois de sair de `PENDENTE`, a garantia não pode voltar para esse estado. É permitido corrigir `SIM` para `NAO` e `NAO` para `SIM`.
- Cada alteração registra, no histórico da OS, data, horário, usuário responsável e os valores anterior e novo.
- Uma nova OS herda a garantia registrada anteriormente para o equipamento, quando existir.
- Quando a garantia for `SIM`, os serviços cobertos não são cobrados, mas as peças podem ser cobradas normalmente. O fluxo de orçamento e aprovação continua obrigatório.

### D-REG-5 — Encerrar OS sem orçamento
- **Documentado:** MER prevê `motivo_encerramento` "inclusive sem reparo"; Especificações deixam pendente o fluxo de encerramento.
- **Implementado:** só a rejeição de orçamento encerra sem reparo.
- **Recomendação:** D-OS-7 (b).
- **Aprovação:** **sim**.

### D-REG-6 — Página de Solicitações só para criação × listagem
- **Documentado:** Guia Mestre (seção 9) — "A página Solicitações é para criar solicitação, sem painel separado de consulta; consulta/acompanhamento acontece pelas OS."
- **Pedido atual:** a especificação do Módulo 2 inclui listagem e filtros.
- **Recomendação:** decisão do usuário (D-SOL-6). As duas opções estão especificadas.
- **Aprovação:** **sim**.

### D-REG-7 — Expedição: quem registra
- **Documentado:** ainda pendente nas Especificações; MER complementar sugere o atendente "a validar com a faculdade".
- **Implementado:** ADMINISTRADOR e ATENDENTE.
- **Recomendação:** manter; registrar a confirmação quando houver.
- **Aprovação:** confirmação acadêmica.

---

## 3. Falhas confirmadas que não exigem decisão de negócio
Estas são correções técnicas; só precisam de autorização para implementar.

> **Atualização 07/11/2026:** A1, A2, A3 e A4 foram **corrigidas** com autorização do usuário (resposta 404 ao técnico, conforme a recomendação D-OS-1). Ponto único de verificação: `backend/src/middlewares/autorizarAcessoOs.js` + `ordemServicoService.verificarAcessoOs`. Testes: `backend/test/acessoOrdemServico.test.js`. As demais falhas desta tabela continuam pendentes.

| Código | Falha | Módulo | Evidência |
|---|---|---|---|
| A1 | TÉCNICO lê OS, acessórios, orçamentos, pagamentos e expedição de OS de outro técnico | 3 | Chamadas reais com o Tecnico Teste (ID 7) na OS 1 (técnico ID 2) → 200 |
| A2 | Model `OrdemServico` descarta equipamento e nome do técnico | 3 | Resposta real da listagem |
| A3 | Orçamento lido ignorando o `id_os` do caminho | 3 | `orcamentoService.buscarPorId` |
| A4 | TÉCNICO registra acessórios em qualquer OS | 2/3 | Rotas com os 3 perfis, sem checagem |
| A5 | `GET /api/usuarios` devolve todos os usuários com e-mail | 3 | `usuarioRepository.listarTodos` |
| A6 | Troca de técnico permitida em OS encerrada | 3 | `ordemServicoService.atribuirTecnico` |
| F1/F2 | Cadastro de cliente sem `complemento` ou com campo obrigatório ausente → 500 | 1 | `mysql2` recusa `undefined` (confirmado) |
| F3/F4 | Violação de CHECK ou UNIQUE do banco → 500 em vez de 400/409 | 1 | Erros MySQL não traduzidos |
| V1 | Texto acima de 100 caracteres em equipamento → 500 | 2 | Sem validação de tamanho |
| ACR-1 | Registro de acessórios em lote não é transacional | 2 | `acessorioRecebidoService.registrar` |
| ACR-2 | Acessório inativo pode ser registrado | 2 | Não verifica `ativo` |
| ACR-3 | `descricao_acessorio` descartada pelo model | 2 | `models/acessorioRecebido.js` |

---

## 4. Decisões de arquitetura e ambiente

### D-INT-1 — Dois padrões de código no backend
- **Evidência:** Clientes, Solicitações, Usuários e Autenticação usam funções/classes sem `BaseService`/`BaseRepository` e sem models (exceto `Usuario`); os módulos da "Fase 1–3" (`MATUTADA/IMPLEMENTATION_LOG.md`) usam classes base e models. `phase2.test.js` e `phase3.test.js` até testam que os módulos novos estendem as classes base.
- **Impacto:** inconsistência para quem mantém e para a avaliação acadêmica da arquitetura em camadas.
- **Alternativas:** (a) migrar Clientes e Solicitações para o padrão com classes base quando forem alterados; (b) manter como está.
- **Recomendação:** (a), dentro de cada módulo, sem mudar comportamento.
- **Aprovação:** sim.

### D-INT-2 — Limite de login atrapalha o desenvolvimento
- **Evidência:** 5 tentativas com falha por IP em 15 min; durante a auditoria, os testes atingiram o limite e até logins corretos receberam 429.
- **Alternativas:** (a) aumentar o limite via `LOGIN_LIMITE_TENTATIVAS` no `.env` local; (b) desativar o limite quando `NODE_ENV=test`; (c) manter.
- **Recomendação:** (a) só no ambiente local, sem mudar código.
- **Aprovação:** sim (configuração).

### D-INT-3 — Prioridade da correção de segurança das OS
- **Recomendação:** corrigir A1, A3 e A4 antes do Módulo 1, como entrega isolada e com testes por rota.
- **Aprovação:** sim.

### D-INT-4 — Nomes de tabela em maiúsculas
- **Evidência:** `clienteRepository` (`CLIENTE`) e `usuarioRepository` (`USUARIO`); funciona porque o MySQL local tem `lower_case_table_names = 1`.
- **Impacto:** falha em servidor Linux, se a hospedagem for definida assim (a hospedagem está "pendente" nas Especificações).
- **Recomendação:** padronizar em minúsculas ao alterar esses repositories.
- **Aprovação:** não (correção técnica sem efeito no comportamento).

### D-INT-5 — Pasta `MATUTADA/`
- **Evidência:** cópia parcial do backend; 3 arquivos diferem da versão em uso (`app.js`, `authMiddleware.js`, `solicitacaoService.js`), além do `IMPLEMENTATION_LOG.md` e de um protótipo do frontend.
- **Risco:** editar a cópia errada.
- **Recomendação:** manter só como histórico (não apagar sem decisão do usuário).
- **Aprovação:** sim, para qualquer remoção.

---

## 5. Dados que exigem decisão

| Código | Situação | Recomendação |
|---|---|---|
| D-DADOS-1 (= D-OS-11) | OS nº 1 atribuída ao técnico inativo Tiago (ID 2); a execução fica bloqueada | Reatribuir ao "Tecnico Teste" (ID 7) **somente com autorização** |
| D-DADOS-2 | Catálogo de acessórios vazio | Seed de desenvolvimento (D-SOL-7) |
| D-DADOS-3 | Cliente, solicitação e OS existentes são dados de teste antigos | Manter como histórico |

---

## 6. Resumo das decisões por prioridade

| Prioridade | Decisões |
|---|---|
| Antes de qualquer implementação | D-INT-3 (segurança das OS) |
| Antes do Módulo 1 | D-CLI-1, D-CLI-2, D-INT-1 |
| Antes do Módulo 2 | D-SOL-1/D-REG-1, D-SOL-2, D-SOL-3/D-REG-3, D-SOL-6/D-REG-6, D-SOL-7, D-SOL-8 |
| Antes do Módulo 3 | D-OS-1, D-OS-3/D-REG-2, D-OS-5, D-OS-8, D-OS-9, D-OS-11 |
| Podem esperar | D-BD-1, D-BD-2 (atualizar documentação), D-BD-3, D-BD-4, D-REG-4, D-REG-5, D-REG-7, D-INT-2, D-INT-4, D-INT-5 |
