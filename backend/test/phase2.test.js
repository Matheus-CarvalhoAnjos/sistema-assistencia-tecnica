const test = require("node:test");
const assert = require("node:assert/strict");

const BaseRepository = require("../src/repositories/BaseRepository");
const BaseService = require("../src/services/BaseService");
const execucaoRepository = require("../src/repositories/execucaoRepository");
const execucaoService = require("../src/services/execucaoService");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const orcamentoRepository = require("../src/repositories/orcamentoRepository");
const orcamentoService = require("../src/services/orcamentoService");
const usuarioRepository = require("../src/repositories/usuarioRepository");

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

test("services and repositories use the shared base classes", () => {
    assert.ok(execucaoService instanceof BaseService);
    assert.ok(orcamentoService instanceof BaseService);
    assert.ok(execucaoRepository instanceof BaseRepository);
    assert.ok(orcamentoRepository instanceof BaseRepository);
});

test("execution records use the assigned technician", async (teste) => {
    let dadosCriacao;

    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async () => ({ id_os: 11, id_tecnico: 7, status: "EM_ANALISE" })
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 7, ativo: 1, perfil: "tecnico" })
    });
    substituirMetodos(teste, execucaoRepository, {
        buscarPorOs: async () => null,
        criar: async (dados) => {
            dadosCriacao = dados;
            return dados;
        }
    });

    const resultado = await execucaoService.registrar(
        11,
        { diagnostico: "  Falha identificada  ", id_tecnico: 99 },
        { id_usuario: 7, perfil: "TECNICO" }
    );

    assert.equal(resultado.diagnostico, "Falha identificada");
    assert.equal(dadosCriacao.id_tecnico, 7);
});

test("execution cannot be recorded by a technician not assigned to the order", async (teste) => {
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async () => ({ id_os: 11, id_tecnico: 7, status: "EM_ANALISE" })
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 7, ativo: 1, perfil: "TECNICO" })
    });
    substituirMetodos(teste, execucaoRepository, {
        buscarPorOs: async () => null,
        criar: async () => assert.fail("Execution must not be created")
    });

    await assert.rejects(
        execucaoService.registrar(11, { diagnostico: "Diagnóstico" }, { id_usuario: 8, perfil: "TECNICO" }),
        { statusCode: 403 }
    );
});

// Garantia confirmada (SIM): o reparo segue sem orçamento; nenhum orçamento (nem de valor zero) é criado
test("confirmed warranty does not create a quote: no charge for covered parts or services", async (teste) => {
    let dadosCriacao = null;

    substituirMetodos(teste, orcamentoRepository, {
        buscarOrdemServico: async () => ({
            id_os: 21,
            id_tecnico: 7,
            status: "EM_ANALISE",
            garantia_status: "SIM"
        }),
        criar: async (dados) => {
            dadosCriacao = dados;
            return dados;
        }
    });
    substituirMetodos(teste, execucaoRepository, {
        buscarPorOs: async () => ({ id_os: 21, diagnostico: "Defeito confirmado" })
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 7, ativo: 1, perfil: "tecnico" })
    });

    await assert.rejects(orcamentoService.criar(21, {
        itens: [
            { tipo_item: "SERVICO", descricao: "Mão de obra", quantidade: 1, valor_unitario: 150 },
            { tipo_item: "PECA", descricao: "Componente", quantidade: 2, valor_unitario: 25 }
        ]
    }, { id_usuario: 7, perfil: "TECNICO" }), { statusCode: 409 });

    assert.equal(dadosCriacao, null);
});

test("pending warranty prevents quote creation", async (teste) => {
    substituirMetodos(teste, orcamentoRepository, {
        buscarOrdemServico: async () => ({
            id_os: 21,
            id_tecnico: 7,
            status: "EM_ANALISE",
            garantia_status: "PENDENTE"
        }),
        criar: async () => assert.fail("Quote must not be created")
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 7, ativo: 1, perfil: "TECNICO" })
    });

    await assert.rejects(
        orcamentoService.criar(21, { itens: [{ tipo_item: "PECA", descricao: "Peça", quantidade: 1, valor_unitario: 10 }] }, { id_usuario: 7, perfil: "TECNICO" }),
        { statusCode: 409 }
    );
});

test("quote responses use the authenticated employee identity", async (teste) => {
    let parametrosResposta;

    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 3, ativo: 1, perfil: "atendente" })
    });
    substituirMetodos(teste, orcamentoRepository, {
        registrarResposta: async (...parametros) => {
            parametrosResposta = parametros;
            return { id_orcamento: 30, status: parametros[2] };
        }
    });

    await orcamentoService.responder(
        30,
        { decisao: "REJEITADO", id_usuario: 99 },
        { id_usuario: 3, perfil: "ATENDENTE" }
    );

    assert.equal(parametrosResposta[1], 3);
    assert.equal(parametrosResposta[2], "REJEITADO");
});

test("quote creation records a three-day validity and keeps its items", async (teste) => {
    const statements = [];
    const conexao = {
        beginTransaction: async () => {},
        execute: async (sql, parametros) => {
            statements.push({ sql, parametros });

            if (sql.includes("SELECT os.id_os")) {
                return [[{
                    id_os: 11,
                    id_tecnico: 7,
                    status: "EM_ANALISE",
                    garantia_status: "NAO"
                }], []];
            }

            if (sql.includes("SELECT id_orcamento") && sql.includes("data_validade >")) {
                return [[], []];
            }

            if (sql.includes("INSERT INTO orcamento")) {
                return [{ insertId: 40 }, []];
            }

            return [{ affectedRows: 1 }, []];
        },
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
    };

    substituirMetodos(teste, orcamentoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, orcamentoRepository, {
        buscarPorId: async () => ({ id_orcamento: 40, status: "PENDENTE" })
    });

    const resultado = await orcamentoRepository.criar({
        id_os: 11,
        id_tecnico: 7,
        garantia_status: "NAO",
        valor_total: 30,
        itens: [{ tipo_item: "PECA", descricao: "Peça", quantidade: 1, valor_unitario: 30 }]
    });

    assert.equal(resultado.id_orcamento, 40);
    assert.ok(statements.some(({ sql }) => sql.includes("INTERVAL 3 DAY")));
    assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO item_orcamento")));
    assert.equal(statements.some(({ sql }) => sql.includes("DELETE")), false);
});

test("rejecting a quote stores the response and closes its service order", async (teste) => {
    const statements = [];
    const conexao = {
        beginTransaction: async () => {},
        execute: async (sql, parametros) => {
            statements.push({ sql, parametros });

            if (sql.includes("SELECT o.id_orcamento")) {
                return [[{
                    id_orcamento: 30,
                    id_os: 11,
                    status: "PENDENTE",
                    vigente: 1,
                    status_os: "AGUARDANDO_APROVACAO"
                }], []];
            }

            return [{ affectedRows: 1 }, []];
        },
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
    };

    substituirMetodos(teste, orcamentoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, orcamentoRepository, {
        buscarPorId: async () => ({ id_orcamento: 30, id_os: 11, status: "PENDENTE" })
    });

    await orcamentoRepository.registrarResposta(30, 3, "REJEITADO", "Reparo não autorizado.");

    assert.ok(statements.some(({ sql, parametros }) => sql.includes("INSERT INTO resposta_orcamento") && parametros[1] === 3));
    assert.ok(statements.some(({ sql }) => sql.includes("ENCERRADA_SEM_REPARO")));
    assert.ok(statements.some(({ sql }) => sql.includes("data_encerramento")));
});

test("expired quotes become VENCIDO without closing the service order", async (teste) => {
    const statements = [];
    const conexao = {
        beginTransaction: async () => {},
        execute: async (sql) => {
            statements.push(sql);

            if (sql.includes("SELECT o.id_orcamento")) {
                return [[{
                    id_orcamento: 31,
                    id_os: 12,
                    status: "PENDENTE",
                    vigente: 0,
                    status_os: "AGUARDANDO_APROVACAO"
                }], []];
            }

            // Busca dos pendentes expirados (com bloqueio) antes de marcá-los como VENCIDO
            if (sql.includes("SELECT id_orcamento") && sql.includes("data_validade <=")) {
                return [[{ id_orcamento: 31 }], []];
            }

            return [{ affectedRows: 1 }, []];
        },
        commit: async () => {},
        rollback: async () => {},
        release: () => {}
    };

    substituirMetodos(teste, orcamentoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, orcamentoRepository, {
        buscarPorId: async () => ({ id_orcamento: 31, id_os: 12, status: "PENDENTE" })
    });

    const resultado = await orcamentoRepository.registrarResposta(31, 3, "APROVADO", null);

    assert.deepEqual(resultado, { expirado: true });
    assert.ok(statements.some((sql) => sql.includes("status = 'VENCIDO'")));
    assert.ok(statements.some((sql) => sql.includes("status = 'EM_ANALISE'")));
    assert.equal(statements.some((sql) => sql.includes("ENCERRADA_SEM_REPARO")), false);
    assert.equal(statements.some((sql) => sql.includes("INSERT INTO resposta_orcamento")), false);
    // RN21: o vencimento gera um único evento automático
    assert.equal(statements.filter((sql) => sql.includes("INSERT INTO historico_os")).length, 1);
});
