/*
 * Etapa 3 — Pagamentos (RN13, RN16) e Expedição (RN18, RN19, RN20) conforme o MER v1.4.
 * Usam conexões e repositories simulados: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const pagamentoRepository = require("../src/repositories/pagamentoRepository");
const pagamentoService = require("../src/services/pagamentoService");
const expedicaoRepository = require("../src/repositories/expedicaoRepository");
const expedicaoService = require("../src/services/expedicaoService");
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

// Conexão simulada: responde conforme a função recebida e guarda os comandos
function conexaoFalsa(responder) {
    const comandos = [];
    return {
        comandos,
        conexao: {
            beginTransaction: async () => comandos.push("BEGIN"),
            commit: async () => comandos.push("COMMIT"),
            rollback: async () => comandos.push("ROLLBACK"),
            release: () => comandos.push("RELEASE"),
            execute: async (sql, parametros) => {
                comandos.push({ sql: sql.replace(/\s+/g, " ").trim(), parametros });
                return responder(sql, parametros) ?? [{ affectedRows: 1 }, []];
            }
        }
    };
}

const ATENDENTE = { id_usuario: 2, perfil: "ATENDENTE" };
const TECNICO = { id_usuario: 7, perfil: "TECNICO" };
const usuarios = { 1: { id_usuario: 1, perfil: "ADMINISTRADOR", ativo: 1 }, 2: { id_usuario: 2, perfil: "ATENDENTE", ativo: 1 }, 7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 } };
const atualizacoes = (comandos, trecho) => comandos.filter((c) => typeof c === "object" && c.sql.includes(trecho));

// ---------- Pagamentos ----------

test("payment: a new payment is recorded as PENDENTE without payment date", async (teste) => {
    const simulada = conexaoFalsa((sql) => {
        if (sql.includes("FROM ordem_servico")) return [[{ id_os: 8, status: "EM_REPARO" }], []];
        if (sql.includes("SELECT valor_total")) return [[{ valor_total: "100.00" }], []];
        if (sql.includes("SUM(CASE")) return [[{ total_confirmado: "0", total_pendente: "0" }], []];
        if (sql.includes("INSERT INTO pagamento")) return [{ insertId: 70 }, []];
    });
    substituirMetodos(teste, pagamentoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, pagamentoRepository, { buscarPorId: async () => ({ id_pagamento: 70, status: "PENDENTE", data_pagamento: null }) });

    await pagamentoRepository.criar({ id_os: 8, valor: 40, valor_centavos: 4000, forma_pagamento: "PIX" });

    const [insert] = atualizacoes(simulada.comandos, "INSERT INTO pagamento");
    assert.match(insert.sql, /VALUES \(\?, NULL, \?, \?, 'PENDENTE'\)/);
});

test("payment: confirmation is refused after the order was closed without repair (RN13)", async (teste) => {
    const simulada = conexaoFalsa((sql) => {
        if (sql.includes("FROM ordem_servico")) return [[{ id_os: 8, status: "ENCERRADA_SEM_REPARO" }], []];
        if (sql.includes("FROM pagamento")) return [[{ id_pagamento: 55, id_os: 8, valor: "25.00", status: "PENDENTE" }], []];
    });
    substituirMetodos(teste, pagamentoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, pagamentoRepository, { buscarPorId: async () => ({ id_pagamento: 55, id_os: 8, status: "PENDENTE" }) });

    await assert.rejects(pagamentoRepository.atualizarStatus(55, "CONFIRMADO"), { statusCode: 409 });
    assert.equal(atualizacoes(simulada.comandos, "UPDATE pagamento").length, 0);
    assert.ok(simulada.comandos.includes("ROLLBACK"));
});

/*
 * Conexão simulada para reembolso (D5, D6): responde às consultas da situação financeira da OS,
 * ao pagamento bloqueado e à soma já reembolsada dele.
 */
function respostasReembolso({ pagamento, reembolsado = "0", tipo_encerramento = null, avaliacoes = [], somaAvaliacao = "0" }) {
    return (sql) => {
        const texto = sql.replace(/\s+/g, " ").trim();
        if (texto.startsWith("SELECT id_os, status, tipo_encerramento FROM ordem_servico")) {
            return [[{ id_os: 8, status: "FINALIZADA", tipo_encerramento }], []];
        }
        if (texto.includes("FROM orcamento WHERE id_os = ? AND status = 'APROVADO'")) return [[{ id_orcamento: 1 }], []];
        if (texto.includes("FROM pagamento p WHERE p.id_os = ? AND p.status = 'CONFIRMADO'")) {
            return [pagamento.status === "CONFIRMADO" ? [{ id_pagamento: 55, valor: pagamento.valor, reembolsado }] : [], []];
        }
        if (texto.includes("FROM avaliacao_reembolso a LEFT JOIN usuario")) return [avaliacoes, []];
        if (texto.includes("INNER JOIN avaliacao_reembolso a")) return [[{ total: somaAvaliacao }], []];
        if (texto.startsWith("SELECT id_pagamento, id_os, valor, status FROM pagamento")) return [[{ id_os: 8, ...pagamento }], []];
        if (texto.includes("FROM reembolso WHERE id_pagamento = ?")) return [[{ total: reembolsado }], []];
        if (texto.startsWith("INSERT INTO reembolso")) return [{ insertId: 900 }, []];
        return undefined;
    };
}

function prepararReembolso(teste, opcoes) {
    const simulada = conexaoFalsa(respostasReembolso(opcoes));
    substituirMetodos(teste, pagamentoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, pagamentoRepository, {
        buscarPorId: async () => ({ id_pagamento: 55, id_os: 8, ...opcoes.pagamento }),
        listarPorOs: async () => [{ id_pagamento: 55, status: "?" }]
    });
    return simulada;
}

const eventoHistorico = (comandos) => {
    const [evento] = atualizacoes(comandos, "INSERT INTO historico_os");
    const [idOs, idUsuario, tipo, descricao, anteriores, novos] = evento.parametros;
    return { idOs, idUsuario, tipo, descricao, anteriores: JSON.parse(anteriores), novos: JSON.parse(novos) };
};

test("refund without value: returns everything still available and the payment becomes REEMBOLSADO (RN16)", async (teste) => {
    const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "25.00", status: "CONFIRMADO" } });
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });

    await pagamentoService.reembolsar(55, { justificativa_reembolso: "  Cliente desistiu  " }, ATENDENTE);

    const [insert] = atualizacoes(simulada.comandos, "INSERT INTO reembolso");
    assert.deepEqual(insert.parametros, [55, null, 25, "Cliente desistiu", 2]);
    const [update] = atualizacoes(simulada.comandos, "UPDATE pagamento");
    assert.match(update.sql, /status = 'REEMBOLSADO', data_reembolso = CURRENT_TIMESTAMP/);
    assert.deepEqual(update.parametros, [2, "Cliente desistiu", 55]);
    assert.ok(simulada.comandos.includes("COMMIT"));

    // RN21: um evento PAGAMENTO na OS do pagamento, com o atendente e a justificativa
    assert.equal(atualizacoes(simulada.comandos, "INSERT INTO historico_os").length, 1);
    const evento = eventoHistorico(simulada.comandos);
    assert.deepEqual([evento.idOs, evento.idUsuario, evento.tipo], [8, 2, "PAGAMENTO"]);
    assert.equal(evento.descricao, "Pagamento nº 55 reembolsado integralmente.");
    assert.deepEqual(evento.novos, {
        id_pagamento: 55, id_reembolso: 900, status: "REEMBOLSADO",
        valor_reembolso: 25, valor_reembolsado: 25, justificativa_reembolso: "Cliente desistiu"
    });

    // A OS é bloqueada antes do pagamento (mesma ordem das demais operações financeiras)
    const bloqueios = simulada.comandos.filter((c) => typeof c === "object" && /FOR UPDATE/.test(c.sql)).map((c) => c.sql);
    assert.match(bloqueios[0], /FROM ordem_servico/);
});

test("partial refund (D6): keeps CONFIRMADO and records the partial value; the rest can be refunded later", async (teste) => {
    const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "100.00", status: "CONFIRMADO" }, reembolsado: "30.00" });

    await pagamentoRepository.reembolsar(55, 2, "Peça devolvida", 2000);

    assert.deepEqual(atualizacoes(simulada.comandos, "INSERT INTO reembolso")[0].parametros, [55, null, 20, "Peça devolvida", 2]);
    assert.equal(atualizacoes(simulada.comandos, "UPDATE pagamento").length, 0);
    const evento = eventoHistorico(simulada.comandos);
    assert.equal(evento.descricao, "Reembolso parcial de R$ 20,00 do pagamento nº 55.");
    // A situação não muda no reembolso parcial: não entra no evento
    assert.deepEqual(evento.anteriores, { id_pagamento: 55, valor_reembolsado: 30 });
    assert.equal(evento.novos.valor_reembolsado, 50);
    assert.equal("status" in evento.novos, false);
});

test("partial refund (D6): the last part completes the refund and the payment becomes REEMBOLSADO", async (teste) => {
    const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "100.00", status: "CONFIRMADO" }, reembolsado: "70.00" });

    await pagamentoRepository.reembolsar(55, 2, "Restante", 3000);

    assert.equal(atualizacoes(simulada.comandos, "UPDATE pagamento").length, 1);
    assert.equal(eventoHistorico(simulada.comandos).descricao, "Reembolso de R$ 30,00 concluiu a devolução do pagamento nº 55.");
});

test("partial refund (D6): cannot exceed the value still available; nothing is written", async (teste) => {
    const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "100.00", status: "CONFIRMADO" }, reembolsado: "70.00" });

    await assert.rejects(pagamentoRepository.reembolsar(55, 2, "x", 3001), { statusCode: 409, message: /R\$ 30,00/ });
    assert.equal(atualizacoes(simulada.comandos, "INSERT INTO").length, 0);
    assert.ok(simulada.comandos.includes("ROLLBACK"));
});

test("RN20 × D5: a refund in a FINALIZADA order never changes the order or the dispatch (no state goes back)", async (teste) => {
    for (const valor of [1000, null]) {
        const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "25.00", status: "CONFIRMADO" } });

        await pagamentoRepository.reembolsar(55, 2, "Depois da entrega", valor);

        assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico").length, 0);
        assert.equal(atualizacoes(simulada.comandos, "UPDATE expedicao").length, 0);
        assert.equal(atualizacoes(simulada.comandos, "INSERT INTO reembolso").length, 1);
        assert.ok(simulada.comandos.includes("COMMIT"));
    }
});

test("refund: only once and only for confirmed payments", async (teste) => {
    for (const status of ["REEMBOLSADO", "PENDENTE", "CANCELADO"]) {
        const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "25.00", status } });

        await assert.rejects(pagamentoRepository.reembolsar(55, 2, "motivo"), { statusCode: 409 }, status);
        assert.equal(atualizacoes(simulada.comandos, "UPDATE pagamento").length, 0, status);
        assert.equal(atualizacoes(simulada.comandos, "INSERT INTO reembolso").length, 0, status);
    }
});

test("refund: invalid value returns 400 before touching the database", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, pagamentoRepository, { reembolsar: async () => assert.fail("não deveria reembolsar") });

    for (const valor of [0, -5, "abc", 10.555]) {
        await assert.rejects(pagamentoService.reembolsar(55, { justificativa_reembolso: "x", valor }, ATENDENTE), { statusCode: 400 }, String(valor));
    }
});

test("refund: technician gets 403 and the justification is required", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, pagamentoRepository, { reembolsar: async () => assert.fail("não deveria reembolsar") });

    await assert.rejects(pagamentoService.reembolsar(55, { justificativa_reembolso: "x" }, TECNICO), { statusCode: 403 });
    await assert.rejects(pagamentoService.reembolsar(55, { justificativa_reembolso: "   " }, ATENDENTE), { statusCode: 400 });
    await assert.rejects(pagamentoService.reembolsar(55, {}, ATENDENTE), { statusCode: 400 });
});

test("HTTP: technician cannot register, confirm or refund payments nor manage dispatch", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const base = `http://127.0.0.1:${servidor.address().port}/api`;
    const token = `Bearer ${jwt.sign({ id_usuario: 7, perfil: "TECNICO" }, process.env.JWT_SECRET)}`;

    const rotas = [
        ["POST", "/ordens-servico/1/pagamentos"],
        ["PATCH", "/pagamentos/1/status"],
        ["PATCH", "/pagamentos/1/reembolso"],
        ["POST", "/ordens-servico/1/expedicao"],
        ["PATCH", "/expedicoes/1/status"]
    ];

    for (const [metodo, caminho] of rotas) {
        const resposta = await fetch(base + caminho, {
            method: metodo,
            headers: { "Content-Type": "application/json", Authorization: token },
            body: "{}"
        });
        assert.equal(resposta.status, 403, `${metodo} ${caminho}`);
    }
});

// ---------- Expedição ----------

test("dispatch: delivery method must be RETIRADA or ENVIO; tracking code only for ENVIO", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, expedicaoRepository, { criar: async (dados) => dados });

    await assert.rejects(expedicaoService.criar(9, { forma_entrega: "Transportadora" }, ATENDENTE), { statusCode: 400 });
    await assert.rejects(expedicaoService.criar(9, { forma_entrega: "RETIRADA", codigo_rastreio: "BR1" }, ATENDENTE), { statusCode: 400 });
    await assert.rejects(expedicaoService.criar(9, { forma_entrega: "ENVIO" }, TECNICO), { statusCode: 403 });

    const envio = await expedicaoService.criar(9, { forma_entrega: "envio", codigo_rastreio: " BR123 " }, ATENDENTE);
    assert.equal(envio.forma_entrega, "ENVIO");
    assert.equal(envio.codigo_rastreio, "BR123");
});

function simularExpedicao(teste, { forma, status, statusOs, quitado = true }) {
    const simulada = conexaoFalsa((sql) => {
        if (sql.includes("FROM ordem_servico")) return [[{ id_os: 9, status: statusOs }], []];
        if (sql.includes("FROM expedicao")) return [[{ id_expedicao: 42, id_os: 9, forma_entrega: forma, status }], []];
    });
    substituirMetodos(teste, expedicaoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, expedicaoRepository, { buscarPorOs: async () => ({ id_expedicao: 42, id_os: 9, forma_entrega: forma, status }) });
    substituirMetodos(teste, pagamentoRepository, {
        buscarValoresOs: async () => ({
            tem_orcamento_aprovado: true,
            total_orcado_centavos: 10000, total_abatido_centavos: 0, total_devido_centavos: 10000,
            total_confirmado_centavos: quitado ? 10000 : 6000,
            total_pendente_centavos: 0
        })
    });
    return simulada;
}

test("dispatch ENVIO: PENDENTE -> EM_TRANSITO records the dispatch date and tracking code", async (teste) => {
    const simulada = simularExpedicao(teste, { forma: "ENVIO", status: "PENDENTE", statusOs: "AGUARDANDO_EXPEDICAO" });

    await expedicaoRepository.atualizarStatus(9, "EM_TRANSITO", "BR999");

    const [update] = atualizacoes(simulada.comandos, "UPDATE expedicao");
    assert.deepEqual(update.parametros, ["EM_TRANSITO", "EM_TRANSITO", "BR999", 0, 9]);
    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico").length, 0);
});

test("dispatch: steps cannot be skipped and a finished dispatch cannot change", async (teste) => {
    const casos = [
        { forma: "ENVIO", status: "PENDENTE", novo: "ENTREGUE" },
        { forma: "ENVIO", status: "EM_TRANSITO", novo: "RETIRADO" },
        { forma: "RETIRADA", status: "AGUARDANDO_RETIRADA", novo: "EM_TRANSITO" },
        { forma: "ENVIO", status: "ENTREGUE", novo: "EM_TRANSITO" },
        { forma: "RETIRADA", status: "RETIRADO", novo: "RETIRADO" }
    ];

    for (const caso of casos) {
        const simulada = simularExpedicao(teste, { ...caso, statusOs: "AGUARDANDO_EXPEDICAO" });
        await assert.rejects(expedicaoRepository.atualizarStatus(9, caso.novo), { statusCode: 409 }, JSON.stringify(caso));
        assert.equal(atualizacoes(simulada.comandos, "UPDATE expedicao").length, 0);
    }
});

test("dispatch: repaired order is FINALIZADA after delivery only when fully paid (RN19, RN20)", async (teste) => {
    const devendo = simularExpedicao(teste, { forma: "ENVIO", status: "EM_TRANSITO", statusOs: "AGUARDANDO_EXPEDICAO", quitado: false });
    await assert.rejects(expedicaoRepository.atualizarStatus(9, "ENTREGUE"), { statusCode: 409 });
    assert.equal(atualizacoes(devendo.comandos, "UPDATE expedicao").length, 0);
    assert.equal(atualizacoes(devendo.comandos, "UPDATE ordem_servico").length, 0);

    const quitado = simularExpedicao(teste, { forma: "ENVIO", status: "EM_TRANSITO", statusOs: "AGUARDANDO_EXPEDICAO" });
    await expedicaoRepository.atualizarStatus(9, "ENTREGUE");
    const [finalizar] = atualizacoes(quitado.comandos, "UPDATE ordem_servico");
    assert.match(finalizar.sql, /status = 'FINALIZADA'/);
});

test("dispatch: an order closed without repair stays ENCERRADA_SEM_REPARO after pickup", async (teste) => {
    const simulada = simularExpedicao(teste, { forma: "RETIRADA", status: "AGUARDANDO_RETIRADA", statusOs: "ENCERRADA_SEM_REPARO", quitado: false });
    substituirMetodos(teste, pagamentoRepository, { buscarValoresOs: async () => assert.fail("sem reparo não exige pagamento") });

    await expedicaoRepository.atualizarStatus(9, "RETIRADO");

    const [update] = atualizacoes(simulada.comandos, "UPDATE expedicao");
    assert.deepEqual(update.parametros, ["RETIRADO", "RETIRADO", null, 1, 9]);
    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico").length, 0);
});

test("dispatch service: tracking code only when moving to EM_TRANSITO; unknown status is 400", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, expedicaoRepository, { atualizarStatus: async (id, status, codigo) => ({ id_os: id, status, codigo }) });

    await assert.rejects(expedicaoService.atualizarStatus(9, { status: "ENVIADA" }, ATENDENTE), { statusCode: 400 });
    await assert.rejects(expedicaoService.atualizarStatus(9, { status: "ENTREGUE", codigo_rastreio: "X" }, ATENDENTE), { statusCode: 400 });

    const resultado = await expedicaoService.atualizarStatus(9, { status: "EM_TRANSITO", codigo_rastreio: " BR1 " }, ATENDENTE);
    assert.deepEqual(resultado, { id_os: 9, status: "EM_TRANSITO", codigo: "BR1" });
});
