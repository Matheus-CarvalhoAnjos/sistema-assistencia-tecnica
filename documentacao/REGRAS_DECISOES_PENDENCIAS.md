# Regras, decisões, pendências e situação — 09/11/2026

Referência: **MER v1.4 consolidado (08/11/2026)**. Este documento substitui as listas de pendências antigas nos pontos em que elas divergem (ver seção 5).

Legenda de situação: **CONCLUÍDA** (implementada e testada, inclusive em integração real quando grava no banco) · **PARCIALMENTE CONCLUÍDA** · **PENDENTE**.

## 1. Regras aprovadas e onde estão implementadas

| Regra (MER v1.4) | Implementação | Testes |
|---|---|---|
| RN01: cada equipamento gera a sua OS; OS pode nascer sem técnico | `solicitacaoRepository.criar` (uma transação) | mocks + integração real |
| RN02: só técnico ativo recebe OS | `ordemServicoService.atribuirTecnico` | mocks + integração real |
| RN03: primeiro diagnóstico cria a execução e passa RECEBIDA → EM_ANALISE | `execucaoRepository.criar` (transação) | mocks + integração real |
| RN04: execução preserva o técnico que a iniciou | `execucaoService` | mocks |
| RN05: garantia por OS; nova OS do mesmo equipamento herda a garantia da OS mais recente; só o técnico atribuído altera; não volta para PENDENTE | `ordemServicoRepository.criar`, `ordemServicoService.atualizarGarantia` | mocks + integração real |
| RN06: garantia verificada **durante EM_ANALISE**, antes do orçamento | `ordemServicoService.atualizarGarantia` | mocks + integração real |
| RN07: impossibilidade técnica, pelo técnico atribuído, com diagnóstico e justificativa, até EM_REPARO | `encerramentoRepository`, `ordemServicoService.encerrarSemReparo` | mocks + integração real |
| RN08: desistência do cliente (ADM, ATD ou técnico atribuído) em RECEBIDA, EM_ANALISE ou AGUARDANDO_APROVACAO | idem | mocks + integração real |
| RN09: rejeição do orçamento encerra a OS com `ORCAMENTO_REJEITADO` | `orcamentoRepository.registrarResposta` | mocks + integração real |
| RN10: validade de 72 h; vencido não encerra a OS | `orcamentoRepository` (vencimento ao consultar ou operar) | mocks + integração real |
| RN11: encerramento grava tipo, motivo, data e usuário | `encerramentoRepository`, `registrarResposta` | mocks + integração real |
| RN12: orçamentos PENDENTE viram CANCELADO no encerramento | `encerramentoRepository` | mocks + integração real |
| RN13: pagamentos PENDENTE são cancelados; CONFIRMADO preservados; sem novas confirmações | `encerramentoRepository`, `pagamentoRepository.atualizarStatus` | mocks + integração real |
| RN14–RN15: total devido, pago e saldo calculados; pagamentos parciais; limite pelo saldo. **R6:** total pago = confirmados − reembolsos. **R1 (implementada em teste):** total devido = orçamento aprovado − abatimentos aprovados (seção 3.5) | `pagamentoRepository.buscarValoresOs` (ponto único) | mocks + integração real |
| RN16 revisada (D5, D6): reembolso parcial ou integral de CONFIRMADO, até o valor disponível; REEMBOLSADO quando a soma atinge o valor | `pagamentoRepository.reembolsar` + tabela `reembolso` | mocks + integração real (5 reembolsos simultâneos não ultrapassam o valor) |
| D1–D4: avaliação financeira obrigatória (impossibilidade técnica em EM_REPARO com pagamento confirmado), imutável, com revisões | `avaliacaoReembolsoRepository` + tabela `avaliacao_reembolso` | mocks + integração real (5 avaliações simultâneas → 1) |
| D7: acessórios depois da abertura por etapa e técnico, com evento `ACESSORIO` | `acessorioRecebidoRepository.criarVarios` | mocks + integração real |
| D8: laudo editável pelo técnico atual até a finalização | `execucaoRepository.atualizar` (OS bloqueada) | mocks + integração real |
| RN17: um orçamento PENDENTE por OS; resposta só por ADM ou ATD | `orcamentoRepository.criar` (bloqueio da OS) | mocks + integração real (5 requisições simultâneas → 1 PENDENTE) |
| RN18–RN20: expedição única; ENVIO e RETIRADA; conclusão exige quitação quando há cobrança (com R1, quitação sobre o total devido após abatimentos) | `expedicaoRepository` | mocks + integração real (inclui entrega após abatimento e concorrência abatimento × entrega) |
| RN21: histórico da OS na mesma transação, sem edição ou exclusão | `historicoRepository` + cada repository | mocks + integração real (incluindo rollback real) |
| RN22: solicitação sem status próprio | O backend não lê nem grava mais `solicitacao.status`; migração preparada | mocks + integração real |
| RN23: acessórios repetidos em linhas separadas | `solicitacaoService` | mocks + integração real |
| RN24: autoria e valor do orçamento | `orcamentoRepository` | mocks |
| RN25–RN26: CPF/CNPJ único; expedição única por OS | banco (UNIQUE) + services | mocks + integração real |

## 2. Decisões técnicas (tomadas na implementação)

| Decisão | Motivo |
|---|---|
| Histórico gravado pela mesma conexão da operação, com lista de campos permitidos no JSON | A operação e o evento são confirmados ou desfeitos juntos (RN21), e senha, hash ou token nunca entram no histórico |
| Nenhum evento para operações recusadas ou sem mudança (mesmo técnico, mesma garantia) | "Não inventar eventos" |
| Aprovação de orçamento gera ORCAMENTO + REPARO (início) | Uma decisão gera dois fatos distintos; não é duplicidade |
| Vencimento registrado como evento automático (`id_usuario` NULL) | O MER prevê usuário opcional para eventos automáticos |
| No encerramento, orçamentos PENDENTE já expirados viram VENCIDO (não CANCELADO) | Reflete o que de fato ocorreu com eles |
| Encerramento em `PATCH /ordens-servico/:id/encerramento` com o tipo no corpo | Uma rota para os dois tipos; `ORCAMENTO_REJEITADO` continua automático |
| "Mesmo equipamento" = mesmo `id_item` (RN05) | Não há identificação segura entre solicitações diferentes (número de série é opcional e não é único); nenhum critério foi inventado |
| Tela de detalhes da OS como ambiente de trabalho, com uma seção por assunto (`pages/ordens-servico/secoes`) | Componentes pequenos que reutilizam o mesmo serviço HTTP; a API confere novamente cada permissão |
| **P6:** itens "Orçamentos", "Pagamentos" e "Expedição" **removidos** do menu (antes ficavam desativados) | Opção mais simples: as ações ficam na tela da OS e telas de listagem geral não foram pedidas. Atalhos levariam à mesma lista de OS, sem ganho. O menu ganhou "Usuários" (somente ADM) |
| **P3:** técnico não vê pagamentos | `GET /ordens-servico/:id/pagamentos` restrito a ADM e ATD (403 para TEC, inclusive por acesso direto); eventos `PAGAMENTO` filtrados do histórico para TEC; a tela não pede nem mostra a seção. Conferido manualmente pela API com a sessão do técnico |
| **P5:** gestão de usuários pela interface, somente ADM | `PUT /usuarios/:id` e `PATCH /usuarios/:id/ativo`; a senha só é gravada como hash e nunca volta na resposta; o último administrador ativo não pode ser desativado nem rebaixado (bloqueio `FOR UPDATE` dos administradores ativos, na mesma transação) |
| Registro de acessórios em lote | Todos os acessórios de um pedido são validados antes de gravar e gravados em uma transação; acessório inativo → 409 e nada é gravado |
| "Avaliação obrigatória" calculada, sem coluna nova: IMPOSSIBILIDADE_TECNICA + orçamento APROVADO + pagamento CONFIRMADO | Só a aprovação leva a EM_REPARO e a impossibilidade só é aceita até EM_REPARO; portanto o orçamento aprovado prova que a OS foi encerrada durante o reparo |
| Uma avaliação original por OS garantida no banco (coluna gerada `id_os_original` + UNIQUE) e cadeia linear de revisões (`id_avaliacao_revisada` UNIQUE) | Protege contra requisições simultâneas mesmo fora do bloqueio da aplicação |
| A revisão informa `id_avaliacao_revisada` e precisa ser a vigente | Evita revisar sem ver uma revisão feita por outra pessoa |
| Avaliação, revisão e reembolsos gravados como evento `PAGAMENTO` | Dado financeiro, já oculto do técnico (P3); nenhum tipo de evento novo para isso |
| Reembolso sem `valor` devolve todo o disponível do pagamento | Mantém o comportamento anterior (integral) para quem não informa valor |
| Colunas antigas de reembolso em `pagamento` viram resumo, preenchido quando a devolução fica integral; a fonte da verdade é `reembolso` | Compatibilidade com RN16 e com os dados existentes, sem alterar `pagamento` |
| A tela limita o valor do reembolso ao que a avaliação vigente ainda permite | Evita o erro 409 previsível; a API confere de novo |
| Os testes de integração aplicam as migrações pendentes no banco `_teste` | O fluxo é testado no estado de destino, sem tocar no banco principal |
| Aviso do encerramento sem reparo | "Pagamentos confirmados são mantidos; não há reembolso automático — a administração ou o atendimento avalia cada caso" (Opção C). O texto anterior mandava o técnico à seção Pagamentos, que ele não vê |
| Scripts SQL alinhados ao banco real; CHECKs que existiam só nos scripts foram retiradas (ENUM no lugar de CHECK de status) | Mesmo critério aprovado para `ck_ordem_servico_datas` |
| `servidor-teste.js` para demonstração | A API só aceita banco terminado em `_teste`, sem risco ao banco principal |

## 3. Decisões aprovadas e pendências

### 3.1 Decisão aprovada — Opção C (antiga P1)

**Impossibilidade técnica durante EM_REPARO:** o orçamento APROVADO e os pagamentos CONFIRMADO são preservados; **não há reembolso automático**; ADMINISTRADOR ou ATENDENTE avalia cada caso; a decisão registra o valor definido para eventual reembolso, a justificativa, o responsável e a data; o reembolso é uma operação separada.

### 3.2 Decisões aprovadas em 09/11/2026 (segunda rodada)

| # | Tema | Decisão aprovada | Como foi implementada |
|---|---|---|---|
| D1 | Avaliação financeira obrigatória | Toda OS encerrada por IMPOSSIBILIDADE_TECNICA durante EM_REPARO com pagamento CONFIRMADO passa por avaliação, mesmo com valor zero | Tabela `avaliacao_reembolso`; a OS mostra a pendência; reembolso dessa OS só depois da avaliação |
| D2 | Revisão da avaliação | Original nunca editada nem excluída; correção = novo registro de revisão com justificativa da correção, responsável e data | `id_avaliacao_revisada` (UNIQUE) + `motivo_revisao`; a anterior permanece |
| D3 | Abrangência | Obrigatória só para IMPOSSIBILIDADE_TECNICA durante EM_REPARO | Regra R1 da proposta (orçamento APROVADO prova o EM_REPARO) |
| D4 | Orçamento aprovado | Permanece APROVADO | A avaliação não altera `orcamento` |
| D5 | Reembolso em OS FINALIZADA | Mantido, sem automação, com justificativa, responsável, data e histórico | Sem restrição de etapa; evento `PAGAMENTO` |
| D6 | Reembolso parcial | Permitido até o valor disponível para devolução | Tabela `reembolso`; `valor` opcional no `PATCH /pagamentos/:id/reembolso` |
| D7 | P4 — acessórios depois da abertura | ADM e ATD em qualquer OS ativa; TÉCNICO só na OS atribuída a ele; bloqueado em CONCLUIDA, AGUARDANDO_EXPEDICAO, FINALIZADA e ENCERRADA_SEM_REPARO; toda inclusão gera evento no histórico | Validação de etapa e técnico **dentro da transação**, com bloqueio da OS; evento `ACESSORIO` na OS atual do equipamento |
| D8 | O2 — laudo técnico | Técnico atualmente atribuído edita o laudo até a OS ser FINALIZADA (inclusive CONCLUIDA e AGUARDANDO_EXPEDICAO); toda edição gera evento com dados anteriores e novos; bloqueado em FINALIZADA e ENCERRADA_SEM_REPARO | Regra já existente; a etapa e o técnico passaram a ser conferidos **dentro da transação**, com bloqueio da OS |
| D10 | Q1 — avaliação pendente e expedição | A avaliação pendente **não** bloqueia expedição, entrega nem retirada; aviso de pendência financeira para ADM e ATD; reembolso continua bloqueado até a avaliação; a expedição não altera o status da OS encerrada sem reparo; fluxos físico e financeiro separados | Nenhum bloqueio no `expedicaoRepository` (fluxo físico inalterado); aviso na seção de expedição e na de avaliação; bloqueio do reembolso em `pagamentoRepository.reembolsar` |
| D9 | P2 — migração de `solicitacao.status` | Executar **somente em banco `_teste`**; não executar no banco principal agora | Ver seção 3.4 |

**Associação do evento de acessório à OS (D7):** `acessorio_recebido` pertence a `item_solicitacao`, não à OS. O evento é gravado na **OS atual do equipamento** (a mais recente do item; o backend garante uma única OS ativa por equipamento). Pela rota `POST /ordens-servico/:id/acessorios`, a OS é a da URL e precisa estar numa etapa permitida.

**Tipo de evento novo:** o MER v1.4 não tem tipo de evento para acessórios. Foi acrescentado `ACESSORIO` ao ENUM `historico_os.tipo_evento` (mudança de modelo, migração `20261109_03_historico_evento_acessorio.sql`, executada só em banco `_teste`).

**Alteração de acessórios (D7, implementada em 09/11/2026):** `PATCH /acessorios-recebidos/:id` e `PATCH /ordens-servico/:id/acessorios/:id_acessorio_recebido` alteram acessório, quantidade e observações, com as mesmas permissões e etapas da inclusão, a OS bloqueada na transação e o evento `ACESSORIO` com valores anteriores e novos. **Exclusão não implementada** (não aprovada).

**RN20 × reembolso (investigado em 09/11/2026, sem mudança de regra):**

| Situação | Comportamento atual (testado em integração real) | Regras aplicadas |
|---|---|---|
| Reembolso parcial depois de registrar a expedição e antes da entrega | Permitido; o pagamento continua CONFIRMADO; o saldo volta a existir (ex.: pago 100, reembolso 30 → saldo 30); OS e expedição não mudam | D5/D6 (reembolso em qualquer etapa) e R6 (total pago = confirmados − reembolsos) |
| Despacho (EM_TRANSITO) com saldo | Permitido | RN20 só exige quitação na conclusão |
| Entrega com saldo pendente | Recusada (409 "A devolução exige a quitação…"); nada muda; um novo pagamento confirmado libera a entrega | RN20 |
| Reembolso depois da entrega (OS FINALIZADA) | Permitido, com histórico | D5 |
| OS FINALIZADA depois de reembolso | Continua FINALIZADA, expedição continua ENTREGUE, data de encerramento inalterada; não há novo pagamento (409) nem nova mudança da expedição (409); o resumo mostra o saldo resultante | O reembolso nunca altera `ordem_servico` nem `expedicao` |

**Conclusão:** o comportamento está de acordo com as regras aprovadas (RN20, D5, D6 e R6). **Decidido depois como R1 (abatimento formal, seção 3.5):** o sistema não tem "desconto" ou "abatimento". Um reembolso parcial antes da entrega usado como abatimento negociado faz a OS ficar com saldo e bloqueia a entrega até um novo pagamento, embora o cliente não deva mais nada. Se esse uso existir na prática, é preciso uma regra nova (por exemplo, reembolso "de abatimento" que reduz o valor devido, ou permitir a entrega com saldo decorrente de reembolso). Depois da finalização, o saldo mostrado é informativo e não reabre a OS.

### 3.3 Lista única de pendências (consolidada em 09/11/2026)

Esta é a **única** lista de pendências do projeto; os demais documentos remetem a ela. Itens já resolvidos ficam no fim, para rastreabilidade.

**Pendentes — técnicas**

| # | Pendência | Situação / evidência | Próximo passo |
|---|---|---|---|
| T1 | ~~R1 (abatimento formal) no banco principal~~ | **Executada no banco principal em 09/11/2026 17:02** (autorizada): backup `assistencia_tecnica_20261109_170123_antes_migracoes.sql` testado antes; `criar_tabelas.ps1 -SomenteVerificar` → 17 OK, 0 divergentes, 0 faltantes | Concluída |
| T2 | ~~Executar as migrações 1–3 no banco principal~~ | **Executada no banco principal em 09/11/2026 17:02** (autorizada): backup `assistencia_tecnica_20261109_170123_antes_migracoes.sql` testado antes; `criar_tabelas.ps1 -SomenteVerificar` → 17 OK, 0 divergentes, 0 faltantes | Concluída |
| T3 | ~~Executar a migração 4 (R1) no banco principal~~ | **Executada no banco principal em 09/11/2026 17:02** (autorizada): backup `assistencia_tecnica_20261109_170123_antes_migracoes.sql` testado antes; `criar_tabelas.ps1 -SomenteVerificar` → 17 OK, 0 divergentes, 0 faltantes | Concluída |
| T4 | Publicar o backend e o frontend atuais | O banco principal já está no estado exigido (migrações 2–4 executadas) | **Aguarda autorização própria** (não incluída na autorização da migração) |

**Pendentes — operacionais (antes de migrar o banco principal)**

| # | Pendência | Situação |
|---|---|---|
| OP1 | Login-path administrativo com `DROP` para restauração e recuperação | Conferido de novo em 09/11/2026 (auditoria final): só existe `assistencia` (`assistencia_dev`), sem `DROP`, `PROCESS` nem acesso a `_teste`. Serve para o backup e as migrações 1–4, **não** para restaurar. Criar `assistencia_admin` (comando em `MIGRACOES_BACKUP_RECUPERACAO.md`, 5.6) |
| OP2 | Encerrar processos node travados (PIDs 18836, 19960, 20712, desde 01:15), o cliente `mysql` interativo (PID 3904, desde 08/11 18:52) e as sessões MySQL ociosas 15 e 279 no banco principal | Conferido em 09/11/2026 (somente leitura): continuam abertos; 0 transações, 0 bloqueios de metadados; nenhum servidor escutando. **Nada foi encerrado**: aguarda autorização. Na janela de 09/11/2026 17:02: a sessão 15 já tinha terminado; a sessão 279 estava ociosa, sem transação nem bloqueio de metadados (não impediu os `ALTER`); nada foi encerrado |
| OP3 | ~~Backup novo e testado imediatamente antes da janela~~ | **Feito em 09/11/2026 17:01**: `banco/backups/assistencia_tecnica_20261109_170123_antes_migracoes.sql`, restaurado com `source` em banco `_teste` com checksums idênticos nas 14 tabelas |
| OP4 | ~~Usuário do backend com privilégio mínimo~~ | **Resolvido em 09/11/2026 (S1):** a API conecta como `assistencia_app`@`localhost`, com `SELECT, INSERT, UPDATE` somente em `assistencia_tecnica` e `assistencia_tecnica_teste` (sem `DELETE`, DDL, `PROCESS` ou acesso a outros bancos; testado). A credencial administrativa ficou em `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD`, usada apenas pelas ferramentas de teste em `backend/integracao` |

**Pendentes — documentação**

| # | Pendência | Situação |
|---|---|---|
| D-1 | ~~Revisar o MER (v1.5)~~ | **Feito em 09/11/2026:** `documentacao/mer/MER_Assistencia_Tecnica_v1.5.md` (17 entidades, RN14 redefinida, RN27–RN36, `tipo_evento` com 11 valores); a v1.4 (`.docx`, `.drawio` e transcrição) está preservada em `documentacao/mer/historico/`. I1–I3 resolvidas no MER; I4 registrada no MER (seção 7); I5 resolvida na implementação de R1 |
| D-3 | Diagrama `.drawio` v1.5 | O texto do MER v1.5 está pronto; o diagrama ainda é o da v1.4 (sem as 3 entidades novas) |
| D-2 | ~~Atualizar API, roteiro e migrações após R1~~ | Feito em 09/11/2026 |

**Lacunas de teste conhecidas (não bloqueiam; registradas para decisão de prioridade)**

| # | Lacuna |
|---|---|
| L1 | Os comandos de "desfazer só a migração 1" e "desfazer só a migração 3" (seção 5.4) não foram executados; a recuperação total pelo backup e a recuperação da falha parcial da migração 2 foram validadas |
| L2 | A devolução por ENVIO com avaliação financeira pendente não tem teste próprio (a RETIRADA tem) |
| L3 | Não há teste automatizado de interface contra o backend real; as telas foram validadas manualmente no navegador (roteiro) e por specs com HTTP simulado |
| L4 | Não há lista ou filtro de OS com avaliação financeira pendente (só aparece ao abrir a OS); não é regra aprovada |
| L5 | Aviso antigo de tamanho do CSS do dashboard no `ng build` (`dashboard.css` 5,2 kB > 4 kB) |
| L6 | `backend/src/models/ordemServico.js` mantém o campo `id_item_ativo`, que não existe no banco (fica sempre indefinido; sem efeito). O `banco/LEIA-ME.txt` citava essa coluna e foi corrigido; o código não foi alterado |

**Fora do escopo aprovado:** exclusão de acessórios recebidos (não aprovada).

**Resolvidas** (evidências nas seções indicadas): P1 avaliação financeira e reembolso parcial (D1–D6, implementado em teste, faz parte de T2) · P2 remoção de `solicitacao.status` (faz parte de T2) · P3 técnico sem dados financeiros · P4 acessórios depois da abertura, inclusão e alteração (D7, em teste; faz parte de T2) · P5 gestão de usuários · P6 menu · Q1/D10 avaliação pendente não bloqueia a devolução · O2/D8 laudo editável até a finalização · R1 decidida (A1–A8, C1, C2).

### 3.4 Migrações do banco principal (EXECUTADAS em 09/11/2026)

**As quatro foram executadas em `assistencia_tecnica` em 09/11/2026 17:02, com autorização** (detalhes em `MIGRACOES_BACKUP_RECUPERACAO.md`, seção 7). `pendentes.json` agora tem a lista de pendentes vazia e registra as executadas em `executadas_no_principal`. Antes da execução: A lista está em `banco/migracoes/pendentes.json`; os testes de integração aplicam todas no banco `_teste` antes de rodar o fluxo completo. Procedimento de backup e recuperação: [MIGRACOES_BACKUP_RECUPERACAO.md](MIGRACOES_BACKUP_RECUPERACAO.md).

| Migração | Efeito | Destrutiva? |
|---|---|---|
| `20261109_01_remover_status_solicitacao.sql` | Remove `solicitacao.status` (RN22) | **Sim** (remove coluna) |
| `20261109_02_avaliacao_reembolso_parcial.sql` | Cria `avaliacao_reembolso` e `reembolso`; copia reembolsos antigos | Não (aditiva) |
| `20261109_03_historico_evento_acessorio.sql` | Acrescenta `ACESSORIO` ao ENUM de `historico_os.tipo_evento` | Não (aditiva) |
| `20261109_04_abatimento_formal.sql` (R1/A8) | Cria `abatimento` e acrescenta `ABATIMENTO` ao ENUM de `historico_os.tipo_evento` (seção 3.5.4) | Não (aditiva) |

**Guardas (auditoria final, 09/11/2026):** cada migração para sem alterar nada quando é executada fora de ordem ou repetida. Isso elimina o risco de a 3, executada depois da 4, remover `ABATIMENTO`. Os nomes foram corrigidos para a data real (`20261109_NN_`), e a ordem alfabética passou a ser a ordem de execução. Testes: `backend/integracao/migracoes.integracao.js` (9/9). Detalhes em `MIGRACOES_BACKUP_RECUPERACAO.md`, 5.5.

Os scripts `banco/sql` e `banco/esquema_esperado.json` já descrevem o **estado de destino** (depois das migrações). Até a migração, `criar_tabelas.ps1 -SomenteVerificar` no banco principal acusa essas três diferenças, e somente elas.

### 3.5 Regra R1 — Abatimento formal (IMPLEMENTADA EM AMBIENTE DE TESTE)

**Situação:** decisões A1–A8, C1 e C2 aprovadas em 09/11/2026. **Implementada e validada somente em ambiente de teste** (evidências na seção 3.5.10). No banco principal depende da migração 4, que aguarda autorização.

**Regra R1:** o abatimento formal **reduz o total devido** da OS e é **separado do reembolso**. A entrega é permitida quando o saldo recalculado chega a zero. O orçamento aprovado nunca é alterado: cada abatimento é um registro próprio.

#### 3.5.1 Decisões aprovadas

| # | Tema | Decisão |
|---|---|---|
| A1 | Fluxo | Uma etapa: o abatimento nasce `APROVADO` no registro; não há aprovação separada |
| A2 | Permissões | ADMINISTRADOR e ATENDENTE registram. TECNICO não registra, não aprova, não cancela e não altera abatimentos |
| A3 | Etapas da OS | Permitido em `EM_REPARO`, `CONCLUIDA` e `AGUARDANDO_EXPEDICAO`. Bloqueado em `FINALIZADA` e `ENCERRADA_SEM_REPARO` (e nas etapas anteriores à aprovação, em que não há orçamento aprovado) |
| A4 | Limite | Valor ≤ total devido − total pago − pagamentos pendentes. Pagamentos pendentes reservam saldo. Validação no backend, em transação, com a OS bloqueada (`SELECT … FOR UPDATE`) e os valores recalculados antes de gravar |
| A5 | Cancelamento | Permitido antes da entrega ou retirada, com justificativa obrigatória. O registro original é preservado (sem exclusão física nem alteração destrutiva); grava responsável, data/hora e justificativa. Proibido depois da entrega ou retirada |
| A6 | Histórico | Novo tipo de evento `ABATIMENTO` em `historico_os`, para inclusão e cancelamento, com valor, motivo, responsável, data/hora e saldo anterior e posterior. Não exibido ao TECNICO |
| A7 | Abatimento integral | Permitido: pode levar o total devido a zero. Com saldo zero, a OS pode ser entregue sem pagamento. A quitação considera o total devido depois dos abatimentos aprovados |
| A8 | Migração | Quarta migração, aditiva, para a tabela `abatimento` e o novo tipo de evento. Aplicada e validada somente em bancos `_teste`; banco principal intocado até autorização |
| C1 | Cancelamento — quem | ADMINISTRADOR ou ATENDENTE **ativo** pode cancelar qualquer abatimento, inclusive registrado por outra pessoa. TECNICO não cancela (A2) |
| C2 | Visualização | A lista de abatimentos e o resumo financeiro (total original, abatido, devido, pago e saldo) ficam restritos a ADMINISTRADOR e ATENDENTE. O TECNICO não vê abatimentos nem eventos `ABATIMENTO`, como nos demais dados financeiros (P3) |

#### 3.5.2 Cálculo financeiro (substitui o cálculo da RN14 do MER v1.4)

| Valor | Definição |
|---|---|
| **Total original** | `valor_total` do orçamento APROVADO da OS (armazenado na emissão, RN24; nunca sobrescrito) |
| **Total abatido** | Soma dos abatimentos `APROVADO` vinculados a esse orçamento (cancelados não contam) |
| **Total devido** | Total original − total abatido |
| **Total pago** | Σ (valor − reembolsado) dos pagamentos `CONFIRMADO` (R6; `REEMBOLSADO` conta zero; pendentes e cancelados não entram) |
| **Saldo** | Total devido − total pago |
| **Disponível para novo abatimento** (A4) | Total devido − total pago − pagamentos `PENDENTE` |
| **Disponível para novo pagamento** (RN15) | Total devido − total pago − pagamentos `PENDENTE` (mesma fórmula; hoje usa o total original) |

Consequências:
- **Invariante:** com A4 e RN15, o total pago nunca ultrapassa o total devido; o saldo nunca fica negativo por abatimento. O reembolso só aumenta o saldo; o cancelamento de abatimento aumenta o total devido (e o saldo).
- **Confirmação de pagamento (RN15):** total pago + valor ≤ total devido.
- **Quitação (RN20):** "saldo igual a zero" passa a usar o total devido. Vale para o registro da expedição de OS reparada (CONCLUIDA) e para a conclusão da entrega ou retirada.
- **Avaliação financeira (D1–D4):** não muda; usa só pagamentos e reembolsos.
- Os valores são calculados pelo backend a cada consulta ou operação, sem saldo armazenado (RN14).

#### 3.5.3 Regras de negócio

| # | Regra |
|---|---|
| AB1 | Registro por ADMINISTRADOR ou ATENDENTE **ativo** (perfil conferido no banco a cada requisição); TECNICO → 403 |
| AB2 | A OS precisa estar em EM_REPARO, CONCLUIDA ou AGUARDANDO_EXPEDICAO e ter orçamento APROVADO; senão 409 |
| AB3 | Valor > 0, até duas casas decimais, ≤ disponível para novo abatimento (A4); acima → 409 sem gravar nada |
| AB4 | Motivo obrigatório (texto, até o limite de TEXT) |
| AB5 | O abatimento guarda o orçamento aprovado ao qual se refere; o orçamento e seus itens não são alterados |
| AB6 | Cancelamento por ADMINISTRADOR ou ATENDENTE ativo, de qualquer autor (C1), com justificativa obrigatória, somente enquanto a OS não estiver FINALIZADA (entrega ou retirada concluída) nem ENCERRADA_SEM_REPARO; abatimento já cancelado → 409 |
| AB7 | Nenhuma operação de abatimento altera `ordem_servico.status`, `orcamento` ou `expedicao`. Em especial, uma OS FINALIZADA nunca volta a uma etapa anterior por operação financeira |
| AB8 | Concorrência: registro e cancelamento bloqueiam primeiro a OS e depois o abatimento, na mesma ordem das demais operações financeiras (pagamento, confirmação, reembolso, avaliação e expedição); evento no histórico na mesma transação |
| AB9 | Histórico (A6): evento `ABATIMENTO` com `id_abatimento`, valor, motivo (ou justificativa do cancelamento), status, total devido e saldo antes e depois. Oculto do TECNICO, como os eventos `PAGAMENTO` (P3) |
| AB10 | Visualização: a lista de abatimentos e o resumo financeiro ficam restritos a ADMINISTRADOR e ATENDENTE; TECNICO → 403 (C2, mesma regra de P3) |

#### 3.5.4 Entidade `abatimento` (complemento ao MER v1.4)

| Coluna | Tipo | Regra |
|---|---|---|
| `id_abatimento` | INT PK AUTO_INCREMENT | |
| `id_os` | INT NOT NULL, FK `ordem_servico` | OS do abatimento |
| `id_orcamento` | INT NOT NULL, FK `orcamento` | Orçamento APROVADO da mesma OS (a correspondência OS × orçamento e o status são conferidos no backend; ver inconsistência I4) |
| `valor` | DECIMAL(10,2) NOT NULL, CHECK `> 0` | |
| `motivo` | TEXT NOT NULL | |
| `status` | ENUM(`APROVADO`, `CANCELADO`) NOT NULL DEFAULT `APROVADO` | Nasce APROVADO (A1) |
| `id_usuario_registro` | INT NOT NULL, FK `usuario` | Responsável pelo registro |
| `data_registro` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `id_usuario_cancelamento` | INT NULL, FK `usuario` | Preenchido só no cancelamento |
| `data_cancelamento` | DATETIME NULL | Idem |
| `justificativa_cancelamento` | TEXT NULL | Idem; obrigatória no cancelamento (backend) |

Índices: `id_os`, `id_orcamento`, `id_usuario_registro`, `id_usuario_cancelamento`. FKs com `ON DELETE RESTRICT ON UPDATE RESTRICT`, como as demais tabelas. Coerência "CANCELADO ⇔ campos de cancelamento preenchidos" validada no backend (padrão do projeto: sem CHECK em colunas com FK).

Migração prevista (A8): `banco/migracoes/<data>_abatimento.sql` com o `CREATE TABLE abatimento` e o acréscimo de `ABATIMENTO` ao ENUM `historico_os.tipo_evento`; script de destino `banco/sql/17_abatimento.sql`; `banco/sql/14_historico_os.sql`, `esquema_esperado.json` e `pendentes.json` atualizados **na implementação** (ver C3).

#### 3.5.5 Impacto previsto (para a implementação)

- **Backend:**
  - Novos: `abatimentoRepository`, `abatimentoService`, `abatimentoController`, `abatimentoRoutes`, model `abatimento`.
  - Alterados: `pagamentoRepository.buscarValoresOs` (ponto único de cálculo; acrescenta total abatido e total devido), `calcularResumo`, limites de `criar` e `atualizarStatus`, `expedicaoRepository` (registro e conclusão), `historicoRepository` (tipo `ABATIMENTO` e campos), filtro do histórico do técnico em `ordemServicoService`.
- **Rotas previstas:** `GET` e `POST /ordens-servico/:id/abatimentos`; `PATCH /abatimentos/:id/cancelamento` (ver API.md).
- **Frontend:**
  - Nova seção de abatimentos na OS (ADM e ATD).
  - Resumo de pagamentos com total original, abatimentos, total devido, total pago e saldo. Hoje o rótulo "Total devido" mostra o valor do orçamento: deve passar a mostrar o total devido.
  - Rótulos do histórico.

#### 3.5.6 Critérios de aceite (plano de testes)

Mocks, integração real em banco `_teste` com a 4ª migração aplicada, telas e validação manual.

| Caso | Esperado (orçamento de R$ 100) |
|---|---|
| Abatimento parcial | 20 → devido 80, saldo 80; novo pagamento limitado a 80; orçamento e itens inalterados |
| Abatimento integral (A7) | 100 → devido 0, saldo 0; novo pagamento → 409; registro e conclusão da entrega sem pagamento |
| Com pagamento parcial | pago 50; abatimento 30 → saldo 20; abatimento 25 → 409; pagar 20 → saldo 0 |
| Com reembolso | pago 100; reembolso 30 (saldo 30); abatimento 30 (saldo 0); entrega liberada; registros e eventos distintos (`reembolso`/`PAGAMENTO` × `abatimento`/`ABATIMENTO`) |
| Acima do devido | saldo 40 → 40,01 → 409; pendente 30 com saldo 40 → limite 10 (A4); nada gravado |
| Entrega após quitação | AGUARDANDO_EXPEDICAO com saldo 30: ENTREGUE → 409; abatimento 30; ENTREGUE → 200 e FINALIZADA |
| Cancelamento (A5) | devido volta a subir; registro preservado com responsável, data e justificativa; segundo cancelamento → 409; cancelamento em FINALIZADA → 409 |
| Etapas (A3) | FINALIZADA, ENCERRADA_SEM_REPARO e etapas sem orçamento aprovado → 409 |
| Perfis (A2) | TECNICO → 403 em registrar, cancelar e listar; usuário inativo → 403; técnico não vê eventos `ABATIMENTO` |
| FINALIZADA (AB7) | nenhuma operação financeira altera status, data de encerramento ou expedição |
| Concorrência | 5 abatimentos simultâneos de 30 com saldo 100 → 3 aceitos; abatimento × pagamento × confirmação simultâneos não ultrapassam o devido; abatimento × conclusão da entrega: nunca entrega com saldo; cancelamento × entrega: consistente |
| Histórico | inclusão e cancelamento com valor, motivo/justificativa, responsável, saldo antes e depois, na mesma transação (falha no histórico desfaz a operação) |

#### 3.5.7 Regras anteriores afetadas

| Regra | Efeito de R1 |
|---|---|
| RN14 (MER v1.4: "o total devido corresponde ao valor do orçamento aprovado") | **Redefinida**: total devido = orçamento aprovado − abatimentos aprovados |
| RN15 (limite de pagamento e confirmação) | Mantida, com o total devido no lugar do valor do orçamento |
| RN20 (entrega com saldo zero) | Mantida; o saldo passa a considerar abatimentos. Resolve o caso "abatimento negociado" levantado na investigação RN20 × reembolso |
| RN24 (valor do orçamento armazenado) | Mantida: o orçamento não é alterado |
| R6 / D5 / D6 (reembolso) | Mantidos e independentes: o reembolso altera o total pago; o abatimento altera o total devido |
| D1–D4, D10 (avaliação financeira) | Sem efeito (abatimento bloqueado em ENCERRADA_SEM_REPARO) |
| P3 (técnico sem dados financeiros) | Estendida aos abatimentos (AB9, AB10) |
| RN21 (histórico) | Novo tipo de evento `ABATIMENTO` (A6) |

#### 3.5.8 Decisões complementares e aplicação das regras

| # | Tema | Situação |
|---|---|---|
| C1 | Quem cancela | **Aprovada** (ver 3.5.1) |
| C2 | Quem vê | **Aprovada** (ver 3.5.1) |
| C3 | Momento de atualizar `pendentes.json` e `esquema_esperado.json` | **Decisão técnica de procedimento**, sem regra de negócio: os dois arquivos são atualizados junto com a criação da migração 4 e do script `17_abatimento.sql`, na implementação. Atualizar antes faria os testes de integração falharem (arquivo inexistente) e deixaria esquema e scripts dessincronizados |
| C4 | Cancelamento com a expedição em andamento (ENVIO em trânsito ou retirada aguardando) | **Aplicação direta de A5** ("antes da entrega ou retirada"): permitido. O saldo volta a existir e a conclusão da entrega fica bloqueada (RN20) até novo pagamento ou novo abatimento |

#### 3.5.9 Plano de implementação (somente em ambiente de teste)

Pré-condição: suítes atuais verdes (mocks, integração real, frontend, build). Banco principal intocado durante todo o plano.

| Fase | Entrega | Evidência exigida |
|---|---|---|
| F1 — Banco | Migração 4 (`CREATE TABLE abatimento` e `MODIFY tipo_evento` com `ACESSORIO` **e** `ABATIMENTO`); `banco/sql/17_abatimento.sql`; `14_historico_os.sql`; `esquema_esperado.json`; `pendentes.json` | Auditoria de esquema (scripts × principal + 4 migrações × esquema: equivalentes); integração real com as 4 migrações; `criar_tabelas.ps1 -SomenteVerificar` no principal mostrando só as diferenças esperadas |
| F2 — Cálculo único | `pagamentoRepository.buscarValoresOs` com total original, abatido e devido; `calcularResumo`, limites de `criar` e `atualizarStatus`; `expedicaoRepository` (registro e conclusão) usando o total devido | As 26 etapas de integração atuais continuam passando (sem abatimento o comportamento não muda) |
| F3 — Abatimentos | `abatimentoRepository` (registrar, cancelar, listar; OS bloqueada antes do abatimento), `abatimentoService` (perfil ativo lido do banco), `abatimentoController`, `abatimentoRoutes`, model, `app.js`; `historicoRepository` (tipo `ABATIMENTO` e campos); filtro do histórico do técnico | Mocks para regras e ordem de bloqueio; integração real para todos os critérios de 3.5.6, inclusive concorrência |
| F4 — Telas | Seção de abatimentos (ADM/ATD), resumo com total original, abatido, devido, pago e saldo; rótulos do histórico | Specs; validação manual no navegador com banco `_teste` (desktop e 375 px) |
| F5 — Segurança da migração | Simulação de backup, falha parcial e recuperação refeita com as 4 migrações | Relatório em `banco/relatorios` |
| F6 — Documentação e relatório | API (de PLANEJADO para implementado), roteiro, migrações, lista única | Relatório consolidado |

Regras de execução: nenhuma funcionalidade é declarada concluída sem teste de **integração real** que a cubra (mocks não substituem); qualquer divergência com regra aprovada é registrada antes de alterar comportamento; dados existentes preservados; sem commit ou push.

**Riscos do plano:** (1) a mudança em `buscarValoresOs` alcança todos os fluxos financeiros. É mitigada pela regressão das 26 etapas de integração e por manter `total_orcado` com o mesmo significado. (2) A migração 4 altera de novo o ENUM do histórico e precisa listar `ACESSORIO`, porque roda depois da 3. (3) Esta versão passa a depender também da migração 4.

#### 3.5.10 Evidências da implementação (ambiente de teste, 09/11/2026)

| Critério (3.5.6) | Evidência |
|---|---|
| Parcial, integral (A7), orçamento e itens inalterados, etapas (A3), perfis (A2, C2), histórico oculto do técnico | Integração real "R1: abatimento parcial, integral, perfis, etapas e orçamento preservado" |
| Com pagamento parcial, limite com pendentes (A4), com reembolso, entrega após quitação (RN20) | Integração real "R1: combinado com pagamento parcial e com reembolso; limite com pendentes; entrega após quitação" |
| Cancelamento (A5, C1, C4), registro preservado, devido recalculado, entrega bloqueada até nova quitação | Integração real "R1: cancelamento (A5, C1, C4) preserva o registro e recalcula o devido" |
| Concorrência (5 abatimentos simultâneos → 3; abatimento × pagamento → 1; abatimento × entrega; cancelamento × entrega → 1) e falha real no histórico desfaz o abatimento (RN21) | Integração real "R1: concorrência entre operações financeiras e falha real no histórico" (executada 3 vezes, sempre verde) |
| Sem abatimento, nenhum comportamento muda | As 26 etapas de integração anteriores continuam passando com o cálculo novo |
| Telas | Specs (registro com limite, confirmação, resumo, cancelamento com justificativa, FINALIZADA sem ações, técnico sem seção) e validação manual no navegador (roteiro, seção 11) |
| Banco | Auditoria: scripts × principal + 4 migrações × `esquema_esperado.json` equivalentes (17 tabelas); simulação de backup, falha parcial e recuperação com as 4 migrações; principal intocado (`criar_tabelas.ps1 -SomenteVerificar`: 12 OK, 2 divergentes e 3 faltantes, exatamente as migrações pendentes) |

**Arquivos:** `banco/migracoes/20261109_04_abatimento_formal.sql`, `banco/sql/17_abatimento.sql`, `banco/sql/14_historico_os.sql`, `banco/esquema_esperado.json`, `banco/migracoes/pendentes.json`; backend `models/abatimento.js`, `repositories/abatimentoRepository.js`, `services/abatimentoService.js`, `controllers/abatimentoController.js`, `routes/abatimentoRoutes.js`, `app.js`, `repositories/pagamentoRepository.js` (cálculo único), `repositories/expedicaoRepository.js`, `repositories/historicoRepository.js`, `services/ordemServicoService.js`; frontend `secoes/secao-abatimentos.ts/.html`, `secao-pagamentos.html`, `secao-historico.ts`, `ordem-servico-detalhe.ts/.html`, `models/ordem-servico.ts`, `services/ordem-servico.service.ts`.

**Risco operacional identificado na auditoria:** repetir a migração 3 **depois** da 4 executa sem erro e **remove** `ABATIMENTO` do ENUM (a 3 redefine a lista inteira). As migrações nunca devem ser repetidas; ver `MIGRACOES_BACKUP_RECUPERACAO.md`, seção 5.4.

**Inconsistências com o MER v1.4 e o banco atual** (registradas; o arquivo do MER não foi alterado):

| # | Inconsistência |
|---|---|
| I1 | MER v1.4, RN14: total devido = orçamento aprovado. R1 redefine (3.5.2). O MER precisa de revisão (v1.5) |
| I2 | MER v1.4, HISTORICO_OS: domínio de `tipo_evento` com 9 valores; o projeto já acrescentou `ACESSORIO` (D7) e R1 acrescenta `ABATIMENTO` |
| I3 | MER v1.4 não tem `AVALIACAO_REEMBOLSO`, `REEMBOLSO` nem `ABATIMENTO`. As duas primeiras estão documentadas como complemento em `PROPOSTA_REEMBOLSO_PARCIAL.md`; `ABATIMENTO` é documentada aqui. Banco principal: nenhuma das três existe (migrações pendentes) |
| I4 | `orcamento` não tem chave única (`id_orcamento`, `id_os`), então o banco não consegue garantir por FK composta que o orçamento do abatimento é da mesma OS. Fica no backend (com bloqueio), como já acontece em outras relações; criar essa chave exigiria alterar uma tabela existente e não está proposto |
| I5 | Tela atual: "Total devido" mostra o valor do orçamento (`total_orcado`). Correto hoje, incorreto depois de R1 (ajuste previsto em 3.5.5) |

## 4. Situação das funcionalidades

| Funcionalidade | Backend | Frontend | Situação |
|---|---|---|---|
| Login, sessão, perfis e rotas protegidas | ✔ | ✔ | CONCLUÍDA |
| Clientes (cadastro, edição, consulta) | ✔ | ✔ | CONCLUÍDA |
| Abertura de solicitação com equipamentos e acessórios | ✔ | ✔ | CONCLUÍDA |
| Consulta de solicitações | ✔ | — (D-SOL-6: a consulta é feita pelas OS) | CONCLUÍDA (conforme decisão) |
| Uma OS por equipamento; lista e detalhes | ✔ | ✔ | CONCLUÍDA |
| Atribuição de técnico | ✔ | ✔ | CONCLUÍDA |
| Diagnóstico, edição e laudo | ✔ | ✔ | CONCLUÍDA |
| Garantia (RN05, RN06) | ✔ | ✔ | CONCLUÍDA |
| Orçamentos: emissão, itens, validade, aprovação, rejeição, anteriores | ✔ | ✔ | CONCLUÍDA |
| Pagamentos: registro, confirmação, cancelamento, totais (somente ADM e ATD) | ✔ | ✔ | CONCLUÍDA |
| Reembolso parcial ou integral (D5, D6) | ✔ | ✔ | PARCIALMENTE CONCLUÍDA: implementado e testado no banco de teste; depende da migração 2 no banco principal |
| Avaliação financeira obrigatória e revisões (D1–D4, D10) | ✔ | ✔ | PARCIALMENTE CONCLUÍDA: implementado e testado no banco de teste; depende da migração 2 no banco principal |
| Conclusão do reparo | ✔ | ✔ | CONCLUÍDA |
| Expedição: ENVIO e RETIRADA, rastreio, datas | ✔ | ✔ | CONCLUÍDA |
| Histórico da OS (RN21) | ✔ | ✔ | CONCLUÍDA (OS antigas, sem eventos, mostram a linha do tempo derivada) |
| Encerramento sem reparo (RN07, RN08) e cancelamentos | ✔ | ✔ | CONCLUÍDA, conforme a Opção C |
| Acessórios registrados ou alterados depois da abertura (D7) | ✔ | ✔ | PARCIALMENTE CONCLUÍDA: implementado e testado no banco de teste; o evento `ACESSORIO` depende da migração 3 no banco principal. Exclusão não aprovada |
| Edição do laudo até a finalização (D8) | ✔ | ✔ | CONCLUÍDA (sem mudança de banco) |
| RN22: solicitação sem status | ✔ | ✔ | PARCIALMENTE CONCLUÍDA: migração executada e validada só no banco de teste; aguarda autorização (P2) |
| Scripts SQL e `esquema_esperado.json` | — | — | CONCLUÍDA: 16 scripts descrevem o estado de destino e são equivalentes ao banco real + migrações (demonstrado em banco de teste) |
| Gestão de usuários pela interface (listar, cadastrar, editar, perfil, ativar/desativar) | ✔ | ✔ | CONCLUÍDA (P5) |
| Abatimento formal (R1, A1–A8, C1, C2) | ✔ | ✔ | PARCIALMENTE CONCLUÍDA: implementada e validada em ambiente de teste (3.5.10); depende da migração 4 no banco principal |
| Validação manual pela interface | — | — | CONCLUÍDA (incluindo as decisões de 09/11, no banco de teste): ver [ROTEIRO_TESTES_MANUAIS.md](ROTEIRO_TESTES_MANUAIS.md) |

## 5. Decisões antigas atualizadas por esta versão

| Item antigo | Situação atual |
|---|---|
| D-OS-3 (EM_ANALISE nunca era usado) | Resolvido pela RN03 |
| D-OS-4 (histórico derivado, sem tabela) | Substituído pela tabela `historico_os` (RN21); a linha do tempo derivada ficou só para OS antigas |
| D-OS-5 (quem define a garantia) | Resolvido pelo MER v1.4: só o técnico atribuído |
| D-OS-7 (encerrar sem orçamento) | Implementado como RN07/RN08 |
| D-OS-8 (técnico vê pagamentos) | Resolvido: o técnico não vê pagamentos (P3) |
| D-SOL-8 (acessórios fora da abertura) | Decidido (D7): ADM/ATD em OS ativa, técnico só na própria OS, bloqueado a partir de CONCLUIDA, evento `ACESSORIO` |
| D-SOL-1 / D-REG-1 (status da solicitação) | RN22: sem status próprio (migração pendente, P2) |
| D-SOL-9 (acessórios repetidos) | Linhas separadas (RN23) |
| D-BD-1 (scripts × banco) | Resolvido: scripts alinhados e testados |
| D-BD-2 (técnico obrigatório × opcional) | MER v1.4: técnico opcional até a atribuição |
| D-BD-3 (uma OS ativa por equipamento) | Garantido no backend (`ordemServicoRepository.criar`, com bloqueio) |
