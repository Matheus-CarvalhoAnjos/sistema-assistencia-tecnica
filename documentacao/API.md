# API REST — Sistema de Assistência Técnica

Base: `http://localhost:3000/api`. Todas as rotas, exceto o login, exigem `Authorization: Bearer <token>`.

> **Banco exigido por esta versão:** as rotas de pagamentos, avaliação financeira e acessórios dependem das migrações pendentes (`banco/migracoes/pendentes.json`), hoje executadas somente em bancos `_teste`. Ver `MIGRACOES_BACKUP_RECUPERACAO.md`.

**Convenções**
- **Usuário e perfil:** o perfil vem do banco a cada requisição, não do token. Usuário desativado recebe 401.
- **Erros:** `400` dados inválidos · `401` sem autenticação · `403` perfil sem permissão · `404` não encontrado (também quando o técnico tenta abrir uma OS que não é dele) · `409` regra de negócio ou etapa incompatível · `429` excesso de tentativas de login. `413` corpo acima de 100 kB. O corpo do erro é sempre `{ "mensagem": "..." }`, inclusive para rota inexistente (`404` "Rota não encontrada.") e JSON malformado (`400` "O corpo da requisição não é um JSON válido."), sem detalhes internos. As respostas não trazem `X-Powered-By` e incluem cabeçalhos básicos de segurança (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`).
- **Siglas de perfil:** ADM = ADMINISTRADOR · ATD = ATENDENTE · TEC = TECNICO. "TEC atribuído" significa o técnico da OS; para os demais técnicos a OS responde 404.

## Autenticação
| Método | Rota | Perfis | Corpo / observação |
|---|---|---|---|
| POST | `/auth/login` | — | `{ email, senha }` → `{ usuario, token }`. Limite de tentativas com falha por IP |
| GET | `/auth/teste` | autenticado | Confere o token |

## Usuários, clientes e acessórios
| Método | Rota | Perfis | Observação |
|---|---|---|---|
| GET | `/usuarios?perfil=&ativo=1\|0` | ADM, ATD | Lista (filtros opcionais). Nunca devolve `senha` nem `senha_hash` |
| GET | `/usuarios/:id` | ADM, ATD | |
| POST | `/usuarios` | ADM | `{ nome, email, perfil, senha }`. Senha de **8 a 72 caracteres** (400 fora disso); gravada só como hash (bcrypt); e-mail único (409) |
| PUT | `/usuarios/:id` | ADM | `{ nome, email, perfil, senha? }`. Sem `senha`, mantém a atual; nova senha segue a mesma regra de 8 a 72 caracteres. O login não aplica a regra (contas existentes continuam entrando). Rebaixar o último administrador ativo → 409 |
| PATCH | `/usuarios/:id/ativo` | ADM | `{ ativo: true \| false }`. Desativar o último administrador ativo (inclusive a si mesmo) → 409 "O sistema precisa de ao menos um administrador ativo." Usuário inativo não entra (403 no login, 401 nas demais rotas) |
| GET | `/clientes?busca=` | ADM, ATD | Busca por nome ou documento |
| GET | `/clientes/:id` | ADM, ATD | |
| POST · PUT | `/clientes` · `/clientes/:id` | ADM, ATD | E-mail opcional; CPF/CNPJ único (409) |
| GET | `/acessorios` · `/acessorios/:id` | todos | Catálogo (ativos) |
| POST | `/acessorios` | ADM, ATD | `{ descricao, preco_atual? }` |
| POST | `/acessorios-recebidos` | ADM, ATD; TEC só na OS atual do item atribuída a ele (outra → 403) | `{ id_item, id_acessorio, quantidade?, observacoes? }` ou lista. **D7:** a OS atual do equipamento precisa estar em RECEBIDA, EM_ANALISE, AGUARDANDO_APROVACAO ou EM_REPARO (senão 409). Lote validado antes e gravado em uma transação; acessório inativo → 409 e nada é gravado. Cada inclusão gera evento `ACESSORIO` na OS atual do equipamento |
| PATCH | `/acessorios-recebidos/:id` | ADM, ATD; TEC só na OS atual do item atribuída a ele (outra → 403; sem relação → 404) | `{ id_acessorio?, quantidade?, observacoes? }`. **D7 (alteração):** mesmas etapas da inclusão (a partir de CONCLUIDA → 409); acessório novo precisa estar ativo (409). Grava evento `ACESSORIO` com valores anteriores e novos só dos campos alterados; sem mudança → 200 "Nenhuma alteração." sem evento. **Não há exclusão** |
| GET | `/acessorios-recebidos/item/:id_item` | todos | |

## Solicitações
| Método | Rota | Perfis | Observação |
|---|---|---|---|
| POST | `/solicitacoes` | ADM, ATD | `{ id_cliente, descricao_inicial, itens: [{ tipo_equipamento, marca, modelo, estado_fisico, numero_serie?, observacoes?, acessorios?: [{ id_acessorio, quantidade, observacoes? }] }] }`. Uma transação cria a solicitação, os itens, uma OS por item (RECEBIDA, garantia PENDENTE) e os acessórios. Atendente vem do token. **Sem `status` (RN22)** |
| GET | `/solicitacoes` · `/solicitacoes/:id` | ADM, ATD | O detalhe traz `itens[].acessorios` e `itens[].ordens_servico` |

## Ordens de Serviço
| Método | Rota | Perfis | Corpo / regra |
|---|---|---|---|
| GET | `/ordens-servico?status=&id_tecnico=&sem_tecnico=true&busca=` | todos | O técnico só recebe as próprias OS |
| GET | `/ordens-servico/:id` | todos (TEC atribuído) | Detalhes, inclui `tipo_encerramento` |
| POST | `/ordens-servico` | ADM, ATD | `{ id_item, id_tecnico? }`. Nova OS para um equipamento sem OS ativa; **herda a garantia** da OS anterior do mesmo item (RN05) |
| PATCH | `/ordens-servico/:id/tecnico` | ADM, ATD | `{ id_tecnico }`, somente técnico ativo; OS encerrada → 409 |
| PATCH | `/ordens-servico/:id/garantia` | TEC atribuído (ADM/ATD → 403; outro TEC → 404) | `{ garantia_status: "SIM" \| "NAO" }`, **somente em EM_ANALISE** e antes da emissão do orçamento (RN06; depois → 409); correções SIM ↔ NAO ficam no histórico; PENDENTE → 400. A etapa da OS não muda: com SIM o atendimento segue para o orçamento (serviços a R$ 0,00, peças cobradas) |
| PATCH | `/ordens-servico/:id/encerramento` | ADM, ATD, TEC atribuído | `{ tipo_encerramento, motivo_encerramento }`. `IMPOSSIBILIDADE_TECNICA`: só TEC, exige diagnóstico, até EM_REPARO. `DESISTENCIA_CLIENTE`: em RECEBIDA, EM_ANALISE ou AGUARDANDO_APROVACAO. Cancela orçamentos e pagamentos PENDENTE. Resposta: `{ encerramento: { orcamentos_cancelados, pagamentos_cancelados }, ordem }` |
| GET | `/ordens-servico/:id/historico` | todos (TEC atribuído) | Eventos em ordem cronológica (RN21). Somente leitura. Para o técnico, os eventos `PAGAMENTO` são omitidos |
| PATCH | `/ordens-servico/:id/acessorios/:id_acessorio_recebido` | todos (TEC atribuído) | Mesmas regras do `PATCH /acessorios-recebidos/:id`, com a OS da URL; acessório de outro equipamento → 404 |
| GET · POST | `/ordens-servico/:id/acessorios` | todos (TEC atribuído) | Acessórios do equipamento da OS. POST: mesmas regras de `/acessorios-recebidos` (D7), com a OS da URL; a etapa e o técnico são conferidos com a OS bloqueada |

### Execução técnica (diagnóstico, laudo, reparo)
| Método | Rota | Perfis | Corpo / regra |
|---|---|---|---|
| GET | `/ordens-servico/:id_os/execucao` | todos (TEC atribuído) | 404 quando ainda não há diagnóstico |
| POST | `/ordens-servico/:id_os/execucao` | TEC atribuído | `{ diagnostico }`. Primeiro diagnóstico: RECEBIDA → EM_ANALISE (RN03) |
| PATCH | `/ordens-servico/:id_os/execucao` | TEC atualmente atribuído | `{ diagnostico?, laudo_tecnico?, resultado?, data_conclusao? }`. **D8:** permitido até a OS ser FINALIZADA (inclusive CONCLUIDA e AGUARDANDO_EXPEDICAO); FINALIZADA ou ENCERRADA_SEM_REPARO → 409; técnico trocado → 403 (conferido com a OS bloqueada). Evento DIAGNOSTICO com valores anteriores e novos |
| PATCH | `/ordens-servico/:id_os/execucao/concluir` | ADM, TEC atribuído | EM_REPARO → CONCLUIDA; exige `data_conclusao` |

### Orçamentos
| Método | Rota | Perfis | Corpo / regra |
|---|---|---|---|
| GET | `/ordens-servico/:id_os/orcamentos[/:id_orcamento]` | todos (TEC atribuído) | Com itens e resposta. Marca os vencidos (evento automático) |
| POST | `/ordens-servico/:id_os/orcamentos` | ADM, TEC atribuído | `{ itens: [{ tipo_item: "PECA" \| "SERVICO", descricao, quantidade, valor_unitario }] }`. Exige diagnóstico e garantia definida; **um PENDENTE por vez** (409); validade de 72 h; serviço em garantia sai a R$ 0 |
| PATCH | `/orcamentos/:id_orcamento/resposta` | ADM, ATD | `{ decisao: "APROVADO" \| "REJEITADO", observacoes? }`. APROVADO → EM_REPARO; REJEITADO → ENCERRADA_SEM_REPARO (tipo ORCAMENTO_REJEITADO) |

### Pagamentos
| Método | Rota | Perfis | Corpo / regra |
|---|---|---|---|
| GET | `/ordens-servico/:id_os/pagamentos` | ADM, ATD (TEC → 403) | `{ pagamentos, resumo: { total_orcado, total_pago, pagamentos_pendentes, saldo_devedor } }`. Cada pagamento traz `reembolsos[]`, `valor_reembolsado` e `valor_disponivel_reembolso`. **R6:** total pago = confirmados − reembolsos (calculado na hora) |
| POST | `/ordens-servico/:id_os/pagamentos` | ADM, ATD | `{ valor, forma_pagamento: PIX \| DINHEIRO \| CARTAO_DEBITO \| CARTAO_CREDITO \| TRANSFERENCIA }`. Fica PENDENTE; não pode ultrapassar o saldo menos os pendentes (409) |
| PATCH | `/pagamentos/:id_pagamento/status` | ADM, ATD | `{ status: "CONFIRMADO" \| "CANCELADO" }`. Confirmação grava `data_pagamento`; recusada em OS encerrada sem reparo (RN13) |
| PATCH | `/pagamentos/:id_pagamento/reembolso` | ADM, ATD | `{ justificativa_reembolso, valor? }`. **D5/D6:** parcial ou integral; sem `valor`, devolve todo o disponível do pagamento; acima do disponível → 409. Somente CONFIRMADO; vira REEMBOLSADO quando a soma devolvida atinge o valor. Permitido em qualquer etapa (inclusive FINALIZADA), sem automação. Em OS que exige avaliação financeira: só depois dela e até o valor definido vigente (409) |

### Abatimentos (R1)
Especificação: `REGRAS_DECISOES_PENDENCIAS.md`, seção 3.5. Implementado e validado em ambiente de teste; exige a migração `20261109_04_abatimento_formal.sql`.

| Método | Rota | Perfis | Corpo / regra prevista |
|---|---|---|---|
| GET | `/ordens-servico/:id_os/abatimentos` | ADM, ATD (TEC → 403) | Abatimentos da OS (aprovados e cancelados) |
| POST | `/ordens-servico/:id_os/abatimentos` | ADM, ATD | `{ valor, motivo }`. Nasce APROVADO (A1). OS em EM_REPARO, CONCLUIDA ou AGUARDANDO_EXPEDICAO com orçamento aprovado (senão 409). Valor ≤ total devido − total pago − pagamentos pendentes (409). OS bloqueada; evento `ABATIMENTO` |
| PATCH | `/abatimentos/:id_abatimento/cancelamento` | ADM, ATD ativos, qualquer autor (C1); TEC → 403 | `{ justificativa }`. Antes da entrega ou retirada; o registro é preservado; evento `ABATIMENTO` |

O resumo de `GET /ordens-servico/:id_os/pagamentos` traz `total_orcado` (total original), `total_abatido`, `total_devido`, `total_pago`, `pagamentos_pendentes` e `saldo_devedor` (= devido − pago). Os limites de pagamento e confirmação (RN15) e a quitação da expedição (RN20) usam o total devido.

### Avaliação financeira (D1–D4)
| Método | Rota | Perfis | Corpo / regra |
|---|---|---|---|
| GET | `/ordens-servico/:id_os/avaliacao-financeira` | ADM, ATD (TEC → 403) | `{ obrigatoria, pendente, vigente, avaliacoes[], total_disponivel, total_reembolsado_avaliacao, saldo_a_reembolsar }`. Obrigatória quando a OS foi encerrada por IMPOSSIBILIDADE_TECNICA com orçamento APROVADO (EM_REPARO) e pagamento CONFIRMADO |
| POST | `/ordens-servico/:id_os/avaliacao-financeira` | ADM, ATD | `{ valor_definido, justificativa }`. Valor de 0 até o disponível para devolução; uma original por OS (409; garantido também por UNIQUE no banco); OS sem obrigação → 409 |
| POST | `/ordens-servico/:id_os/avaliacao-financeira/revisoes` | ADM, ATD | `{ id_avaliacao_revisada, valor_definido, justificativa, motivo_revisao }`. Revisa a avaliação **vigente** (outra → 409); valor entre o já reembolsado e esse valor + o disponível. Nenhum registro é alterado ou excluído |

### Expedição
| Método | Rota | Perfis | Corpo / regra |
|---|---|---|---|
| GET | `/ordens-servico/:id_os/expedicao` | todos (TEC atribuído) | `null` quando não há |
| POST | `/ordens-servico/:id_os/expedicao` | ADM, ATD | `{ forma_entrega: "RETIRADA" \| "ENVIO", codigo_rastreio? }`. OS CONCLUIDA (exige quitação) ou ENCERRADA_SEM_REPARO; uma por OS |
| PATCH | `/expedicoes/:id_os/status` | ADM, ATD | `{ status, codigo_rastreio? }`. ENVIO: PENDENTE → EM_TRANSITO → ENTREGUE. RETIRADA: AGUARDANDO_RETIRADA → RETIRADO. Na conclusão, a OS reparada fica FINALIZADA (exige saldo zero) e a OS sem reparo continua ENCERRADA_SEM_REPARO. **D10:** a avaliação financeira pendente não bloqueia registro, atualização nem conclusão da expedição |

## Histórico (eventos gravados)
Cada operação grava os próprios eventos **na mesma transação**: CRIACAO, ATRIBUICAO_TECNICO, DIAGNOSTICO, GARANTIA, ORCAMENTO (emissão, aprovação, rejeição, vencimento automático, cancelamento), REPARO (início e conclusão), ENCERRAMENTO, PAGAMENTO (registro, confirmação, cancelamento, reembolso parcial ou integral, avaliação financeira e revisão), EXPEDICAO e ACESSORIO (inclusão e alteração depois da abertura; exige a migração do ENUM). ABATIMENTO (registro e cancelamento de abatimentos, com total devido e saldo antes e depois; oculto do técnico; exige a migração 4). Operações recusadas ou sem mudança não geram eventos.
