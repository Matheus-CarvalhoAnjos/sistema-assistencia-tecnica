# Migrações pendentes, backup e recuperação

**Situação em 09/11/2026 17:02: as quatro migrações foram EXECUTADAS no banco principal `assistencia_tecnica`, com autorização** (seção 7). Antes disso, foram executadas e validadas somente em bancos `_teste`. O restante deste documento registra o que foi preparado e validado antes da execução e continua valendo para a recuperação.

*Situação anterior à execução:* as quatro migrações foram executadas e validadas **somente em bancos terminados em `_teste`**. **Nada foi executado no banco principal `assistencia_tecnica`** (decisão D9). Este documento reúne o que foi pedido antes de solicitar a autorização: o SQL, a demonstração no banco de teste, a verificação das referências a `solicitacao.status`, os scripts atualizados, o procedimento de backup e recuperação e a simulação de falha parcial (seção 6).

## 1. Migrações (ordem de execução)

Lista oficial: `banco/migracoes/pendentes.json`.

| # | Arquivo | Efeito | Destrutiva | Decisão |
|---|---|---|---|---|
| 1 | `20261109_01_remover_status_solicitacao.sql` | Remove a coluna legada `solicitacao.status` | **Sim** | RN22, D9 |
| 2 | `20261109_02_avaliacao_reembolso_parcial.sql` | Cria `avaliacao_reembolso` e `reembolso`; copia os reembolsos integrais antigos para `reembolso` | Não | D1–D6 |
| 3 | `20261109_03_historico_evento_acessorio.sql` | Acrescenta `ACESSORIO` ao ENUM `historico_os.tipo_evento` | Não | D7 |
| 4 | `20261109_04_abatimento_formal.sql` | Cria a tabela `abatimento` e acrescenta `ABATIMENTO` ao ENUM `historico_os.tipo_evento` (mantendo `ACESSORIO`) | Não | R1 / A8 |

> **Migração 4 (R1) — criada e validada somente em `_teste` (09/11/2026).** Junto com ela foram criados ou atualizados `banco/sql/17_abatimento.sql`, `14_historico_os.sql`, `pendentes.json` e `esquema_esperado.json`. Validação: auditoria de esquema (17 tabelas equivalentes), integração real com as 4 migrações e simulação de falha e recuperação (seção 6, relatório `recuperacao_migracao_teste_2026-11-09T18-53-17-132Z.txt`).

> **Guardas de pré-condição (auditoria final, 09/11/2026).** Antes desta auditoria, executar a migração 3 depois da 4 removia `ABATIMENTO` do ENUM sem nenhum erro. Agora cada arquivo começa com uma guarda. A guarda confere se o banco está exatamente no estado que antecede aquela migração; se não estiver, a execução para com o erro `PROCEDURE … migracao_<AAAAMMDD_NN>_bloqueada_ja_aplicada_ou_fora_de_ordem does not exist` e **nada** daquela migração é aplicado (seção 5.5).
>
> **Nomes corrigidos.** Os arquivos foram criados em 09/11/2026, mas três deles tinham "20261110" no nome. Além disso, a ordem alfabética antiga (abatimento < avaliacao < historico) não era a ordem de execução. Foram renomeados para `20261109_NN_…`: a ordem alfabética passou a ser a ordem de execução, e o `listarPendentes()` recusa uma lista fora de ordem. O cabeçalho de cada arquivo registra o nome anterior. Os relatórios antigos em `banco/relatorios` mantêm os nomes da época.

### SQL da migração P2 (remoção de `solicitacao.status`)

```sql
-- Conferência prévia (somente leitura): deve retornar 0 linhas
SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'solicitacao'
  AND COLUMN_NAME = 'status';

ALTER TABLE solicitacao DROP COLUMN status;
```

O SQL completo das outras duas está nos arquivos (DDL das tabelas novas, cópia dos reembolsos antigos e a conferência `reembolsos_antigos_sem_usuario`, que deve ser 0).

## 2. Demonstração no banco de teste

Comando: `cd backend && node integracao/demonstrarMigracoes.js`. Relatório gerado: `banco/relatorios/migracoes_teste_2026-11-09T14-20-32-903Z.txt`.

| Passo | Resultado |
|---|---|
| Cópia do banco principal (estrutura e dados, **sem senhas**) em `assistencia_tecnica_migracao_teste` | 14 tabelas, 10 linhas |
| Backup da cópia com `mysqldump` e restauração em `assistencia_tecnica_restauracao_teste` | Linhas e estrutura idênticas |
| Migrações aplicadas na cópia | As 3, sem erro; conferências: 0 linhas na verificação de P2; 0 reembolsos antigos sem usuário |
| Linhas das 14 tabelas existentes | Preservadas |
| `solicitacao.status` | Removida |
| Tabelas novas | `avaliacao_reembolso` e `reembolso` criadas |
| `historico_os.tipo_evento` | Aceita `ACESSORIO` |
| Estrutura criada por `banco/sql` (16 scripts) × cópia migrada | **Equivalentes** (16 tabelas: colunas, tipos, NULL, padrões, PK, chaves únicas, FKs e CHECKs) |
| Banco principal | Linhas inalteradas; `solicitacao.status` continua existindo; nenhuma tabela nova |

Além disso, `npm run test:integracao` aplica as mesmas migrações no banco `assistencia_tecnica_teste` e roda o fluxo completo (26 etapas na última execução, 09/11/2026) no estado de destino.

Verificação do banco principal com `criar_tabelas.ps1 -SomenteVerificar` (somente leitura, `banco/relatorios/relatorio_20261109_155328.txt`): 12 tabelas OK; `solicitacao` com a coluna `status` ainda presente; `historico_os` sem `ACESSORIO` nem `ABATIMENTO`; `avaliacao_reembolso`, `reembolso` e `abatimento` faltantes. São exatamente as quatro migrações pendentes.

## 3. Referências restantes a `solicitacao.status`

| Onde | Situação |
|---|---|
| Backend (`src/`) | **Nenhuma.** `INSERT INTO solicitacao` grava só `id_cliente, id_atendente, descricao_inicial`; as consultas listam colunas explícitas (sem `s.*`). Os `status` em `solicitacaoRepository` são da OS |
| Frontend | **Nenhuma.** O model `SolicitacaoCriada` não tem `status` |
| Testes | A integração confere que a resposta da abertura não tem `status` e roda o fluxo inteiro sem a coluna |
| `banco/sql/04_solicitacao.sql` e `banco/esquema_esperado.json` | **Atualizados** (estado de destino, sem a coluna) |
| Documentação | Menções históricas (especificações antigas e este registro de decisões) |
| `entregas/backend_auditoria_assistencia_tecnica/` | Cópia de auditoria antiga; não alterada |

Não há FK, índice, CHECK, view, trigger ou procedure que use a coluna (conferido no INFORMATION_SCHEMA).

## 4. Atenção: compatibilidade do código

O backend desta versão **depende das migrações 2, 3 e 4**: consultas de pagamentos usam as tabelas `reembolso` e `abatimento`, a avaliação usa `avaliacao_reembolso` e os registros de acessórios e abatimentos gravam os eventos `ACESSORIO` e `ABATIMENTO`. **Não iniciar esta versão do backend contra o banco principal antes de migrá-lo.** Ordem segura: backup → migrações → conferência → nova versão do backend e do frontend.

## 5. Procedimento de backup e recuperação (para quando houver autorização)

Pré-requisitos:
- MySQL 8.0 em `C:\Program Files\MySQL\MySQL Server 8.0\bin`; aplicação parada (sem gravações durante a janela); processos e sessões antigas encerrados (`SHOW PROCESSLIST` sem conexões da aplicação).
- **Um login-path com permissão suficiente** (a senha fica no `mysql_config_editor`, nunca em comandos ou arquivos). O login-path `assistencia` (usuário `assistencia_dev`) tem `SELECT, INSERT, UPDATE, CREATE, REFERENCES, INDEX, ALTER, TRIGGER` em `assistencia_tecnica` e **não tem `DROP`** nem acesso a bancos `_teste`: ele faz o backup e as migrações 1–3, mas **não** restaura um backup (o arquivo do mysqldump contém `DROP TABLE IF EXISTS`) nem executa a recuperação (seção 5.4). Para restaurar e recuperar, use um login-path administrativo (por exemplo `assistencia_admin`, criado pelo responsável pelo servidor). Abaixo, `$lp` é o login-path usado em cada passo.
- **Nunca restaure com `Get-Content arquivo | mysql` no Windows PowerShell 5.1:** o pipe converte o texto e **corrompe acentos** (comprovado na simulação da seção 6, e a contagem de linhas não revela o problema). Use `source`, como abaixo.
- **`source` não abre arquivos em caminhos com acento** (a pasta do projeto fica em "Área de Trabalho"): copie o backup e as migrações para uma pasta **sem acentos nem espaços** antes de usar `source` (comprovado: o laço falhou no primeiro arquivo, sem alterar nada, e funcionou depois da cópia). O `mysqldump --result-file` funciona normalmente em caminhos com acento.

### 5.1 Backup

```powershell
$bin = "C:\Program Files\MySQL\MySQL Server 8.0\bin"
$lp = "assistencia"
$arquivo = "banco\backups\assistencia_tecnica_$(Get-Date -Format yyyyMMdd_HHmmss).sql"
& "$bin\mysqldump.exe" --login-path=$lp --single-transaction --routines --triggers `
    --no-tablespaces --default-character-set=utf8mb4 --set-gtid-purged=OFF assistencia_tecnica `
    --result-file=$arquivo
```

Conferir: o arquivo existe, termina com `-- Dump completed` e o tamanho é compatível. Guardar uma cópia fora da máquina. O arquivo contém dados pessoais e hashes de senha: não versionar nem compartilhar.

### 5.2 Teste do backup antes de migrar (login-path administrativo)

```powershell
$lp = "assistencia_admin"   # precisa de CREATE e DROP no banco de teste
$pasta = Join-Path $env:TEMP "restauracao_assistencia"   # sem acentos nem espaços
New-Item -ItemType Directory -Force $pasta | Out-Null
Copy-Item $arquivo (Join-Path $pasta "backup.sql") -Force
$caminho = (Join-Path $pasta "backup.sql") -replace '\\','/'
& "$bin\mysql.exe" --login-path=$lp -e "CREATE DATABASE assistencia_tecnica_restauracao_teste CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
& "$bin\mysql.exe" --login-path=$lp --default-character-set=utf8mb4 assistencia_tecnica_restauracao_teste -e "source $caminho"
```

Comparar **o conteúdo**, não só a contagem de linhas: `CHECKSUM TABLE <tabela>` em cada tabela dos dois bancos (ou o script `backend/integracao/simularRecuperacaoMigracao.js`, que compara contagem e soma de verificação por tabela). Depois, apagar o banco `_teste` e a cópia temporária (`Remove-Item $pasta -Recurse -Force`): ela contém dados pessoais.

### 5.3 Execução das migrações (somente com autorização)

1. Backup **novo**, feito imediatamente antes da janela (5.1), e teste do backup (5.2). O backup `banco/backups/assistencia_tecnica_20261107_193227.sql` está **desatualizado**: o banco principal tinha 4 usuários quando ele foi feito e tem 5 hoje (conferido em 09/11/2026). Não use esse arquivo para recuperação.
2. Guardar os valores antigos de `solicitacao.status` (opcional, sem significado de negócio): `CREATE TABLE solicitacao_status_backup AS SELECT id_solicitacao, status FROM solicitacao;`
3. Executar os quatro arquivos na ordem de `pendentes.json`, **um por vez**, e só passar ao próximo se o anterior terminar sem erro. **Nunca use `mysql --force`**, que continuaria depois da guarda:
   ```powershell
   # Executar na pasta do projeto. As migrações são copiadas para uma pasta sem acentos (exigência do "source").
   $pasta = Join-Path $env:TEMP "migracoes_assistencia"
   New-Item -ItemType Directory -Force $pasta | Out-Null
   $lista = (Get-Content banco\migracoes\pendentes.json -Raw | ConvertFrom-Json).migracoes
   foreach ($m in $lista) { Copy-Item "banco\migracoes\$m" $pasta -Force }
   foreach ($m in $lista) {
       $c = (Join-Path $pasta $m) -replace '\\','/'
       & "$bin\mysql.exe" --login-path=$lp --default-character-set=utf8mb4 assistencia_tecnica -e "source $c"
       if ($LASTEXITCODE -ne 0) { throw "Falha em $m: NÃO repetir; seguir a seção 5.4" }
       "OK $m"
   }
   Remove-Item $pasta -Recurse -Force
   ```
   Este laço foi executado num banco `_teste` com a estrutura do principal (usuário do `.env` no lugar do login-path): 3 × OK, 16 tabelas, `solicitacao.status` removida, `ACESSORIO` no ENUM (antes da migração 4). Com as 4 migrações, a mesma sequência é executada pelos testes `migracoes.integracao.js` e `simularRecuperacaoMigracao.js` (seção 6). O `$env:TEMP` não pode ter acentos (no computador atual: `C:\Users\Acer\AppData\Local\Temp`).
4. Conferir: `criar_tabelas.ps1 -SomenteVerificar` deve mostrar **17 tabelas OK** e `historico_os.tipo_evento` terminando em `'ACESSORIO','ABATIMENTO'`; contagem e soma de verificação iguais às anteriores nas tabelas existentes. Se o passo 2 foi feito, `solicitacao_status_backup` aparece como tabela extra, o que é esperado.
5. Retirar os quatro arquivos de `pendentes.json` e marcar no cabeçalho de cada um "EXECUTADA NO BANCO PRINCIPAL em <data>". As guardas continuam nos arquivos e impedem reexecução acidental.
6. Publicar a nova versão do backend e do frontend.

### 5.4 Recuperação (login-path administrativo)

DDL no MySQL não é transacional: uma migração interrompida no meio deixa o que já foi criado. **Nenhuma migração pode ser repetida nem executada fora de ordem.** A guarda (5.5) bloqueia a tentativa sem alterar nada, inclusive no estado parcial: para repetir a 2 ou a 4, primeiro é preciso desfazer a parte criada (tabela abaixo).

| Situação | Ação (validada na seção 6) |
|---|---|
| Falha em qualquer ponto, ou conferência divergente (**recomendado**) | Parar a aplicação; `DROP DATABASE assistencia_tecnica; CREATE DATABASE assistencia_tecnica CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;` e restaurar o backup com `source` (5.2, destino `assistencia_tecnica`). Conferir as somas de verificação. Voltar à versão anterior do backend ou repetir as 3 migrações |
| Falha parcial da migração 2 (só `avaliacao_reembolso` criada) | `DROP TABLE IF EXISTS reembolso; DROP TABLE IF EXISTS avaliacao_reembolso;` e repetir as migrações da 2 em diante |
| Falha na migração 4 depois de criar `abatimento` e antes do ENUM | `DROP TABLE IF EXISTS abatimento;` e repetir somente a migração 4 |
| Desfazer só a migração 4 (sem abatimentos nem eventos `ABATIMENTO` gravados) | `DROP TABLE abatimento;` e `ALTER TABLE historico_os MODIFY tipo_evento ENUM('CRIACAO','ATRIBUICAO_TECNICO','DIAGNOSTICO','GARANTIA','ORCAMENTO','REPARO','ENCERRAMENTO','PAGAMENTO','EXPEDICAO','ACESSORIO') NOT NULL;` |
| Migração 3 executada de novo depois da 4 | **Risco eliminado pela guarda**: a tentativa para antes do `ALTER` e o ENUM continua com `ABATIMENTO` (testado pelo executor Node e pelo cliente `mysql` com `source`). Sem a guarda, a 3 redefiniria a lista inteira e removeria `ABATIMENTO`. Por isso não remova a guarda nem use `--force` |
| Desfazer só a migração 3 (sem eventos `ACESSORIO` gravados) | `ALTER TABLE historico_os MODIFY tipo_evento ENUM('CRIACAO','ATRIBUICAO_TECNICO','DIAGNOSTICO','GARANTIA','ORCAMENTO','REPARO','ENCERRAMENTO','PAGAMENTO','EXPEDICAO') NOT NULL;` |
| Desfazer só a migração 2 (sem avaliações nem reembolsos gravados depois) | `DROP TABLE reembolso; DROP TABLE avaliacao_reembolso;` (as colunas antigas de `pagamento` continuam preenchidas) |
| Desfazer só a migração 1 | `ALTER TABLE solicitacao ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT 'RECEBIDA' AFTER descricao_inicial;` e, se o passo 2 de 5.3 foi feito, restaurar os valores a partir de `solicitacao_status_backup` |

Depois de gravações novas (avaliações, reembolsos parciais, abatimentos, eventos `ACESSORIO` ou `ABATIMENTO`), desfazer as migrações 2, 3 ou 4 perde dados. Nesse caso a recuperação é pelo backup, com a perda do que foi gravado depois dele.

### 5.5 Guardas de pré-condição

| Migração | Executa somente se |
|---|---|
| 1 | `solicitacao.status` existe |
| 2 | `solicitacao.status` não existe, `solicitacao` existe e `avaliacao_reembolso` e `reembolso` não existem |
| 3 | `avaliacao_reembolso` e `reembolso` existem e `historico_os.tipo_evento` é **exatamente** o ENUM de 9 valores da v1.4 |
| 4 | `avaliacao_reembolso` e `reembolso` existem, o ENUM contém `ACESSORIO` e não contém `ABATIMENTO`, e `abatimento` não existe |

A guarda é um bloco `SET … / PREPARE / EXECUTE` no início do arquivo. Quando a condição falha, ela chama uma procedure inexistente; o erro (`ER_SP_DOES_NOT_EXIST`) interrompe o cliente `mysql` (código de saída 1) e o executor Node antes do primeiro comando da migração. Ela não cria procedure, trigger nem tabela, e usa só aspas simples (compatível com `ANSI_QUOTES`).

Testes (`backend/integracao/migracoes.integracao.js`, 9/9, banco `<DB_NAME>_migracoes_teste` com a estrutura do principal, apagado ao final):
- 2, 3 e 4 bloqueadas antes da 1;
- 3 e 4 bloqueadas depois da 1;
- 4 bloqueada depois da 2;
- sequência completa aceita;
- cada repetição bloqueada, com a estrutura comparada por `SHOW CREATE TABLE` antes e depois;
- `aplicarPendentes` repetido rejeitado;
- falha parcial da 4 bloqueada e recuperada;
- cliente `mysql` com `source` parando na guarda;
- banco principal preservado.

### 5.6 Situação operacional conferida em 09/11/2026 (somente leitura; nada foi encerrado)

| Item | Situação | O que fazer antes da janela (com autorização do responsável) |
|---|---|---|
| Login-paths (`mysql_config_editor print --all`) | Só existe `assistencia` (`assistencia_dev`): `SELECT, INSERT, UPDATE, CREATE, REFERENCES, INDEX, ALTER, TRIGGER` em `assistencia_tecnica`, **sem `DROP`**, sem `PROCESS` e sem acesso a `_teste` | Criar um login-path administrativo para restauração e recuperação, por exemplo `mysql_config_editor set --login-path=assistencia_admin --host=localhost --user=<usuário administrativo> --password`. A senha é digitada no prompt, nunca em comando ou arquivo. As migrações 1–4 também rodam com `assistencia` (precisam só de `ALTER` e `CREATE`) |
| Usuário do backend (`backend/.env`) | **Resolvido em 09/11/2026 (S1):** a API conecta como `assistencia_app`@`localhost`, com `SELECT, INSERT, UPDATE` somente em `assistencia_tecnica` e `assistencia_tecnica_teste` (sem `DELETE`, DDL, `PROCESS` ou acesso a outros bancos; testado). A credencial administrativa ficou em `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD`, usada apenas pelas ferramentas de teste em `backend/integracao` | Em produção, o `.env` não deve conter `DB_ADMIN_*` |
| Processos node | PIDs 18836, 19960 e 20712 (`npm test` / `node --test`), iniciados em 09/11/2026 01:15 e ainda abertos | Confirmar com o responsável que são execuções de teste esquecidas e encerrá-las antes da janela |
| Cliente mysql | PID 3904 (`mysql -u root -p`, sessão interativa aberta desde 08/11/2026 18:52) | Fechar a sessão interativa |
| Sessões MySQL | IDs 15 e 279 (`root`, banco `assistencia_tecnica`, `Sleep` há 20 h e 15 h); nenhuma transação aberta (`INNODB_TRX` vazio); nenhum bloqueio de metadados em `assistencia%` | Encerrar ou confirmar que não pertencem à aplicação; repetir a conferência imediatamente antes de migrar (`ALTER` espera por bloqueio de metadados) |
| Servidores | Nenhum backend ou frontend escutando (portas 3000, 3001, 3100 e 4200 livres) | Manter a aplicação parada durante a janela |
| Backup | O último (`20261107_193227`) está desatualizado (4 usuários × 5 hoje) | **Backup novo obrigatório**, testado (5.1–5.2) |

## 6. Simulação de backup, falha parcial e recuperação (09/11/2026)

Comando: `cd backend && node integracao/simularRecuperacaoMigracao.js` (somente bancos `*_teste`; o banco principal só é lido). Relatório: `banco/relatorios/recuperacao_migracao_teste_2026-11-09T16-51-10-215Z.txt`.

O banco simulado recebeu a estrutura e os dados do principal (sem senhas) e três linhas de controle: uma solicitação com texto acentuado, um reembolso integral antigo e um evento de histórico. A integridade foi medida por **contagem e soma de verificação (CRC32) de todas as colunas de cada tabela**. Os comandos usaram o usuário do `.env` (com a senha em `MYSQL_PWD`), porque o login-path `assistencia` não tem acesso a bancos `_teste`; fora isso, são os comandos da seção 5.

| Passo | Resultado |
|---|---|
| Backup com mysqldump (5.1) | ✅ Arquivo completo (`-- Dump completed`), texto acentuado íntegro no arquivo |
| Restauração pelo comando antes documentado (`Get-Content … \| mysql`, PowerShell 5.1) | ❌ **Dados corrompidos** em 6 tabelas (acentos); a contagem de linhas era igual. **Comando substituído** nesta versão do documento |
| Restauração com `mysql … -e "source …"` | ✅ Dados idênticos (todas as tabelas), acentos preservados |
| Migração 1 + migração 2 interrompida após `CREATE TABLE avaliacao_reembolso` | ✅ Estado parcial confirmado (`avaliacao_reembolso` existe, `reembolso` não) |
| Repetir a migração 2 nesse estado | ✅ Falha com `ER_TABLE_EXISTS_ERROR`, sem alterar nada. **Desde a auditoria final** (relatório `recuperacao_migracao_teste_2026-11-09T19-15-00-001Z.txt`, 4 migrações): bloqueada pela guarda (`ER_SP_DOES_NOT_EXIST`), antes de qualquer `CREATE`; estado parcial inalterado. A execução das 19:14 (`…19-14-27-571Z.txt`) falhou só porque a simulação ainda esperava o erro antigo; a expectativa foi corrigida |
| **Recuperação A**: `DROP DATABASE` + `CREATE DATABASE` + restauração com `source` | ✅ Dados idênticos ao estado anterior (inclusive `solicitacao.status`) |
| Migrações 1–3 depois da recuperação A | ✅ Executadas; dados das 14 tabelas preservados (solicitação comparada sem a coluna removida); reembolso antigo copiado para `reembolso` |
| **Recuperação B**: `DROP TABLE IF EXISTS reembolso; DROP TABLE IF EXISTS avaliacao_reembolso;` e repetir as migrações 2 e 3 | ✅ Dados preservados; estrutura final completa |
| Banco principal | ✅ Contagem de linhas inalterada; bancos de teste e arquivo de backup temporário apagados |
| Laço de migração da seção 5.3 a partir da pasta do projeto (caminho com "Á") | ❌ `source` não abriu o primeiro arquivo; laço parou sem alterar nada. **Corrigido**: cópia para pasta sem acentos |
| Laço corrigido (cópia para `$env:TEMP\migracoes_assistencia`), banco `_teste` com a estrutura do principal | ✅ 3 × OK; 16 tabelas; `solicitacao.status` removida; `ACESSORIO` no ENUM |
| `mysqldump --result-file` em pasta com acento | ✅ Funciona |
| Permissões do login-path `assistencia` (`SHOW GRANTS`) | ⚠️ Sem `DROP` e sem acesso a bancos `_teste`: serve para backup e migrações, **não** para restaurar nem recuperar |

## 7. Execução no banco principal (09/11/2026, autorizada)

| Passo | Resultado |
|---|---|
| Conferência antes (somente leitura) | 14 tabelas; `solicitacao.status` presente; ENUM com 9 valores; 0 transações; 0 bloqueios de metadados; sessão 279 ociosa (não encerrada, sem bloqueio) |
| Backup (5.1, login-path `assistencia`) | `banco/backups/assistencia_tecnica_20261109_170123_antes_migracoes.sql` (19 KB, `-- Dump completed`) |
| Teste do backup (5.2) | Restaurado com `source` em `assistencia_tecnica_restauracao_teste`: 14 tabelas, **checksums idênticos** (contagem + `CHECKSUM TABLE`); banco de teste e cópia apagados |
| Estrutura anterior (sem dados) para os testes | `banco/migracoes/estrutura_antes_migracoes_20261109.sql` (`mysqldump --no-data`; 14 tabelas; 0 `INSERT`) |
| Passo 2 de 5.3 | `solicitacao_status_backup` criada (1 linha: `RECEBIDA`) e mantida no banco |
| Migrações (laço 5.3, login-path `assistencia`, cópia em `$env:TEMP`, sem `--force`) | 01, 02 (`reembolsos_antigos_sem_usuario` = 0), 03 e 04: **OK**, entre 17:02:30 e 17:02:31 |
| Conferência depois | 18 tabelas (17 do MER + `solicitacao_status_backup`); `solicitacao.status` removida; ENUM terminando em `'ACESSORIO','ABATIMENTO'`; checksums iguais aos de antes em 13 tabelas; `solicitacao` igual ao backup sem a coluna `status` (checksum e estrutura) |
| `criar_tabelas.ps1 -SomenteVerificar` | **17 OK, 0 divergentes, 0 faltantes**, 1 não prevista (`solicitacao_status_backup`); relatório `banco/relatorios/relatorio_20261109_170303.txt` |
| Testes depois | Integração real 39/39 (inclui: estrutura anterior + 4 migrações = estrutura do principal); mocks 188/188 |

**Recuperação, se necessária:** restaurar `assistencia_tecnica_20261109_170123_antes_migracoes.sql` com `source` (5.2 e 5.4, login-path administrativo). Gravações feitas depois da migração seriam perdidas.

**Ainda não feito:** a publicação do backend e do frontend (T4) depende de autorização própria. Apagar `solicitacao_status_backup` quando não for mais necessária também depende de decisão.
