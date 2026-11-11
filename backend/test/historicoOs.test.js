/*
 * RN21 (MER v1.4) — histórico da Ordem de Serviço.
 * Testes com conexões simuladas: nenhum teste acessa o MySQL.
 * (A gravação real no MySQL é verificada em integracao/fluxoCompleto.integracao.js.)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const historicoRepository = require("../src/repositories/historicoRepository");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const execucaoRepository = require("../src/repositories/execucaoRepository");
const orcamentoRepository = require("../src/repositories/orcamentoRepository");
const pagamentoRepository = require("../src/repositories/pagamentoRepository");
const expedicaoRepository = require("../src/repositories/expedicaoRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");
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

/*
 * Conexão simulada: responde pela função recebida, guarda os comandos e
 * pode falhar no INSERT do histórico (para testar o rollback conjunto).
 */
function conexaoFalsa(responder, { falharHistorico = false } = {}) {
    const comandos = [];
    const conexao = {
        beginTransaction: async () => comandos.push("BEGIN"),
        commit: async () => comandos.push("COMMIT"),
        rollback: async () => comandos.push("ROLLBACK"),
        release: () => comandos.push("RELEASE"),
        execute: async (sql, parametros) => {
            const texto = sql.replace(/\s+/g, " ").trim();
            if (texto.startsWith("INSERT INTO historico_os") && falharHistorico) {
                throw new Error("falha simulada ao gravar o histórico");
            }
            comandos.push({ sql: texto, parametros });
            return responder(texto, parametros) ?? [{ affectedRows: 1, insertId: 1 }, []];
        }
    };
    return { comandos, conexao };
}

function eventos(comandos) {
    return comandos
        .filter((c) => typeof c === "object" && c.sql.startsWith("INSERT INTO historico_os"))
        .map(({ parametros: [id_os, id_usuario, tipo_evento, descricao, anteriores, novos] }) => ({
            id_os,
            id_usuario,
            tipo_evento,
            descricao,
            dados_anteriores: anteriores ? JSON.parse(anteriores) : null,
            dados_novos: novos ? JSON.parse(novos) : null
        }));
}

const atualizacoes = (comandos, trecho) => comandos.filter((c) => typeof c === "object" && c.sql.startsWith(trecho));

function usarConexao(teste, repository, simulada) {
    substituirMetodos(teste, repository.pool, { getConnection: async () => simulada.conexao });
}

// ---------- Repository do histórico ----------

test("history repository: validates the event type and refuses sensitive fields", async () => {
    const simulada = conexaoFalsa(() => undefined);

    await assert.rejects(
        historicoRepository.registrar(simulada.conexao, { id_os: 1, tipo_evento: "LOGIN", descricao: "x" }),
        /Tipo de evento inválido/
    );
    for (const campo of ["senha", "senha_hash", "token"]) {
        await assert.rejects(
            historicoRepository.registrar(simulada.conexao, {
                id_os: 1, tipo_evento: "GARANTIA", descricao: "x", dados_novos: { [campo]: "segredo" }
            }),
            /Campo não permitido/
        );
    }
    await assert.rejects(historicoRepository.registrar(simulada.conexao, { tipo_evento: "GARANTIA", descricao: "x" }), /OS/);
    assert.equal(eventos(simulada.comandos).length, 0);

    await historicoRepository.registrar(simulada.conexao, {
        id_os: 4, id_usuario: 7, tipo_evento: "DIAGNOSTICO", descricao: "ok",
        dados_novos: { data_inicio: new Date("2026-11-09T10:00:00Z"), status_os: undefined }
    });
    const [evento] = eventos(simulada.comandos);
    assert.deepEqual(evento.dados_novos, { data_inicio: "2026-11-09T10:00:00.000Z" });
    assert.equal(evento.dados_anteriores, null);
    assert.match(simulada.comandos.at(-1).sql, /CURRENT_TIMESTAMP/);
});

test("history repository: chronological query ordered by date and insertion", async (teste) => {
    let sqlConsulta;
    substituirMetodos(teste, pool, {
        execute: async (sql, parametros) => {
            sqlConsulta = sql.replace(/\s+/g, " ");
            assert.deepEqual(parametros, [11]);
            return [[{ id_historico: 1 }, { id_historico: 2 }]];
        }
    });

    const linhas = await historicoRepository.listarPorOs(11);
    assert.equal(linhas.length, 2);
    assert.match(sqlConsulta, /WHERE h\.id_os = \? ORDER BY h\.data_evento, h\.id_historico/);
    assert.doesNotMatch(sqlConsulta, /senha/);
});

// ---------- Atribuição, garantia e conclusão do reparo ----------

const OS_ATUAL = { id_os: 11, id_tecnico: 7, status: "EM_REPARO", garantia_status: "PENDENTE" };
const respostaOs = (atual = OS_ATUAL) => (sql) => (sql.startsWith("SELECT id_os, id_tecnico") ? [[{ ...atual }], []] : undefined);

test("ATRIBUICAO_TECNICO: previous and new technician, with the responsible user", async (teste) => {
    const simulada = conexaoFalsa(respostaOs());
    usarConexao(teste, ordemServicoRepository, simulada);

    assert.equal(await ordemServicoRepository.atribuirTecnico(11, 8, 2), true);

    assert.deepEqual(eventos(simulada.comandos), [{
        id_os: 11, id_usuario: 2, tipo_evento: "ATRIBUICAO_TECNICO", descricao: "Técnico responsável alterado.",
        dados_anteriores: { id_tecnico: 7 }, dados_novos: { id_tecnico: 8 }
    }]);
    assert.ok(simulada.comandos.includes("COMMIT"));
});

test("ATRIBUICAO_TECNICO and GARANTIA: no change, no update and no event", async (teste) => {
    const simulada = conexaoFalsa(respostaOs({ ...OS_ATUAL, garantia_status: "SIM" }));
    usarConexao(teste, ordemServicoRepository, simulada);

    assert.equal(await ordemServicoRepository.atribuirTecnico(11, 7, 2), true);
    assert.equal(await ordemServicoRepository.atualizarGarantia(11, "SIM", 7), true);

    assert.equal(atualizacoes(simulada.comandos, "UPDATE").length, 0);
    assert.equal(eventos(simulada.comandos).length, 0);
});

test("GARANTIA: event by the assigned technician with previous and new status", async (teste) => {
    const simulada = conexaoFalsa(respostaOs({ ...OS_ATUAL, status: "EM_ANALISE" }));
    usarConexao(teste, ordemServicoRepository, simulada);

    await ordemServicoRepository.atualizarGarantia(11, "NAO", 7);

    const [evento] = eventos(simulada.comandos);
    assert.deepEqual([evento.id_os, evento.id_usuario, evento.tipo_evento], [11, 7, "GARANTIA"]);
    assert.deepEqual(evento.dados_anteriores, { garantia_status: "PENDENTE" });
    assert.deepEqual(evento.dados_novos, { garantia_status: "NAO" });
});

// ---------- Reparo em garantia (verificação pelo atendente) ----------

test("GARANTIA SIM in analysis: order goes to EM_REPARO without a quote, with the attendant as responsible", async (teste) => {
    const simulada = conexaoFalsa(respostaOs({ ...OS_ATUAL, status: "EM_ANALISE" }));
    usarConexao(teste, ordemServicoRepository, simulada);

    assert.equal(await ordemServicoRepository.atualizarGarantia(11, "SIM", 2), true);

    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico SET garantia_status").length, 1);
    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico SET status = 'EM_REPARO'").length, 1);
    assert.equal(atualizacoes(simulada.comandos, "INSERT INTO orcamento").length, 0); // nenhum orçamento fictício
    assert.deepEqual(eventos(simulada.comandos).map((e) => [e.id_usuario, e.tipo_evento, e.dados_anteriores, e.dados_novos]), [
        [2, "GARANTIA", { garantia_status: "PENDENTE" }, { garantia_status: "SIM" }],
        [2, "REPARO", { status_os: "EM_ANALISE" }, { status_os: "EM_REPARO", garantia_status: "SIM" }]
    ]);
    assert.ok(simulada.comandos.includes("COMMIT"));
});

test("GARANTIA NAO keeps the normal quote flow (order stays in analysis)", async (teste) => {
    const simulada = conexaoFalsa(respostaOs({ ...OS_ATUAL, status: "EM_ANALISE" }));
    usarConexao(teste, ordemServicoRepository, simulada);

    await ordemServicoRepository.atualizarGarantia(11, "NAO", 2);

    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico SET status").length, 0);
    assert.deepEqual(eventos(simulada.comandos).map((e) => e.tipo_evento), ["GARANTIA"]);
});

test("GARANTIA inherited SIM: the attendant's confirmation starts the warranty repair and is recorded", async (teste) => {
    const simulada = conexaoFalsa(respostaOs({ ...OS_ATUAL, status: "EM_ANALISE", garantia_status: "SIM" }));
    usarConexao(teste, ordemServicoRepository, simulada);

    await ordemServicoRepository.atualizarGarantia(11, "SIM", 2);

    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico SET garantia_status").length, 0);
    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico SET status = 'EM_REPARO'").length, 1);
    assert.deepEqual(eventos(simulada.comandos).map((e) => [e.id_usuario, e.tipo_evento, e.descricao]), [
        [2, "GARANTIA", "Garantia SIM confirmada."],
        [2, "REPARO", "Reparo em garantia iniciado: equipamento coberto, sem orçamento e sem cobrança."]
    ]);
});

test("GARANTIA: an order that left the analysis stage is not changed (rollback)", async (teste) => {
    const simulada = conexaoFalsa(respostaOs({ ...OS_ATUAL, status: "AGUARDANDO_APROVACAO" }));
    usarConexao(teste, ordemServicoRepository, simulada);

    assert.equal(await ordemServicoRepository.atualizarGarantia(11, "SIM", 2), false);
    assert.equal(atualizacoes(simulada.comandos, "UPDATE").length, 0);
    assert.ok(simulada.comandos.includes("ROLLBACK"));
});

for (const [garantia, liberada] of [["SIM", true], ["NAO", false]]) {
    test(`EXPEDICAO without quote, warranty ${garantia}: ${liberada ? "released without charge" : "a quote is required"}`, async (teste) => {
        const simulada = conexaoFalsa((sql) => {
            if (sql.startsWith("SELECT id_os, status FROM ordem_servico")) return [[{ id_os: 9, status: "CONCLUIDA" }], []];
            if (sql.startsWith("SELECT garantia_status FROM ordem_servico")) return [[{ garantia_status: garantia }], []];
            if (sql.startsWith("SELECT id_expedicao")) return [[], []];
            if (sql.startsWith("INSERT INTO expedicao")) return [{ insertId: 43 }, []];
        });
        usarConexao(teste, expedicaoRepository, simulada);
        substituirMetodos(teste, expedicaoRepository, { buscarPorOs: async () => ({ id_expedicao: 43, id_os: 9 }) });
        substituirMetodos(teste, pagamentoRepository, {
            buscarValoresOs: async () => ({ tem_orcamento_aprovado: false, total_orcado_centavos: 0, total_abatido_centavos: 0, total_devido_centavos: 0, total_confirmado_centavos: 0, total_pendente_centavos: 0 })
        });

        const criar = expedicaoRepository.criar({ id_os: 9, id_usuario: 2, forma_entrega: "RETIRADA", codigo_rastreio: null });

        if (liberada) {
            await criar;
            assert.equal(atualizacoes(simulada.comandos, "INSERT INTO expedicao").length, 1);
        } else {
            await assert.rejects(criar, { statusCode: 409 });
            assert.equal(atualizacoes(simulada.comandos, "INSERT INTO expedicao").length, 0);
        }
    });
}

test("REPARO: completion event; an order not in repair changes nothing", async (teste) => {
    const concluida = conexaoFalsa(respostaOs());
    usarConexao(teste, ordemServicoRepository, concluida);
    assert.equal(await ordemServicoRepository.marcarConcluida(11, 7), true);
    assert.deepEqual(eventos(concluida.comandos).map((e) => [e.tipo_evento, e.dados_novos.status_os]), [["REPARO", "CONCLUIDA"]]);

    const fora = conexaoFalsa(respostaOs({ ...OS_ATUAL, status: "EM_ANALISE" }));
    usarConexao(teste, ordemServicoRepository, fora);
    assert.equal(await ordemServicoRepository.marcarConcluida(11, 7), false);
    assert.equal(eventos(fora.comandos).length, 0);
    assert.ok(fora.comandos.includes("ROLLBACK"));
});

test("rollback: if the history insert fails, the technician change is undone too", async (teste) => {
    const simulada = conexaoFalsa(respostaOs(), { falharHistorico: true });
    usarConexao(teste, ordemServicoRepository, simulada);

    await assert.rejects(ordemServicoRepository.atribuirTecnico(11, 8, 2), /falha simulada/);

    assert.equal(atualizacoes(simulada.comandos, "UPDATE ordem_servico").length, 1);
    assert.ok(simulada.comandos.includes("ROLLBACK"));
    assert.ok(!simulada.comandos.includes("COMMIT"));
});

// ---------- Diagnóstico ----------

test("DIAGNOSTICO edit: only the changed fields are recorded; no change, no event", async (teste) => {
    const atual = {
        diagnostico: "Placa", laudo_tecnico: null, resultado: null,
        data_inicio: new Date("2026-11-09T10:00:00Z"), data_conclusao: null
    };
    const simulada = conexaoFalsa((sql) => {
        if (sql.startsWith("SELECT status, id_tecnico FROM ordem_servico")) return [[{ status: "EM_REPARO", id_tecnico: 7 }], []];
        return sql.startsWith("SELECT diagnostico") ? [[{ ...atual }], []] : undefined;
    });
    usarConexao(teste, execucaoRepository, simulada);
    substituirMetodos(teste, execucaoRepository, { buscarPorOs: async () => ({ id_os: 11 }) });

    await execucaoRepository.atualizar(11, { ...atual, data_inicio: new Date("2026-11-09T10:00:00Z"), laudo_tecnico: "Troca da placa", id_usuario: 7 });
    await execucaoRepository.atualizar(11, { ...atual, data_inicio: new Date("2026-11-09T10:00:00Z"), id_usuario: 7 });

    assert.deepEqual(eventos(simulada.comandos), [{
        id_os: 11, id_usuario: 7, tipo_evento: "DIAGNOSTICO", descricao: "Diagnóstico ou laudo técnico atualizado.",
        dados_anteriores: { laudo_tecnico: null }, dados_novos: { laudo_tecnico: "Troca da placa" }
    }]);
});

test("DIAGNOSTICO first record: event includes RECEBIDA → EM_ANALISE only when the status changed", async (teste) => {
    let mudou = 1;
    const simulada = conexaoFalsa((sql) => (sql.startsWith("UPDATE ordem_servico") ? [{ affectedRows: mudou }, []] : undefined));
    usarConexao(teste, execucaoRepository, simulada);
    substituirMetodos(teste, execucaoRepository, { buscarPorOs: async () => ({ id_os: 11 }) });

    await execucaoRepository.criar({ id_os: 11, id_usuario: 7, id_tecnico: 7, diagnostico: "Placa", data_inicio: null });
    mudou = 0;
    await execucaoRepository.criar({ id_os: 12, id_usuario: 7, id_tecnico: 7, diagnostico: "Tela", data_inicio: null });

    const [primeiro, segundo] = eventos(simulada.comandos);
    assert.deepEqual(primeiro.dados_anteriores, { status_os: "RECEBIDA" });
    assert.equal(primeiro.dados_novos.status_os, "EM_ANALISE");
    assert.equal(segundo.id_os, 12);
    assert.equal(segundo.dados_anteriores, null);
    assert.equal(segundo.dados_novos.status_os, undefined);
});

// ---------- Orçamento, início do reparo e encerramento ----------

function respostaOrcamento(vigente = 1) {
    return (sql) => {
        if (sql.startsWith("SELECT o.id_orcamento")) {
            return [[{ id_orcamento: 30, id_os: 11, status: "PENDENTE", vigente, status_os: "AGUARDANDO_APROVACAO" }], []];
        }
        if (sql.startsWith("SELECT id_orcamento FROM orcamento")) {
            return [vigente ? [] : [{ id_orcamento: 30 }], []];
        }
        return undefined;
    };
}

test("ORCAMENTO approved: quote event + REPARO started, both by the attendant", async (teste) => {
    const simulada = conexaoFalsa(respostaOrcamento());
    usarConexao(teste, orcamentoRepository, simulada);
    substituirMetodos(teste, orcamentoRepository, { buscarPorId: async () => ({ id_orcamento: 30, id_os: 11 }) });

    await orcamentoRepository.registrarResposta(30, 2, "APROVADO", "Cliente autorizou");

    assert.deepEqual(eventos(simulada.comandos).map((e) => [e.id_os, e.id_usuario, e.tipo_evento, e.dados_novos.status ?? e.dados_novos.status_os]), [
        [11, 2, "ORCAMENTO", "APROVADO"],
        [11, 2, "REPARO", "EM_REPARO"]
    ]);
});

test("ORCAMENTO rejected: quote event + ENCERRAMENTO with type, reason and responsible user (RN09/RN11)", async (teste) => {
    const simulada = conexaoFalsa(respostaOrcamento());
    usarConexao(teste, orcamentoRepository, simulada);
    substituirMetodos(teste, orcamentoRepository, { buscarPorId: async () => ({ id_orcamento: 30, id_os: 11 }) });

    await orcamentoRepository.registrarResposta(30, 2, "REJEITADO", null);

    const [encerrar] = atualizacoes(simulada.comandos, "UPDATE ordem_servico");
    assert.match(encerrar.sql, /tipo_encerramento = 'ORCAMENTO_REJEITADO', id_usuario_encerramento = \?/);
    assert.deepEqual(encerrar.parametros, [2, 11]);

    const [orcamento, encerramento] = eventos(simulada.comandos);
    assert.equal(orcamento.tipo_evento, "ORCAMENTO");
    assert.deepEqual(encerramento, {
        id_os: 11, id_usuario: 2, tipo_evento: "ENCERRAMENTO", descricao: "OS encerrada sem reparo: orçamento rejeitado.",
        dados_anteriores: { status_os: "AGUARDANDO_APROVACAO" },
        dados_novos: { status_os: "ENCERRADA_SEM_REPARO", tipo_encerramento: "ORCAMENTO_REJEITADO", motivo_encerramento: "Orçamento rejeitado." }
    });
});

test("ORCAMENTO response: a history failure rolls back the response and the order change", async (teste) => {
    const simulada = conexaoFalsa(respostaOrcamento(), { falharHistorico: true });
    usarConexao(teste, orcamentoRepository, simulada);
    substituirMetodos(teste, orcamentoRepository, { buscarPorId: async () => ({ id_orcamento: 30, id_os: 11 }) });

    await assert.rejects(orcamentoRepository.registrarResposta(30, 2, "APROVADO", null), /falha simulada/);
    assert.ok(simulada.comandos.includes("ROLLBACK"));
    assert.ok(!simulada.comandos.includes("COMMIT"));
});

test("ORCAMENTO expiry: automatic event (no user) only when a quote really expires", async (teste) => {
    const nada = conexaoFalsa((sql) => (sql.startsWith("SELECT id_orcamento") ? [[], []] : undefined));
    usarConexao(teste, orcamentoRepository, nada);
    await orcamentoRepository.atualizarVencidos(11);
    assert.equal(eventos(nada.comandos).length, 0);
    assert.equal(atualizacoes(nada.comandos, "UPDATE").length, 0);

    const vencido = conexaoFalsa(respostaOrcamento(0));
    usarConexao(teste, orcamentoRepository, vencido);
    await orcamentoRepository.atualizarVencidos(11);
    assert.deepEqual(eventos(vencido.comandos), [{
        id_os: 11, id_usuario: null, tipo_evento: "ORCAMENTO", descricao: "Orçamento nº 30 vencido sem resposta.",
        dados_anteriores: { id_orcamento: 30, status: "PENDENTE", status_os: "AGUARDANDO_APROVACAO" },
        dados_novos: { id_orcamento: 30, status: "VENCIDO", status_os: "EM_ANALISE" }
    }]);
});

// ---------- Pagamento ----------

test("PAGAMENTO: registration and confirmation record the user and the payment", async (teste) => {
    const simulada = conexaoFalsa((sql) => {
        if (sql.startsWith("SELECT id_os, status FROM ordem_servico")) return [[{ id_os: 8, status: "EM_REPARO" }], []];
        if (sql.includes("SELECT valor_total")) return [[{ valor_total: "100.00" }], []];
        if (sql.includes("SUM(CASE")) return [[{ total_confirmado: "0", total_pendente: "0" }], []];
        if (sql.startsWith("INSERT INTO pagamento")) return [{ insertId: 70 }, []];
        if (sql.startsWith("SELECT id_pagamento, id_os, valor, status")) return [[{ id_pagamento: 70, id_os: 8, valor: "40.00", status: "PENDENTE" }], []];
    });
    usarConexao(teste, pagamentoRepository, simulada);
    substituirMetodos(teste, pagamentoRepository, { buscarPorId: async () => ({ id_pagamento: 70, id_os: 8, status: "PENDENTE" }) });

    await pagamentoRepository.criar({ id_os: 8, valor: 40, valor_centavos: 4000, forma_pagamento: "PIX", id_usuario: 2 });
    await pagamentoRepository.atualizarStatus(70, "CONFIRMADO", 1);

    assert.deepEqual(eventos(simulada.comandos).map((e) => [e.id_os, e.id_usuario, e.tipo_evento, e.dados_anteriores, e.dados_novos]), [
        [8, 2, "PAGAMENTO", null, { id_pagamento: 70, valor: 40, forma_pagamento: "PIX", status: "PENDENTE" }],
        [8, 1, "PAGAMENTO", { id_pagamento: 70, status: "PENDENTE" }, { id_pagamento: 70, status: "CONFIRMADO", valor: "40.00" }]
    ]);
});

test("PAGAMENTO: a refused confirmation records no event", async (teste) => {
    const simulada = conexaoFalsa((sql) => {
        if (sql.startsWith("SELECT id_os, status FROM ordem_servico")) return [[{ id_os: 8, status: "ENCERRADA_SEM_REPARO" }], []];
    });
    usarConexao(teste, pagamentoRepository, simulada);
    substituirMetodos(teste, pagamentoRepository, { buscarPorId: async () => ({ id_pagamento: 70, id_os: 8, status: "PENDENTE" }) });

    await assert.rejects(pagamentoRepository.atualizarStatus(70, "CONFIRMADO", 1), { statusCode: 409 });
    assert.equal(eventos(simulada.comandos).length, 0);
});

// ---------- Expedição ----------

test("EXPEDICAO: creation and final delivery record the user and the order finalization", async (teste) => {
    let etapa = "criar";
    const simulada = conexaoFalsa((sql) => {
        if (sql.startsWith("SELECT id_os, status FROM ordem_servico")) {
            return [[{ id_os: 9, status: etapa === "criar" ? "CONCLUIDA" : "AGUARDANDO_EXPEDICAO" }], []];
        }
        if (sql.startsWith("SELECT id_expedicao, id_os, forma_entrega, status")) {
            return [[{ id_expedicao: 42, id_os: 9, forma_entrega: "ENVIO", status: "EM_TRANSITO" }], []];
        }
        if (sql.startsWith("SELECT id_expedicao")) return [[], []];
        if (sql.startsWith("INSERT INTO expedicao")) return [{ insertId: 42 }, []];
    });
    usarConexao(teste, expedicaoRepository, simulada);
    substituirMetodos(teste, expedicaoRepository, { buscarPorOs: async () => ({ id_expedicao: 42, id_os: 9 }) });
    substituirMetodos(teste, pagamentoRepository, {
        buscarValoresOs: async () => ({ tem_orcamento_aprovado: true, total_orcado_centavos: 100, total_abatido_centavos: 0, total_devido_centavos: 100, total_confirmado_centavos: 100, total_pendente_centavos: 0 })
    });

    await expedicaoRepository.criar({ id_os: 9, id_usuario: 2, forma_entrega: "ENVIO", codigo_rastreio: null });
    etapa = "entregar";
    await expedicaoRepository.atualizarStatus(9, "ENTREGUE", null, 1);

    const [criacao, entrega] = eventos(simulada.comandos);
    assert.deepEqual([criacao.id_os, criacao.id_usuario, criacao.tipo_evento], [9, 2, "EXPEDICAO"]);
    assert.deepEqual(criacao.dados_anteriores, { status_os: "CONCLUIDA" });
    assert.deepEqual(criacao.dados_novos, { id_expedicao: 42, forma_entrega: "ENVIO", status: "PENDENTE", codigo_rastreio: null, status_os: "AGUARDANDO_EXPEDICAO" });
    assert.deepEqual([entrega.id_usuario, entrega.dados_anteriores, entrega.dados_novos], [
        1, { status: "EM_TRANSITO", status_os: "AGUARDANDO_EXPEDICAO" }, { status: "ENTREGUE", status_os: "FINALIZADA" }
    ]);
});

// ---------- Consulta HTTP e permissões ----------

test("HTTP: history is read-only and follows the OS access rules", async (teste) => {
    const usuarios = {
        1: { id_usuario: 1, perfil: "ADMINISTRADOR", ativo: 1 },
        7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 },
        8: { id_usuario: 8, perfil: "TECNICO", ativo: 1 }
    };
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async (id) => (Number(id) === 11 ? { id_os: 11, id_tecnico: 7, status: "EM_ANALISE" } : null)
    });
    substituirMetodos(teste, historicoRepository, {
        listarPorOs: async (id) => [{ id_historico: 1, id_os: id, tipo_evento: "CRIACAO" }, { id_historico: 2, id_os: id, tipo_evento: "DIAGNOSTICO" }]
    });

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const url = `http://127.0.0.1:${servidor.address().port}/api/ordens-servico/11/historico`;
    const chamar = (metodo, id) => fetch(url, {
        method: metodo,
        headers: id ? { Authorization: `Bearer ${jwt.sign({ id_usuario: id }, process.env.JWT_SECRET)}` } : {}
    });

    assert.equal((await chamar("GET")).status, 401);
    assert.equal((await chamar("GET", 8)).status, 404); // técnico de outra OS

    const admin = await chamar("GET", 1);
    assert.equal(admin.status, 200);
    assert.deepEqual((await admin.json()).map((e) => e.tipo_evento), ["CRIACAO", "DIAGNOSTICO"]);
    assert.equal((await chamar("GET", 7)).status, 200);

    // Não existe rota para alterar ou apagar o histórico
    for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
        assert.equal((await chamar(metodo, 1)).status, 404, metodo);
    }
});
