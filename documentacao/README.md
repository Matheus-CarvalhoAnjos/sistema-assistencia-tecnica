# Sistema de Assistência Técnica

Aplicação web interna para funcionários de uma assistência técnica: recebimento de equipamentos, Ordens de Serviço (OS), diagnóstico, garantia, orçamentos, pagamentos, devolução e histórico.

**Situação em 09/11/2026:** versão funcional e demonstrável. **Banco principal migrado em 09/11/2026 17:02** (com autorização): foram executadas as quatro migrações de que esta versão do backend depende (remoção de `solicitacao.status`, avaliação financeira e reembolso parcial, evento `ACESSORIO`, abatimento formal). A publicação do backend e do frontend ainda depende de autorização. Ver [MIGRACOES_BACKUP_RECUPERACAO.md](MIGRACOES_BACKUP_RECUPERACAO.md). O que está pronto e o que falta estão em [REGRAS_DECISOES_PENDENCIAS.md](REGRAS_DECISOES_PENDENCIAS.md) (a seção 3.3 é a lista única de pendências). Referência do modelo de dados: **MER v1.5 consolidado (09/11/2026)**, em [mer/MER_Assistencia_Tecnica_v1.5.md](mer/MER_Assistencia_Tecnica_v1.5.md); a v1.4 está preservada em `mer/historico/`.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | Angular (componentes standalone, signals, formulários reativos), testes com Vitest (`ng test`) |
| Backend | Node.js + Express 5, JWT, bcrypt, mysql2; testes com `node:test` |
| Banco | MySQL 8.0 (`assistencia_tecnica`), InnoDB, utf8mb4 |
| Arquitetura | API REST em camadas: Routes → Controller → Service → Repository → Model |

Perfis: **ADMINISTRADOR**, **ATENDENTE** e **TECNICO**. O cliente é cadastrado, mas não tem login. Somente o administrador gerencia usuários (tela **Usuários**); o sistema mantém sempre ao menos um administrador ativo. O técnico não vê pagamentos.

## Estrutura

```
PROJETO ASSISTENCIA TECNICA/
├── backend/
│   ├── src/
│   │   ├── routes/          rotas e perfis permitidos
│   │   ├── controllers/     entrada e saída HTTP
│   │   ├── services/        regras de negócio e permissões
│   │   ├── repositories/    SQL e transações (inclui historicoRepository e encerramentoRepository)
│   │   ├── models/          formato dos registros
│   │   ├── middlewares/     autenticação, perfil, acesso à OS, limite de login
│   │   └── config/          conexão MySQL (variáveis do .env)
│   ├── test/                testes com mocks (npm test)
│   ├── integracao/          testes de integração reais em banco "_teste" e servidor de teste
│   └── scripts/             seed de usuários de desenvolvimento
├── frontend/src/
│   ├── app/                 serviços HTTP, models, autenticação (guards e interceptor)
│   ├── pages/               telas (login, início, clientes, solicitações, acessórios, usuários, detalhes da OS)
│   │   └── ordens-servico/secoes/   seções de ação da OS (execução, garantia, orçamentos,
│   │                                pagamentos, expedição, histórico, encerramento)
│   └── components/          cabeçalho, navegação e selo de status
├── banco/
│   ├── sql/01..16_*.sql     um CREATE TABLE por tabela, na ordem das dependências (estado de destino)
│   ├── migracoes/           alterações incrementais; pendentes.json lista as não executadas no banco principal
│   ├── esquema_esperado.json  estrutura esperada, usada por criar_tabelas.ps1
│   └── criar_tabelas.ps1    verifica o banco e cria tabelas que faltam
└── documentacao/            este README, API, regras e especificações dos módulos
```

## Como executar

### Pré-requisitos
Node.js e npm, MySQL 8.0.16 ou superior (CHECK constraints) e o banco `assistencia_tecnica` criado.

### Banco de dados
```bash
cd banco
powershell -ExecutionPolicy Bypass -File .\criar_tabelas.ps1 -SomenteVerificar
```
O script só verifica. Desde 09/11/2026 o banco principal está migrado: a verificação mostra 17 tabelas OK (e a tabela auxiliar `solicitacao_status_backup` como não prevista). Sem `-SomenteVerificar`, ele cria apenas as tabelas que faltam, a partir de `banco/sql`. Ele nunca altera ou apaga tabelas existentes.

### Backend
Copie `backend/.env.example` para `backend/.env` e preencha os valores (não versionar). O modelo descreve todas as variáveis, inclusive as opcionais de teste. As principais são:

```
DB_HOST=localhost
DB_USER=
DB_PASSWORD=
DB_NAME=assistencia_tecnica
PORT=3000
JWT_SECRET=
JWT_EXPIRES_IN=1h
CORS_ORIGIN=http://localhost:4200
```

```bash
cd backend
npm install
npm start
```

### Frontend
```bash
cd frontend
npm install
npm start
```
Acesse `http://localhost:4200`. Em desenvolvimento (`npm start` / `ng serve` e testes), a API é esperada em `http://localhost:3000/api` (`frontend/src/environments/environment.ts`). A build de produção (`ng build`) usa `frontend/src/environments/environment.production.ts`, com o caminho relativo `/api`: frontend e API servidos no mesmo domínio, com HTTPS (por exemplo, proxy reverso encaminhando `/api` ao Express). Se a API ficar em outro domínio, ajuste esse arquivo e inclua a origem do frontend em `CORS_ORIGIN`.

## Testes

| Comando | O que roda | Banco |
|---|---|---|
| `cd backend && npm test` | Testes unitários e com mocks (services, repositories com conexões simuladas, rotas HTTP com dados simulados) | Nenhum |
| `cd backend && npm run test:integracao` | **Integração real**: fluxo completo pela API, com gravações | Cria `assistencia_tecnica_teste`, copia a estrutura do banco real (somente leitura), **aplica as migrações pendentes** e apaga o banco de teste ao final. O banco real só é lido, e a contagem de linhas dele é conferida antes e depois |
| `cd backend && node integracao/demonstrarMigracoes.js` | Demonstração das migrações: cópia com dados (sem senhas), backup e restauração, migrações, conferências e comparação com `banco/sql` | Somente bancos `*_teste`, apagados ao final; relatório em `banco/relatorios` |
| `cd frontend && npx ng test --watch=false` | Testes das telas e serviços (HTTP simulado) | Nenhum |
| `cd frontend && npx ng build` | Build de produção | — |

`MANTER_BANCO_TESTE=1 npm run test:integracao` mantém o banco de teste para inspeção.

**Credenciais (S1):** a API usa `DB_USER` (usuário `assistencia_app`, só `SELECT, INSERT, UPDATE`). Os testes de integração e as ferramentas de migração precisam criar e apagar bancos `_teste`; para isso usam `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD` (sem elas, usam `DB_USER`, o que falha com o usuário da aplicação). Essas variáveis existem só no `.env` de desenvolvimento.

### Demonstração sem tocar no banco principal
1. Prepare um banco `assistencia_tecnica_teste`, por exemplo com `MANTER_BANCO_TESTE=1 npm run test:integracao`.
2. Inicie a API com `node backend/integracao/servidor-teste.js` (ou a configuração `backend-teste` em `.claude/launch.json`). Ela só aceita bancos cujo nome termina em `_teste`.
3. Inicie o frontend normalmente.

Os usuários do banco de teste são criados pelos próprios testes, com senha aleatória. Para demonstrar, cadastre usuários de teste com `npm run seed:usuarios`, apontando o `.env` para o banco de teste.

## Documentação

- [API.md](API.md): endpoints, perfis e corpos de requisição.
- [REGRAS_DECISOES_PENDENCIAS.md](REGRAS_DECISOES_PENDENCIAS.md): regras aprovadas e onde estão implementadas, decisões técnicas (inclusive a Opção C), a regra R1 (abatimento formal, implementada em ambiente de teste), pendências e situação de cada funcionalidade.
- [PROPOSTA_REEMBOLSO_PARCIAL.md](PROPOSTA_REEMBOLSO_PARCIAL.md): decisões aprovadas e modelo da avaliação financeira e do reembolso parcial (implementado no banco de teste).
- [ROTEIRO_TESTES_MANUAIS.md](ROTEIRO_TESTES_MANUAIS.md): roteiro de validação pela interface e resultados de 09/11/2026.
- [MIGRACOES_BACKUP_RECUPERACAO.md](MIGRACOES_BACKUP_RECUPERACAO.md): migrações pendentes, demonstração em banco de teste, referências a `solicitacao.status`, backup e recuperação.
- `especificacoes/`: especificações por módulo (Clientes, Solicitações, Ordens de Serviço), integração entre módulos e pendências históricas.
