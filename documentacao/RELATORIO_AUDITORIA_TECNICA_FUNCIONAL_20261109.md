# Auditoria técnica e funcional — Sistema de Assistência Técnica (09/11/2026)

**Escopo:** auditoria e validação, **sem alterações** no código, no banco principal ou na documentação existente, exceto este relatório.

O banco principal `assistencia_tecnica` só foi lido. Ao final, era idêntico ao estado posterior à migração autorizada das 17:02 (18 tabelas, contagens e checksums iguais).

Ambiente de teste usado:
- banco `assistencia_tecnica_teste`, recriado pela suíte de integração com dados controlados;
- API em modo de teste (`servidor-teste.js`);
- frontend em `localhost:4200`.

**Única alteração de dados:** a senha dos 3 usuários de integração foi redefinida **somente no banco `_teste`**, para permitir o login no navegador. A suíte gera uma senha aleatória a cada execução.

Legenda do tipo de validação:
- **INT**: teste de integração real (MySQL);
- **HTTP**: sonda manual na API de teste;
- **NAV**: navegador;
- **UNIT**: testes com mocks ou specs;
- **COD**: somente análise de código;
- **BD**: consulta ao banco.

## A. Situação geral

- **Estado:** backend, frontend e banco consistentes entre si e com o MER v1.5. O banco principal foi migrado (17 tabelas do MER, mais a auxiliar `solicitacao_status_backup`).
- **Funcionando, com evidência:**
  - todos os fluxos de negócio dos cenários A–E (29 etapas de integração real);
  - controle de acesso por perfil no backend;
  - restrição financeira do técnico, na API e na tela;
  - transações, concorrência e histórico na mesma transação;
  - guardas das migrações;
  - build de produção.
- **Não validado nesta auditoria:**
  - fluxo completo clicando em todas as telas: a validação de tela foi por amostragem (login, perfis, OS em várias etapas, nova solicitação, 375 px), e os fluxos completos foram validados pela API;
  - gestão de usuários pela tela;
  - devolução por ENVIO com avaliação pendente (lacuna L2);
  - testes automatizados de interface contra o backend real (L3);
  - carga e desempenho;
  - ambiente de publicação (não existe ainda).

## B. Problemas encontrados

Nenhum problema **crítico** de funcionamento. Os pontos de prioridade alta se referem à **publicação**, não à apresentação local.

| ID | Arquivo / local | Descrição | Causa provável | Impacto | Prioridade |
|---|---|---|---|---|---|
| S1 | `backend/.env` (`DB_USER`) | A API conecta ao MySQL como `root` | Configuração de desenvolvimento | Uma falha na aplicação teria privilégio total no servidor MySQL | **Alta** (publicação) — **RESOLVIDO (ver seção S1 abaixo)** |
| S2 | Banco principal, tabela `usuario`; `backend/scripts/usuarios-teste.local.json` | Os 3 usuários ativos do banco principal (ADM, ATD e TEC, domínio `.test`) usam as senhas de teste do arquivo local em texto puro | Usuários criados pelo seed de desenvolvimento | Quem tiver o arquivo acessa o sistema principal como administrador | **Alta** (publicação) |
| S3 | `frontend/src/app/config/api.config.ts` | Endereço da API fixo em `http://localhost:3000/api`; não há configuração por ambiente | Projeto ainda sem build de publicação | O frontend publicado não encontraria a API; também força HTTP | **Alta** (publicação) |
| S4 | `backend/src/app.js` | Não há tratamento JSON para rota inexistente (Express devolve HTML "Cannot GET"); o JSON malformado devolve a mensagem crua do parser; o cabeçalho `X-Powered-By: Express` aparece; não há cabeçalhos de segurança (helmet) | Configuração mínima do Express | Respostas inconsistentes para o frontend; exposição menor de detalhes | Média |
| S5 | `backend/src/services/usuarioService.js` (criar/editar) | A senha exige apenas "não vazia"; não há tamanho mínimo | Regra não definida | Senhas fracas para contas reais | Média |
| D1 | Banco principal, usuários 1 e 2 (inativos, `teste.com`) | `senha_hash` com 13 caracteres, fora do formato bcrypt | Dados de teste antigos, inseridos sem o serviço | Não conseguem entrar (bcrypt devolve falso). Se forem reativados sem nova senha, continuam sem acesso | Média |
| D2 | `backend/.env.example` | Não existe no backend (só na cópia antiga em `entregas/`) | Arquivo não recriado | Quem instalar o projeto não sabe quais variáveis definir | Média |
| D3 | `MATUTADA/`, `entregas/` | Cópias antigas de backend, frontend e banco dentro da pasta do projeto | Restos de etapas anteriores | Confusão na entrega e na correção acadêmica | Baixa |
| U1 | `secao-historico` (frontend) | O histórico mostra valores crus: "técnico nº: — → 3" (ID em vez do nome); "valor: 100" e "valor: 100.00" no mesmo histórico | O histórico grava IDs e números como recebidos | Legibilidade na apresentação | Baixa |
| U2 | `app-header.html` | A busca global e as notificações são placeholders desabilitados; em telas estreitas, o aviso "BUSCA INDISPONÍVEL" some e o campo parece ativo | Funcionalidade não incluída no escopo | O usuário pode achar que a busca está quebrada | Baixa |
| U3 | Seções de pagamentos e abatimentos | Com o saldo zerado, os formulários "Registrar pagamento/abatimento" somem sem explicação | Comportamento correto, sem mensagem | Dúvida do usuário | Baixa |
| U4 | `frontend/src/pages/dashboard/dashboard.css` | Aviso de orçamento de tamanho no build (5,2 kB > 4 kB) | CSS acima do limite configurado | Nenhum funcional | Baixa |
| C1 | `backend/src/models/ordemServico.js` | Campo `id_item_ativo` que não existe no banco (L6) | Resto de versão anterior | Nenhum (fica indefinido) | Baixa |
| B1 | Banco principal | Tabela auxiliar `solicitacao_status_backup` (1 linha) | Passo opcional da migração | Aparece como "não prevista" na verificação | Baixa (decisão) |

**Verificado e sem problema:**
- **SQL:** todas as consultas usam parâmetros; as interpolações são só estruturais (listas de `?`, `WHERE` montado com placeholders e limite constante). As sondas com aspas, `OR 1=1` e `SLEEP` devolveram 0 resultados, sem atraso.
- **Senhas e token:** bcrypt custo 10; `senha_hash` nunca aparece nas respostas; JWT com segredo longo e expiração de 1 h.
- **Autenticação:** o usuário é recarregado do banco a cada requisição (desativação e mudança de perfil valem na hora); limite de tentativas de login (testado: bloqueou após 5 falhas).
- **CORS:** só a origem configurada recebe `Access-Control-Allow-Origin`.
- **Limites de entrada:** corpo acima de 100 kB recebe 413; IDs inválidos recebem 400; OS inexistente recebe 404.
- **Segredos:** `.env` e `*.local.json` estão no `.gitignore`; não há credencial no código.

## C. Funcionalidades validadas

| Funcionalidade | Resultado | Tipo | Observações |
|---|---|---|---|
| Login e sessão | OK | INT, HTTP, NAV | Token 1 h; 401 limpa a sessão; usuário inativo bloqueado; limite de tentativas ativo |
| Controle de acesso por perfil (51 rotas) | OK | COD, HTTP, INT | Todas exigem autenticação, exceto `/login`. Técnico: 403 em clientes, solicitações, usuários e financeiro; 404 em OS de outro técnico |
| Rotas protegidas no frontend | OK | NAV | Técnico em `/clientes` e `/usuarios` é redirecionado ao início |
| Cadastro e consulta de clientes | OK | INT, HTTP | CPF/CNPJ validado; busca parametrizada |
| Abertura de solicitação, equipamentos, acessórios e geração de OS | OK | INT, NAV | Uma OS por item; acessórios repetidos; tela sem rolagem horizontal em 375 px |
| Atribuição e reatribuição de técnico | OK | INT, NAV | Bloqueada em OS encerrada |
| Diagnóstico e laudo (D8) | OK | INT | Laudo editável até FINALIZADA |
| Garantia (RN05/RN06) | OK | INT | Herança para nova OS do mesmo equipamento |
| Orçamento: criação, um só pendente (inclusive concorrente), aprovação | OK | INT | — |
| Cenário B — orçamento rejeitado | OK | INT | Orçamento REJEITADO; OS ENCERRADA_SEM_REPARO / ORCAMENTO_REJEITADO; pendentes cancelados |
| Cenário C — impossibilidade técnica, avaliação financeira e reembolso | OK | INT | Diagnóstico e justificativa obrigatórios; avaliação obrigatória com pagamento confirmado em EM_REPARO; revisão; reembolso só depois da avaliação |
| Pagamentos parciais, limite, confirmação e reembolso parcial | OK | INT, NAV | Concorrência testada; o resumo da tela confere (100 − 30 abatido = 70; pago 100 − 30 reembolsado = 70; saldo 0) |
| Cenário D — abatimento (registro, limite, cancelamento, saldo, histórico, perfis) | OK | INT, NAV, HTTP | Técnico recebe 403; cancelar aparece em EM_REPARO; FINALIZADA não oferece cancelamento |
| Cenário E — expedição ENVIO e RETIRADA; RN20; OS sem reparo | OK | INT | Entrega com saldo recusada (409); OS sem reparo continua ENCERRADA_SEM_REPARO |
| Acessórios depois da abertura (D7) | OK | INT, NAV | — |
| Histórico (RN21) | OK | INT, NAV | Mesma transação: uma falha desfaz a operação. Técnico não vê PAGAMENTO/ABATIMENTO |
| Restrição financeira do técnico (P3/C2) | OK | HTTP, NAV | Detalhe da OS sem campos financeiros; pagamentos, abatimentos e avaliação respondem 403; telas sem essas seções. O técnico vê os valores do orçamento, que ele mesmo elabora (regra: o orçamento não é dado financeiro restrito) |
| Gestão de usuários | OK (API) | INT, HTTP | Tela não exercitada nesta auditoria |
| Guardas de migração | OK | INT | 9/9; estrutura anterior + 4 migrações = estrutura do principal |
| Suítes | 188/188 UNIT · 39/39 INT · 99/99 specs · build OK | — | Executadas nesta auditoria |
| Console do navegador | Sem erros | NAV | Telas visitadas: login, início, OS 12, 13 e 19, nova solicitação |

## D. Inconsistências

| Entre | Divergência |
|---|---|
| MER × banco | Nenhuma estrutural (17 entidades = 17 tabelas, colunas, tipos, nulos, chaves, ENUMs). `ITEM_ORCAMENTO.subtotal` é derivado (não armazenado), como o MER prevê. A tabela extra `solicitacao_status_backup` não está no MER |
| MER × banco (restrição física) | I4: a FK composta abatimento × orçamento da mesma OS é garantida só pelo backend. `EXPEDICAO.forma_entrega` aceita NULL no banco para registros antigos (o backend exige o valor) |
| Regras × backend × frontend | Nenhuma divergência encontrada nos fluxos testados |
| Documentação × projeto | O diagrama `.drawio` ainda é o da v1.4 (D-3). As especificações antigas em `documentacao/especificacoes/` citam a situação anterior (por exemplo, `solicitacao.status`) e servem de histórico |
| Dados × regras | Usuários 1 e 2 com `senha_hash` inválido (D1) |

## E. Pendências para finalização (por prioridade)

1. **Antes de publicar (alta):**
   - S1: usuário MySQL da aplicação com privilégio mínimo;
   - S2: trocar as senhas dos usuários ativos do banco principal, ou criar contas reais e desativar as de teste;
   - S3: endereço da API configurável por ambiente, com HTTPS;
   - login-path administrativo (OP1).
2. **Robustez da API (média):**
   - S4: 404 em JSON, mensagem padronizada para JSON inválido, sem `X-Powered-By`, cabeçalhos de segurança;
   - S5: tamanho mínimo de senha.
3. **Dados e instalação (média):**
   - D1: decidir o destino dos usuários 1 e 2;
   - D2: criar `backend/.env.example`.
4. **Apresentação (baixa):**
   - U1: nomes em vez de IDs no histórico e números formatados;
   - U2: esconder ou deixar claramente desativados busca e notificações;
   - U3: mensagem de "saldo quitado";
   - U4: CSS do dashboard.
5. **Organização (baixa):**
   - D3: retirar `MATUTADA/` e `entregas/` da pasta do projeto, movendo-os, não apagando;
   - C1: campo morto;
   - B1: destino de `solicitacao_status_backup`;
   - diagrama `.drawio` v1.5.
6. **Testes (baixa):**
   - L2: ENVIO com avaliação pendente;
   - L3: teste de interface contra o backend real;
   - validação da tela de usuários.
7. **Publicação (T4):** com autorização própria.

## F. Recomendação final

**Funcionalmente pronto, mas exige ajustes de segurança ou documentação.**

Para a apresentação acadêmica local, o sistema está pronto: fluxos completos validados em banco real, permissões aplicadas no backend e as suítes passando. Para a publicação, faltam S1, S2 e S3 e a configuração do ambiente.

## Sequência de correções proposta (aguarda autorização)

| Etapa | O que | Risco para o que já funciona | Como validar |
|---|---|---|---|
| 1 | S4 e S5 no backend: 404 em JSON, erro de JSON padronizado, `x-powered-by` desligado, senha com mínimo de 8 caracteres (só em criação e troca) | Baixo; as senhas existentes não mudam | Novos testes com mocks + integração |
| 2 | S3: `API_BASE_URL` por ambiente (`environment.ts` / `fileReplacements`) | Baixo | Specs + build + navegador |
| 3 | D2: `backend/.env.example` sem valores reais | Nenhum | Revisão |
| 4 | U1–U4: ajustes de apresentação no histórico, cabeçalho, mensagens e CSS | Baixo | Specs + navegador |
| 5 | S1 e S2: usuário MySQL da aplicação e troca de senhas no banco principal | **Exige sua autorização** (criação de usuário e alteração de dados reais) | Login real, `SHOW GRANTS` |
| 6 | D1, D3, B1, C1: decisões sobre dados e pastas | **Exige decisão** (dados e arquivos) | — |

## Correções aplicadas — etapas 1 a 4 (autorizadas em 09/11/2026)

Só houve mudanças em código e configuração. Nenhuma alteração no banco principal, nas regras de negócio ou em dados reais.

| ID | Correção | Arquivos | Evidência |
|---|---|---|---|
| S4 | 404 em JSON ("Rota não encontrada."); mensagens padronizadas para JSON malformado (400), corpo grande (413) e codificação não suportada (415); `X-Powered-By` desligado; cabeçalhos `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cross-Origin-Resource-Policy` e `Content-Security-Policy` (sem dependência nova) | `backend/src/app.js` | `backend/test/seguranca.test.js` (novo); navegador: `/api/nao-existe` → 404 JSON; telas e preflight CORS continuam 200/204 |
| S5 | Senha de 8 a 72 caracteres no cadastro e na troca de senha (backend e formulário); o login não aplica a regra, para não bloquear contas existentes | `backend/src/services/usuarioService.js`, `frontend/src/pages/usuarios/usuarios.ts/.html` | `seguranca.test.js` (2 testes) e `usuarios.spec.ts` (1 teste novo) |
| S3 | Endereço da API por ambiente: desenvolvimento `http://localhost:3000/api`; produção `/api` (mesmo domínio, HTTPS) por `fileReplacements` | `frontend/src/environments/environment.ts` e `environment.production.ts` (novos), `frontend/src/app/config/api.config.ts`, `frontend/angular.json` | Build de produção sem `localhost:3000` no bundle; specs e `ng serve` usam o endereço de desenvolvimento |
| D2 | `backend/.env.example` com todas as variáveis lidas pelo backend, sem valores reais | `backend/.env.example` (novo) | Conferido com `grep process.env` (14 variáveis) |
| U1 | Histórico: nome do técnico no lugar do número (com "nº X" quando o nome não é conhecido), códigos com os rótulos das telas (situação, garantia, forma, tipo de encerramento) e valores em R$ | `secoes/secao-historico.ts`, `ordem-servico-detalhe.ts/.html` | Spec nova e ajustada; navegador: "técnico: — → Técnico Integração", "valor: R$ 100,00", "total devido: R$ 100,00 → R$ 30,00" |
| U2 | Busca e notificações identificadas como "indisponível nesta versão"; busca esmaecida; escondida em celular | `components/layout/app-header/app-header.html/.css` | Navegador em 375 px: busca oculta, sem rolagem horizontal |
| U3 | Mensagens quando não há valor para pagamento ou abatimento ("Saldo quitado…" / "reservado por pagamentos pendentes…") | `secoes/secao-pagamentos.ts/.html`, `secoes/secao-abatimentos.ts/.html` | 2 specs novas; navegador (OS 12) |
| U4 | Limite de aviso de CSS por componente de 4 kB para 6 kB (erro continua em 8 kB); todas as classes do `dashboard.css` são usadas | `frontend/angular.json` | Build sem avisos |

**Suítes depois das correções:**
- backend com mocks: 193/193 (5 novos);
- integração real: 39/39;
- frontend: 103/103 (4 novos);
- build de produção: sem avisos;
- console do navegador: sem erros nas requisições atuais.

**Observação:** as descrições já gravadas no histórico (por exemplo, "Garantia definida como NAO.") são texto permanente do evento (RN21) e não foram alteradas.

**Continuam pendentes:**
- dependem de autorização: S1 (usuário MySQL da aplicação), S2 (senhas dos usuários do banco principal), D1, D3, B1 e C1;
- diagrama `.drawio` v1.5;
- L2/L3;
- publicação (T4).

## S1 resolvido — usuário MySQL da aplicação (09/11/2026, autorizado)

| Item | Resultado |
|---|---|
| Usuário criado | `assistencia_app`@`localhost` (só conexão local). A senha foi gerada aleatoriamente (44 caracteres), gravada só em `backend/.env`, entre aspas por conter `#`, e não foi exibida |
| Privilégios (`SHOW GRANTS`) | `SELECT, INSERT, UPDATE` em `assistencia_tecnica`.* e `assistencia_tecnica_teste`.*; nada mais |
| Por que só isso | A aplicação não usa `DELETE` nem DDL (conferido no código: só `SELECT`, `INSERT`, `UPDATE` e `SELECT … FOR UPDATE`) |
| Recusas testadas com o usuário da aplicação | `DELETE`, `DROP`, `CREATE TABLE`, `ALTER`, `TRUNCATE`, `CREATE DATABASE`, `CREATE USER`, leitura de `mysql.user` e de `sys`, consulta a `INNODB_TRX` (`PROCESS`): **todas recusadas**. Vê só as próprias sessões e os 2 bancos concedidos |
| `backend/.env` | `DB_USER=assistencia_app`. A credencial anterior passou para `DB_ADMIN_USER`/`DB_ADMIN_PASSWORD`, que a API não lê; usada só por `backend/integracao` (`credenciaisAdmin()`) |
| Ferramentas de teste | `fluxoCompleto`, `migracoes`, `simularRecuperacaoMigracao` e `demonstrarMigracoes` usam a credencial administrativa para criar e apagar bancos `_teste`; a API testada usa `assistencia_app` |
| Evidência de uso real | Integração 39/39 com a API conectada como `assistencia_app` (`performance_schema.accounts` registrou as conexões). API real no banco principal: GET clientes, OS e usuários → 200, com sessão `assistencia_app` em `assistencia_tecnica` |
| Demais suítes | Mocks 193/193 |
| Banco principal | Dados e estrutura idênticos ao estado pós-migração (contagens e `CHECKSUM TABLE`); nenhum dado alterado |
| Para produção | O `.env` de produção leva só `DB_USER`/`DB_PASSWORD` da aplicação, sem `DB_ADMIN_*`. Não foi alterado: o login-path `assistencia` (`assistencia_dev`) |

**Continua pendente:** S2 (senhas dos usuários do banco principal), além de D1, D3, B1 e C1, que dependem de decisão.
