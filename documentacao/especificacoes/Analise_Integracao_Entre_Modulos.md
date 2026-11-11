# Análise de Integração entre os Módulos 1, 2 e 3

> **Atualização 09/11/2026:** este documento é histórico. A situação atual (regras do MER v1.4, decisões resolvidas, pendências e o que está implementado) está em [../REGRAS_DECISOES_PENDENCIAS.md](../REGRAS_DECISOES_PENDENCIAS.md), e a API em [../API.md](../API.md).

**Projeto:** Sistema de Assistência Técnica · **Versão:** 1.0 · **Data:** 07/11/2026
Documentos relacionados: `Especificacao_Modulo_Clientes.md`, `Especificacao_Modulo_Solicitacoes.md`, `Especificacao_Modulo_Ordens_Servico.md`, `Pendencias_e_Decisoes_Tecnicas.md`.

---

## 1. Visão do fluxo

```
CLIENTE ──1:N──▶ SOLICITACAO ──1:N──▶ ITEM_SOLICITACAO ──1:N──▶ ORDEM_SERVICO ──▶ orçamento / execução / pagamento / expedição
                                         │
                                         └──1:N──▶ ACESSORIO_RECEBIDO ──N:1──▶ ACESSORIO (catálogo)
USUARIO (ATENDENTE) abre a SOLICITACAO · USUARIO (TECNICO) é atribuído à ORDEM_SERVICO
```

- Módulo 1 (Clientes) fornece o cliente.
- Módulo 2 (Solicitações) cria a solicitação, os equipamentos, os acessórios recebidos **e as OS** (mesma transação).
- Módulo 3 (OS) consulta e administra as OS criadas pelo Módulo 2 e é a porta de entrada do técnico.

---

## 2. Dependências entre funcionalidades

| Funcionalidade | Depende de | Tipo |
|---|---|---|
| Abrir solicitação (interface) | Busca de clientes (`GET /api/clientes?busca=`) — Módulo 1 | Bloqueante para a seleção de cliente |
| Abrir solicitação com acessórios | Catálogo com itens ativos (`GET /api/acessorios`) — hoje vazio | Bloqueante para testar acessórios (D-SOL-7) |
| Mostrar OS geradas após abrir a solicitação | `POST /api/solicitacoes` devolver `id_os` — Módulo 2 | Bloqueante para o link Solicitação → OS |
| Detalhes da solicitação com OS | Consulta de OS por item — Módulo 2 (repository) | — |
| Dashboard de OS com cliente e equipamento | Correção do model `OrdemServico` (A2) e JOIN com cliente — Módulo 3 | Bloqueante |
| Atribuir técnico pela interface | Lista de técnicos ativos (`GET /api/usuarios?perfil=TECNICO&ativo=1`, proposta) | Bloqueante |
| Experiência do técnico | Filtro por técnico em todas as leituras (A1) | **Bloqueante de segurança** |
| Detalhes do cliente com suas solicitações | Filtro `id_cliente` em `GET /api/solicitacoes` — Módulo 2 | Opcional |
| Testar o fluxo completo pela interface | Dados reais criados pelos Módulos 1 e 2 | — |

---

## 3. Endpoints que precisam existir primeiro

| Ordem | Endpoint | Situação | Módulo |
|---|---|---|---|
| 1 | Validações completas em `POST /api/clientes` | parcial | 1 |
| 2 | `GET /api/clientes?busca=` | proposta | 1 |
| 3 | `PUT /api/clientes/:id` | proposta | 1 |
| 4 | `GET /api/acessorios` com itens (seed ou cadastro) | existe, catálogo vazio | 2 |
| 5 | `POST /api/solicitacoes` com acessórios e retorno de `id_os` | ajuste proposto | 2 |
| 6 | `GET /api/solicitacoes/:id` com OS e acessórios | ajuste proposto | 2 |
| 7 | Filtro por técnico em todas as leituras de OS | correção proposta | 3 |
| 8 | `GET /api/ordens-servico` com filtros e dados completos | ajuste proposto | 3 |
| 9 | `GET /api/usuarios?perfil=TECNICO&ativo=1` | proposta | 3 |

**Exceção de prioridade:** o item 7 é uma falha de segurança confirmada. Recomenda-se corrigi-lo **antes** de qualquer tela do Módulo 3 e, se possível, antes do Módulo 1 (é uma alteração pequena e isolada no backend). Ver D-INT-3.

---

## 4. Reutilização no Angular

### 4.1 O que já existe e será reutilizado
| Item | Arquivo | Uso nos módulos |
|---|---|---|
| `authGuard`, `perfilGuard`, `somenteVisitanteGuard` | `src/app/auth/auth.guards.ts` | Rotas dos 3 módulos |
| `AuthService` (`perfil()`, `possuiPerfil()`) | `src/app/auth/auth.service.ts` | Mostrar/ocultar ações por perfil |
| Interceptor JWT | `src/app/auth/auth.interceptor.ts` | Todas as chamadas |
| `mensagemDeErro()` | `src/app/auth/mensagem-erro.ts` | Mensagens de 400/404/409 |
| `API_BASE_URL` | `src/app/config/api.config.ts` | Base das URLs |
| Layout (header, menu por perfil) | `src/components/layout/*` | Shell; ativar rotas no menu |
| Estrutura visual da tabela e indicadores de OS | `src/pages/dashboard/*` | Módulo 3 |

### 4.2 Componentes novos reutilizáveis (proposta)
| Componente | Usado em |
|---|---|
| `CampoBusca` (input com debounce e botão limpar) | Lista de clientes, seleção de cliente, lista de solicitações, filtros de OS |
| `EstadoLista` (carregando / vazio / erro com "Tentar novamente") | Todas as listas |
| `SeletorCliente` (busca + cartão do cliente escolhido) | Abertura de solicitação |
| `StatusBadge` (status da OS em português) | Dashboard, detalhes da OS, detalhes da solicitação |
| Funções de formatação (CPF/CNPJ, CEP, telefone, datas) | Módulos 1, 2 e 3 |

### 4.3 Serviços Angular a criar (proposta)
`ClienteService` (M1), `SolicitacaoService` (M2), `AcessorioService` (M2), `OrdemServicoService` (M3), `UsuarioService` (M3, só a lista de técnicos). Todos em `src/app/services/`, com `providedIn: 'root'` e `inject()` (padrão do `CLAUDE.md` do frontend).

---

## 5. Estruturas do banco a revisar

| Item | Situação | Módulos afetados | Decisão |
|---|---|---|---|
| `solicitacao.status` (RECEBIDA × ABERTA; sem CHECK) | divergente | 2 | D-SOL-1 |
| `ordem_servico.id_tecnico` NULL × MER "obrigatório" | MER desatualizado | 2, 3 | D-BD-2 |
| Unicidade de OS ativa por equipamento (`id_item_ativo` ausente) | só no código | 2, 3 | D-BD-3 |
| Tamanhos de `item_solicitacao` (banco 100 × script 50/80/60) | divergente | 2 | D-SOL-5 |
| `acessorio_recebido.quantidade` sem CHECK no banco | só no código | 2 | D-BD-4 |
| Catálogo `acessorio` vazio e sem UNIQUE de descrição | dados/estrutura | 2 | D-SOL-7 |
| Histórico da OS (não existe tabela) | ausente | 3 | D-OS-4 |

Nenhuma dessas revisões é obrigatória para começar o Módulo 1.

---

## 6. Regras que precisam ser decididas antes de cada módulo

| Antes de | Decisões necessárias |
|---|---|
| Módulo 1 | D-CLI-1 (editar documento), D-CLI-2 (dígito verificador) |
| Módulo 2 | D-SOL-1 (status), D-SOL-2 (acessórios na transação), D-SOL-3 (garantia na abertura), D-SOL-6 (listagem), D-SOL-7 (catálogo), D-SOL-8 (técnico e acessórios) |
| Módulo 3 | D-OS-1 (403/404), D-OS-3 (EM_ANALISE), D-OS-5 (garantia), D-OS-8 (técnico vê pagamentos), D-OS-9 (cliente para o técnico), D-OS-11 (OS com técnico inativo) |
| Todos | D-INT-1 (padrão de camadas), D-INT-2 (limite de login em desenvolvimento) |

---

## 7. Testes que devem passar antes de avançar

| Antes de iniciar | Testes obrigatórios |
|---|---|
| Módulo 1 | Suítes atuais: backend 22/22, Angular 15/15, build OK |
| Módulo 2 | Módulo 1: cadastro sem `complemento`, validações → 400, duplicado → 409, edição, busca, TÉCNICO → 403; tela de clientes testada |
| Módulo 3 | Módulo 2: N equipamentos → N OS; rollback em falha; acessórios na transação; TÉCNICO → 403; detalhes com OS |
| Concluir Módulo 3 | Matriz de autorização por rota com os 3 perfis e as contas de teste; dashboard com dados reais |

Em todas as etapas: rodar `npm test` (backend), `ng test --watch=false` e `ng build` (frontend), e um teste manual com as três contas de teste (`backend/scripts/usuarios-teste.local.json`, fora do Git).

---

## 8. Sequência recomendada de implementação

| Passo | Entrega | Por que nesta posição |
|---|---|---|
| 0 | **Correção de segurança das leituras de OS** (A1, A3, A4) | Falha confirmada que expõe dados; pequena, isolada no backend, sem depender de tela |
| 1 | **Módulo 1 — Clientes** (backend + tela) | Início do fluxo; a abertura de solicitação depende da busca de clientes; estabelece o padrão de serviço, tela, formulário e testes para os demais |
| 2 | **Catálogo de acessórios** (seed de desenvolvimento e, se aprovado, tela simples) | Sem itens no catálogo não é possível testar acessórios recebidos |
| 3 | **Módulo 2 — Solicitações** | Depende de clientes e do catálogo; é o que **cria** as OS |
| 4 | **Módulo 3 — Ordens de Serviço** (dashboard, detalhes, atribuição) | Depende das OS criadas pelo Módulo 2 para ser testado com dados reais; usa a correção do passo 0 |
| Depois | Execução/garantia → Orçamentos → Pagamentos → Expedição (telas) | O backend já existe; cada etapa depende do status gerado pela anterior |

**Alternativa considerada:** começar pelo dashboard de OS porque já existe a estrutura visual. Descartada porque, sem Clientes e Solicitações na interface, as OS só poderiam ser criadas por chamadas manuais à API, e o módulo não seria testável de ponta a ponta.

---

## 9. Riscos de integração

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Mudar o formato de respostas existentes quebra quem já consome | baixa (o frontend ainda não consome esses endpoints) | médio | Manter os formatos atuais e só **acrescentar** campos |
| Filtro do técnico aplicado em uma rota e esquecido em outra | média | alto | Ponto único de verificação (`verificarAcessoOs`) e teste por rota |
| Acessórios fora da transação da solicitação | média | médio | D-SOL-2 (mesma transação) |
| Status da solicitação inconsistente | alta (já ocorre) | baixo/médio | D-SOL-1 antes do Módulo 2 |
| Técnico inativo atribuído a OS ativa bloqueia o fluxo | já ocorre (OS 1) | médio | Alerta na interface + D-OS-11 |
| Limite de 5 tentativas de login por IP atrapalhar testes | alta em desenvolvimento | baixo | D-INT-2 |
| Nome de tabela em maiúsculas (`CLIENTE`, `USUARIO`) falhar em servidor Linux | depende da hospedagem | alto se ocorrer | Padronizar nomes em minúsculas ao mexer nos repositories (D-INT-4) |
| Scripts em `banco/sql` não recriam o banco real | certa | alto para quem recriar o ambiente | D-BD-1 |
