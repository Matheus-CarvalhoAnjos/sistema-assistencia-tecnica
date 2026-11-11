/*
 * Decisões de 09/11/2026: avaliação financeira (D1–D4), reembolso sob avaliação (D5, D6),
 * acessórios depois da abertura (D7, P4) e edição do laudo (D8, O2).
 * Conexões simuladas: nenhum teste acessa o MySQL (a gravação real está em integracao/).
 */
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const avaliacaoReembolsoRepository = require("../src/repositories/avaliacaoReembolsoRepository");
const avaliacaoReembolsoService = require("../src/services/avaliacaoReembolsoService");
const pagamentoRepository = require("../src/repositories/pagamentoRepository");
const acessorioRecebidoRepository = require("../src/repositories/acessorioRecebidoRepository");
const execucaoRepository = require("../src/repositories/execucaoRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const { pool } = require("../src/config/database");

function substituirMetodos(teste, alvo, substitutos) {
    const originais = {};
    for (const [nome, metodo] of Object.entries(substitutos)) {
        originais[nome] = alvo[nome];
        alvo[nome] = metodo;
    }
    teste.after(() => Object.assign(alvo, originais));
}

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
                const texto = sql.replace(/\s+/g, " ").trim();
                comandos.push({ sql: texto, parametros });
                return responder(texto, parametros) ?? [{ affectedRows: 1, insertId: 1 }, []];
            }
        }
    };
}

const comandosCom = (comandos, trecho) => comandos.filter((c) => typeof c === "object" && c.sql.includes(trecho));
const eventos = (comandos) => comandosCom(comandos, "INSERT INTO historico_os").map(({ parametros: [id_os, id_usuario, tipo, descricao, ant, nov] }) => ({
    id_os, id_usuario, tipo, descricao, anteriores: ant ? JSON.parse(ant) : null, novos: nov ? JSON.parse(nov) : null
}));

const ATENDENTE = { id_usuario: 2, perfil: "ATENDENTE" };
const usuarios = { 1: { id_usuario: 1, perfil: "ADMINISTRADOR", ativo: 1 }, 2: { id_usuario: 2, perfil: "ATENDENTE", ativo: 1 }, 7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 } };

/*
 * Situação financeira simulada de uma OS.
 * confirmados: [{ id_pagamento, valor, reembolsado }]
 */
function financeiro({
    tipo_encerramento = "IMPOSSIBILIDADE_TECNICA", aprovado = true, confirmados = [{ id_pagamento: 55, valor: "200.00", reembolsado: "0" }],
    avaliacoes = [], somaAvaliacao = "0", pagamento = null, reembolsadoPagamento = "0", dup = false
} = {}) {
    return (sql) => {
        if (sql.startsWith("SELECT id_os, status, tipo_encerramento FROM ordem_servico")) {
            return [[{ id_os: 8, status: "ENCERRADA_SEM_REPARO", tipo_encerramento }], []];
        }
        if (sql.includes("FROM orcamento WHERE id_os = ? AND status = 'APROVADO'")) return [aprovado ? [{ id_orcamento: 1 }] : [], []];
        if (sql.includes("FROM pagamento p WHERE p.id_os = ? AND p.status = 'CONFIRMADO'")) return [confirmados, []];
        if (sql.includes("FROM avaliacao_reembolso a LEFT JOIN usuario")) return [avaliacoes, []];
        if (sql.includes("INNER JOIN avaliacao_reembolso a")) return [[{ total: somaAvaliacao }], []];
        if (sql.startsWith("INSERT INTO avaliacao_reembolso")) {
            if (dup) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
            return [{ insertId: 31 }, []];
        }
        if (sql.startsWith("SELECT id_pagamento, id_os, valor, status FROM pagamento")) return [[{ id_os: 8, ...pagamento }], []];
        if (sql.includes("FROM reembolso WHERE id_pagamento = ?")) return [[{ total: reembolsadoPagamento }], []];
        if (sql.startsWith("INSERT INTO reembolso")) return [{ insertId: 900 }, []];
        return undefined;
    };
}

const AVALIACAO_ORIGINAL = { id_avaliacao: 30, id_os: 8, id_avaliacao_revisada: null, valor_definido: "120.00", justificativa: "Peça já comprada", motivo_revisao: null, id_usuario: 2 };

// ---------- Avaliação financeira (D1–D4) ----------

test("D1: original evaluation is recorded (value zero allowed) with a PAGAMENTO event, inside one transaction", async (teste) => {
    const simulada = conexaoFalsa(financeiro());
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao, execute: async (sql) => simulada.conexao.execute(sql) });

    await avaliacaoReembolsoRepository.registrar({ id_os: 8, valor_centavos: 0, justificativa: "Cliente não terá devolução", id_usuario: 2 });

    // A OS é bloqueada primeiro
    assert.match(simulada.comandos[1].sql, /FROM ordem_servico WHERE id_os = \? FOR UPDATE/);
    const [insert] = comandosCom(simulada.comandos, "INSERT INTO avaliacao_reembolso");
    assert.deepEqual(insert.parametros, [8, null, 0, "Cliente não terá devolução", null, 2]);
    const [evento] = eventos(simulada.comandos);
    assert.equal(evento.tipo, "PAGAMENTO");
    assert.equal(evento.descricao, "Avaliação financeira registrada: reembolso definido em R$ 0,00.");
    assert.deepEqual(evento.novos, { id_avaliacao: 31, valor_definido: 0, justificativa: "Cliente não terá devolução" });
    assert.ok(simulada.comandos.includes("COMMIT"));
});

test("D3: evaluation is refused when the OS does not require it (other closing, no approved quote, no confirmed payment)", async (teste) => {
    for (const opcoes of [
        { tipo_encerramento: "DESISTENCIA_CLIENTE" },
        { tipo_encerramento: "ORCAMENTO_REJEITADO" },
        { tipo_encerramento: null },
        { aprovado: false },
        { confirmados: [] }
    ]) {
        const simulada = conexaoFalsa(financeiro(opcoes));
        substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

        await assert.rejects(
            avaliacaoReembolsoRepository.registrar({ id_os: 8, valor_centavos: 0, justificativa: "x", id_usuario: 2 }),
            { statusCode: 409, message: /só se aplica/ },
            JSON.stringify(opcoes)
        );
        assert.equal(comandosCom(simulada.comandos, "INSERT").length, 0);
    }
});

test("D1/D6: the defined value cannot exceed what is still available for refund", async (teste) => {
    const simulada = conexaoFalsa(financeiro({ confirmados: [{ id_pagamento: 55, valor: "200.00", reembolsado: "50.00" }] }));
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(
        avaliacaoReembolsoRepository.registrar({ id_os: 8, valor_centavos: 15001, justificativa: "x", id_usuario: 2 }),
        { statusCode: 409, message: /R\$ 150,00/ }
    );
    assert.ok(simulada.comandos.includes("ROLLBACK"));
});

test("D2: a second original is refused; the correction is a revision that preserves the previous one", async (teste) => {
    const simulada = conexaoFalsa(financeiro({ avaliacoes: [AVALIACAO_ORIGINAL] }));
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao, execute: async (sql) => simulada.conexao.execute(sql) });

    await assert.rejects(
        avaliacaoReembolsoRepository.registrar({ id_os: 8, valor_centavos: 100, justificativa: "x", id_usuario: 2 }),
        { statusCode: 409, message: /registre uma revisão/ }
    );

    await avaliacaoReembolsoRepository.registrar({
        id_os: 8, id_avaliacao_revisada: 30, valor_centavos: 9000, justificativa: "Fornecedor aceitou devolução", motivo_revisao: "Valor recalculado", id_usuario: 1
    });

    const [insert] = comandosCom(simulada.comandos, "INSERT INTO avaliacao_reembolso");
    assert.deepEqual(insert.parametros, [8, 30, 90, "Fornecedor aceitou devolução", "Valor recalculado", 1]);
    // Nenhuma linha de avaliação é alterada ou excluída
    assert.equal(comandosCom(simulada.comandos, "UPDATE avaliacao_reembolso").length, 0);
    assert.equal(comandosCom(simulada.comandos, "DELETE").length, 0);
    const [evento] = eventos(simulada.comandos);
    assert.equal(evento.descricao, "Avaliação financeira revisada: reembolso definido em R$ 90,00.");
    assert.deepEqual(evento.anteriores, { id_avaliacao: 30, valor_definido: 120 });
    assert.equal(evento.novos.motivo_revisao, "Valor recalculado");
});

test("D2: a revision of an outdated evaluation, or below what was already refunded, is refused", async (teste) => {
    const simulada = conexaoFalsa(financeiro({ avaliacoes: [AVALIACAO_ORIGINAL], somaAvaliacao: "60.00" }));
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(
        avaliacaoReembolsoRepository.registrar({ id_os: 8, id_avaliacao_revisada: 29, valor_centavos: 9000, justificativa: "x", motivo_revisao: "y", id_usuario: 2 }),
        { statusCode: 409, message: /outra revisão/ }
    );
    await assert.rejects(
        avaliacaoReembolsoRepository.registrar({ id_os: 8, id_avaliacao_revisada: 30, valor_centavos: 5999, justificativa: "x", motivo_revisao: "y", id_usuario: 2 }),
        { statusCode: 409, message: /já reembolsado \(R\$ 60,00\)/ }
    );
});

test("D2: two simultaneous originals: the database UNIQUE turns the second one into 409", async (teste) => {
    const simulada = conexaoFalsa(financeiro({ dup: true }));
    substituirMetodos(teste, pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(
        avaliacaoReembolsoRepository.registrar({ id_os: 8, valor_centavos: 100, justificativa: "x", id_usuario: 2 }),
        { statusCode: 409, message: /ao mesmo tempo/ }
    );
    assert.ok(simulada.comandos.includes("ROLLBACK"));
});

test("service: only active ADMINISTRADOR/ATENDENTE; value, justification and revision reason are validated", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, avaliacaoReembolsoRepository, { registrar: async (dados) => dados });

    await assert.rejects(avaliacaoReembolsoService.registrar(8, { valor_definido: 0, justificativa: "x" }, { id_usuario: 7, perfil: "TECNICO" }), { statusCode: 403 });
    for (const valor_definido of [undefined, "", -1, "abc", 1.005]) {
        await assert.rejects(avaliacaoReembolsoService.registrar(8, { valor_definido, justificativa: "x" }, ATENDENTE), { statusCode: 400 }, String(valor_definido));
    }
    await assert.rejects(avaliacaoReembolsoService.registrar(8, { valor_definido: 10, justificativa: "  " }, ATENDENTE), { statusCode: 400 });
    await assert.rejects(avaliacaoReembolsoService.revisar(8, { id_avaliacao_revisada: 30, valor_definido: 10, justificativa: "x" }, ATENDENTE), { statusCode: 400 });

    const dados = await avaliacaoReembolsoService.registrar(8, { valor_definido: "0", justificativa: " Sem devolução " }, ATENDENTE);
    assert.deepEqual(dados, { id_os: 8, valor_centavos: 0, justificativa: "Sem devolução", id_usuario: 2 });
});

// ---------- Reembolso sob avaliação (D1, D6) ----------

function prepararReembolso(teste, opcoes) {
    const simulada = conexaoFalsa(financeiro(opcoes));
    substituirMetodos(teste, pagamentoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, pagamentoRepository, {
        buscarPorId: async () => ({ id_pagamento: 55, id_os: 8 }),
        listarPorOs: async () => []
    });
    return simulada;
}

test("D1: refund of an OS that requires evaluation is refused until the evaluation exists", async (teste) => {
    const simulada = prepararReembolso(teste, { pagamento: { id_pagamento: 55, valor: "200.00", status: "CONFIRMADO" } });

    await assert.rejects(pagamentoRepository.reembolsar(55, 2, "x", 1000), { statusCode: 409, message: /avaliação financeira/ });
    assert.equal(comandosCom(simulada.comandos, "INSERT INTO reembolso").length, 0);
});

test("D1/D6: refunds under evaluation are limited to the defined value and linked to the current evaluation", async (teste) => {
    const opcoes = {
        avaliacoes: [AVALIACAO_ORIGINAL], somaAvaliacao: "100.00",
        pagamento: { id_pagamento: 55, valor: "200.00", status: "CONFIRMADO" }, reembolsadoPagamento: "100.00"
    };
    let simulada = prepararReembolso(teste, opcoes);
    await assert.rejects(pagamentoRepository.reembolsar(55, 2, "x", 2001), { statusCode: 409, message: /restam R\$ 20,00/ });

    simulada = prepararReembolso(teste, opcoes);
    await pagamentoRepository.reembolsar(55, 2, "Segunda parte", 2000);
    assert.deepEqual(comandosCom(simulada.comandos, "INSERT INTO reembolso")[0].parametros, [55, 30, 20, "Segunda parte", 2]);
    assert.equal(eventos(simulada.comandos)[0].novos.id_avaliacao, 30);
});

test("D5: refund in an OS without evaluation requirement (e.g. FINALIZADA) is allowed and not linked to an evaluation", async (teste) => {
    const simulada = prepararReembolso(teste, { tipo_encerramento: null, pagamento: { id_pagamento: 55, valor: "200.00", status: "CONFIRMADO" } });

    await pagamentoRepository.reembolsar(55, 2, "Garantia comercial", 5000);
    assert.deepEqual(comandosCom(simulada.comandos, "INSERT INTO reembolso")[0].parametros, [55, null, 50, "Garantia comercial", 2]);
});

// ---------- Acessórios depois da abertura (D7, P4) ----------

function conexaoAcessorios(os) {
    return conexaoFalsa((sql) => {
        if (sql.includes("FROM ordem_servico")) return [[os], []];
        if (sql.startsWith("INSERT INTO acessorio_recebido")) return [{ insertId: 77 }, []];
        return undefined;
    });
}

const REGISTRO = [{ id_item: 4, id_acessorio: 3, descricao_acessorio: "Carregador", quantidade: 2, observacoes: null }];

test("D7: accessories are refused from CONCLUIDA on, and nothing is written", async (teste) => {
    for (const status of ["CONCLUIDA", "AGUARDANDO_EXPEDICAO", "FINALIZADA", "ENCERRADA_SEM_REPARO"]) {
        const simulada = conexaoAcessorios({ id_os: 9, id_item: 4, status, id_tecnico: 7 });
        substituirMetodos(teste, acessorioRecebidoRepository.pool, { getConnection: async () => simulada.conexao });

        await assert.rejects(acessorioRecebidoRepository.criarVarios(REGISTRO, { id_usuario: 2, perfil: "ATENDENTE" }), { statusCode: 409 }, status);
        assert.equal(comandosCom(simulada.comandos, "INSERT").length, 0, status);
    }
});

test("D7: a technician cannot register accessories in another technician's OS", async (teste) => {
    const simulada = conexaoAcessorios({ id_os: 9, id_item: 4, status: "EM_REPARO", id_tecnico: 8 });
    substituirMetodos(teste, acessorioRecebidoRepository.pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(acessorioRecebidoRepository.criarVarios(REGISTRO, { id_usuario: 7, perfil: "TECNICO" }), { statusCode: 403 });
    assert.equal(comandosCom(simulada.comandos, "INSERT").length, 0);
});

test("D7: assigned technician and attendant register in active OS; each inclusion creates an ACESSORIO event in the item's current OS", async (teste) => {
    for (const [usuario, os] of [
        [{ id_usuario: 7, perfil: "TECNICO" }, { id_os: 9, id_item: 4, status: "EM_ANALISE", id_tecnico: 7 }],
        [{ id_usuario: 2, perfil: "ATENDENTE" }, { id_os: 9, id_item: 4, status: "RECEBIDA", id_tecnico: null }]
    ]) {
        const simulada = conexaoAcessorios(os);
        substituirMetodos(teste, acessorioRecebidoRepository.pool, { getConnection: async () => simulada.conexao });
        substituirMetodos(teste, acessorioRecebidoRepository, { buscarPorId: async (id) => ({ id_acessorio_recebido: id }) });

        await acessorioRecebidoRepository.criarVarios(REGISTRO, usuario);

        // OS atual do equipamento: a mais recente do item, bloqueada
        assert.match(comandosCom(simulada.comandos, "FROM ordem_servico")[0].sql, /WHERE id_item = \? ORDER BY id_os DESC LIMIT 1 FOR UPDATE/);
        assert.deepEqual(eventos(simulada.comandos), [{
            id_os: 9, id_usuario: usuario.id_usuario, tipo: "ACESSORIO",
            descricao: "Acessório recebido registrado: 2× Carregador.",
            anteriores: null,
            novos: { id_acessorio_recebido: 77, id_item: 4, id_acessorio: 3, descricao_acessorio: "Carregador", quantidade: 2 }
        }]);
        assert.ok(simulada.comandos.includes("COMMIT"));
    }
});

test("D7: through the OS route, the OS in the URL is used and must be the equipment's OS", async (teste) => {
    const simulada = conexaoAcessorios({ id_os: 9, id_item: 5, status: "RECEBIDA", id_tecnico: null });
    substituirMetodos(teste, acessorioRecebidoRepository.pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(acessorioRecebidoRepository.criarVarios(REGISTRO, { id_usuario: 2, perfil: "ATENDENTE", id_os: 9 }), { statusCode: 409 });
    assert.match(comandosCom(simulada.comandos, "FROM ordem_servico")[0].sql, /WHERE id_os = \? FOR UPDATE/);
});

// ---------- Laudo técnico (D8, O2) ----------

function conexaoLaudo(os) {
    return conexaoFalsa((sql) => {
        if (sql.startsWith("SELECT status, id_tecnico FROM ordem_servico")) return [[os], []];
        if (sql.startsWith("SELECT diagnostico")) return [[{ diagnostico: "Placa", laudo_tecnico: null, resultado: null, data_inicio: null, data_conclusao: null }], []];
        return undefined;
    });
}

const EDICAO = { diagnostico: "Placa", laudo_tecnico: "Laudo corrigido", resultado: null, data_inicio: null, data_conclusao: null, id_usuario: 7 };

test("D8: the assigned technician edits the report in CONCLUIDA and AGUARDANDO_EXPEDICAO, with before/after in the history", async (teste) => {
    for (const status of ["CONCLUIDA", "AGUARDANDO_EXPEDICAO"]) {
        const simulada = conexaoLaudo({ status, id_tecnico: 7 });
        substituirMetodos(teste, execucaoRepository.pool, { getConnection: async () => simulada.conexao });
        substituirMetodos(teste, execucaoRepository, { buscarPorOs: async () => ({ id_os: 11 }) });

        await execucaoRepository.atualizar(11, EDICAO);
        const [evento] = eventos(simulada.comandos);
        assert.deepEqual([evento.tipo, evento.anteriores, evento.novos], ["DIAGNOSTICO", { laudo_tecnico: null }, { laudo_tecnico: "Laudo corrigido" }], status);
    }
});

test("D8: FINALIZADA and ENCERRADA_SEM_REPARO block the edit; a technician no longer assigned gets 403 (checked under lock)", async (teste) => {
    for (const [os, codigo] of [
        [{ status: "FINALIZADA", id_tecnico: 7 }, 409],
        [{ status: "ENCERRADA_SEM_REPARO", id_tecnico: 7 }, 409],
        [{ status: "EM_REPARO", id_tecnico: 8 }, 403]
    ]) {
        const simulada = conexaoLaudo(os);
        substituirMetodos(teste, execucaoRepository.pool, { getConnection: async () => simulada.conexao });

        await assert.rejects(execucaoRepository.atualizar(11, EDICAO), { statusCode: codigo }, os.status);
        assert.match(simulada.comandos[1].sql, /FOR UPDATE/);
        assert.equal(comandosCom(simulada.comandos, "UPDATE execucao").length, 0);
        assert.ok(simulada.comandos.includes("ROLLBACK"));
    }
});
