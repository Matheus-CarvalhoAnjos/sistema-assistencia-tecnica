# Especificação Técnica — Módulo 2: Solicitações, Equipamentos e Acessórios Recebidos

> **Atualização 09/11/2026:** este documento é histórico. A situação atual (regras do MER v1.4, decisões resolvidas, pendências e o que está implementado) está em [../REGRAS_DECISOES_PENDENCIAS.md](../REGRAS_DECISOES_PENDENCIAS.md), e a API em [../API.md](../API.md).

**Projeto:** Sistema de Assistência Técnica · **Versão:** 1.0 · **Data:** 07/11/2026
**Situação do documento:** proposta para aprovação. Nada aqui foi implementado.

> **Atualização 07/11/2026 — abertura implementada.** Decisão do usuário em **D-SOL-6: só criação**; a consulta é feita pelas Ordens de Serviço (não há tela de listagem nem de detalhes de solicitação; os endpoints GET continuam existindo no backend).
> Implementado: acessórios dentro de cada equipamento no `POST /api/solicitacoes`, gravados na mesma transação (D-SOL-2); garantia sempre `PENDENTE` na abertura (D-SOL-3); limite de 20 equipamentos (D-SOL-4); tamanhos conforme o banco real (D-SOL-5); acessório inexistente → 404, inativo → 409; ~~mesmo acessório repetido no equipamento soma as quantidades~~ *(substituído em 08/11/2026 por D-SOL-9: cada ocorrência é um registro separado)*; resposta com `id_os` de cada equipamento, acessórios com descrição e o `status` real gravado pelo banco (deixou de responder `"ABERTA"` fixo). Frontend: rota `/solicitacoes/nova` (`/solicitacoes` redireciona) com `perfilGuard`; cadastro de cliente com `?retorno=solicitacao` volta com o cliente selecionado. Testes: `backend/test/solicitacoes.test.js` e `frontend/src/pages/solicitacoes/nova-solicitacao.spec.ts`.
> **D-SOL-7 decidido pelo usuário: só a tela (sem seed).** Rota `/acessorios` (ADMINISTRADOR e ATENDENTE, sem item no menu principal; atalhos na página de nova solicitação) com listagem dos ativos e cadastro de descrição + preço opcional. Corrigido no backend: preço vazio era gravado como 0 e descrição acima de 150 caracteres gerava 500. Edição e inativação de acessórios não existem (não há endpoint).
> **Atualização 08/11/2026 — auditoria do módulo.** **D-SOL-9 decidido: cada ocorrência de acessório é um registro separado**, alinhado ao MER v1.4. Se o mesmo acessório for informado mais de uma vez para o mesmo equipamento, cada ocorrência gera sua própria linha em `ACESSORIO_RECEBIDO`, com sua quantidade e sua observação. As quantidades **não** são somadas e as observações **não** são concatenadas. Isso substitui a regra de soma registrada acima em 07/11. A estrutura de `ACESSORIO_RECEBIDO` não muda: não há UNIQUE em (`id_item`, `id_acessorio`). Na mesma auditoria: quantidade acima do limite de `INT` (2.147.483.647) passou a retornar 400; `GET /api/solicitacoes/:id` passou a trazer `acessorios` e `ordens_servico` de cada equipamento (contrato da seção 7.3); `descricao_inicial`, `estado_fisico` e `observacoes` (e também as observações dos acessórios) passaram a ser limitados a 65.535 bytes em UTF-8, o limite real das colunas `TEXT` utf8mb4, conferido no banco. O limite é contado em bytes, não em caracteres: "ç" ocupa 2 bytes, "€" 3 e um emoji 4. Antes, um texto acima do limite chegava ao MySQL em modo estrito e gerava erro 500; agora o service retorna 400.
> **Continuam pendentes:** D-SOL-1 (status próprio da solicitação — sem tela de consulta, ficou só o valor do banco) e D-SOL-8 (perfis que registram acessórios fora da abertura).

Legenda: **IMPLEMENTADO** · **PARCIALMENTE IMPLEMENTADO** · **NÃO IMPLEMENTADO** · **PRECISA DE REVISÃO** · **DECISÃO PENDENTE**. Itens **(proposta)** não existem no projeto.

---

## 1. Fontes analisadas

| Fonte | O que foi verificado |
|---|---|
| `backend/src/routes/solicitacaoRoutes.js` | Rotas e perfis |
| `backend/src/controllers/solicitacaoController.js` | `id_atendente` vindo do token |
| `backend/src/services/solicitacaoService.js` | Validações e bloqueio do TÉCNICO |
| `backend/src/repositories/solicitacaoRepository.js` | Transação e criação automática de OS |
| `backend/src/routes/acessorioRoutes.js`, `acessorioRecebidoRoutes.js` | Catálogo e registro de acessórios |
| `backend/src/services/acessorioService.js`, `acessorioRecebidoService.js` | Validações |
| `backend/src/repositories/acessorioRepository.js`, `acessorioRecebidoRepository.js` | SQL |
| `backend/src/models/acessorioRecebido.js` | Campos devolvidos |
| `backend/src/routes/ordemServicoRoutes.js` (rotas `/:id/acessorios`) | Registro via OS |
| Banco (somente leitura): `solicitacao`, `item_solicitacao`, `acessorio`, `acessorio_recebido`, `ordem_servico` | Estrutura e dados reais |
| `banco/sql/04_solicitacao.sql`, `05_item_solicitacao.sql`, `06_acessorio_recebido.sql` | Scripts versionados |
| MER, Validação do MER, Especificações, `Permissoes_frontend_solicitacoes.txt`, `Decisao_tecnico_opcional_na_OS.txt`, Guia Mestre (seção 9) | Regras e decisões |
| Chamada real `GET /api/solicitacoes/1` (somente leitura) | Formato da resposta |

Dados atuais: 1 solicitação, 1 equipamento, 1 OS, **0 acessórios no catálogo**, 0 acessórios recebidos.

---

## 2. Situação atual por funcionalidade

| Funcionalidade | Situação | Evidência |
|---|---|---|
| Criar solicitação para um cliente | **IMPLEMENTADO** | `POST /api/solicitacoes`; `id_atendente` vem de `req.usuario` |
| Selecionar cliente cadastrado | **PARCIALMENTE IMPLEMENTADO** | A API recebe `id_cliente` e valida a existência; não há interface nem busca de clientes (Módulo 1) |
| Registrar um ou vários equipamentos | **IMPLEMENTADO** | `itens[]` obrigatório com pelo menos 1 elemento |
| Campos do equipamento | **IMPLEMENTADO** | `tipo_equipamento`, `marca`, `modelo`, `estado_fisico` obrigatórios; `numero_serie`, `garantia_status`, `observacoes` opcionais |
| Criar uma OS por equipamento | **IMPLEMENTADO** | Na mesma transação, com `id_tecnico = NULL` e status `RECEBIDA` |
| Registrar acessórios por equipamento | **PARCIALMENTE IMPLEMENTADO** | Existe, mas em **requisição separada**, fora da transação da solicitação (seção 4.4) |
| Catálogo de acessórios | **PARCIALMENTE IMPLEMENTADO** | Listar, consultar e criar; sem edição/inativação; **catálogo vazio** |
| Listar solicitações | **IMPLEMENTADO** (sem filtros) | `GET /api/solicitacoes` → `{ quantidade, solicitacoes }` |
| Pesquisa e filtros | **NÃO IMPLEMENTADO** | — |
| Detalhes da solicitação | **PARCIALMENTE IMPLEMENTADO** | `GET /api/solicitacoes/:id` devolve os itens, mas **não** devolve as OS geradas nem os acessórios recebidos |
| Ver as OS originadas | **NÃO IMPLEMENTADO** | Nenhum endpoint relaciona solicitação → OS; a resposta de criação também não traz os `id_os` |
| Ver acessórios recebidos | **PARCIALMENTE IMPLEMENTADO** | Só por item (`GET /api/acessorios-recebidos/item/:id_item`) ou por OS (`GET /api/ordens-servico/:id/acessorios`); a descrição do acessório é descartada (seção 4.5) |
| Bloqueio do TÉCNICO | **IMPLEMENTADO** | Rotas restritas a ADMINISTRADOR/ATENDENTE e checagem extra no service |
| Status da solicitação | **PRECISA DE REVISÃO** | Divergência RECEBIDA × ABERTA (seção 4.6) |
| Interface Angular | **NÃO IMPLEMENTADO** | Item "Solicitações" no menu com `rota: null` |
| Testes automatizados | **NÃO IMPLEMENTADO** | Nenhum teste cobre solicitações ou acessórios |

---

## 3. Modelo de dados (estado real do banco)

| Tabela | Colunas relevantes | Observações reais |
|---|---|---|
| `solicitacao` | `id_solicitacao` PK; `id_cliente` FK→cliente; `id_atendente` FK→usuario; `data_abertura` DATETIME default agora; `descricao_inicial` TEXT; `status` VARCHAR(40) default `'RECEBIDA'` | **Sem CHECK de status** no banco real |
| `item_solicitacao` | `id_item` PK; `id_solicitacao` FK; `tipo_equipamento`, `marca`, `modelo` VARCHAR(100); `numero_serie` VARCHAR(100) NULL; `estado_fisico` TEXT; `garantia_status` ENUM('PENDENTE','SIM','NAO') default PENDENTE; `observacoes` TEXT NULL | O script SQL usa tamanhos menores (50/50/80/60/255) — divergência D-SOL-5 |
| `acessorio` | `id_acessorio` PK; `descricao` VARCHAR(150); `preco_atual` DECIMAL NULL; `ativo` TINYINT | Sem UNIQUE em `descricao` (a unicidade é só no código, sem diferenciar maiúsculas) |
| `acessorio_recebido` | `id_acessorio_recebido` PK; `id_item` FK; `id_acessorio` FK; `quantidade` INT; `observacoes` TEXT NULL | Script SQL tem `CHECK (quantidade > 0)` e default 1; **banco real não tem** |
| `ordem_servico` | `id_os` PK; `id_item` FK; `id_tecnico` FK NULL; `status` ENUM; datas | `id_tecnico` aceita NULL (decisão "técnico opcional") |

Relações: CLIENTE 1:N SOLICITACAO 1:N ITEM_SOLICITACAO 1:N ORDEM_SERVICO; ITEM_SOLICITACAO 1:N ACESSORIO_RECEBIDO N:1 ACESSORIO. Todas as FKs são `NO ACTION` (impedem apagar registros referenciados).

---

## 4. Comportamento atual detalhado

### 4.1 Fluxo de criação (`POST /api/solicitacoes`)
1. `autenticar` → `autorizarPerfil("ADMINISTRADOR","ATENDENTE")`.
2. O controller monta `{ ...req.body, id_atendente: req.usuario.id_usuario }` — o cliente da API não consegue escolher outro atendente.
3. O service valida: `id_cliente`, `descricao_inicial` (texto não vazio), `itens` (array não vazio); cada item com `tipo_equipamento`, `marca`, `modelo`, `estado_fisico` (texto não vazio); `garantia_status` opcional dentro de PENDENTE/SIM/NAO.
4. O service confirma que o cliente existe (404) e que o atendente está ativo e é ADMINISTRADOR/ATENDENTE (403).
5. O repository abre uma **transação** e, para cada item: insere em `item_solicitacao` e insere uma OS (`id_tecnico NULL`, status `RECEBIDA`). Em qualquer erro: `rollback`. **Não há registros parciais** — este ponto está correto.
6. Resposta 201 com `status: "ABERTA"` (valor fixo no código) e `itens` com `id_item`, **sem `id_os`**.

### 4.2 Consistência com a documentação
| Aspecto | Documentação | Código | Banco |
|---|---|---|---|
| OS criada no recebimento | MER: "cada equipamento recebido gera sua própria OS no momento do recebimento" | Cria automaticamente na mesma transação | Coerente |
| Técnico na OS | MER: obrigatório; decisão posterior: opcional | Cria com `NULL` | `id_tecnico` NULL permitido |
| Uma OS ativa por equipamento | Script SQL: coluna gerada `id_item_ativo` UNIQUE | `POST /api/ordens-servico` verifica com `FOR UPDATE` | Coluna **não existe** no banco real |

### 4.3 Validações ausentes na criação (confirmadas no código)
| Nº | Falha | Efeito |
|---|---|---|
| V1 | Tamanho máximo de `tipo_equipamento`, `marca`, `modelo` (100) e `numero_serie` (100) não validado | `ER_DATA_TOO_LONG` → **500** |
| V2 | `numero_serie`/`observacoes` não validados como texto | Um número ou objeto vai direto ao banco |
| V3 | `id_cliente` não validado como inteiro positivo | Valor como `"abc"` resulta em 404 (aceitável), mas sem mensagem de formato |
| V4 | Sem limite de equipamentos por solicitação | Corpo com centenas de itens é aceito |
| V5 | `garantia_status` pode ser definido pelo atendente na abertura | Conflita com "o técnico determina a garantia" — D-SOL-3 |
| V6 | Erros do service usam `statusCode` (corrigido nesta sessão); erros de banco inesperados viram 500 | — |

### 4.4 Acessórios recebidos — como funciona hoje
- **Duas rotas** chegam ao mesmo service:
  - `POST /api/acessorios-recebidos` (ADMINISTRADOR, ATENDENTE, **TÉCNICO**) — corpo com `id_item`, `id_acessorio`, `quantidade`, `observacoes`, ou um array.
  - `POST /api/ordens-servico/:id/acessorios` (ADMINISTRADOR, ATENDENTE, **TÉCNICO**) — o `id_item` vem da OS.
- O registro em lote **não é transacional**: os itens são inseridos um por um; se o 3º falhar, os 2 primeiros ficam gravados.
- **Não verifica se o acessório está ativo** (`acessorio.ativo`), embora a listagem do catálogo mostre só os ativos.
- O TÉCNICO pode registrar acessórios em **qualquer** equipamento (não há checagem de OS atribuída).

### 4.5 Consultas — lacunas
- O model `AcessorioRecebido` só copia as colunas da tabela; o campo `descricao_acessorio` (vindo do JOIN com `acessorio`) **é descartado** na resposta. A interface não teria o nome do acessório sem outra chamada.
- `GET /api/solicitacoes/:id` não inclui OS nem acessórios.
- `GET /api/solicitacoes` não tem busca, filtros nem paginação.

### 4.6 Status da solicitação
- Banco real: default `'RECEBIDA'`, sem CHECK. O registro existente tem `RECEBIDA`.
- Script `04_solicitacao.sql`: default `'ABERTA'` e CHECK `ABERTA|EM_ATENDIMENTO|FINALIZADA|CANCELADA`.
- Código: não grava status (usa o default do banco), mas **responde `"ABERTA"`** na criação. Nenhum código atualiza o status depois.
- Validação do MER: recomenda decidir se SOLICITACAO precisa de status próprio, para não duplicar o status da OS.
- **DECISÃO PENDENTE D-SOL-1** (seção 9).

---

## 5. Requisitos funcionais

### RF-SOL-01 — Abrir solicitação
- **Perfis:** ADMINISTRADOR, ATENDENTE. **TÉCNICO:** 403.
- **Fluxo:** escolher o cliente → descrever o problema → incluir equipamentos (com acessórios) → revisar → confirmar.
- **Dados:** `id_cliente`, `descricao_inicial`, `itens[]`.
- **Comportamento:** grava tudo em uma única transação; responde com a solicitação, cada equipamento e o número da OS gerada.
- **Critérios de aceitação:** 1 solicitação com N equipamentos gera N registros em `item_solicitacao` e N OS com status `RECEBIDA` e sem técnico; qualquer erro desfaz tudo.

### RF-SOL-02 — Selecionar cliente
- **Fluxo:** campo de busca reutilizando `GET /api/clientes?busca=` (Módulo 1); atalho "Cadastrar novo cliente" que volta para a solicitação com o cliente selecionado.
- **Dependência:** busca do Módulo 1.

### RF-SOL-03 — Registrar equipamentos
- Pelo menos 1 equipamento; limite proposto de **20** por solicitação (D-SOL-4).
- Campos: tipo, marca, modelo, número de série (opcional), estado físico, observações (opcional).
- `garantia_status`: conforme D-SOL-3 (recomendado: não exibir no formulário de abertura; fica PENDENTE).

### RF-SOL-04 — Registrar acessórios por equipamento
- Para cada equipamento, zero ou mais acessórios do catálogo ativo, com quantidade (inteiro > 0) e observação opcional.
- **Recomendado (proposta):** enviar os acessórios dentro de cada item no `POST /api/solicitacoes` e gravá-los na mesma transação (D-SOL-2).
- **Regra vigente (D-SOL-9, 08/11/2026, alinhada ao MER v1.4):** o mesmo acessório pode aparecer mais de uma vez no mesmo equipamento. **Cada ocorrência é registrada separadamente** em `ACESSORIO_RECEBIDO`, com sua própria quantidade e observação. Nada é somado nem mesclado.
- *Histórico:* a versão de 07/11/2026 sugeria somar as quantidades ("o mesmo acessório não deve aparecer duas vezes no mesmo equipamento"), e essa soma chegou a ser implementada. A sugestão foi **substituída** por D-SOL-9.

### RF-SOL-05 — Consultar solicitações
- **Perfis:** ADMINISTRADOR, ATENDENTE.
- **Filtros (proposta):** busca por nome ou documento do cliente; período de abertura; status (se D-SOL-1 mantiver status).
- **DECISÃO PENDENTE D-SOL-6:** o Guia Mestre registra que a página Solicitações é **só para criar**, "sem painel separado de consulta", e que o acompanhamento acontece pelas OS. Esta especificação foi pedida com listagem; os dois precisam ser conciliados.

### RF-SOL-06 — Detalhes da solicitação
- Dados da solicitação, cliente, atendente, data e status; lista de equipamentos; para cada equipamento, seus acessórios e a OS gerada (número, status e técnico).

### RF-SOL-07 — Identificar as OS originadas
- A resposta da criação e os detalhes devem trazer o `id_os` de cada equipamento, com link para os detalhes da OS (Módulo 3).

---

## 6. Regras de negócio

| Código | Regra | Fonte | Situação |
|---|---|---|---|
| RN-SOL-01 | A solicitação pertence a um cliente | MER (Cliente 1:N Solicitação) | IMPLEMENTADO (FK e validação) |
| RN-SOL-02 | A solicitação tem 1..N equipamentos | MER; Especificações | IMPLEMENTADO |
| RN-SOL-03 | Cada equipamento é um ITEM_SOLICITACAO acompanhado individualmente | Especificações; Validação do MER | IMPLEMENTADO |
| RN-SOL-04 | Cada equipamento gera sua OS no recebimento | MER complementar | IMPLEMENTADO (automático) |
| RN-SOL-05 | A OS nasce sem técnico | Decisão "técnico opcional" | IMPLEMENTADO |
| RN-SOL-06 | Acessórios associados ao equipamento correto | MER | IMPLEMENTADO (FK); não transacional com a abertura |
| RN-SOL-07 | Abertura só por ADMINISTRADOR/ATENDENTE | Especificações; `Permissoes_frontend_solicitacoes.txt` | IMPLEMENTADO (rota + service) |
| RN-SOL-08 | TÉCNICO não vê nem acessa Solicitações | `Permissoes_frontend_solicitacoes.txt` | IMPLEMENTADO (API 403; menu oculto) |
| RN-SOL-09 | O atendente responsável é quem está logado | Implementação (token) | IMPLEMENTADO |
| RN-SOL-10 | Garantia determinada pelo técnico | Especificações (perfil TÉCNICO; fluxo item 4) | **PRECISA DE REVISÃO** — a abertura aceita `garantia_status` (D-SOL-3) |
| RN-SOL-11 | Só acessórios ativos podem ser registrados | Atributo `ativo` ("indica se pode ser selecionado") | **NÃO IMPLEMENTADO** no registro |

---

## 7. Backend

### 7.1 Endpoints

| Método | Rota | Perfis | Situação |
|---|---|---|---|
| POST | `/api/solicitacoes` | ADMIN, ATENDENTE | IMPLEMENTADO — ajustes propostos em 7.2 |
| GET | `/api/solicitacoes` | ADMIN, ATENDENTE | IMPLEMENTADO — filtros **(proposta)** |
| GET | `/api/solicitacoes/:id` | ADMIN, ATENDENTE | PARCIALMENTE — OS e acessórios **(proposta)** |
| GET | `/api/acessorios` | ADMIN, ATENDENTE, TÉCNICO | IMPLEMENTADO (só ativos) |
| GET | `/api/acessorios/:id` | ADMIN, ATENDENTE, TÉCNICO | IMPLEMENTADO |
| POST | `/api/acessorios` | ADMIN, ATENDENTE | IMPLEMENTADO |
| PUT/PATCH | `/api/acessorios/:id` | ADMIN | NÃO IMPLEMENTADO **(proposta, D-SOL-7)** |
| POST | `/api/acessorios-recebidos` | ADMIN, ATENDENTE, TÉCNICO | IMPLEMENTADO — revisar perfis (D-SOL-8) |
| GET | `/api/acessorios-recebidos/item/:id_item` | ADMIN, ATENDENTE, TÉCNICO | IMPLEMENTADO — revisar acesso do TÉCNICO |

### 7.2 Contrato proposto para `POST /api/solicitacoes`
Mantém os campos atuais e acrescenta `acessorios` opcional dentro de cada item.

```json
{
  "id_cliente": 1,
  "descricao_inicial": "Notebook não liga e impressora com atolamento de papel",
  "itens": [
    {
      "tipo_equipamento": "Notebook",
      "marca": "Dell",
      "modelo": "Inspiron 15",
      "numero_serie": "SN123",
      "estado_fisico": "Arranhões na tampa",
      "observacoes": null,
      "acessorios": [
        { "id_acessorio": 2, "quantidade": 1, "observacoes": "Carregador original" }
      ]
    },
    {
      "tipo_equipamento": "Impressora",
      "marca": "HP",
      "modelo": "LaserJet 1020",
      "estado_fisico": "Sem avarias aparentes",
      "acessorios": []
    }
  ]
}
```

Resposta 201 proposta (acrescenta `id_os` e acessórios; o `status` passa a refletir o banco):
```json
{
  "mensagem": "Solicitação cadastrada com sucesso.",
  "solicitacao": {
    "id_solicitacao": 2,
    "id_cliente": 1,
    "id_atendente": 6,
    "descricao_inicial": "Notebook não liga e impressora com atolamento de papel",
    "status": "<conforme D-SOL-1>",
    "itens": [
      {
        "id_item": 2,
        "id_os": 2,
        "tipo_equipamento": "Notebook",
        "marca": "Dell",
        "modelo": "Inspiron 15",
        "numero_serie": "SN123",
        "estado_fisico": "Arranhões na tampa",
        "garantia_status": "PENDENTE",
        "observacoes": null,
        "acessorios": [
          { "id_acessorio_recebido": 1, "id_acessorio": 2, "descricao_acessorio": "Carregador", "quantidade": 1, "observacoes": "Carregador original" }
        ]
      }
    ]
  }
}
```

**Transação (proposta):** uma única transação para `solicitacao` → cada `item_solicitacao` → sua `ordem_servico` → seus `acessorio_recebido`. Os acessórios são validados **antes** de abrir a transação (existem e estão ativos), para falhar cedo com 400/404.

### 7.3 Contrato proposto para `GET /api/solicitacoes/:id`
```json
{
  "solicitacao": {
    "id_solicitacao": 1,
    "id_cliente": 1,
    "nome_cliente": "Maria Cliente",
    "id_atendente": 1,
    "nome_atendente": "Ana Atendente",
    "data_abertura": "2026-10-28T02:32:43.000Z",
    "descricao_inicial": "Notebook não liga",
    "status": "RECEBIDA",
    "itens": [
      {
        "id_item": 1,
        "tipo_equipamento": "Notebook",
        "marca": "Dell",
        "modelo": "Inspiron 15",
        "numero_serie": null,
        "estado_fisico": "Arranhões na tampa",
        "garantia_status": "PENDENTE",
        "observacoes": null,
        "acessorios": [],
        "ordens_servico": [
          { "id_os": 1, "status": "RECEBIDA", "id_tecnico": 2, "nome_tecnico": "Tiago Técnico", "data_abertura": "2026-10-28T02:32:57.000Z" }
        ]
      }
    ]
  }
}
```
Os campos até `itens[].observacoes` já existem hoje (confirmado em chamada real). `acessorios` e `ordens_servico` são **propostas**. `ordens_servico` é uma lista porque um equipamento pode ter várias OS ao longo do tempo (MER: Item 1:N OS).

### 7.4 Filtros propostos para `GET /api/solicitacoes`
| Parâmetro | Efeito |
|---|---|
| `busca` | Nome do cliente (`LIKE %termo%`) ou documento (prefixo) |
| `data_inicio`, `data_fim` | Intervalo de `data_abertura` (formato `AAAA-MM-DD`) |
| `status` | Só se D-SOL-1 mantiver status próprio |
| `id_cliente` | Solicitações de um cliente (usado nos detalhes do cliente) |

A resposta mantém `{ quantidade, solicitacoes }`.

### 7.5 Erros
| HTTP | Situação | Mensagem |
|---|---|---|
| 400 | Campos principais ausentes | "Cliente, atendente, descrição inicial e pelo menos um equipamento são obrigatórios." (**atual**) |
| 400 | Equipamento incompleto | "Cada equipamento deve possuir tipo, marca, modelo e estado físico." (**atual**) |
| 400 | Texto acima do limite | "O campo <nome> do equipamento <n> deve ter no máximo 100 caracteres." **(proposta)** |
| 400 | Quantidade de acessório inválida | "A quantidade do acessório deve ser um número inteiro maior que zero." (**atual**, no service de acessórios) |
| 400 | Mais itens que o limite | "Uma solicitação pode ter no máximo 20 equipamentos." **(proposta)** |
| 403 | TÉCNICO | "Você não possui permissão para realizar esta ação." (rota) |
| 404 | Cliente inexistente | "Cliente não encontrado." (**atual**) |
| 404 | Acessório inexistente | "Acessório não encontrado." (**atual**) |
| 409 | Acessório inativo | "O acessório <descrição> está inativo." **(proposta)** |
| 500 | Falha inesperada no banco | rollback completo; mensagem genérica (**atual**) |

### 7.6 Alterações por camada (proposta)
| Camada | Arquivo | Alteração |
|---|---|---|
| Service | `services/solicitacaoService.js` | Validar tamanhos, tipos, limite de itens e acessórios; aplicar D-SOL-1 e D-SOL-3 |
| Repository | `repositories/solicitacaoRepository.js` | Inserir acessórios na mesma transação; devolver `id_os`; detalhes com OS e acessórios; filtros na listagem |
| Service | `services/acessorioRecebidoService.js` | Rejeitar acessório inativo; lote em transação (D-SOL-2) |
| Model | `models/acessorioRecebido.js` | Incluir `descricao_acessorio` (hoje descartado) |
| Rotas | `routes/acessorioRecebidoRoutes.js`, `routes/ordemServicoRoutes.js` | Revisar o acesso do TÉCNICO (D-SOL-8) |

---

## 8. Frontend

### 8.1 Rotas (proposta)
| Rota | Componente (proposta) | Guards |
|---|---|---|
| `/solicitacoes/nova` | `NovaSolicitacaoPage` | `authGuard` + `perfilGuard` (ADMINISTRADOR, ATENDENTE) |
| `/solicitacoes` | `SolicitacoesPage` (lista) | idem — **somente se D-SOL-6 aprovar a listagem** |
| `/solicitacoes/:id` | `SolicitacaoDetalhePage` | idem |

Se D-SOL-6 mantiver "só criação", o item de menu "Solicitações" aponta para `/solicitacoes/nova` e os detalhes ficam acessíveis pelas OS e pelos detalhes do cliente.

### 8.2 Serviços e models (proposta)
- `frontend/src/app/services/solicitacao.service.ts` — `criar`, `listar(filtros)`, `buscarPorId`.
- `frontend/src/app/services/acessorio.service.ts` — `listarAtivos()` (catálogo).
- `frontend/src/app/models/solicitacao.ts` — interfaces de entrada e resposta.
- Reutiliza `ClienteService` (Módulo 1) para a seleção de cliente.

### 8.3 Formulário de abertura — organização para vários equipamentos
Uma página em **3 blocos verticais**, com Reactive Forms (`FormGroup` com `FormArray` de equipamentos, e cada equipamento com `FormArray` de acessórios):

1. **Cliente** — campo de busca com sugestões (nome e documento formatado). Ao selecionar, mostra um cartão compacto (nome, documento, telefone) com o botão "Trocar". Atalho "Cadastrar novo cliente".
2. **Problema relatado** — `descricao_inicial` (área de texto).
3. **Equipamentos** — lista de **cartões numerados** ("Equipamento 1", "Equipamento 2"…):
   - Apenas **um cartão aberto por vez**; os demais aparecem recolhidos com um resumo de uma linha ("Notebook · Dell Inspiron 15 · 1 acessório").
   - Cada cartão tem os campos do equipamento e uma sub-seção "Acessórios recebidos": seletor do catálogo + quantidade + observação, com botão "Adicionar acessório" e lista do que foi adicionado.
   - Botões "Adicionar equipamento" (abre um cartão novo e recolhe o anterior) e "Remover" (com confirmação; desabilitado quando só há 1 equipamento).
   - Cartões com erro ficam destacados mesmo recolhidos, com a contagem de erros.
4. **Revisão e envio** — resumo (cliente, número de equipamentos e de acessórios) e o botão "Abrir solicitação".

**Comportamentos:**
- Validação no cliente igual à do backend; no envio, se houver erro, abre o primeiro cartão inválido e move o foco para o campo.
- Botão desabilitado durante o envio; os erros 400/404/409 aparecem no topo, com a mensagem da API.
- **Sucesso:** tela de confirmação com o número da solicitação e a lista "Equipamento → OS nº X", com links para as OS (Módulo 3).
- **Catálogo vazio:** aviso "Nenhum acessório cadastrado" (depende de D-SOL-7 para cadastrar).
- **Rascunho (proposta):** guardar o formulário em `sessionStorage` para não perder o preenchimento ao recarregar.

### 8.4 Detalhes
Cabeçalho (número, data, cliente, atendente, status) → lista de equipamentos, cada um com acessórios e as OS geradas (número, status, técnico ou "Sem técnico"), com link para os detalhes da OS.

### 8.5 Estados
Carregando o catálogo e a busca de clientes; erro ao carregar o catálogo (permite continuar sem acessórios, com aviso); sem resultados na busca de clientes; 404 nos detalhes.

---

## 9. Decisões pendentes deste módulo

| Código | Questão | Alternativas | Recomendação |
|---|---|---|---|
| D-SOL-1 | Status da solicitação | (a) remover o uso de status da solicitação (fica só na OS); (b) manter um status simples derivado das OS; (c) adotar ABERTA/EM_ATENDIMENTO/FINALIZADA/CANCELADA do script SQL e atualizar o banco | (b) **sem gravar**: calcular "Em atendimento" enquanto houver OS ativa e "Concluída" quando todas estiverem encerradas — evita estados duplicados (como recomenda a Validação do MER). Exige aprovação por afetar o MER |
| D-SOL-2 | Acessórios na mesma transação da abertura | (a) dentro do `POST /api/solicitacoes`; (b) chamadas separadas depois | (a) — evita solicitação gravada sem acessórios quando a 2ª chamada falha |
| D-SOL-3 | Quem define a garantia | (a) só o técnico/fluxo da OS; (b) também o atendente na abertura | (a) segue as Especificações; a abertura sempre grava PENDENTE |
| D-SOL-4 | Limite de equipamentos por solicitação | (a) 20; (b) sem limite | (a) — proteção simples; ajustar se a faculdade pedir |
| D-SOL-5 | Tamanhos de `item_solicitacao` (banco 100 × script 50/80/60) | (a) seguir o banco; (b) seguir o script | (a) — o banco é o que roda; atualizar o script depois |
| D-SOL-6 | Listagem de Solicitações × "página só para criar" do Guia Mestre | (a) só criação; (b) criação + lista com filtros | Decisão do usuário. A especificação cobre as duas |
| D-SOL-7 | Gestão do catálogo de acessórios (vazio hoje) | (a) tela de catálogo para ADMIN; (b) seed de desenvolvimento; (c) ambos | (c) — seed para testar agora e tela simples depois |
| D-SOL-8 | TÉCNICO registrando acessórios | (a) manter, restringindo às OS atribuídas; (b) só ADMIN/ATENDENTE | (b) — acessórios são registrados no recebimento (atendimento) |
| D-SOL-9 | Mesmo acessório repetido no mesmo equipamento | (a) somar as quantidades em um registro (sugestão de 07/11); (b) registrar cada ocorrência separadamente | **Decidido em 08/11/2026: (b)**, alinhado ao MER v1.4. Substitui a soma |

---

## 10. Testes

### 10.1 Backend
| Caso | Esperado |
|---|---|
| Solicitação com 1 equipamento | 1 item, 1 OS `RECEBIDA` sem técnico; resposta com `id_os` |
| Solicitação com 3 equipamentos | 3 itens e 3 OS, todos ligados à mesma solicitação |
| Equipamento com 3 acessórios | 3 registros em `acessorio_recebido` para aquele `id_item` |
| Mesmo acessório informado 2 vezes no mesmo equipamento (D-SOL-9) | 2 registros separados, cada um com sua quantidade e observação |
| Quantidade 0, negativa, fracionária ou > 2.147.483.647 | 400; nada gravado |
| `descricao_inicial`, `estado_fisico` ou `observacoes` acima de 65.535 bytes em UTF-8 | 400; nada gravado |
| Cliente inexistente | 404; nada gravado |
| `itens` vazio / equipamento incompleto / texto > 100 | 400; nada gravado |
| Acessório inexistente / inativo | 404 / 409; nada gravado |
| Falha no INSERT da 2ª OS (simulada) | rollback; nenhuma linha em nenhuma tabela |
| `id_atendente` no corpo da requisição | ignorado; vale o usuário do token |
| Integridade | Cada OS aponta para um item da solicitação; cada acessório para o item certo |
| TÉCNICO em POST, GET lista e GET detalhe | 403 |
| TÉCNICO chamando o service diretamente | 403 (defesa já existente) |
| Detalhes trazem OS e acessórios | campos `ordens_servico` e `acessorios` presentes |
| Filtros da listagem | busca por nome/documento e período |

### 10.2 Frontend
- Adicionar/remover equipamentos e acessórios no `FormArray`; não permite remover o último equipamento.
- Validação por cartão; o envio abre o primeiro cartão inválido.
- Envio monta o JSON do contrato 7.2.
- Sucesso mostra as OS geradas.
- `perfilGuard` bloqueia o TÉCNICO.

### 10.3 Critério de conclusão
Abrir uma solicitação com vários equipamentos e acessórios em uma única operação, ver as OS geradas e consultá-las depois; nenhum registro parcial em falhas; TÉCNICO bloqueado; testes e build passando.
