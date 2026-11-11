# Especificação Técnica — Módulo 1: Clientes

> **Atualização 09/11/2026:** este documento é histórico. A situação atual (regras do MER v1.4, decisões resolvidas, pendências e o que está implementado) está em [../REGRAS_DECISOES_PENDENCIAS.md](../REGRAS_DECISOES_PENDENCIAS.md), e a API em [../API.md](../API.md).

**Projeto:** Sistema de Assistência Técnica · **Versão:** 1.0 · **Data:** 07/11/2026
**Situação do documento:** proposta para aprovação. Nada aqui foi implementado.

> **Atualização 07/11/2026 — módulo implementado.** Backend: validações completas (F1–F5 corrigidas), `GET /api/clientes?busca=`, `PUT /api/clientes/:id`, erros do MySQL traduzidos em 400/409, tabela em minúsculas (F6), limite de 200 resultados. Frontend: rotas `/clientes`, `/clientes/novo`, `/clientes/:id`, `/clientes/:id/editar` com `perfilGuard`; menu "Clientes" ativo. Testes: `backend/test/clientes.test.js` e `*.spec.ts` em `frontend/src/pages/clientes` e `frontend/src/app/{services,utils}`.
> **Decisões aplicadas (seguindo as recomendações):** D-CLI-1 = permitir editar tipo e documento; D-CLI-3 = sem paginação, limite de 200; D-CLI-4 = sem exclusão. **Não aplicado:** D-CLI-2 (dígito verificador) e D-INT-1 (migração para classes base), que continuam pendentes. **Regras adicionadas na implementação:** telefone com 10 ou 11 dígitos, formato básico de e-mail e UF dentro da lista das 27 — podem ser ajustadas se não forem aprovadas.

Legenda de situação: **IMPLEMENTADO** · **PARCIALMENTE IMPLEMENTADO** · **NÃO IMPLEMENTADO** · **PRECISA DE REVISÃO** · **DECISÃO PENDENTE**.
Itens marcados como **(proposta)** não existem no projeto e dependem de aprovação.

---

## 1. Fontes analisadas

| Fonte | O que foi verificado |
|---|---|
| `backend/src/routes/clienteRoutes.js` | Rotas e perfis |
| `backend/src/controllers/clienteController.js` | Tratamento de requisições |
| `backend/src/services/clienteService.js` | Validações |
| `backend/src/repositories/clienteRepository.js` | SQL |
| Banco `assistencia_tecnica`, tabela `cliente` (inspeção somente leitura) | Colunas, UNIQUE e CHECK reais |
| `banco/sql/02_cliente.sql` | Script versionado |
| `MERASSISTENCIA1.1_atualizado` (Pacote de Continuidade) | Atributos previstos |
| `Especificacoes_Atualizadas_Sistema_Assistencia_Tecnica` | RN01 e perfis |
| `frontend/src/components/layout/top-navigation/top-navigation.ts` | Item de menu "Clientes" |
| Chamadas reais `GET /api/clientes/1` (somente leitura) | Formato da resposta |

Não existem models (`models/cliente.js`) nem testes automatizados para este módulo.

---

## 2. Situação atual

| Funcionalidade | Situação | Evidência |
|---|---|---|
| Listar clientes | **IMPLEMENTADO** | `GET /api/clientes` → array ordenado por `nome_razao_social` |
| Consultar cliente por ID | **IMPLEMENTADO** | `GET /api/clientes/:id` → objeto; 400 para ID inválido; 404 se não existir |
| Cadastrar cliente | **PARCIALMENTE IMPLEMENTADO** | `POST /api/clientes` funciona apenas com todos os campos presentes; ver falhas F1–F4 |
| Pesquisar por nome ou CPF/CNPJ | **NÃO IMPLEMENTADO** | Não há parâmetro de busca nem SQL com `LIKE` |
| Editar cliente | **NÃO IMPLEMENTADO** | Não há rota `PUT`/`PATCH` |
| Excluir cliente | **NÃO IMPLEMENTADO** (e não solicitado) | `solicitacao.id_cliente` referencia `cliente` com `NO ACTION` |
| Tela Angular | **NÃO IMPLEMENTADO** | Item "Clientes" existe no menu com `rota: null` (botão desabilitado) |
| Autorização no backend | **IMPLEMENTADO** | As 3 rotas usam `autenticar` + `autorizarPerfil("ADMINISTRADOR", "ATENDENTE")` |
| Autorização no menu | **IMPLEMENTADO** | Item visível só para ADMINISTRADOR e ATENDENTE |
| Testes automatizados | **NÃO IMPLEMENTADO** | `backend/test/` não cobre clientes |

### 2.1 Falhas encontradas no cadastro atual (confirmadas no código)

| Nº | Falha | Causa | Efeito observado/esperado |
|---|---|---|---|
| F1 | Cadastro sem `complemento` falha | O repository passa `complemento` `undefined` ao `pool.execute`; o `mysql2` recusa `undefined` (confirmado: *"Bind parameters must not contain undefined"*) | **HTTP 500** "Ocorreu um erro interno" para um campo que é opcional |
| F2 | Campos obrigatórios do banco não são validados | O service só valida `tipo_pessoa`, `nome_razao_social` e `cpf_cnpj`. `telefone`, `email`, `cep`, `logradouro`, `numero`, `bairro`, `cidade`, `uf` são `NOT NULL` no banco | Ausência de qualquer um → **500** (mesma causa de F1) |
| F3 | Regras de formato só existem no banco | Tamanho do CPF/CNPJ, somente dígitos e CEP com 8 dígitos são `CHECK` no MySQL; o service não valida | Violação → erro MySQL `ER_CHECK_CONSTRAINT_VIOLATED` → **500** em vez de 400 |
| F4 | Duplicidade com corrida | A checagem de CPF/CNPJ é feita antes do `INSERT`; duas requisições simultâneas podem passar pela checagem | O `UNIQUE` do banco impede o duplicado, mas o erro `ER_DUP_ENTRY` vira **500** em vez de 409 |
| F5 | UF e e-mail sem validação | Não há `CHECK` nem validação de código | Aceita `uf = "XX"` e e-mail sem formato |
| F6 | Nome de tabela em maiúsculas | O SQL usa `FROM CLIENTE`; funciona porque o MySQL local tem `lower_case_table_names = 1` (Windows) | Em servidor Linux, as consultas falhariam (tabela real é `cliente`) — **PRECISA DE REVISÃO** se houver hospedagem |

---

## 3. Modelo de dados (estado real do banco)

Tabela `cliente` — 2 registros atuais.

| Coluna | Tipo | Obrigatória | Restrição real |
|---|---|---|---|
| `id_cliente` | INT AUTO_INCREMENT | sim | PK |
| `tipo_pessoa` | VARCHAR(10) | sim | CHECK `IN ('FISICA','JURIDICA')` |
| `nome_razao_social` | VARCHAR(200) | sim | — |
| `cpf_cnpj` | VARCHAR(14) | sim | UNIQUE; CHECK só dígitos; 11 se FISICA, 14 se JURIDICA |
| `telefone` | VARCHAR(20) | sim | — |
| `email` | VARCHAR(150) | sim | — |
| `cep` | VARCHAR(8) | sim | CHECK `^[0-9]{8}$` |
| `logradouro` | VARCHAR(150) | sim | — |
| `numero` | VARCHAR(10) | sim | — |
| `complemento` | VARCHAR(100) | não | — |
| `bairro` | VARCHAR(100) | sim | — |
| `cidade` | VARCHAR(100) | sim | — |
| `uf` | CHAR(2) | sim | — (sem CHECK) |

O banco real corresponde ao script `banco/sql/02_cliente.sql` e aos atributos do MER. **Nenhuma alteração de estrutura é necessária para este módulo.**

---

## 4. Requisitos funcionais

### RF-CLI-01 — Listar clientes
- **Objetivo:** exibir os clientes cadastrados para localizar quem abrirá uma solicitação.
- **Perfis:** ADMINISTRADOR, ATENDENTE.
- **Situação:** IMPLEMENTADO no backend; NÃO IMPLEMENTADO no frontend.
- **Dados exibidos:** nome/razão social, tipo de pessoa, CPF/CNPJ formatado, telefone, cidade/UF.
- **Critérios de aceitação:** lista ordenada por nome; estado vazio quando não houver clientes; técnico recebe 403 na API e não vê o menu.

### RF-CLI-02 — Pesquisar clientes
- **Objetivo:** encontrar rapidamente um cliente por nome ou documento.
- **Perfis:** ADMINISTRADOR, ATENDENTE.
- **Situação:** NÃO IMPLEMENTADO.
- **Fluxo:** o usuário digita no campo de busca; a lista é filtrada pelo servidor.
- **Regra de busca (proposta):**
  - Se o termo, sem pontuação, tiver só dígitos → busca `cpf_cnpj LIKE 'digitos%'` (prefixo).
  - Caso contrário → `nome_razao_social LIKE '%termo%'` (o collation `utf8mb4_0900_ai_ci` já ignora maiúsculas e acentos).
  - Termo com menos de 2 caracteres → retorna a lista completa (sem filtro).
- **Critérios de aceitação:** "maria" encontra "Maria Cliente"; "123.456" encontra o CPF `12345678901`; busca sem resultado mostra estado "Nenhum cliente encontrado".

### RF-CLI-03 — Cadastrar cliente
- **Objetivo:** registrar um cliente novo (pessoa física ou jurídica).
- **Perfis:** ADMINISTRADOR, ATENDENTE.
- **Situação:** PARCIALMENTE IMPLEMENTADO (falhas F1–F5).
- **Dados:** todos os campos da seção 3, exceto `id_cliente`; `complemento` opcional.
- **Critérios de aceitação:** cadastro válido → 201 e mensagem de sucesso; cada validação da seção 5 → 400 com mensagem específica; CPF/CNPJ já existente → 409; nenhum caso de dado inválido pode resultar em 500.

### RF-CLI-04 — Consultar dados de um cliente
- **Perfis:** ADMINISTRADOR, ATENDENTE.
- **Situação:** IMPLEMENTADO no backend; NÃO IMPLEMENTADO no frontend.
- **Critérios de aceitação:** exibe todos os campos formatados; ID inexistente → mensagem "Cliente não encontrado." e botão para voltar à lista.

### RF-CLI-05 — Editar cliente
- **Perfis:** ADMINISTRADOR, ATENDENTE.
- **Situação:** NÃO IMPLEMENTADO.
- **Fluxo:** a partir dos detalhes, o usuário abre o formulário preenchido, altera e salva.
- **Regras:** as mesmas validações do cadastro; CPF/CNPJ continua único, desconsiderando o próprio cliente.
- **DECISÃO PENDENTE D-CLI-1:** permitir alterar `tipo_pessoa` e `cpf_cnpj` depois do cadastro? (ver seção 9).
- **Critérios de aceitação:** alteração válida → 200 com os dados atualizados; documento de outro cliente → 409; cliente inexistente → 404.

### RF-CLI-06 — Tratar cadastro duplicado
- **Situação:** PARCIALMENTE IMPLEMENTADO (checagem prévia existe; corrida vira 500).
- **Comportamento esperado:** 409 com a mensagem existente *"Já existe um cliente cadastrado com esse CPF/CNPJ."*, tanto na checagem prévia quanto quando o `UNIQUE` do banco disparar.
- **Interface:** destacar o campo CPF/CNPJ e mostrar a mensagem junto dele.

### RF-CLI-07 — Mensagens de sucesso e erro
- Sucesso no cadastro: *"Cliente cadastrado com sucesso."* (mensagem atual da API).
- Sucesso na edição (proposta): *"Cliente atualizado com sucesso."*
- Erros: exibir o campo `mensagem` retornado pela API, usando a função existente `mensagemDeErro` (`frontend/src/app/auth/mensagem-erro.ts`).

---

## 5. Regras de negócio e validações

| Código | Regra | Fonte | Banco | Backend hoje | Proposta |
|---|---|---|---|---|---|
| RN01 | CPF/CNPJ único | Especificações RN01; MER (UNIQUE) | UNIQUE | Checagem prévia (409) | Manter + converter `ER_DUP_ENTRY` em 409 |
| RN-CLI-02 | `tipo_pessoa` é FISICA ou JURIDICA | MER; banco | CHECK | Validado (400) | Manter |
| RN-CLI-03 | CPF com 11 dígitos (FISICA) | Banco (CHECK) | CHECK | **Não validado** | Validar no service (400) |
| RN-CLI-04 | CNPJ com 14 dígitos (JURIDICA) | Banco (CHECK) | CHECK | **Não validado** | Validar no service (400) |
| RN-CLI-05 | CPF/CNPJ só com dígitos | Banco (CHECK) | CHECK | **Não validado** | Frontend envia sem máscara; backend remove `.`, `-`, `/` e valida dígitos (proposta) |
| RN-CLI-06 | CEP com 8 dígitos | Banco (CHECK) | CHECK | **Não validado** | Validar (400); aceitar com hífen e remover (proposta) |
| RN-CLI-07 | UF com 2 letras | Pedido do usuário | Só `CHAR(2)` | **Não validado** | Validar contra a lista das 27 UFs (proposta) |
| RN-CLI-08 | Campos obrigatórios | Banco (`NOT NULL`) | NOT NULL | **Não validado** (500) | Validar presença e texto não vazio (400) |
| RN-CLI-09 | Limites de tamanho | Banco (`VARCHAR`) | VARCHAR(n) | **Não validado** | Validar tamanho máximo de cada coluna (400) |
| RN-CLI-10 | E-mail com formato válido | — (não documentado) | — | Não validado | **Sugestão pendente de aprovação**; mesmo regex do `usuarioService` |
| RN-CLI-11 | Dígito verificador de CPF/CNPJ | — (não documentado) | — | Não validado | **Sugestão pendente de aprovação** (D-CLI-2) |
| RN-CLI-12 | Só ADMINISTRADOR e ATENDENTE acessam | Especificações (perfil ATENDENTE); decisão de permissões | — | IMPLEMENTADO | Manter |
| RN-CLI-13 | TÉCNICO não acessa | Decisão do usuário (auditoria) | — | IMPLEMENTADO (403) | Manter e testar |

---

## 6. Backend

### 6.1 Endpoints

| Método | Rota | Perfis | Situação |
|---|---|---|---|
| GET | `/api/clientes` | ADMINISTRADOR, ATENDENTE | IMPLEMENTADO (sem busca) |
| GET | `/api/clientes?busca=<termo>` | ADMINISTRADOR, ATENDENTE | NÃO IMPLEMENTADO **(proposta)** |
| GET | `/api/clientes/:id` | ADMINISTRADOR, ATENDENTE | IMPLEMENTADO |
| POST | `/api/clientes` | ADMINISTRADOR, ATENDENTE | PARCIALMENTE IMPLEMENTADO |
| PUT | `/api/clientes/:id` | ADMINISTRADOR, ATENDENTE | NÃO IMPLEMENTADO **(proposta)** |

**Por que `PUT` e não `PATCH`:** o formulário de edição sempre envia todos os campos, e as validações cruzadas (tipo × tamanho do documento) exigem o conjunto completo.

**Paginação:** não existe. Com 2 clientes atuais e uso acadêmico, a proposta é **não paginar nesta versão**; limitar a 200 resultados por segurança (proposta, D-CLI-3).

### 6.2 Contratos

**GET /api/clientes?busca=maria** — 200 (formato atual: array, mantido para compatibilidade)
```json
[
  {
    "id_cliente": 1,
    "tipo_pessoa": "FISICA",
    "nome_razao_social": "Maria Cliente",
    "cpf_cnpj": "12345678901",
    "telefone": "11999990000",
    "email": "maria@teste.com",
    "cep": "01001000",
    "logradouro": "Rua Teste",
    "numero": "100",
    "complemento": null,
    "bairro": "Centro",
    "cidade": "São Paulo",
    "uf": "SP"
  }
]
```

**GET /api/clientes/:id** — 200: mesmo objeto acima (formato atual). Erros: 400 `"O ID informado deve ser um número inteiro positivo."`; 404 `"Cliente não encontrado."`.

**POST /api/clientes** — requisição
```json
{
  "tipo_pessoa": "JURIDICA",
  "nome_razao_social": "Oficina Exemplo Ltda",
  "cpf_cnpj": "12345678000199",
  "telefone": "1133334444",
  "email": "contato@oficina.test",
  "cep": "01310100",
  "logradouro": "Avenida Paulista",
  "numero": "1000",
  "complemento": "Sala 12",
  "bairro": "Bela Vista",
  "cidade": "São Paulo",
  "uf": "SP"
}
```
Resposta 201 (formato atual):
```json
{ "mensagem": "Cliente cadastrado com sucesso.", "cliente": { "id_cliente": 3, "...": "demais campos" } }
```

**PUT /api/clientes/:id (proposta)** — mesmo corpo do POST. Resposta 200:
```json
{ "mensagem": "Cliente atualizado com sucesso.", "cliente": { "id_cliente": 3, "...": "demais campos" } }
```

**Erros (todos no formato `{ "mensagem": "..." }`):**

| HTTP | Quando | Mensagem (proposta, exceto as marcadas como atuais) |
|---|---|---|
| 400 | Corpo ausente ou não-objeto | "Os dados do cliente são inválidos." |
| 400 | Campo obrigatório ausente | "O campo <nome> é obrigatório." |
| 400 | `tipo_pessoa` inválido | "Tipo de pessoa inválido. Use FISICA ou JURIDICA." (**atual**) |
| 400 | CPF sem 11 dígitos / CNPJ sem 14 | "CPF deve conter 11 dígitos." / "CNPJ deve conter 14 dígitos." |
| 400 | CEP inválido | "CEP deve conter 8 dígitos." |
| 400 | UF inválida | "UF inválida." |
| 400 | Texto acima do limite | "O campo <nome> deve ter no máximo <n> caracteres." |
| 401 | Sem token / token inválido / usuário inativo | mensagens atuais do `authMiddleware` |
| 403 | Perfil TÉCNICO | "Você não possui permissão para realizar esta ação." (**atual**) |
| 404 | Cliente inexistente (GET/PUT) | "Cliente não encontrado." (**atual**) |
| 409 | CPF/CNPJ de outro cliente | "Já existe um cliente cadastrado com esse CPF/CNPJ." (**atual**) |

### 6.3 Alterações necessárias por camada (proposta)

| Camada | Arquivo existente | Alteração |
|---|---|---|
| Rotas | `routes/clienteRoutes.js` | Adicionar `PUT /:id` com os mesmos middlewares |
| Controller | `controllers/clienteController.js` | Ler `req.query.busca` em `listarTodos`; criar `atualizar` |
| Service | `services/clienteService.js` | Função única de validação/normalização usada por `criar` e `atualizar`; `listarTodos(busca)`; checagem de duplicidade excluindo o próprio ID; converter `ER_DUP_ENTRY` em 409 |
| Repository | `repositories/clienteRepository.js` | `listarTodos(filtro)` com `LIKE`; `atualizar(id, dados)`; `buscarPorDocumento` aceitar ID a ignorar; passar `complemento ?? null`; usar nome de tabela `cliente` (minúsculo) — **PRECISA DE REVISÃO** (F6) |
| Model | — (não existe) | Opcional. Os módulos mais novos usam models; Clientes não. Ver D-INT-1 em `Pendencias_e_Decisoes_Tecnicas.md` |

---

## 7. Frontend

### 7.1 Rotas (proposta)

| Rota | Componente (proposta) | Guards | Observação |
|---|---|---|---|
| `/clientes` | `ClientesPage` | `authGuard`, `perfilGuard` com `data: { perfis: ['ADMINISTRADOR','ATENDENTE'] }` | Lista + busca |
| `/clientes/novo` | `ClienteFormPage` | idem | Cadastro |
| `/clientes/:id` | `ClienteDetalhePage` | idem | Detalhes |
| `/clientes/:id/editar` | `ClienteFormPage` (modo edição) | idem | Edição |

- `authGuard` e `perfilGuard` **já existem** em `frontend/src/app/auth/auth.guards.ts`; o exemplo de uso está comentado em `app.routes.ts`.
- Carregar com `loadComponent` (lazy loading), como a rota `/login`.
- No menu (`top-navigation.ts`), trocar `rota: null` por `rota: '/clientes'` no item "Clientes" (os perfis já estão corretos).

### 7.2 Arquivos (proposta)
- `frontend/src/app/models/cliente.ts` — interfaces `Cliente`, `ClienteEntrada`, `RespostaCliente`.
- `frontend/src/app/services/cliente.service.ts` — `listar(busca?)`, `buscarPorId(id)`, `criar(dados)`, `atualizar(id, dados)`; usa `HttpClient` e o token `API_BASE_URL` existente. O interceptor existente já envia o JWT.
- `frontend/src/pages/clientes/…` — páginas acima, seguindo a pasta `pages/` já usada por `dashboard` e `login`.
- Utilitário de formatação (proposta) para exibir CPF `000.000.000-00`, CNPJ `00.000.000/0000-00`, CEP `00000-000` e telefone.

### 7.3 Tela de listagem
- **Cabeçalho:** título "Clientes", botão primário "Novo cliente".
- **Busca:** um campo único "Buscar por nome ou CPF/CNPJ", com `debounce` de 300 ms e busca no servidor (`?busca=`).
- **Tabela:** Nome/Razão social · Tipo · CPF/CNPJ (formatado) · Telefone · Cidade/UF · Ação "Ver". Em telas estreitas, a tabela vira lista de cartões (o dashboard já tem `@media` como referência).
- **Estados:** carregando ("Carregando clientes…", com `aria-busy`); vazio sem busca ("Nenhum cliente cadastrado"); vazio com busca ("Nenhum cliente encontrado para '<termo>'"); erro (mensagem da API + botão "Tentar novamente").
- Sem dados fictícios (regra do Guia Mestre, seção 9).

### 7.4 Formulário de cadastro e edição
- **Reactive Forms** (padrão do projeto e do `CLAUDE.md` do frontend).
- **Seções:** "Identificação" (tipo de pessoa em botões de opção, nome/razão social, CPF/CNPJ), "Contato" (telefone, e-mail), "Endereço" (CEP, logradouro, número, complemento, bairro, cidade, UF em lista de seleção).
- O rótulo e a máscara do documento mudam conforme o tipo: "CPF" (11 dígitos) ou "CNPJ" (14 dígitos).
- **Validação no cliente:** obrigatórios, tamanhos, dígitos, UF da lista, e-mail. Mensagens abaixo de cada campo, ligadas por `aria-describedby` (mesmo padrão da tela de login).
- **Envio:** remover máscaras antes de enviar; desabilitar o botão durante o envio.
- **Erro 400:** mostrar a mensagem da API em alerta no topo do formulário.
- **Erro 409:** mostrar a mensagem junto do campo CPF/CNPJ e mover o foco para ele.
- **Sucesso:** navegar para os detalhes do cliente e mostrar a mensagem de sucesso.
- **Edição:** carregar o cliente; aplicar a decisão D-CLI-1 (campos de documento bloqueados ou não).
- **Busca automática de endereço pelo CEP:** fora do escopo (integração externa não aprovada).

### 7.5 Tela de detalhes
- Todos os campos formatados, botões "Editar" e "Voltar".
- **(proposta, depende do Módulo 2)** seção "Solicitações deste cliente".

---

## 8. Testes

### 8.1 Backend (proposta: `backend/test/clientes.test.js`, no mesmo estilo de `phase2.test.js`, com repositories simulados)

| Caso | Tipo | Esperado |
|---|---|---|
| Cadastro completo de pessoa física | positivo | cliente criado; `cpf_cnpj` só com dígitos |
| Cadastro de pessoa jurídica sem `complemento` | positivo | `complemento = null` enviado ao banco (regressão de F1) |
| CPF com máscara | positivo | máscara removida |
| Campo obrigatório ausente (cada um) | negativo | 400 |
| CPF com 10 dígitos / CNPJ com 13 | negativo | 400 |
| FISICA com 14 dígitos | negativo | 400 |
| CEP com 7 dígitos / UF "XX" | negativo | 400 |
| Texto acima do limite | negativo | 400 |
| Documento duplicado (checagem prévia) | negativo | 409 |
| Documento duplicado (erro `ER_DUP_ENTRY` simulado) | negativo | 409 |
| Edição válida | positivo | 200 e dados alterados |
| Edição com documento de outro cliente | negativo | 409 |
| Edição mantendo o próprio documento | positivo | 200 (não acusa duplicidade) |
| Edição de cliente inexistente | negativo | 404 |
| Busca por nome / por prefixo de documento | positivo | filtros corretos no SQL |
| Rotas com TÉCNICO | autorização | 403 em GET, POST e PUT |
| Rotas sem token | autorização | 401 |

### 8.2 Frontend (Vitest, padrão dos `*.spec.ts` existentes)
- `ClienteService`: URLs, método, corpo sem máscara, parâmetro `busca`.
- Lista: estados de carregamento, vazio, sem resultado e erro.
- Formulário: mensagens de validação; troca CPF↔CNPJ; 409 destacado no campo; botão desabilitado durante o envio.
- Rotas: TÉCNICO redirecionado pelo `perfilGuard`; visitante redirecionado ao login.

### 8.3 Critério de conclusão do módulo
Cadastrar, pesquisar, consultar e editar funcionando com a API e o banco reais; nenhum dado inválido resultando em 500; TÉCNICO bloqueado na API e na interface; testes do backend e do Angular passando; build sem erros.

---

## 9. Decisões pendentes deste módulo

| Código | Questão | Alternativas | Recomendação |
|---|---|---|---|
| D-CLI-1 | Permitir alterar `tipo_pessoa` e `cpf_cnpj` na edição? | (a) bloquear; (b) permitir com validação de unicidade | (b) permitir: corrige erros de digitação; a unicidade continua garantida |
| D-CLI-2 | Validar dígito verificador de CPF/CNPJ? | (a) não; (b) sim, no backend e no frontend | (b) é boa prática, mas **não está documentada** — aprovar antes |
| D-CLI-3 | Paginação da lista | (a) sem paginação, limite de 200; (b) paginação no servidor | (a) nesta versão |
| D-CLI-4 | Exclusão ou inativação de clientes | (a) fora do escopo; (b) criar coluna `ativo` (altera o MER) | (a) — não foi solicitado e alteraria o MER |
