/*
 * Encerramento sem reparo (RN07, RN08, RN11, RN12, RN13) e garantia em EM_ANALISE (RN06).
 * Conexões e repositories simulados: nenhum teste acessa o MySQL.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const encerramentoRepository = require("../src/repositories/encerramentoRepository");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const ordemServicoService = require("../src/services/ordemServicoService");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const historicoRepository = require("../src/repositories/historicoRepository");
const { pool } = require("../src/config/database");

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

const USUARIOS = {
    1: { id_usuario: 1, perfil: "ADMINISTRADOR", ativo: 1 },
    2: { id_usuario: 2, perfil: "ATENDENTE", ativo: 1 },
    7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 },
    8: { id_usuario: 8, perfil: "TECNICO", ativo: 1 }
};

/*
 * Banco simulado da transação de encerramento. Guarda os comandos e
 * devolve a OS, a execução, os orçamentos e os pagamentos da situação informada.
 */
function bancoEncerramento({ status, comDiagnostico = true, orcamentos = [], pagamentos = [], falharHistorico = false }) {
    const comandos = [];
    const responder = (sql, parametros) => {
        if (sql.startsWith("SELECT id_os, status FROM ordem_servico")) return [[{ id_os: 11, status }], []];
        if (sql.startsWith("SELECT id_execucao FROM execucao")) return [comDiagnostico ? [{ id_execucao: 3 }] : [], []];
        if (sql.startsWith("SELECT id_orcamento FROM orcamento WHERE id_os = ? AND status = 'PENDENTE' AND data_validade <=")) {
            return [orcamentos.filter((o) => o.status === "PENDENTE" && o.vencido).map(({ id_orcamento }) => ({ id_orcamento })), []];
        }
        if (sql.startsWith("SELECT id_orcamento FROM orcamento")) {
            return [orcamentos.filter((o) => o.status === "PENDENTE" && !o.vencido).map(({ id_orcamento }) => ({ id_orcamento })), []];
        }
        if (sql.startsWith("SELECT id_pagamento, valor FROM pagamento")) {
            return [pagamentos.filter((p) => p.status === "PENDENTE").map(({ id_pagamento, valor }) => ({ id_pagamento, valor })), []];
        }
        if (sql.startsWith("INSERT INTO historico_os") && falharHistorico) {
            throw new Error("falha simulada ao gravar o histórico");
        }
        return [{ affectedRows: 1 }, []];
    };

    return {
        comandos,
        conexao: {
            beginTransaction: async () => comandos.push("BEGIN"),
            commit: async () => comandos.push("COMMIT"),
            rollback: async () => comandos.push("ROLLBACK"),
            release: () => comandos.push("RELEASE"),
            execute: async (sql, parametros) => {
                const texto = sql.replace(/\s+/g, " ").trim();
                const resposta = responder(texto, parametros);
                comandos.push({ sql: texto, parametros });
                return resposta;
            }
        }
    };
}

const comandosSql = (banco, inicio) => banco.comandos.filter((c) => typeof c === "object" && c.sql.startsWith(inicio));
const eventos = (banco) => comandosSql(banco, "INSERT INTO historico_os").map(({ parametros }) => ({
    id_os: parametros[0],
    id_usuario: parametros[1],
    tipo_evento: parametros[2],
    dados_anteriores: parametros[4] ? JSON.parse(parametros[4]) : null,
    dados_novos: parametros[5] ? JSON.parse(parametros[5]) : null
}));

function usarBanco(teste, banco) {
    substituirMetodos(teste, pool, { getConnection: async () => banco.conexao });
}

const encerrar = (tipo, idUsuario = 7) => encerramentoRepository.encerrarSemReparo({
    id_os: 11, tipo_encerramento: tipo, motivo: "Peça fora de linha", id_usuario: idUsuario
});

// ---------- Regras de etapa e diagnóstico ----------

test("customer withdrawal is allowed in RECEBIDA, EM_ANALISE and AGUARDANDO_APROVACAO, even without diagnosis", async (teste) => {
    for (const status of ["RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO"]) {
        const banco = bancoEncerramento({ status, comDiagnostico: false });
        usarBanco(teste, banco);

        const resultado = await encerrar("DESISTENCIA_CLIENTE", 2);

        assert.equal(resultado.status, "ENCERRADA_SEM_REPARO", status);
        assert.ok(banco.comandos.includes("COMMIT"), status);
        assert.equal(comandosSql(banco, "SELECT id_execucao").length, 0, "desistência não exige diagnóstico");
    }
});

test("customer withdrawal is refused after the repair started", async (teste) => {
    for (const status of ["EM_REPARO", "CONCLUIDA", "AGUARDANDO_EXPEDICAO", "FINALIZADA", "ENCERRADA_SEM_REPARO"]) {
        const banco = bancoEncerramento({ status });
        usarBanco(teste, banco);

        await assert.rejects(encerrar("DESISTENCIA_CLIENTE", 2), { statusCode: 409 }, status);
        assert.equal(comandosSql(banco, "UPDATE").length, 0, status);
        assert.ok(banco.comandos.includes("ROLLBACK"), status);
    }
});

test("technical impossibility is allowed up to EM_REPARO and requires the diagnosis", async (teste) => {
    for (const status of ["EM_ANALISE", "AGUARDANDO_APROVACAO", "EM_REPARO"]) {
        const banco = bancoEncerramento({ status });
        usarBanco(teste, banco);
        assert.equal((await encerrar("IMPOSSIBILIDADE_TECNICA")).status, "ENCERRADA_SEM_REPARO", status);
    }

    const semDiagnostico = bancoEncerramento({ status: "RECEBIDA", comDiagnostico: false });
    usarBanco(teste, semDiagnostico);
    await assert.rejects(encerrar("IMPOSSIBILIDADE_TECNICA"), { statusCode: 409 });
    assert.equal(comandosSql(semDiagnostico, "UPDATE").length, 0);

    for (const status of ["CONCLUIDA", "AGUARDANDO_EXPEDICAO", "FINALIZADA", "ENCERRADA_SEM_REPARO"]) {
        const banco = bancoEncerramento({ status });
        usarBanco(teste, banco);
        await assert.rejects(encerrar("IMPOSSIBILIDADE_TECNICA"), { statusCode: 409 }, status);
    }
});

// ---------- Gravação: OS, cancelamentos e histórico ----------

test("closing records type, reason and user, cancels pending quotes and payments and preserves the others", async (teste) => {
    const banco = bancoEncerramento({
        status: "EM_REPARO",
        orcamentos: [{ id_orcamento: 30, status: "APROVADO" }, { id_orcamento: 31, status: "PENDENTE" }],
        pagamentos: [
            { id_pagamento: 50, status: "CONFIRMADO", valor: "100.00" },
            { id_pagamento: 51, status: "PENDENTE", valor: "40.00" },
            { id_pagamento: 52, status: "REEMBOLSADO", valor: "10.00" }
        ]
    });
    usarBanco(teste, banco);

    const resultado = await encerrar("IMPOSSIBILIDADE_TECNICA");

    const [encerrarOs] = comandosSql(banco, "UPDATE ordem_servico");
    assert.match(encerrarOs.sql, /status = 'ENCERRADA_SEM_REPARO', data_encerramento = CURRENT_TIMESTAMP, tipo_encerramento = \?, motivo_encerramento = \?, id_usuario_encerramento = \?/);
    assert.deepEqual(encerrarOs.parametros, ["IMPOSSIBILIDADE_TECNICA", "Peça fora de linha", 7, 11]);

    // Somente os registros PENDENTE são cancelados; nada é apagado
    assert.deepEqual(comandosSql(banco, "UPDATE orcamento").map((c) => c.parametros), [[31]]);
    assert.deepEqual(comandosSql(banco, "UPDATE pagamento").map((c) => c.parametros), [[51]]);
    assert.equal(comandosSql(banco, "DELETE").length, 0);
    assert.deepEqual(resultado.orcamentos_cancelados, [31]);
    assert.deepEqual(resultado.pagamentos_cancelados, [51]);

    // Histórico na mesma transação: encerramento + cada cancelamento, todos na OS 11 e pelo técnico
    assert.deepEqual(eventos(banco).map((e) => [e.id_os, e.id_usuario, e.tipo_evento, e.dados_novos.status ?? e.dados_novos.status_os]), [
        [11, 7, "ENCERRAMENTO", "ENCERRADA_SEM_REPARO"],
        [11, 7, "ORCAMENTO", "CANCELADO"],
        [11, 7, "PAGAMENTO", "CANCELADO"]
    ]);
    assert.deepEqual(eventos(banco)[0].dados_anteriores, { status_os: "EM_REPARO" });
    assert.equal(banco.comandos.filter((c) => c === "COMMIT").length, 1);
});

test("an expired pending quote becomes VENCIDO (not CANCELADO) when the order is closed", async (teste) => {
    const banco = bancoEncerramento({
        status: "AGUARDANDO_APROVACAO",
        orcamentos: [{ id_orcamento: 32, status: "PENDENTE", vencido: true }]
    });
    usarBanco(teste, banco);

    await encerrar("DESISTENCIA_CLIENTE", 2);

    assert.equal(comandosSql(banco, "UPDATE orcamento SET status = 'CANCELADO'").length, 0);
    assert.deepEqual(eventos(banco).map((e) => [e.tipo_evento, e.id_usuario, e.dados_novos.status ?? e.dados_novos.status_os]), [
        ["ORCAMENTO", null, "VENCIDO"],
        ["ENCERRAMENTO", 2, "ENCERRADA_SEM_REPARO"]
    ]);
});

test("if the history insert fails, the closing and the cancellations are rolled back", async (teste) => {
    const banco = bancoEncerramento({ status: "EM_ANALISE", falharHistorico: true });
    usarBanco(teste, banco);

    await assert.rejects(encerrar("DESISTENCIA_CLIENTE", 2), /falha simulada/);
    assert.ok(banco.comandos.includes("ROLLBACK"));
    assert.ok(!banco.comandos.includes("COMMIT"));
});

// ---------- Service: tipo, perfil, justificativa ----------

function simularOs(teste, status = "EM_ANALISE") {
    const chamadas = [];
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => USUARIOS[id] ?? null });
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async (id) => (Number(id) === 11 ? { id_os: 11, id_tecnico: 7, status } : null),
        buscarDetalhes: async () => null
    });
    substituirMetodos(teste, encerramentoRepository, {
        encerrarSemReparo: async (dados) => {
            chamadas.push(dados);
            return { id_os: 11, status: "ENCERRADA_SEM_REPARO" };
        }
    });
    return chamadas;
}

test("service: only the technician closes for technical impossibility; withdrawal also by staff", async (teste) => {
    const chamadas = simularOs(teste);
    const dados = (tipo) => ({ tipo_encerramento: tipo, motivo_encerramento: "  Cliente levou o aparelho  " });

    await assert.rejects(ordemServicoService.encerrarSemReparo(11, dados("IMPOSSIBILIDADE_TECNICA"), USUARIOS[1]), { statusCode: 403 });
    await assert.rejects(ordemServicoService.encerrarSemReparo(11, dados("IMPOSSIBILIDADE_TECNICA"), USUARIOS[2]), { statusCode: 403 });
    await assert.rejects(ordemServicoService.encerrarSemReparo(11, dados("IMPOSSIBILIDADE_TECNICA"), USUARIOS[8]), { statusCode: 404 });
    assert.equal(chamadas.length, 0);

    for (const id of [1, 2, 7]) {
        await ordemServicoService.encerrarSemReparo(11, dados("DESISTENCIA_CLIENTE"), USUARIOS[id]);
    }
    await ordemServicoService.encerrarSemReparo(11, dados("IMPOSSIBILIDADE_TECNICA"), USUARIOS[7]);

    assert.deepEqual(chamadas.map((c) => [c.tipo_encerramento, c.id_usuario, c.motivo]), [
        ["DESISTENCIA_CLIENTE", 1, "Cliente levou o aparelho"],
        ["DESISTENCIA_CLIENTE", 2, "Cliente levou o aparelho"],
        ["DESISTENCIA_CLIENTE", 7, "Cliente levou o aparelho"],
        ["IMPOSSIBILIDADE_TECNICA", 7, "Cliente levou o aparelho"]
    ]);
});

test("service: justification required; ORCAMENTO_REJEITADO and unknown types are not accepted", async (teste) => {
    const chamadas = simularOs(teste);

    for (const dados of [
        { tipo_encerramento: "DESISTENCIA_CLIENTE" },
        { tipo_encerramento: "DESISTENCIA_CLIENTE", motivo_encerramento: "   " },
        { tipo_encerramento: "ORCAMENTO_REJEITADO", motivo_encerramento: "x" },
        { tipo_encerramento: "OUTRO", motivo_encerramento: "x" },
        { tipo_encerramento: "DESISTENCIA_CLIENTE", motivo_encerramento: "€".repeat(21846) }
    ]) {
        await assert.rejects(ordemServicoService.encerrarSemReparo(11, dados, USUARIOS[2]), { statusCode: 400 }, JSON.stringify(dados).slice(0, 60));
    }
    assert.equal(chamadas.length, 0);
});

// ---------- RN06: garantia só em EM_ANALISE ----------

test("RN06: warranty can only be set while the order is EM_ANALISE", async (teste) => {
    // A verificação é do atendente (usuário 2), conferido no banco
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => USUARIOS[id] ?? null });

    for (const status of ["RECEBIDA", "AGUARDANDO_APROVACAO", "EM_REPARO", "ENCERRADA_SEM_REPARO"]) {
        const gravacoes = [];
        substituirMetodos(teste, ordemServicoRepository, {
            buscarPorId: async () => ({ id_os: 11, id_tecnico: 7, status }),
            atualizarGarantia: async () => gravacoes.push(status)
        });
        await assert.rejects(ordemServicoService.atualizarGarantia(11, "SIM", USUARIOS[2]), { statusCode: 409 }, status);
        assert.equal(gravacoes.length, 0);
    }

    const gravacoes = [];
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async () => ({ id_os: 11, id_tecnico: 7, status: "EM_ANALISE" }),
        atualizarGarantia: async (id, garantia, idUsuario) => gravacoes.push([id, garantia, idUsuario])
    });
    await ordemServicoService.atualizarGarantia(11, "NAO", USUARIOS[2]);
    await ordemServicoService.atualizarGarantia(11, "SIM", USUARIOS[2]); // correção NAO → SIM ainda em análise
    await assert.rejects(ordemServicoService.atualizarGarantia(11, "PENDENTE", USUARIOS[2]), { statusCode: 400 });
    assert.deepEqual(gravacoes, [[11, "NAO", 2], [11, "SIM", 2]]);
});

// ---------- HTTP ----------

test("HTTP: closing route checks access; another technician gets 404 and nothing is recorded", async (teste) => {
    const chamadas = simularOs(teste);
    substituirMetodos(teste, ordemServicoService, { buscarDetalhes: async () => ({ id_os: 11, status: "ENCERRADA_SEM_REPARO" }) });
    substituirMetodos(teste, historicoRepository, { registrar: async () => assert.fail("o service simulado não grava histórico") });

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const url = `http://127.0.0.1:${servidor.address().port}/api/ordens-servico/11/encerramento`;
    const chamar = (id, corpo) => fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ id_usuario: id }, process.env.JWT_SECRET)}` },
        body: JSON.stringify(corpo)
    });
    const desistencia = { tipo_encerramento: "DESISTENCIA_CLIENTE", motivo_encerramento: "Desistiu" };

    assert.equal((await chamar(8, desistencia)).status, 404);
    assert.equal((await chamar(2, { ...desistencia, tipo_encerramento: "IMPOSSIBILIDADE_TECNICA" })).status, 403);
    assert.equal(chamadas.length, 0);

    const resposta = await chamar(2, desistencia);
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).ordem.status, "ENCERRADA_SEM_REPARO");
});
