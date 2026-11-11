# Relatório — Auditoria final e preparação para implantação (09/11/2026)

**Situação:** auditoria concluída em ambiente de teste. O banco principal `assistencia_tecnica` **não foi alterado**: 14 tabelas, mesmas contagens de linhas e `solicitacao.status` presente (conferido no fim). Nenhuma migração, deploy, commit, push, exclusão de dados ou encerramento de processo ou sessão foi feito. **Aguarda autorização para a migração do banco principal.**

## 1. Pendências resolvidas

| Pendência | Resolução | Evidência |
|---|---|---|
| A migração 3 executada depois da 4 removia `ABATIMENTO` do ENUM sem erro | Guarda de pré-condição em cada uma das 4 migrações: fora de ordem ou repetida, a migração para antes do primeiro comando e não altera nada | `migracoes.integracao.js` 9/9; auditoria de esquema (reexecução das 4 → `ER_SP_DOES_NOT_EXIST`) |
| Controle de ordem frágil (a ordem alfabética antiga, abatimento < avaliacao < historico, divergia da ordem de execução) | Arquivos renomeados para `20261109_01…04`, de modo que a ordem alfabética é a ordem de execução; `listarPendentes()` recusa uma lista fora de ordem, nomes fora do padrão e arquivo ausente | Teste "nomes em ordem" |
| Data "20261110" nos nomes × relatório de 09/11 | Os arquivos foram criados em 09/11 (horários dos arquivos: 10:54 e 14:37) e receberam a data errada. Foram renomeados; o cabeçalho de cada um registra o nome anterior | Cabeçalhos das migrações |
| Scripts × `esquema_esperado.json` | Scripts `01–17` × (principal + 4 migrações) × esquema: equivalentes e sincronizados (17 tabelas, incluindo colação e nomes de CHECK) | `auditoria_esquema.js` |
| MER v1.5 (D-1) | Criado, com a v1.4 preservada | Item 5 |
| Procedimento de backup e recuperação | Atualizado com: 4 migrações, guardas, proibição de `--force`, backup novo obrigatório, situação operacional e privilégios | `MIGRACOES_BACKUP_RECUPERACAO.md`, 5.3–5.6 |

## 2. Problemas encontrados e correções

| # | Problema | Correção |
|---|---|---|
| 1 | Repetir a migração 3 depois da 4 apagava `ABATIMENTO` (risco silencioso) | Guardas (seção 5.5 do procedimento) |
| 2 | Nomes com data errada e ordem alfabética diferente da de execução | Renomeação e validação da ordem no executor |
| 3 | As primeiras guardas usavam aspas duplas (falhariam com `ANSI_QUOTES`) | Convertidas para aspas simples |
| 4 | O teste de migrações mantinha o banco quando `MANTER_BANCO_TESTE=1` | Agora o banco é sempre apagado; a sobra (só estrutura, 0 linhas) foi removida |
| 5 | A simulação de recuperação falhava porque ainda esperava `ER_TABLE_EXISTS_ERROR`, erro anterior às guardas | Expectativa corrigida para `ER_SP_DOES_NOT_EXIST`, com verificação do estado inalterado. O relatório da execução que falhou (`…19-14-27-571Z.txt`) foi mantido |
| 6 | O backup existente (`20261107_193227`) está desatualizado: 4 usuários no arquivo × 5 no banco | Registrado: backup novo obrigatório (OP3) |
| 7 | O backend (`.env`) conecta ao MySQL como `root` | Registrado como risco (OP4); não alterado |
| 8 | `banco/LEIA-ME.txt` citava a coluna `ordem_servico.id_item_ativo`, que não existe, e domínios "VARCHAR + CHECK" (hoje são ENUM) | Documento corrigido. O campo morto em `models/ordemServico.js` foi registrado como L6, sem alterar o código |

## 3. Testes executados (todos nesta auditoria)

| Suíte | Resultado |
|---|---|
| Backend com mocks (`npm test`) | **188/188** |
| Integração real MySQL (`npm run test:integracao`): fluxo completo 30 + migrações 9 | **39/39** |
| Frontend (`ng test`) | **99/99** (14 arquivos) |
| Build de produção (`ng build`) | OK, com o aviso antigo de tamanho do `dashboard.css` (L5) |
| Simulação de backup, falha parcial e recuperação (`simularRecuperacaoMigracao.js`, 4 migrações) | **OK** (`recuperacao_migracao_teste_2026-11-09T19-15-00-001Z.txt`) |
| Auditoria de esquema (scripts × principal + migrações × esquema) | Equivalentes, 17 tabelas |
| Controle de acesso por rota (51 rotas) | Todas, exceto `/login`, com `autenticar` + perfil. Financeiro (pagamentos, reembolso, avaliação, abatimentos) só ADM/ATD; gestão de usuários só ADM; nenhuma rota DELETE |
| Concorrência financeira e histórico na mesma transação | Cobertos na integração real (etapas R1: abatimentos simultâneos, abatimento × pagamento × confirmação, abatimento × entrega, falha real no histórico desfazendo a operação) |
| Banco principal (somente leitura) | 14 tabelas; contagens iguais antes e depois; `solicitacao.status` presente |

O log `WARN_DATA_TRUNCATED` que aparece na integração vem do teste que força uma falha no histórico, e é esperado.

## 4. Arquivos alterados nesta etapa

- **Migrações** (renomeadas, com guarda e cabeçalho): `banco/migracoes/20261109_01_remover_status_solicitacao.sql`, `20261109_02_avaliacao_reembolso_parcial.sql`, `20261109_03_historico_evento_acessorio.sql`, `20261109_04_abatimento_formal.sql`, `pendentes.json`. Os nomes antigos foram removidos.
- **Backend:**
  - `integracao/migracoes.js` (validação da ordem)
  - `integracao/migracoes.integracao.js` (**novo**)
  - `integracao/fluxoCompleto.integracao.js` (novos nomes)
  - `integracao/simularRecuperacaoMigracao.js` (expectativa da guarda)
  - `src/repositories/historicoRepository.js` (só comentários)
- **Banco:** cabeçalhos de `banco/sql/04, 14, 15, 16, 17`; `banco/LEIA-ME.txt`.
- **MER:**
  - `documentacao/mer/MER_Assistencia_Tecnica_v1.5.md` (**novo**)
  - `documentacao/mer/historico/` (**novo**: cópias idênticas do `.docx` e do `.drawio` v1.4, conferidas por SHA-256, e a transcrição em texto)
- **Documentação:** `MIGRACOES_BACKUP_RECUPERACAO.md`, `REGRAS_DECISOES_PENDENCIAS.md` (3.3 e 3.4), `README.md`, `API.md`, `PROPOSTA_REEMBOLSO_PARCIAL.md` e este relatório.
- **Relatórios gerados:** `banco/relatorios/recuperacao_migracao_teste_2026-11-09T19-14-27-571Z.txt` (falha da expectativa antiga) e `…19-15-00-001Z.txt` (OK).

## 5. Situação do MER v1.5

**Pronto (texto):** `documentacao/mer/MER_Assistencia_Tecnica_v1.5.md`.
- 17 entidades: as novas são 4.15 AVALIACAO_REEMBOLSO, 4.16 REEMBOLSO e 4.17 ABATIMENTO.
- 11 relacionamentos novos.
- `tipo_evento` com 11 valores (ACESSORIO e ABATIMENTO).
- RN14 redefinida: total devido = aprovado − abatimentos APROVADO; total pago = confirmados − reembolsos.
- RN15, RN16 e RN20 atualizadas; novas RN27–RN36.
- Seção de correspondência com tabelas e migrações.

**Preservação da v1.4:** todo o texto da v1.4 permanece. Os 7 trechos alterados (título, data, `tipo_evento`, RN14 e títulos renumerados) mantêm a redação anterior marcada como "Redação v1.4" ou "texto da v1.4". Os originais estão em `documentacao/mer/historico/`; os arquivos em `Downloads` não foram modificados.

**Pendente:**
- D-3: o diagrama `.drawio` v1.5 (o atual ainda é o da v1.4).
- A validação acadêmica (seção 8 do MER).

## 6. Situação das migrações

| # | Arquivo | Tipo | `_teste` | Principal |
|---|---|---|---|---|
| 1 | `20261109_01_remover_status_solicitacao.sql` | **Destrutiva** (remove coluna) | Validada | **Não executada** |
| 2 | `20261109_02_avaliacao_reembolso_parcial.sql` | Aditiva | Validada | **Não executada** |
| 3 | `20261109_03_historico_evento_acessorio.sql` | Aditiva | Validada | **Não executada** |
| 4 | `20261109_04_abatimento_formal.sql` | Aditiva | Validada | **Não executada** |

As 4 têm guarda. Foram testadas: a ordem correta, a execução fora de ordem, a repetição, a falha parcial (2 e 4) com recuperação, o cliente `mysql` com `source` (código de saída 1) e o executor Node. O backend atual **depende** das migrações 2–4: não deve ser iniciado contra o banco principal antes delas.

## 7. Procedimento recomendado para implantação

1. **Autorização** explícita para migrar o banco principal.
2. **Preparação, feita pelo responsável:**
   - criar o login-path administrativo `assistencia_admin`;
   - encerrar os processos node 18836, 19960 e 20712, o cliente mysql 3904 e as sessões 15 e 279, depois de confirmar que são antigos;
   - manter a aplicação parada.
3. Conferir de novo que `PROCESSLIST` não tem conexões da aplicação, `INNODB_TRX` está vazio e não há bloqueios de metadados.
4. **Backup novo** (5.1) e **teste do backup** com `source` num banco `_teste`, comparando somas de verificação (5.2).
5. (Opcional) `solicitacao_status_backup`.
6. Executar as 4 migrações uma a uma pelo laço 5.3, a partir de uma cópia em `$env:TEMP`, **sem `--force`**, parando no primeiro erro.
7. Conferir: `criar_tabelas.ps1 -SomenteVerificar` deve mostrar 17 tabelas OK, o ENUM deve terminar em `'ACESSORIO','ABATIMENTO'` e as contagens e somas devem ser iguais.
8. Em caso de falha, seguir a recuperação 5.4: pelo backup (recomendado) ou desfazendo a parte criada.
9. Atualizar `pendentes.json` e os cabeçalhos ("EXECUTADA NO BANCO PRINCIPAL em …").
10. Só então publicar o backend e o frontend (T4). Esta etapa exige autorização à parte.

## 8. Riscos que ainda exigem autorização

| Risco / ação | Por que precisa de autorização |
|---|---|
| Migração 1 é destrutiva (remove `solicitacao.status`; hoje 1 linha com "RECEBIDA") | Perda de coluna; reversível só pelo backup ou pela `solicitacao_status_backup` |
| Executar as migrações 1–4 no banco principal | Restrição do projeto (D9) |
| Encerrar processos e sessões (node 18836, 19960 e 20712; mysql 3904; sessões 15 e 279) | Restrição: não encerrar sem autorização. Sessões ociosas podem segurar bloqueios de metadados e travar o `ALTER` |
| Criar o login-path administrativo (`DROP`) | Envolve credenciais do servidor; deve ser feito pelo responsável |
| Backend conectado como `root` | Trocar por um usuário com privilégio mínimo exige criar usuário e alterar o `.env` |
| Novo backup antes da janela | Obrigatório; o backup de 07/11 não corresponde aos dados atuais |
| Publicação do backend e do frontend | Só depois das migrações; restrição de não publicar |
| Lacunas conhecidas (L1–L6) e diagrama v1.5 (D-3) | Não bloqueiam a migração; precisam de decisão de prioridade |

## 9. Atualização — migração do banco principal executada (09/11/2026 17:02, autorizada)

- **Backup:** `banco/backups/assistencia_tecnica_20261109_170123_antes_migracoes.sql`, testado com restauração por `source` em `_teste` (14 tabelas, checksums idênticos).
- **Migrações 01–04:** executadas no principal uma a uma (login-path `assistencia`, sem `--force`), todas OK.
- **Verificação:** `criar_tabelas.ps1 -SomenteVerificar` deu 17 OK, 0 divergentes e 0 faltantes. Dados preservados: checksums iguais em 13 tabelas, e `solicitacao` igual ao backup sem a coluna `status`.
- **`solicitacao_status_backup`:** criada com os valores antigos (1 linha) e mantida.
- **Testes depois:** integração real 39/39, que inclui a igualdade "estrutura anterior + 4 migrações = principal", e mocks 188/188.
- **Ajustes para o novo estado:**
  - `pendentes.json` passou a ter a lista de pendentes vazia e registra as executadas em `executadas_no_principal`;
  - os cabeçalhos das migrações foram marcados como executados;
  - foi criada a estrutura anterior sem dados (`estrutura_antes_migracoes_20261109.sql`), usada pelos testes de guarda;
  - `migracoes.js` ganhou `listarExecutadas`, `listarSequencia` e `arquivoEstruturaAnterior`;
  - os testes de integração foram adaptados;
  - os ensaios `simularRecuperacaoMigracao.js` e `demonstrarMigracoes.js` encerram com aviso quando não há pendentes.
- **Nada foi encerrado.** A sessão 279 estava ociosa, sem bloqueios. Os processos node e o cliente mysql 3904 continuam abertos.
- **Ainda depende de autorização:**
  - a publicação do backend e do frontend (T4);
  - apagar `solicitacao_status_backup`;
  - o login-path administrativo e o usuário de privilégio mínimo para o backend (OP1 e OP4).
