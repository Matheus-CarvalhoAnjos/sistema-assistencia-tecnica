/*
 * Testes da abertura de solicitações (equipamentos, OS e acessórios recebidos).
 * Usam repositories e conexão simulados: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const { pool } = require("../src/config/database");
const solicitacaoRepository = require("../src/repositories/solicitacaoRepository");
const solicitacaoService = require("../src/services/solicitacaoService");
const clienteRepository = require("../src/repositories/clienteRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const acessorioRepository = require("../src/repositories/acessorioRepository");

function substituirMetodos(teste, alvo, substitutos) {
    const originais = {};

    for (const [nome, metodo] of Object.entries(substitutos)) {
        originais[nome] = alvo[nome];
        alvo[nome] = metodo;
    }

    teste.after(() => {
        Object.assign(alvo, originais);
    });
}

function equipamento(alteracoes = {}) {
    return {
        tipo_equipamento: " Notebook ",
        marca: "Dell",
        modelo: "Inspiron 15",
        estado_fisico: "Arranhões na tampa",
        ...alteracoes
    };
}

function solicitacao(alteracoes = {}) {
    return {
        id_cliente: 1,
        id_atendente: 6,
        descricao_inicial: "  Não liga  ",
        itens: [equipamento()],
        ...alteracoes
    };
}

const ACESSORIOS = {
    3: { id_acessorio: 3, descricao: "Carregador", ativo: 1 },
    4: { id_acessorio: 4, descricao: "Cabo de força", ativo: 1 },
    5: { id_acessorio: 5, descricao: "Bolsa", ativo: 0 }
};

// Cliente, atendente e catálogo simulados; a gravação é capturada
function simularDependencias(teste) {
    const gravacoes = [];

    substituirMetodos(teste, clienteRepository, {
        buscarPorId: async (id) => (id === 1 ? { id_cliente: 1 } : null)
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => ({
            5: { id_usuario: 5, perfil: "ADMINISTRADOR", ativo: 1 },
            6: { id_usuario: 6, perfil: "ATENDENTE", ativo: 1 },
            7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 }
        })[id] ?? null
    });
    substituirMetodos(teste, acessorioRepository, {
        buscarPorId: async (id) => ACESSORIOS[id] ?? null
    });
    substituirMetodos(teste, solicitacaoRepository, {
        criar: async (dados) => {
            gravacoes.push(dados);
            return dados;
        }
    });

    return gravacoes;
}

async function esperarStatus(promessa, status, trecho) {
    await assert.rejects(promessa, (erro) => {
        assert.equal(erro.statusCode, status);
        if (trecho) {
            assert.match(erro.message, trecho);
        }
        return true;
    });
}

// ---------- Service ----------

test("one equipment: data is trimmed and warranty starts as PENDENTE", async (teste) => {
    const gravacoes = simularDependencias(teste);

    await solicitacaoService.criar(solicitacao({
        itens: [equipamento({ garantia_status: "SIM", numero_serie: "  ", observacoes: " frágil " })]
    }));

    const dados = gravacoes[0];
    assert.equal(dados.descricao_inicial, "Não liga");
    assert.equal(dados.itens.length, 1);
    assert.equal(dados.itens[0].tipo_equipamento, "Notebook");
    assert.equal(dados.itens[0].garantia_status, "PENDENTE");
    assert.equal(dados.itens[0].numero_serie, null);
    assert.equal(dados.itens[0].observacoes, "frágil");
    assert.deepEqual(dados.itens[0].acessorios, []);
});

test("several equipments, each with its own accessories and descriptions", async (teste) => {
    const gravacoes = simularDependencias(teste);

    await solicitacaoService.criar(solicitacao({
        itens: [
            equipamento({
                acessorios: [
                    { id_acessorio: 3, quantidade: 1, observacoes: "original" },
                    { id_acessorio: 4 },
                    { id_acessorio: 3, quantidade: 2 }
                ]
            }),
            equipamento({ tipo_equipamento: "Impressora" }),
            equipamento({ tipo_equipamento: "Monitor", acessorios: [{ id_acessorio: 4, quantidade: 2 }] })
        ]
    }));

    // O acessório 3 aparece duas vezes: cada ocorrência vira um registro próprio
    const [primeiro, segundo, terceiro] = gravacoes[0].itens;
    assert.deepEqual(primeiro.acessorios, [
        { id_acessorio: 3, quantidade: 1, observacoes: "original", descricao_acessorio: "Carregador" },
        { id_acessorio: 4, quantidade: 1, observacoes: null, descricao_acessorio: "Cabo de força" },
        { id_acessorio: 3, quantidade: 2, observacoes: null, descricao_acessorio: "Carregador" }
    ]);
    assert.deepEqual(segundo.acessorios, []);
    assert.equal(terceiro.acessorios[0].quantidade, 2);
});

test("missing client returns 404 and nothing is recorded", async (teste) => {
    const gravacoes = simularDependencias(teste);

    await esperarStatus(solicitacaoService.criar(solicitacao({ id_cliente: 99 })), 404, /Cliente/);
    await esperarStatus(solicitacaoService.criar(solicitacao({ id_cliente: "abc" })), 400);
    assert.equal(gravacoes.length, 0);
});

test("invalid data returns 400 before touching the database", async (teste) => {
    const gravacoes = simularDependencias(teste);
    const casos = [
        solicitacao({ itens: [] }),
        solicitacao({ descricao_inicial: "  " }),
        solicitacao({ itens: [equipamento({ marca: "" })] }),
        solicitacao({ itens: [equipamento({ estado_fisico: undefined })] }),
        solicitacao({ itens: [equipamento({ modelo: "m".repeat(101) })] }),
        solicitacao({ itens: [equipamento({ numero_serie: 123 })] }),
        solicitacao({ itens: [equipamento({ acessorios: "carregador" })] }),
        solicitacao({ itens: [equipamento({ acessorios: [{ id_acessorio: 3, quantidade: 0 }] })] }),
        solicitacao({ itens: [equipamento({ acessorios: [{ id_acessorio: "x" }] })] }),
        solicitacao({ itens: Array.from({ length: 21 }, () => equipamento()) })
    ];

    for (const caso of casos) {
        await esperarStatus(solicitacaoService.criar(caso), 400);
    }
    assert.equal(gravacoes.length, 0);
});

test("unknown accessory returns 404 and inactive accessory returns 409", async (teste) => {
    const gravacoes = simularDependencias(teste);

    await esperarStatus(
        solicitacaoService.criar(solicitacao({ itens: [equipamento({ acessorios: [{ id_acessorio: 77 }] })] })),
        404,
        /Acessório/
    );
    await esperarStatus(
        solicitacaoService.criar(solicitacao({ itens: [equipamento({ acessorios: [{ id_acessorio: 5 }] })] })),
        409,
        /Bolsa/
    );
    assert.equal(gravacoes.length, 0);
});

test("a technician cannot open a request even calling the service directly", async (teste) => {
    simularDependencias(teste);
    await esperarStatus(solicitacaoService.criar(solicitacao({ id_atendente: 7 })), 403);
});

// ---------- Repository: transação ----------

function conexaoSimulada({ falharNaOs } = {}) {
    const comandos = [];
    let proximoId = 100;
    let osCriadas = 0;

    return {
        comandos,
        conexao: {
            beginTransaction: async () => comandos.push("BEGIN"),
            commit: async () => comandos.push("COMMIT"),
            rollback: async () => comandos.push("ROLLBACK"),
            release: () => comandos.push("RELEASE"),
            execute: async (sql, parametros) => {
                const tabela = (sql.match(/INSERT INTO (\w+)/) || [])[1];
                comandos.push({ tabela: tabela ?? "SELECT", parametros });

                if (tabela === "ordem_servico") {
                    osCriadas += 1;
                    if (falharNaOs === osCriadas) {
                        throw new Error("falha simulada no banco");
                    }
                }
                if (!tabela) {
                    return [[{ data_abertura: "2026-11-07T12:00:00.000Z" }]];
                }
                proximoId += 1;
                return [{ insertId: proximoId }];
            }
        }
    };
}

const dadosValidados = {
    id_cliente: 1,
    id_atendente: 6,
    descricao_inicial: "Não liga",
    itens: [
        {
            tipo_equipamento: "Notebook", marca: "Dell", modelo: "X", estado_fisico: "ok",
            numero_serie: null, observacoes: null, garantia_status: "PENDENTE",
            acessorios: [
                { id_acessorio: 3, quantidade: 1, observacoes: null, descricao_acessorio: "Carregador" },
                { id_acessorio: 4, quantidade: 2, observacoes: null, descricao_acessorio: "Cabo" }
            ]
        },
        {
            tipo_equipamento: "Impressora", marca: "HP", modelo: "Y", estado_fisico: "ok",
            numero_serie: null, observacoes: null, garantia_status: "PENDENTE", acessorios: []
        }
    ]
};

test("records request, items, one OS per item and accessories in one transaction", async (teste) => {
    const simulada = conexaoSimulada();
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

    const resultado = await solicitacaoRepository.criar(dadosValidados);

    const tabelas = simulada.comandos.map((c) => (typeof c === "string" ? c : c.tabela));
    assert.deepEqual(tabelas, [
        "BEGIN",
        "solicitacao",
        "item_solicitacao", "ordem_servico", "historico_os", "acessorio_recebido", "acessorio_recebido",
        "item_solicitacao", "ordem_servico", "historico_os",
        "SELECT",
        "COMMIT",
        "RELEASE"
    ]);

    // Cada OS e cada acessório apontam para o item recém-criado
    const [, , item1, os1, hist1, ac1, ac2, item2, os2, hist2] = simulada.comandos;
    assert.equal(item1.parametros[0], 101);
    assert.equal(os1.parametros[0], 102);
    assert.equal(os1.parametros[1], null);
    assert.equal(os1.parametros[2], "RECEBIDA");
    assert.equal(ac1.parametros[0], 102);
    assert.equal(ac2.parametros[0], 102);
    assert.equal(os2.parametros[0], 107);
    assert.equal(item2.parametros[0], 101);

    // RN21: um evento CRIACAO por OS, cada um apontando para a sua OS
    assert.deepEqual([hist1.parametros[0], hist1.parametros[2]], [103, "CRIACAO"]);
    assert.deepEqual([hist2.parametros[0], hist2.parametros[2]], [108, "CRIACAO"]);
    assert.equal(hist1.parametros[1], 6);

    // Resposta com o número da OS de cada equipamento e o status real do banco
    // RN22: a solicitação não tem status próprio (o andamento é o das OS)
    assert.equal("status" in resultado, false);
    assert.equal(resultado.data_abertura, "2026-11-07T12:00:00.000Z");
    assert.equal(resultado.itens[0].id_os, 103);
    assert.equal(resultado.itens[0].acessorios.length, 2);
    assert.equal(resultado.itens[0].acessorios[0].descricao_acessorio, "Carregador");
    assert.equal(resultado.itens[1].id_os, 108);
});

test("warranty status is stored on each OS, not on the equipment", async (teste) => {
    const simulada = conexaoSimulada();
    const comandosSql = [];
    const executarOriginal = simulada.conexao.execute;
    simulada.conexao.execute = async (sql, parametros) => {
        comandosSql.push({ sql, parametros });
        return executarOriginal(sql, parametros);
    };
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

    await solicitacaoRepository.criar(dadosValidados);

    const insercoesItem = comandosSql.filter(({ sql }) => sql.includes("INSERT INTO item_solicitacao"));
    const insercoesOs = comandosSql.filter(({ sql }) => sql.includes("INSERT INTO ordem_servico"));

    assert.equal(insercoesItem.length, 2);
    assert.equal(insercoesOs.length, 2);

    for (const { sql } of insercoesItem) {
        assert.ok(!sql.includes("garantia_status"));
    }

    for (const { sql, parametros } of insercoesOs) {
        assert.ok(sql.includes("garantia_status"));
        assert.equal(parametros[3], "PENDENTE");
    }
});

test("a failure while creating the second OS rolls everything back", async (teste) => {
    const simulada = conexaoSimulada({ falharNaOs: 2 });
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(solicitacaoRepository.criar(dadosValidados), /falha simulada/);

    assert.ok(simulada.comandos.includes("ROLLBACK"));
    assert.ok(!simulada.comandos.includes("COMMIT"));
    assert.equal(simulada.comandos.at(-1), "RELEASE");
});

// ---------- Autorização (HTTP, sem banco) ----------

test("technician gets 403 on every request route; attendant id comes from the token", async (teste) => {
    const gravacoes = simularDependencias(teste);

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const base = `http://127.0.0.1:${servidor.address().port}/api/solicitacoes`;

    const token = (id, perfil) => `Bearer ${jwt.sign({ id_usuario: id, perfil }, process.env.JWT_SECRET)}`;
    const chamar = (metodo, caminho, autorizacao, corpo) => fetch(base + caminho, {
        method: metodo,
        headers: { "Content-Type": "application/json", Authorization: autorizacao },
        body: corpo ? JSON.stringify(corpo) : undefined
    });

    for (const [metodo, caminho] of [["POST", ""], ["GET", ""], ["GET", "/1"]]) {
        const corpo = metodo === "POST" ? solicitacao() : undefined;
        const resposta = await chamar(metodo, caminho, token(7, "TECNICO"), corpo);
        assert.equal(resposta.status, 403, `TECNICO ${metodo} ${caminho}`);
    }

    // id_atendente enviado no corpo é ignorado: vale o usuário do token (6)
    const resposta = await chamar("POST", "", token(6, "ATENDENTE"), solicitacao({ id_atendente: 5 }));
    assert.equal(resposta.status, 201);
    assert.equal(gravacoes.at(-1).id_atendente, 6);
});

// =====================================================================
// Cenários de auditoria (A a G): service + repository com banco simulado
// =====================================================================

// Banco simulado com transação: as linhas só ficam gravadas após o COMMIT
function bancoTransacional({ falharEm } = {}) {
    const gravados = { solicitacao: [], item_solicitacao: [], ordem_servico: [], acessorio_recebido: [], historico_os: [] };
    const comandos = [];
    let pendentes = [];
    let proximoId = 0;
    let insercoes = 0;

    const colunas = {
        solicitacao: ["id_cliente", "id_atendente", "descricao_inicial"],
        item_solicitacao: ["id_solicitacao", "tipo_equipamento", "marca", "modelo", "numero_serie", "estado_fisico", "observacoes"],
        ordem_servico: ["id_item", "id_tecnico", "status", "garantia_status"],
        acessorio_recebido: ["id_item", "id_acessorio", "quantidade", "observacoes"],
        historico_os: ["id_os", "id_usuario", "tipo_evento", "descricao", "dados_anteriores", "dados_novos"]
    };

    const conexao = {
        beginTransaction: async () => comandos.push("BEGIN"),
        commit: async () => {
            comandos.push("COMMIT");
            for (const { tabela, linha } of pendentes) {
                gravados[tabela].push(linha);
            }
            pendentes = [];
        },
        rollback: async () => {
            comandos.push("ROLLBACK");
            pendentes = [];
        },
        release: () => comandos.push("RELEASE"),
        execute: async (sql, parametros) => {
            const tabela = (sql.match(/INSERT INTO (\w+)/) || [])[1];

            if (!tabela) {
                return [[{ data_abertura: "2026-11-08T12:00:00.000Z" }]];
            }

            insercoes += 1;
            if (falharEm && falharEm.tabela === tabela && falharEm.vez === insercoes) {
                throw new Error("falha simulada no banco");
            }

            const linha = { id: ++proximoId };
            colunas[tabela].forEach((coluna, indice) => {
                linha[coluna] = parametros[indice];
            });
            pendentes.push({ tabela, linha });
            comandos.push(tabela);
            return [{ insertId: linha.id }];
        }
    };

    return { conexao, gravados, comandos };
}

// Cliente, usuários e catálogo simulados; o repository real grava no banco simulado
function simularCadastros(teste, banco) {
    substituirMetodos(teste, clienteRepository, {
        buscarPorId: async (id) => (id === 1 ? { id_cliente: 1 } : null)
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => ({
            5: { id_usuario: 5, perfil: "ADMINISTRADOR", ativo: 1 },
            6: { id_usuario: 6, perfil: "ATENDENTE", ativo: 1 },
            7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 }
        })[id] ?? null
    });
    substituirMetodos(teste, acessorioRepository, {
        buscarPorId: async (id) => ACESSORIOS[id] ?? null
    });
    substituirMetodos(teste, pool, { getConnection: async () => banco.conexao });
}

test("Scenario A: one equipment creates one OS with RECEBIDA, PENDENTE and no technician", async (teste) => {
    const banco = bancoTransacional();
    simularCadastros(teste, banco);

    const criada = await solicitacaoService.criar(solicitacao());

    assert.equal(banco.gravados.solicitacao.length, 1);
    assert.equal(banco.gravados.solicitacao[0].id_cliente, 1);
    assert.equal(banco.gravados.item_solicitacao.length, 1);
    assert.equal(banco.gravados.ordem_servico.length, 1);

    const [item] = banco.gravados.item_solicitacao;
    const [os] = banco.gravados.ordem_servico;
    assert.equal(item.id_solicitacao, banco.gravados.solicitacao[0].id);
    assert.equal(os.id_item, item.id);
    assert.equal(os.status, "RECEBIDA");
    assert.equal(os.garantia_status, "PENDENTE");
    assert.equal(os.id_tecnico, null);

    assert.equal(criada.id_cliente, 1);
    assert.equal(criada.itens[0].id_os, os.id);
    assert.equal(criada.itens[0].garantia_status, "PENDENTE");
});

test("Scenario B: three equipments create three items and one OS for each item", async (teste) => {
    const banco = bancoTransacional();
    simularCadastros(teste, banco);

    const criada = await solicitacaoService.criar(solicitacao({
        itens: [
            equipamento({ tipo_equipamento: "Equipamento A" }),
            equipamento({ tipo_equipamento: "Equipamento B" }),
            equipamento({ tipo_equipamento: "Equipamento C" })
        ]
    }));

    const { solicitacao: solicitacoes, item_solicitacao: itens, ordem_servico: ordens } = banco.gravados;
    assert.equal(solicitacoes.length, 1);
    assert.equal(itens.length, 3);
    assert.equal(ordens.length, 3);

    // Cada OS aponta para um item diferente, e cada item tem exatamente uma OS
    assert.deepEqual(ordens.map((os) => os.id_item), itens.map((item) => item.id));
    assert.equal(new Set(ordens.map((os) => os.id_item)).size, 3);
    assert.ok(itens.every((item) => item.id_solicitacao === solicitacoes[0].id));

    // A resposta liga cada equipamento à sua própria OS
    assert.deepEqual(
        criada.itens.map((item) => [item.tipo_equipamento, item.id_os]),
        [["Equipamento A", ordens[0].id], ["Equipamento B", ordens[1].id], ["Equipamento C", ordens[2].id]]
    );
    assert.deepEqual(banco.comandos.filter((c) => c === "COMMIT"), ["COMMIT"]);

    // RN21: três eventos CRIACAO, um para cada OS, com o atendente do token
    assert.deepEqual(banco.gravados.historico_os.map((h) => [h.id_os, h.tipo_evento, h.id_usuario]),
        ordens.map((os) => [os.id, "CRIACAO", 6]));
});

test("Scenario C: each equipment keeps its own accessories, including a repeated one", async (teste) => {
    const banco = bancoTransacional();
    simularCadastros(teste, banco);

    const criada = await solicitacaoService.criar(solicitacao({
        itens: [
            equipamento({
                tipo_equipamento: "Notebook",
                acessorios: [
                    { id_acessorio: 3, quantidade: 1, observacoes: "original" },
                    { id_acessorio: 3, quantidade: 1, observacoes: "paralelo" }
                ]
            }),
            equipamento({ tipo_equipamento: "Impressora", acessorios: [{ id_acessorio: 4, quantidade: 2 }] })
        ]
    }));

    const [notebook, impressora] = banco.gravados.item_solicitacao;
    const doNotebook = banco.gravados.acessorio_recebido.filter((a) => a.id_item === notebook.id);
    const daImpressora = banco.gravados.acessorio_recebido.filter((a) => a.id_item === impressora.id);

    assert.deepEqual(doNotebook.map((a) => [a.id_acessorio, a.quantidade, a.observacoes]), [[3, 1, "original"], [3, 1, "paralelo"]]);
    assert.deepEqual(daImpressora.map((a) => [a.id_acessorio, a.quantidade]), [[4, 2]]);
    assert.equal(banco.gravados.acessorio_recebido.length, 3);

    assert.equal(criada.itens[0].acessorios.length, 2);
    assert.deepEqual(criada.itens[1].acessorios.map((a) => a.descricao_acessorio), ["Cabo de força"]);
});

test("Scenario D: zero, negative, fractional or too large accessory quantity returns 400", async (teste) => {
    const banco = bancoTransacional();
    simularCadastros(teste, banco);

    for (const quantidade of [0, -1, 1.5, "abc", 2147483648]) {
        await esperarStatus(
            solicitacaoService.criar(solicitacao({ itens: [equipamento({ acessorios: [{ id_acessorio: 3, quantidade }] })] })),
            400,
            /quantidade/
        );
    }

    assert.equal(banco.comandos.length, 0);
});

test("Scenario E: a failure in the second equipment's accessory rolls back everything", async (teste) => {
    // Inserções: solicitação(1), item A(2), OS A(3), histórico A(4), item B(5), OS B(6), histórico B(7), acessório de B(8)
    const banco = bancoTransacional({ falharEm: { tabela: "acessorio_recebido", vez: 8 } });
    simularCadastros(teste, banco);

    await assert.rejects(
        solicitacaoService.criar(solicitacao({
            itens: [
                equipamento({ tipo_equipamento: "Equipamento A" }),
                equipamento({ tipo_equipamento: "Equipamento B", acessorios: [{ id_acessorio: 3 }] })
            ]
        })),
        /falha simulada/
    );

    assert.deepEqual(banco.gravados, { solicitacao: [], item_solicitacao: [], ordem_servico: [], acessorio_recebido: [], historico_os: [] });
    assert.ok(banco.comandos.includes("ROLLBACK"));
    assert.ok(!banco.comandos.includes("COMMIT"));
    assert.equal(banco.comandos.at(-1), "RELEASE");
});

test("Scenario F: administrator and attendant use every request route; technician gets 403", async (teste) => {
    simularDependencias(teste);
    substituirMetodos(teste, solicitacaoRepository, {
        listarTodos: async () => [{ id_solicitacao: 1 }],
        buscarPorId: async (id) => (id === 1 ? { id_solicitacao: 1, itens: [] } : null)
    });

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const base = `http://127.0.0.1:${servidor.address().port}/api/solicitacoes`;

    const token = (id, perfil) => `Bearer ${jwt.sign({ id_usuario: id, perfil }, process.env.JWT_SECRET)}`;
    const chamar = (metodo, caminho, autorizacao, corpo) => fetch(base + caminho, {
        method: metodo,
        headers: { "Content-Type": "application/json", Authorization: autorizacao },
        body: corpo ? JSON.stringify(corpo) : undefined
    });

    const rotas = [["POST", "", 201], ["GET", "", 200], ["GET", "/1", 200]];

    for (const [id, perfil] of [[5, "ADMINISTRADOR"], [6, "ATENDENTE"]]) {
        for (const [metodo, caminho, esperado] of rotas) {
            const corpo = metodo === "POST" ? solicitacao() : undefined;
            const resposta = await chamar(metodo, caminho, token(id, perfil), corpo);
            assert.equal(resposta.status, esperado, `${perfil} ${metodo} ${caminho}`);
        }
    }

    for (const [metodo, caminho] of rotas) {
        const corpo = metodo === "POST" ? solicitacao() : undefined;
        const resposta = await chamar(metodo, caminho, token(7, "TECNICO"), corpo);
        assert.equal(resposta.status, 403, `TECNICO ${metodo} ${caminho}`);
    }

    // Sem token: 401
    const semToken = await fetch(base);
    assert.equal(semToken.status, 401);
});

test("Scenario G: request details include client, equipments, their accessories and their OS", async (teste) => {
    const consultas = [];
    substituirMetodos(teste, pool, {
        execute: async (sql, parametros) => {
            consultas.push({ sql, parametros });

            if (sql.includes("FROM solicitacao s")) {
                return [[{
                    id_solicitacao: 9, id_cliente: 1, nome_cliente: "Maria Cliente",
                    id_atendente: 6, nome_atendente: "Ana Atendente",
                    data_abertura: "2026-11-08T12:00:00.000Z", descricao_inicial: "Não liga", status: "RECEBIDA"
                }]];
            }
            if (sql.includes("FROM acessorio_recebido ar")) {
                return [[
                    { id_acessorio_recebido: 1, id_item: 21, id_acessorio: 3, descricao_acessorio: "Carregador", quantidade: 1, observacoes: null },
                    { id_acessorio_recebido: 2, id_item: 22, id_acessorio: 4, descricao_acessorio: "Cabo de força", quantidade: 2, observacoes: "gasto" },
                    { id_acessorio_recebido: 3, id_item: 21, id_acessorio: 3, descricao_acessorio: "Carregador", quantidade: 1, observacoes: "reserva" }
                ]];
            }
            if (sql.includes("u.nome AS nome_tecnico")) {
                return [[
                    { id_os: 31, id_item: 21, status: "RECEBIDA", garantia_status: "PENDENTE", id_tecnico: null, nome_tecnico: null, data_abertura: "2026-11-08T12:00:00.000Z" },
                    { id_os: 32, id_item: 22, status: "EM_ANALISE", garantia_status: "SIM", id_tecnico: 7, nome_tecnico: "Tiago Técnico", data_abertura: "2026-11-08T12:00:00.000Z" }
                ]];
            }
            if (sql.includes("FROM item_solicitacao i")) {
                return [[
                    { id_item: 21, tipo_equipamento: "Notebook", marca: "Dell", modelo: "X", numero_serie: null, estado_fisico: "ok", garantia_status: "PENDENTE", observacoes: null },
                    { id_item: 22, tipo_equipamento: "Impressora", marca: "HP", modelo: "Y", numero_serie: "S1", estado_fisico: "ok", garantia_status: "SIM", observacoes: null }
                ]];
            }
            throw new Error(`Consulta não prevista no teste: ${sql}`);
        }
    });

    const detalhes = await solicitacaoService.buscarPorId(9, { perfil: "ATENDENTE" });

    assert.equal(detalhes.id_solicitacao, 9);
    assert.equal(detalhes.nome_cliente, "Maria Cliente");
    assert.equal(detalhes.descricao_inicial, "Não liga");
    assert.equal(detalhes.itens.length, 2);

    const [notebook, impressora] = detalhes.itens;
    assert.deepEqual(notebook.acessorios.map((a) => a.id_acessorio_recebido), [1, 3]);
    assert.deepEqual(impressora.acessorios, [
        { id_acessorio_recebido: 2, id_acessorio: 4, descricao_acessorio: "Cabo de força", quantidade: 2, observacoes: "gasto" }
    ]);
    assert.deepEqual(notebook.ordens_servico.map((os) => os.id_os), [31]);
    assert.deepEqual(impressora.ordens_servico.map((os) => [os.id_os, os.nome_tecnico]), [[32, "Tiago Técnico"]]);

    // Campos que a resposta já tinha continuam presentes
    assert.equal(notebook.garantia_status, "PENDENTE");
    assert.equal(impressora.numero_serie, "S1");

    // Quatro consultas, todas filtradas pela solicitação pedida
    assert.equal(consultas.length, 4);
    assert.ok(consultas.every(({ parametros }) => parametros[0] === 9));
});

test("Scenario G: unknown request returns 404, invalid id 400 and technician 403", async (teste) => {
    substituirMetodos(teste, pool, { execute: async () => [[]] });

    await esperarStatus(solicitacaoService.buscarPorId(99, { perfil: "ADMINISTRADOR" }), 404);
    await esperarStatus(solicitacaoService.buscarPorId(1, { perfil: "TECNICO" }), 403);
    await esperarStatus(solicitacaoService.buscarPorId("abc", { perfil: "ATENDENTE" }), 400);
});

// ---------- Limite em bytes das colunas TEXT (65.535 bytes em UTF-8) ----------

const LIMITE_TEXT = 65535;

test("TEXT fields accept exactly 65,535 bytes, including multibyte characters", async (teste) => {
    const gravacoes = simularDependencias(teste);

    // "€" ocupa 3 bytes: 21.845 × 3 = 65.535 bytes (no limite)
    const noLimiteMultibyte = "€".repeat(21845);
    assert.equal(Buffer.byteLength(noLimiteMultibyte, "utf8"), LIMITE_TEXT);

    await solicitacaoService.criar(solicitacao({
        descricao_inicial: "a".repeat(LIMITE_TEXT),
        itens: [equipamento({
            estado_fisico: noLimiteMultibyte,
            observacoes: "ç".repeat(32767) + "a", // 32.767 × 2 + 1 = 65.535 bytes
            acessorios: [{ id_acessorio: 3, observacoes: "b".repeat(LIMITE_TEXT) }]
        })]
    }));

    assert.equal(gravacoes.length, 1);
    assert.equal(Buffer.byteLength(gravacoes[0].descricao_inicial, "utf8"), LIMITE_TEXT);
    assert.equal(gravacoes[0].itens[0].estado_fisico, noLimiteMultibyte);
});

test("TEXT fields over 65,535 bytes return 400, even when the character count is small", async (teste) => {
    const gravacoes = simularDependencias(teste);

    const umByteAMais = "a".repeat(LIMITE_TEXT + 1);   // 65.536 caracteres, 65.536 bytes
    const euros = "€".repeat(21846);                   // 21.846 caracteres, 65.538 bytes
    const cedilhas = "ç".repeat(32768);                // 32.768 caracteres, 65.536 bytes
    const emojis = "😀".repeat(16384);                 // 16.384 emojis, 65.536 bytes

    const casos = [
        [solicitacao({ descricao_inicial: umByteAMais }), /descrição inicial/],
        [solicitacao({ descricao_inicial: euros }), /descrição inicial/],
        [solicitacao({ itens: [equipamento({ estado_fisico: cedilhas })] }), /estado físico do equipamento 1/],
        [solicitacao({ itens: [equipamento(), equipamento({ observacoes: emojis })] }), /observações do equipamento 2/],
        [solicitacao({ itens: [equipamento({ acessorios: [{ id_acessorio: 3, observacoes: euros }] })] }), /observação do acessório/]
    ];

    for (const [dados, trecho] of casos) {
        await esperarStatus(solicitacaoService.criar(dados), 400, trecho);
    }

    assert.equal(gravacoes.length, 0);
});

test("the byte limit is checked after trimming spaces", async (teste) => {
    const gravacoes = simularDependencias(teste);

    await solicitacaoService.criar(solicitacao({ descricao_inicial: `   ${"a".repeat(LIMITE_TEXT)}   ` }));

    assert.equal(gravacoes[0].descricao_inicial.length, LIMITE_TEXT);
});

test("HTTP: a multibyte text over the TEXT limit returns 400, not 500", async (teste) => {
    const gravacoes = simularDependencias(teste);

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));

    // Corpo de cerca de 66 KB: abaixo do limite de 100 KB do express.json, então chega ao service
    const resposta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/solicitacoes`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt.sign({ id_usuario: 6, perfil: "ATENDENTE" }, process.env.JWT_SECRET)}`
        },
        body: JSON.stringify(solicitacao({ descricao_inicial: "€".repeat(21846) }))
    });
    const corpo = await resposta.json();

    assert.equal(resposta.status, 400);
    assert.match(corpo.mensagem, /descrição inicial excede o tamanho máximo/);
    assert.equal(gravacoes.length, 0);
});
