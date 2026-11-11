# Sistema de Assistência Técnica

Aplicação web interna para os funcionários de uma assistência técnica de equipamentos. Ela cobre o atendimento do começo ao fim: recebimento dos equipamentos, abertura de Ordens de Serviço (OS), diagnóstico, garantia, orçamento, execução, pagamento, reembolso, expedição e histórico de cada OS.

## Funcionalidades

- **Clientes:** cadastro de pessoa física e jurídica, com CPF/CNPJ validado e único.
- **Solicitações:** um atendimento registra um ou mais equipamentos e os acessórios recebidos. Cada equipamento gera a sua própria OS automaticamente.
- **Ordens de Serviço:** fluxo por etapas (recebida → em análise → aguardando aprovação → em reparo → concluída → finalizada), com técnico responsável, diagnóstico e encerramento sem reparo (por exemplo, impossibilidade técnica ou desistência).
- **Garantia:** definida somente pelo técnico atribuído à OS. Com garantia, o serviço passa por orçamento com os serviços a R$ 0.
- **Orçamentos:** montados pelo técnico com os itens do serviço; a aprovação ou recusa do cliente é registrada pelo atendimento.
- **Pagamentos e reembolsos:** confirmação de pagamentos, avaliação financeira obrigatória nos encerramentos por impossibilidade técnica, reembolso parcial e abatimento formal.
- **Expedição:** devolução do equipamento por retirada ou envio.
- **Histórico da OS:** cada evento fica registrado com o responsável e a data.
- **Usuários:** só o administrador gerencia as contas, e o sistema mantém sempre ao menos um administrador ativo.

### Perfis de acesso

| Perfil | O que faz |
|---|---|
| **ADMINISTRADOR** | Gerencia usuários e tem acesso a todos os módulos (a garantia continua sendo decisão do técnico atribuído) |
| **ATENDENTE** | Clientes, solicitações, atribuição de técnico, resposta do cliente ao orçamento, pagamentos, reembolsos e expedição |
| **TECNICO** | Só as OS atribuídas a ele: diagnóstico, garantia, orçamento, execução e acessórios. Não vê pagamentos |

O cliente é cadastrado, mas não tem login.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | Angular 21 (componentes standalone, signals, formulários reativos), testes com Vitest |
| Backend | Node.js 22 + Express 5, JWT, bcrypt, mysql2; testes com `node:test` |
| Banco | MySQL 8.0.16 ou superior (InnoDB, utf8mb4) |
| Arquitetura | API REST em camadas: Routes → Controller → Service → Repository → Model |

### Segurança

- Senhas gravadas somente como hash bcrypt.
- O perfil do usuário é lido do banco a cada requisição, não do token.
- Limite de tentativas de login por IP.
- Cabeçalhos de segurança nas respostas e mensagens de erro sem detalhes internos.
- A API usa um usuário de banco com privilégio mínimo (`SELECT`, `INSERT`, `UPDATE`).
- Credenciais ficam só no `.env`, que não é versionado.

## Estrutura do repositório

```
├── backend/          API REST (Express)
│   ├── src/          routes, controllers, services, repositories, models, middlewares, config
│   ├── test/         testes unitários e com mocks
│   ├── integracao/   testes de integração em banco "_teste"
│   └── scripts/      cadastro de usuários de teste e do primeiro administrador
├── frontend/         aplicação Angular
│   └── src/          app (serviços, autenticação), pages (telas), components
├── banco/            scripts SQL (17 tabelas), migrações e verificação do esquema
└── documentacao/     API, regras de negócio, especificações dos módulos e MER
```

## Como executar

### Pré-requisitos

- Node.js 22 e npm
- MySQL 8.0.16 ou superior, com o banco `assistencia_tecnica` criado

### 1. Banco de dados

Os scripts de criação estão em [banco/sql](banco/sql), um arquivo por tabela, na ordem das dependências. No Windows, o script abaixo cria as tabelas que faltam (sem alterar nem apagar as existentes):

```powershell
cd banco
powershell -ExecutionPolicy Bypass -File .\criar_tabelas.ps1
```

Mais detalhes em [banco/LEIA-ME.txt](banco/LEIA-ME.txt).

### 2. Backend

```bash
cd backend
cp .env.example .env    # preencha DB_USER, DB_PASSWORD e JWT_SECRET
npm install
npm start               # API em http://localhost:3000/api
```

O [.env.example](backend/.env.example) descreve todas as variáveis.

Para ter usuários de teste (um por perfil), copie `backend/scripts/usuarios-teste.example.json`, ajuste e rode `npm run seed:usuarios`.

### 3. Frontend

```bash
cd frontend
npm install
npm start               # http://localhost:4200
```

Em desenvolvimento, o frontend chama a API em `http://localhost:3000/api`.

## Testes

| Comando | O que roda |
|---|---|
| `cd backend && npm test` | Testes unitários e de rotas com dados simulados (sem banco) |
| `cd backend && npm run test:integracao` | Fluxo completo pela API num banco `assistencia_tecnica_teste`, criado e apagado pelo próprio teste |
| `cd frontend && npx ng test --watch=false` | Testes das telas e dos serviços |
| `cd frontend && npx ng build` | Build de produção |

Os testes de integração precisam de um usuário de banco que possa criar bancos (`DB_ADMIN_USER` e `DB_ADMIN_PASSWORD` no `.env`).

## Documentação

| Documento | Conteúdo |
|---|---|
| [documentacao/README.md](documentacao/README.md) | Visão técnica detalhada e instruções completas |
| [documentacao/API.md](documentacao/API.md) | Todos os endpoints, perfis permitidos e corpos de requisição |
| [documentacao/REGRAS_DECISOES_PENDENCIAS.md](documentacao/REGRAS_DECISOES_PENDENCIAS.md) | Regras de negócio, decisões técnicas e pendências |
| [documentacao/especificacoes](documentacao/especificacoes) | Especificação de cada módulo (Clientes, Solicitações, Ordens de Serviço) |
| [documentacao/mer](documentacao/mer) | Modelo Entidade-Relacionamento (v1.5) em imagem, drawio e texto |
| [documentacao/ROTEIRO_TESTES_MANUAIS.md](documentacao/ROTEIRO_TESTES_MANUAIS.md) | Roteiro de testes pela interface e resultados |
| [documentacao/MIGRACOES_BACKUP_RECUPERACAO.md](documentacao/MIGRACOES_BACKUP_RECUPERACAO.md) | Migrações, backup e recuperação do banco |
