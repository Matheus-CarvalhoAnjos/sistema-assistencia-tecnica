# Relatório — gravação das demonstrações (09/11/2026)

| Arquivo | Duração | Formato | Verificação |
|---|---|---|---|
| `01-utilizacao-administrativa.mp4` | 3 min 17 s | MP4 (H.264), 1920×1080, 16:9, 30 fps | Decodificado do início ao fim: 0 erros |
| `02-utilizacao-tecnico.mp4` | 2 min 23 s | MP4 (H.264), 1920×1080, 16:9, 30 fps | Decodificado do início ao fim: 0 erros |

## Ambiente utilizado

Os vídeos foram gravados com o **sistema real**:
- **Frontend:** build de produção do Angular, servida em `localhost:4300`.
- **API:** Node/Express em modo de teste, em `localhost:3100`.
- **Banco:** MySQL `assistencia_tecnica_teste`.
- **Navegador:** Google Chrome controlado pelo Playwright, com movimentos de mouse e digitação reais.

O frontend chama a API pelo caminho relativo `/api`, como na configuração de publicação.

**Por que um ambiente separado:**
- O **banco principal** `assistencia_tecnica` **não recebeu nenhum dado**: as gravações criam cliente, solicitação, OS, diagnóstico e orçamento.
- Os servidores que você deixou abertos no VS Code (portas 3000 e 4200) não foram tocados.

**Banco de demonstração:** antes da gravação, `assistencia_tecnica_teste` foi recriado com a estrutura atual do banco principal (17 tabelas) e com dados **fictícios**:
- 4 usuários: Carla Mendes (ADMINISTRADOR), Rafael Souza (ATENDENTE), Bruno Lima (TECNICO) e Juliana Prado (TECNICO);
- 5 acessórios;
- 2 clientes;
- a OS nº 1, atribuída a Juliana, usada para demonstrar a restrição de acesso.

Esse banco é descartável: a suíte de integração o recria a cada execução.

**Senhas:** são aleatórias e não aparecem nos vídeos (o campo de senha mostra apenas pontos). Elas não estão no projeto.

**Nenhum arquivo do projeto foi alterado** para gravar. Os scripts ficaram em uma pasta temporária, fora do projeto; a única coisa criada no projeto foi esta pasta `evidencias/`.

## Vídeo 1 — utilização administrativa (perfil ADMINISTRADOR: Carla Mendes)

| # | Etapa | Resultado |
|---|---|---|
| 1 | Navegador aberto e sistema acessado (tela de login "Link do Brasil") | ✅ |
| 2 | Login digitado e enviado | ✅ Redirecionou para "Visão geral" |
| 3 | Página inicial: tabela de OS e indicadores por situação | ✅ |
| 4 | Navegação pelo menu (Início, Clientes, Solicitações, Usuários) | ✅ |
| 5 | Clientes: consulta da lista (2 clientes) | ✅ |
| 6 | Cadastro do cliente fictício **Lucas Ferreira Rocha**: CPF, telefone e CEP com máscara aplicada durante a digitação | ✅ Cliente salvo e exibido |
| 7 | Solicitações → Nova solicitação | ✅ |
| 8–9 | Cliente buscado e selecionado; problema relatado; equipamento (Notebook Dell Inspiron 15 3520, nº de série, estado físico); acessório "Carregador original" | ✅ |
| 10 | "Abrir solicitação" | ✅ "Solicitação cadastrada com sucesso", com a **OS nº 2** gerada |
| 11 | OS nova na página inicial, "Recebida" e "Sem técnico" | ✅ |
| 12 | Detalhes da OS (equipamento, acessórios, cliente, atendimento) | ✅ |
| 13 | Atribuição do técnico **Bruno Lima** | ✅ Mensagem "Técnico Bruno Lima atribuído." e técnico responsável atualizado |

## Vídeo 2 — utilização do técnico (perfil TECNICO: Bruno Lima)

| # | Etapa | Resultado |
|---|---|---|
| 1–2 | Navegador aberto e login do técnico | ✅ |
| 3–4 | "Minhas Ordens de Serviço": só a OS atribuída a ele (nº 2); menu apenas com "Início" | ✅ |
| 5–6 | OS nº 2 aberta; dados do equipamento, acessórios e atendimento consultados | ✅ |
| 7–8 | Diagnóstico digitado e registrado | ✅ "Diagnóstico registrado. A OS passou para análise." |
| 9 | Status da OS atualizado | ✅ Recebida → **Em análise** |
| 10a | Garantia verificada: "Fora da garantia" | ✅ "Garantia registrada: Fora da garantia." |
| 10b | Orçamento emitido com 2 itens: peça "Ventoinha do processador" R$ 180,00 e serviço "Limpeza interna e troca da pasta térmica" R$ 120,00 | ✅ Total R$ 300,00; OS em **Aguardando aprovação** |
| 10c | Histórico da OS consultado | ✅ |
| R1 | Menu sem Solicitações e Clientes | ✅ |
| R2 | Acesso direto pelo endereço `/solicitacoes/nova` | ✅ Redirecionado para o início |
| R3 | Acesso direto pelo endereço à **OS nº 1**, da técnica Juliana | ✅ "Ordem de Serviço não encontrada — Ela não existe ou não está disponível para o seu perfil" |
| — | Logout ("Sair") | ✅ Voltou para a tela de login |

## Operações confirmadas no banco de dados (após as gravações)

Conferido diretamente no MySQL; não é só o que a tela mostra.

- **Cliente:** "Lucas Ferreira Rocha" cadastrado.
- **OS nº 2:**
  - técnico Bruno Lima;
  - status `AGUARDANDO_APROVACAO`;
  - garantia `NAO`;
  - diagnóstico gravado;
  - acessório recebido: 1× "Carregador original".
- **Orçamento da OS nº 2:** `PENDENTE`, valor total **R$ 300,00**.
  - Itens: PEÇA 1 × R$ 180,00 e SERVIÇO 1 × R$ 120,00.
- **Histórico da OS nº 2**, em ordem: CRIACAO → ATRIBUICAO_TECNICO → DIAGNOSTICO → GARANTIA → ORCAMENTO.
- **OS nº 1** (de Juliana): não foi alterada pelo técnico Bruno.

## Funcionalidades indisponíveis ou não demonstradas

- **Busca global e notificações do cabeçalho:** indisponíveis nesta versão; aparecem desativadas.
- **Aprovação do orçamento, pagamentos, abatimentos e expedição:** implementados, mas fora do roteiro pedido. O vídeo 2 termina com o orçamento aguardando a aprovação do cliente.
- **Consulta de solicitações:** a área de Solicitações só abre novas solicitações; a consulta é feita pelas Ordens de Serviço na página inicial. Por isso, a OS gerada foi aberta a partir do "Início" (a tela de resultado da solicitação mostra o número da OS, mas não tem link para ela).

## Erros e limitações encontrados

1. **Histórico não se atualiza após a atribuição de técnico (sistema).** Após "Atribuir", a mensagem de sucesso e o técnico responsável são atualizados na hora. A seção **Histórico**, porém, só mostra o evento ao reabrir a OS. O evento é gravado no banco, como confirmado. Não corrigi porque o pedido era não alterar funcionalidades para gravar. A correção é simples: recarregar o histórico após a atribuição.
2. **Erros 404 no console (esperados, sem efeito na tela):**
   - `GET /ordens-servico/2/execucao` antes do diagnóstico: a API responde 404 quando ainda não há diagnóstico.
   - `GET /ordens-servico/1` pelo técnico: o bloqueio de acesso responde 404 por decisão de projeto.
3. **Problemas da gravação, corrigidos antes da versão final** (não são do sistema):
   - o servidor estático enviava HTML no lugar dos arquivos `.js`;
   - na primeira gravação do vídeo 2, a rolagem do mouse sobre um campo numérico com foco alterou os valores do orçamento para R$ 179,60 e R$ 119,60. A gravação foi descartada; o roteiro passou a tirar o foco antes de rolar, e os **dois vídeos foram regravados** a partir de um banco recriado.
4. **Características da gravação:**
   - **Cursor:** o Playwright não move o cursor do sistema operacional, então o cursor e o destaque amarelo dos cliques são desenhados sobre a página e acompanham os eventos reais de mouse enviados ao navegador.
   - **Barra de endereços:** a gravação mostra só a área da página, sem a barra do navegador. Um pequeno indicador no canto inferior esquerdo mostra o endereço atual, para deixar visíveis as tentativas de acesso por URL.
   - **Listas de seleção:** a lista nativa de opções de um `<select>` não aparece em gravação; o vídeo mostra o clique no campo e o valor escolhido.

## Resultado dos testes

- **Vídeo 1:** 8/8 etapas verificadas com sucesso.
- **Vídeo 2:** 10/10 etapas verificadas com sucesso.
- Todas as operações foram conferidas no banco de demonstração.
- **Arquivos:** os dois MP4 foram gerados em 1920×1080 e decodificados por completo sem erros.
- **Banco principal:** não alterado.
