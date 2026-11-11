const test = require("node:test");
const assert = require("node:assert/strict");

const BaseRepository = require("../src/repositories/BaseRepository");
const BaseService = require("../src/services/BaseService");
const pagamentoRepository = require("../src/repositories/pagamentoRepository");
const pagamentoService = require("../src/services/pagamentoService");
const expedicaoRepository = require("../src/repositories/expedicaoRepository");
const expedicaoService = require("../src/services/expedicaoService");
const pagamentoParaExpedicao = require("../src/repositories/pagamentoRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const execucaoRepository = require("../src/repositories/execucaoRepository");
const execucaoService = require("../src/services/execucaoService");

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

function conexaoFalsa(executor) {
    const statements = [];

    return {
        statements,
        conexao: {
            beginTransaction: async () => {},
            execute: async (sql, parametros = []) => {
                statements.push({ sql, parametros });
                return executor(sql, parametros);
            },
            commit: async () => {},
            rollback: async () => {},
            release: () => {}
        }
    };
}

test("payment and dispatch services and repositories extend shared bases", () => {
    assert.ok(pagamentoService instanceof BaseService);
    assert.ok(expedicaoService instanceof BaseService);
    assert.ok(pagamentoRepository instanceof BaseRepository);
    assert.ok(expedicaoRepository instanceof BaseRepository);
});

test("payment summary reports partial confirmed payments and outstanding balance", async (teste) => {
    substituirMetodos(teste, pagamentoRepository, {
        buscarValoresOs: async () => ({
            tem_orcamento_aprovado: true,
            total_orcado_centavos: 10000, total_abatido_centavos: 0, total_devido_centavos: 10000,
            total_confirmado_centavos: 2500,
            total_pendente_centavos: 2000
        })
    });

    const resumo = await pagamentoRepository.calcularResumo(8);

    assert.equal(resumo.total_orcado, 100);
    assert.equal(resumo.total_pago, 25);
    assert.equal(resumo.pagamentos_pendentes, 20);
    assert.equal(resumo.saldo_devedor, 75);
});

test("payment registration remains tied to its order and supports partial amounts", async (teste) => {
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status")) {
            return [[{ id_os: 8, status: "EM_REPARO" }], []];
        }
        if (sql.includes("SELECT valor_total")) {
            return [[{ valor_total: "100.00" }], []];
        }
        if (sql.includes("SUM(CASE")) {
            return [[{ total_confirmado: "20.00", total_pendente: "10.00" }], []];
        }
        if (sql.includes("INSERT INTO pagamento")) {
            return [{ insertId: 55 }, []];
        }
        return [[], []];
    });

    substituirMetodos(teste, pagamentoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, pagamentoRepository, {
        buscarPorId: async () => ({ id_pagamento: 55, id_os: 8, valor: 15, status: "PENDENTE" })
    });

    const pagamento = await pagamentoRepository.criar({
        id_os: 8,
        valor: 15,
        valor_centavos: 1500,
        forma_pagamento: "PIX"
    });

    const insert = statements.find(({ sql }) => sql.includes("INSERT INTO pagamento"));
    assert.equal(pagamento.id_os, 8);
    assert.equal(insert.parametros[0], 8);
    assert.equal(insert.parametros[1], 15);
    assert.equal(insert.parametros[2], "PIX");
    assert.ok(insert.sql.includes("'PENDENTE'"));
});

test("payment registration rejects an amount beyond the remaining order balance", async (teste) => {
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status")) {
            return [[{ id_os: 8, status: "EM_REPARO" }], []];
        }
        if (sql.includes("SELECT valor_total")) {
            return [[{ valor_total: "100.00" }], []];
        }
        if (sql.includes("SUM(CASE")) {
            return [[{ total_confirmado: "80.00", total_pendente: "15.00" }], []];
        }
        return [[], []];
    });

    substituirMetodos(teste, pagamentoRepository.pool, {
        getConnection: async () => conexao
    });

    await assert.rejects(
        pagamentoRepository.criar({ id_os: 8, valor: 10, valor_centavos: 1000, forma_pagamento: "PIX" }),
        { statusCode: 409 }
    );
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO pagamento")), false);
});

test("payment service rejects invalid amounts and methods", async () => {
    await assert.rejects(
        pagamentoService.criar(8, { valor: 0, forma_pagamento: "PIX" }),
        { statusCode: 400 }
    );
    await assert.rejects(
        pagamentoService.criar(8, { valor: 10, forma_pagamento: "BOLETO" }),
        { statusCode: 400 }
    );
});

test("confirming a pending payment preserves its order and status history", async (teste) => {
    let buscarCount = 0;
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os") && sql.includes("FROM ordem_servico")) {
            return [[{ id_os: 8, status: "CONCLUIDA" }], []];
        }
        if (sql.includes("SELECT id_pagamento, id_os, valor, status")) {
            return [[{ id_pagamento: 55, id_os: 8, valor: "25.00", status: "PENDENTE" }], []];
        }
        if (sql.includes("SELECT valor_total")) {
            return [[{ valor_total: "100.00" }], []];
        }
        if (sql.includes("SUM(CASE")) {
            return [[{ total_confirmado: "20.00", total_pendente: "10.00" }], []];
        }
        return [{ affectedRows: 1 }, []];
    });

    substituirMetodos(teste, pagamentoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, pagamentoRepository, {
        buscarPorId: async () => {
            buscarCount++;
            return {
                id_pagamento: 55,
                id_os: 8,
                valor: 25,
                status: buscarCount === 1 ? "PENDENTE" : "CONFIRMADO"
            };
        }
    });

    const pagamento = await pagamentoRepository.atualizarStatus(55, "CONFIRMADO");
    const atualizar = statements.find(({ sql }) => sql.includes("UPDATE pagamento"));

    assert.equal(pagamento.status, "CONFIRMADO");
    assert.equal(pagamento.id_os, 8);
    // data_pagamento é gravada na confirmação (MER v1.4: NULL enquanto PENDENTE)
    assert.deepEqual(atualizar.parametros, ["CONFIRMADO", "CONFIRMADO", 55]);
    assert.ok(atualizar.sql.includes("data_pagamento = CASE"));
});

test("dispatch after repair requires full confirmed payment", async (teste) => {
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status")) {
            return [[{ id_os: 9, status: "CONCLUIDA" }], []];
        }
        if (sql.includes("SELECT valor_total")) {
            return [[{ valor_total: "100.00" }], []];
        }
        if (sql.includes("SUM(CASE")) {
            return [[{ total_confirmado: "50.00", total_pendente: "50.00" }], []];
        }
        return [[], []];
    });

    substituirMetodos(teste, expedicaoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, pagamentoParaExpedicao, {
        buscarValoresOs: async () => ({
            tem_orcamento_aprovado: true,
            total_orcado_centavos: 10000, total_abatido_centavos: 0, total_devido_centavos: 10000,
            total_confirmado_centavos: 5000,
            total_pendente_centavos: 5000
        })
    });

    await assert.rejects(
        expedicaoRepository.criar({
            id_os: 9,
            id_usuario: 2,
            forma_entrega: "ENVIO",
            codigo_rastreio: "TRACK-1"
        }),
        { statusCode: 409 }
    );
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO expedicao")), false);
});

test("dispatch after repair is registered when the approved quote is fully paid", async (teste) => {
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status")) {
            return [[{ id_os: 9, status: "CONCLUIDA" }], []];
        }
        if (sql.includes("SELECT id_expedicao")) {
            return [[], []];
        }
        if (sql.includes("INSERT INTO expedicao")) {
            return [{ insertId: 42 }, []];
        }
        return [{ affectedRows: 1 }, []];
    });

    substituirMetodos(teste, expedicaoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, pagamentoParaExpedicao, {
        buscarValoresOs: async () => ({
            tem_orcamento_aprovado: true,
            total_orcado_centavos: 10000, total_abatido_centavos: 0, total_devido_centavos: 10000,
            total_confirmado_centavos: 10000,
            total_pendente_centavos: 0
        })
    });
    substituirMetodos(teste, expedicaoRepository, {
        buscarPorOs: async () => ({ id_expedicao: 42, id_os: 9, status: "PENDENTE" })
    });

    const expedicao = await expedicaoRepository.criar({
        id_os: 9,
        id_usuario: 2,
        forma_entrega: "ENVIO",
        codigo_rastreio: "TRACK-42"
    });

    const insert = statements.find(({ sql }) => sql.includes("INSERT INTO expedicao"));
    assert.equal(expedicao.id_expedicao, 42);
    assert.equal(expedicao.status, "PENDENTE");
    assert.equal(insert.parametros[4], "PENDENTE");
    assert.ok(statements.some(({ sql }) => sql.includes("UPDATE ordem_servico") && sql.includes("AGUARDANDO_EXPEDICAO")));
});

test("dispatch after no-repair closure does not require payment", async (teste) => {
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status")) {
            return [[{ id_os: 10, status: "ENCERRADA_SEM_REPARO" }], []];
        }
        if (sql.includes("SELECT id_expedicao")) {
            return [[], []];
        }
        if (sql.includes("INSERT INTO expedicao")) {
            return [{ insertId: 41 }, []];
        }
        return [{ affectedRows: 1 }, []];
    });

    substituirMetodos(teste, expedicaoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, expedicaoRepository, {
        buscarPorOs: async () => ({ id_expedicao: 41, id_os: 10, status: "AGUARDANDO_RETIRADA" })
    });
    substituirMetodos(teste, pagamentoParaExpedicao, {
        buscarValoresOs: async () => assert.fail("No-repair dispatch must not require payment")
    });

    const expedicao = await expedicaoRepository.criar({
        id_os: 10,
        id_usuario: 2,
        forma_entrega: "RETIRADA",
        codigo_rastreio: null
    });

    const insert = statements.find(({ sql }) => sql.includes("INSERT INTO expedicao"));
    assert.equal(expedicao.status, "AGUARDANDO_RETIRADA");
    assert.equal(insert.parametros[4], "AGUARDANDO_RETIRADA");
    assert.ok(insert.sql.includes("forma_entrega"));
    assert.equal(insert.parametros[0], 10);
    assert.equal(insert.parametros[1], 2);
    assert.equal(insert.parametros[2], "RETIRADA");
    assert.equal(statements.some(({ sql }) => sql.includes("UPDATE ordem_servico")), false);
});

test("dispatch registration prevents duplicates", async (teste) => {
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status")) {
            return [[{ id_os: 10, status: "ENCERRADA_SEM_REPARO" }], []];
        }
        if (sql.includes("SELECT id_expedicao")) {
            return [[{ id_expedicao: 5 }], []];
        }
        return [[], []];
    });

    substituirMetodos(teste, expedicaoRepository.pool, {
        getConnection: async () => conexao
    });

    await assert.rejects(
        expedicaoRepository.criar({ id_os: 10, id_usuario: 2, forma_entrega: "RETIRADA", codigo_rastreio: null }),
        { statusCode: 409 }
    );
    assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO expedicao")), false);
});

test("delivered repaired dispatch closes the service order", async (teste) => {
    let buscaCount = 0;
    const { statements, conexao } = conexaoFalsa((sql) => {
        if (sql.includes("SELECT id_os, status") && sql.includes("FROM ordem_servico")) {
            return [[{ id_os: 9, status: "AGUARDANDO_EXPEDICAO" }], []];
        }
        if (sql.includes("SELECT id_expedicao, id_os, forma_entrega, status")) {
            return [[{ id_expedicao: 42, id_os: 9, forma_entrega: "ENVIO", status: "EM_TRANSITO" }], []];
        }
        return [{ affectedRows: 1 }, []];
    });

    substituirMetodos(teste, expedicaoRepository.pool, {
        getConnection: async () => conexao
    });
    substituirMetodos(teste, pagamentoParaExpedicao, {
        buscarValoresOs: async () => ({
            tem_orcamento_aprovado: true,
            total_orcado_centavos: 10000, total_abatido_centavos: 0, total_devido_centavos: 10000,
            total_confirmado_centavos: 10000,
            total_pendente_centavos: 0
        })
    });
    substituirMetodos(teste, expedicaoRepository, {
        buscarPorOs: async () => {
            buscaCount++;
            return {
                id_expedicao: 42,
                id_os: 9,
                status: buscaCount === 1 ? "EM_TRANSITO" : "ENTREGUE"
            };
        }
    });

    const expedicao = await expedicaoRepository.atualizarStatus(9, "ENTREGUE");

    assert.equal(expedicao.status, "ENTREGUE");
    assert.ok(statements.some(({ sql }) => sql.includes("data_entrega = CASE")));
    assert.ok(statements.some(({ sql }) => sql.includes("UPDATE ordem_servico") && sql.includes("FINALIZADA")));
});

test("dispatch status and employee identity are validated", async (teste) => {
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 2, perfil: "atendente", ativo: 1 })
    });
    substituirMetodos(teste, expedicaoRepository, {
        criar: async (dados) => dados
    });

    const expedicao = await expedicaoService.criar(
        10,
        { forma_entrega: "  retirada  ", codigo_rastreio: " " },
        { id_usuario: 2, perfil: "ATENDENTE" }
    );

    assert.equal(expedicao.id_os, 10);
    assert.equal(expedicao.id_usuario, 2);
    assert.equal(expedicao.forma_entrega, "RETIRADA");
    assert.equal(expedicao.codigo_rastreio, null);

    await assert.rejects(
        expedicaoService.atualizarStatus(10, { status: "CANCELADA" }, { id_usuario: 2, perfil: "ATENDENTE" }),
        { statusCode: 400 }
    );
});

test("repaired order can be completed only after its execution report has a completion date", async (teste) => {
    let chamadasBusca = 0;
    let marcouConcluida = false;

    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async () => {
            chamadasBusca++;
            return {
                id_os: 12,
                id_tecnico: 4,
                status: chamadasBusca === 1 ? "EM_REPARO" : "CONCLUIDA"
            };
        },
        marcarConcluida: async () => {
            marcouConcluida = true;
            return true;
        }
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async () => ({ id_usuario: 4, ativo: 1, perfil: "tecnico" })
    });
    substituirMetodos(teste, execucaoRepository, {
        buscarPorOs: async () => ({ id_os: 12, data_conclusao: "2026-11-03 14:00:00" })
    });

    const ordem = await execucaoService.concluirReparo(12, { id_usuario: 4, perfil: "TECNICO" });
    assert.equal(marcouConcluida, true);
    assert.equal(ordem.status, "CONCLUIDA");
});
