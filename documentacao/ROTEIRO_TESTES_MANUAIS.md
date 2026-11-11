# Roteiro de testes manuais — resultados de 09/11/2026

**Ambiente:** frontend `http://localhost:4200` (dev server) + API em modo de teste (`backend/integracao/servidor-teste.js`, configuração `backend-teste`), banco **`assistencia_tecnica_teste`**. O banco principal não foi usado.
**Usuários de demonstração:** `admin@demo.test` (ADMINISTRADOR), `atendente@demo.test` (ATENDENTE), `tecnico@demo.test` (TECNICO) e `bruno@demo.test` (criado e desativado durante o teste). A senha de teste foi gerada aleatoriamente e não consta neste documento.
**Navegador:** painel de navegador do Claude Desktop (Chromium), largura de desktop e 375 px (celular).

Legenda: ✅ passou · ⚠️ passou com observação · 🔧 falhou e foi corrigido durante o teste.

## 1. Login e acesso por perfil

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 1.1 | Login com cada perfil | Entra e mostra nome e perfil no cabeçalho | ✅ |
| 1.2 | Menu do ADMINISTRADOR | Início, Clientes, Solicitações, Usuários (sem itens desativados) | ✅ |
| 1.3 | Menu do TÉCNICO | Somente Início | ✅ |
| 1.4 | Técnico abre `/usuarios` pela URL | Volta para o Início | ✅ |
| 1.5 | Usuário inativo tenta entrar | Mensagem "Este usuário está inativo." | ✅ |
| 1.6 | Cabeçalho com nome "Ana Atendente (demo)" | Iniciais "AA" | 🔧 mostrava "A(" (iniciais pegavam a última palavra "(demo)"); corrigido em `app-header.ts` |

## 2. Gestão de usuários (ADMINISTRADOR)

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 2.1 | Listar usuários | Nome, e-mail, perfil, situação; "(você)" no usuário logado; nenhuma senha | ✅ |
| 2.2 | Cadastrar sem senha | "Informe a senha."; nada é gravado | ✅ |
| 2.3 | Cadastrar Bruno (Técnico) | Mensagem de sucesso e lista atualizada | ✅ |
| 2.4 | Editar Bruno (nome) sem informar senha | Salva sem alterar a senha | ✅ |
| 2.5 | Desativar Bruno (com confirmação) | Situação "Inativo" | ✅ |
| 2.6 | Filtro "Inativos" | 1 usuário | ✅ |
| 2.7 | Admin tenta se desativar sendo o único admin ativo | Alerta "O sistema precisa de ao menos um administrador ativo." | ✅ |
| 2.8 | Bruno inativo não aparece na atribuição de técnico | Só técnicos ativos | ✅ |

## 3. Clientes e abertura

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 3.1 | Cadastrar cliente sem e-mail (atendente) | Salva; e-mail "Não informado" | ✅ |
| 3.2 | Editar o cliente (e-mail e complemento) | Dados atualizados na tela | ✅ |
| 3.3 | Abrir solicitação com 3 equipamentos | Solicitação nº 1 e OS 1, 2 e 3 em RECEBIDA | ✅ |
| 3.4 | Atribuir técnico às 3 OS | Evento "Técnico atribuído" no histórico | ✅ |

## 4. Fluxo completo com reparo (OS 1)

| # | Perfil | Passo | Esperado | Resultado |
|---|---|---|---|---|
| 4.1 | TEC | Abrir OS 1 | Sem seção Pagamentos | ✅ |
| 4.2 | TEC | Registrar diagnóstico | RECEBIDA → EM_ANALISE | ✅ |
| 4.3 | TEC | Garantia | Botão desativado até escolher; salva "NAO" | ✅ |
| 4.4 | TEC | Emitir orçamento com 2 itens (R$ 120 + R$ 80) | Total R$ 200; OS em AGUARDANDO_APROVACAO | ✅ |
| 4.5 | TEC | Tentar novo orçamento | "Já existe um orçamento aguardando resposta." | ✅ |
| 4.6 | ATD | "Cliente aprovou" → confirmar | Orçamento APROVADO; OS EM_REPARO; eventos ORCAMENTO e REPARO | ✅ |
| 4.7 | ATD | Expedição durante EM_REPARO | Não é oferecida | ✅ |
| 4.8 | ATD | Pagamento R$ 200 Pix | PENDENTE; "Pendente de confirmação R$ 200" | ✅ |
| 4.9 | ATD | Confirmar recebimento (com confirmação) | CONFIRMADO; saldo R$ 0 | ✅ |
| 4.10 | ATD | Reembolsar sem justificativa | "Informe a justificativa do reembolso." | ✅ |
| 4.11 | ATD | Reembolsar com justificativa | REEMBOLSADO; saldo volta a R$ 200; não oferece novo reembolso do mesmo pagamento | ✅ |
| 4.12 | ATD | Pagamento de R$ 250 | "Informe um valor entre R$ 0,01 e R$ 200,00." | ✅ |
| 4.13 | ATD | Pagamento R$ 120 em dinheiro e confirmar | Pago R$ 120; saldo R$ 80 | ✅ |
| 4.14 | TEC | Laudo com data de conclusão anterior ao início | "A data de conclusão não pode ser anterior à data de início." | ✅ |
| 4.15 | TEC | Laudo, resultado e data válida | Salvo; botão "Concluir reparo" aparece | ✅ |
| 4.16 | TEC | **Concluir reparo pela interface** (com confirmação) | EM_REPARO → CONCLUIDA; evento REPARO | ✅ |
| 4.17 | ATD | Expedição com saldo de R$ 80 | Bloqueada: "A devolução exige a quitação… Saldo restante: R$ 80,00." | ✅ |
| 4.18 | ATD | Pagar R$ 80 e confirmar | Saldo R$ 0; a seção Expedição se atualiza sozinha e oferece "Registrar devolução" | ✅ |
| 4.19 | ATD | Registrar devolução por ENVIO | OS em AGUARDANDO_EXPEDICAO; "Pendente de envio" | ✅ |
| 4.20 | ATD | Marcar como despachado com rastreio | "Em trânsito", data e código exibidos | ✅ |
| 4.21 | ATD | Confirmar entrega | Expedição ENTREGUE; OS FINALIZADA | ✅ |
| 4.22 | ATD | Histórico da OS 1 | 19 eventos (7 de pagamento) em ordem, com autor e mudanças (criação → finalização) | ✅ |
| 4.23 | ATD | OS FINALIZADA | Pagamentos confirmados ainda mostram "Reembolsar" | ⚠️ comportamento atual da RN16 (sem restrição de etapa); ver O1 em `REGRAS_DECISOES_PENDENCIAS.md` |
| 4.24 | TEC | OS CONCLUIDA | "Editar diagnóstico e laudo" continua disponível | ⚠️ regra atual: edição bloqueada só em FINALIZADA e ENCERRADA_SEM_REPARO |

## 5. Encerramentos sem reparo

| # | Perfil | Passo | Esperado | Resultado |
|---|---|---|---|---|
| 5.1 | ATD | OS 2 em RECEBIDA: encerrar | Só "Desistência do cliente" é oferecida; OS encerrada com evento | ✅ |
| 5.2 | TEC | OS 3 em RECEBIDA: encerramento | Sem "Impossibilidade técnica" antes do diagnóstico | ✅ |
| 5.3 | TEC | OS 3: diagnóstico e depois "Impossibilidade técnica" com justificativa | ENCERRADA_SEM_REPARO; faixa com data, tipo e motivo; eventos DIAGNOSTICO e ENCERRAMENTO | ✅ |

## 6. Acesso direto à API com a sessão do técnico

| Requisição | Esperado | Resultado |
|---|---|---|
| `GET /ordens-servico/1/pagamentos` | 403 | ✅ 403 |
| `POST /ordens-servico/1/pagamentos` | 403 | ✅ 403 |
| `PATCH /pagamentos/2/status` | 403 | ✅ 403 |
| `PATCH /pagamentos/2/reembolso` | 403 | ✅ 403 |
| `GET /usuarios`, `PUT /usuarios/1`, `PATCH /usuarios/1/ativo` | 403 | ✅ 403 |
| `GET /ordens-servico/1/historico` | Sem eventos PAGAMENTO | ✅ 12 eventos, 0 PAGAMENTO (o atendente vê 19, sendo 7 de pagamento) |

## 7. Responsividade (375 px) e console

| Tela | Resultado |
|---|---|
| Início, Clientes, Nova solicitação, OS (aberta, finalizada e encerrada) | ✅ sem rolagem horizontal da página |
| Usuários | 🔧 a página ficava com 457 px: o rótulo oculto "Ações" (position: absolute) escapava da área de rolagem da tabela. Corrigido com `position: relative` em `.tabela-rolagem` (Usuários e Clientes). A tabela rola dentro do próprio painel |
| Console | Só os erros HTTP provocados de propósito (409, 403, 400) e 404 de "execução ainda não registrada", tratado pela tela |

## 8. Atualização dos dados após cada operação

Em todas as operações acima a tela recarregou a OS e as seções afetadas sem recarregar a página: situação no topo, totais de pagamento, disponibilidade da expedição e histórico.

## 9. Decisões de 09/11/2026 (segunda rodada) — validação no banco de teste

**Ambiente:** banco `assistencia_tecnica_teste` preparado pelo teste de integração (com as migrações pendentes aplicadas) e mantido para a validação; usuários de integração com a mesma senha de teste. Cenário criado pela API: OS 8 encerrada por impossibilidade técnica durante o reparo, com pagamento de R$ 200 confirmado; OS 9 em análise. O banco foi apagado depois.

| # | Perfil | Passo | Esperado | Resultado |
|---|---|---|---|---|
| 9.1 | ATD | Abrir OS 8 | Seção "Avaliação financeira" com "Avaliação obrigatória pendente"; "Reembolsar" desativado; aviso nos pagamentos | ✅ |
| 9.2 | ATD | Avaliação com R$ 250 | "Informe um valor entre R$ 0,00 e R$ 200,00." | ✅ |
| 9.3 | ATD | Avaliação de R$ 120 com justificativa → Continuar → Confirmar registro | Avaliação original vigente, com autor e data; "Reembolsar" liberado | ✅ |
| 9.4 | ATD | Reembolso de R$ 200 (antes do ajuste da tela) | API recusa: "O reembolso ultrapassa o valor definido na avaliação financeira (restam R$ 120,00)." | ✅ — 🔧 a tela passou a sugerir e limitar o valor ao permitido pela avaliação (R$ 120) |
| 9.5 | ATD | Reembolso parcial de R$ 80 | Pagamento continua confirmado; "Reembolsado R$ 80,00"; total pago R$ 120; avaliação: já reembolsado R$ 80, falta R$ 40 | ✅ |
| 9.6 | ATD | Revisão: R$ 200, justificativa e motivo | Faixa permitida R$ 80 a R$ 200; original marcada "Substituída", revisão "Vigente" com motivo | ✅ — 🔧 a dica "Zero registra…" aparecia mesmo com mínimo R$ 80; corrigida |
| 9.7 | ATD | Reembolso do restante (valor sugerido R$ 120) | Pagamento REEMBOLSADO com os dois reembolsos listados; total pago R$ 0 | ✅ |
| 9.8 | ATD | Histórico da OS 8 | Eventos de avaliação, reembolso parcial, revisão e conclusão do reembolso, com valores | ✅ — 🔧 o reembolso parcial mostrava "situação: CONFIRMADO → CONFIRMADO"; a situação só entra no evento quando muda |
| 9.9 | ATD | OS 9 (EM_ANALISE): registrar acessório sem escolher | "Escolha o acessório e informe uma quantidade inteira maior que zero." | ✅ |
| 9.10 | ATD | Registrar 2× Carregador com observação | Acessório listado; evento "Acessório" no histórico com quantidade e observação | ✅ |
| 9.11 | ATD | OS 8 (encerrada) | Sem "Registrar acessório" | ✅ |
| 9.12 | ATD | OS 8 em 375 px | Sem rolagem horizontal; seção de avaliação legível | ✅ |
| 9.13 | TEC | OS 8 | Sem seções de avaliação e pagamentos; histórico sem eventos de pagamento (8 eventos) | ✅ |
| 9.14 | TEC | Acesso direto: GET e POST `/ordens-servico/8/avaliacao-financeira` | 403 | ✅ |
| 9.15 | — | Console | Somente os erros HTTP provocados (409 e 403) | ✅ |

Regras sem tela própria, conferidas nos testes de integração reais (D10/Q1 incluída: retirada concluída com avaliação pendente, OS continua ENCERRADA_SEM_REPARO e o reembolso segue bloqueado até a avaliação): 5 avaliações simultâneas geram 1; 5 reembolsos simultâneos não ultrapassam o valor; técnico de outra OS recebe 403 ao registrar acessório; laudo editável em CONCLUIDA e AGUARDANDO_EXPEDICAO e bloqueado em FINALIZADA.

## 10. Alteração de acessórios (D7) e Q1 — validação no banco de teste

| # | Perfil | Passo | Esperado | Resultado |
|---|---|---|---|---|
| 10.1 | ATD | OS com avaliação pendente (encerrada por impossibilidade técnica) | Aviso "Pendência financeira" na expedição; "Registrar devolução" habilitado | ✅ |
| 10.2 | ATD | Registrar retirada e confirmar | Expedição "Retirado pelo cliente"; OS continua "Encerrada sem reparo"; "Reembolsar" continua desativado | ✅ |
| 10.3 | ATD | OS 3 (AGUARDANDO_APROVACAO): botão "Editar" em cada acessório | Formulário "Alterar acessório recebido" com os valores atuais | ✅ |
| 10.4 | ATD | Alterar quantidade 1 → 2 e observação | "Acessório recebido alterado."; lista atualizada; histórico "Acessório recebido nº 4 alterado." com "quantidade: 1 → 2" e "observações: — → Conferido na bancada" | ✅ |
| 10.5 | — | Acessibilidade | 🔧 os botões "Editar" tinham o mesmo nome acessível; agora incluem quantidade, descrição e nº do registro |

Regras conferidas nos testes automatizados (sem tela própria): bloqueio a partir de CONCLUIDA, técnico de outra OS (403), técnico sem relação (404), acessório de outro equipamento pela rota da OS (404), acessório inativo (409), alteração sem mudança não gera evento, não existe exclusão.

## 11. Abatimento formal (R1) — validação no banco de teste (09/11/2026)

**Cenário:** banco `assistencia_tecnica_teste` com as 4 migrações; OS 21 em EM_REPARO, orçamento aprovado de R$ 300, R$ 100 pagos.

| # | Perfil | Passo | Esperado | Resultado |
|---|---|---|---|---|
| 11.1 | ATD | Abrir a OS | Seção "Abatimentos" com o aviso "Não é reembolso"; "Registrar abatimento" disponível | ✅ |
| 11.2 | ATD | Abatimento de R$ 250 | "Informe um valor entre R$ 0,01 e R$ 200,00." (devido 300 − pago 100) | ✅ |
| 11.3 | ATD | Abatimento de R$ 50 com motivo → Continuar → Confirmar abatimento | "Abatimento registrado."; resumo: Orçamento aprovado R$ 300 · Abatimentos − R$ 50 · Total devido R$ 250 · Saldo R$ 150; histórico "total devido: 300 → 250", "saldo: 200 → 150" | ✅ |
| 11.4 | ATD | Cancelar sem justificativa | "Informe a justificativa do cancelamento." | ✅ |
| 11.5 | ATD | Cancelar com justificativa | Registro preservado ("Cancelado em … por … · justificativa"); total devido volta a R$ 300; histórico "APROVADO → CANCELADO", "total devido: 250 → 300" | ✅ |
| 11.6 | ATD | 375 px | Sem rolagem horizontal | ✅ |
| 11.7 | TEC | Mesma OS | Sem seção de abatimentos; `GET /abatimentos` → 403; nenhum evento `ABATIMENTO` no histórico | ✅ |

Entrega após quitação, abatimento integral, combinação com reembolso, limite com pendentes e concorrência estão cobertos pela integração real (`REGRAS_DECISOES_PENDENCIAS.md`, seção 3.5.10).
