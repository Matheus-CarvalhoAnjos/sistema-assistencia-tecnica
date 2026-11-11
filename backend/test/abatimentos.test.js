/*
 * R1 — abatimento formal (decisões A1–A8, C1, C2).
 * Conexões e repositories simulados: verificam regras, validações e ordem de bloqueio.
 * NÃO substituem a integração real (integracao/fluxoCompleto.integracao.js), que é a evidência.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const abatimentoRepository = require("../src/repositories/abatimentoRepository");
const abatimentoService = require("../src/services/abatimentoService");
const pagamentoRepository = require("../src/repositories/pagamentoRepository");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const ordemServicoService = require("../src/services/ordemServicoService");
const historicoRepository = require("../src/repositories/historicoRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");

// Substituições empilhadas por teste e desfeitas em ordem inversa (o mesmo método pode ser
// substituído mais de uma vez no mesmo teste).
const pilhas = new WeakMap();
function substituirMetodos(teste, alvo, substitutos) {
    if (!pilhas.has(teste)) {
        pilhas.set(teste, []);
        teste.after(() => {
            for (const [objeto, nome, original] of pilhas.get(teste).reverse()) objeto[nome] = original;
        });
    }
    for (const [nome, metodo] of Object.entries(substitutos)) {
        pilhas.get(teste).push([alvo, nome, alvo[nome]]);
        alvo[nome] = metodo;
    }
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

const sqls = (comandos, trecho) => comandos.filter((c) => typeof c === "object" && c.sql.includes(trecho));
const evento = (comandos) => {
    const [e] = sqls(comandos, "INSERT INTO historico_os");
    const [id_os, id_usuario, tipo, descricao, ant, nov] = e.parametros;
    return { id_os, id_usuario, tipo, descricao, anteriores: ant ? JSON.parse(ant) : null, novos: nov ? JSON.parse(nov) : null };
};

/** Valores financeiros em centavos, como devolvidos por buscarValoresOs. */
function valores({ orcado = 10000, abatido = 0, pago = 0, pendente = 0, aprovado = true } = {}) {
    return {
        tem_orcamento_aprovado: aprovado,
        id_orcamento_aprovado: aprovado ? 50 : null,
        total_orcado_centavos: orcado,
        total_abatido_centavos: abatido,
        total_devido_centavos: orcado - abatido,
        total_confirmado_centavos: pago,
        total_pendente_centavos: pendente
    };
}

function preparar(teste, { status = "EM_REPARO", antes = valores(), depois = antes, abatimento = null } = {}) {
    const simulada = conexaoFalsa((sql) => {
        if (sql.startsWith("SELECT id_os, status FROM ordem_servico")) return [[{ id_os: 8, status }], []];
        if (sql.startsWith("SELECT id_abatimento, id_os, valor, status FROM abatimento")) return [abatimento ? [abatimento] : [], []];
        if (sql.startsWith("INSERT INTO abatimento")) return [{ insertId: 70 }, []];
        return undefined;
    });
    let chamadas = 0;
    substituirMetodos(teste, abatimentoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, pagamentoRepository, { buscarValoresOs: async () => (chamadas++ === 0 ? antes : depois) });
    substituirMetodos(teste, abatimentoRepository, {
        buscarPorId: async (id) => ({ id_abatimento: id, id_os: 8, status: abatimento?.status ?? "APROVADO" })
    });
    return simulada;
}

// ---------- Registro ----------

test("R1 registro: nasce APROVADO, vinculado ao orçamento aprovado, com evento ABATIMENTO e saldo antes/depois", async (teste) => {
    const simulada = preparar(teste, { antes: valores({ pago: 3000 }), depois: valores({ pago: 3000, abatido: 2000 }) });

    await abatimentoRepository.registrar({ id_os: 8, valor_centavos: 2000, motivo: "Peça usada", id_usuario: 2 });

    // A OS é bloqueada antes de qualquer cálculo (A4)
    assert.match(simulada.comandos[1].sql, /FROM ordem_servico WHERE id_os = \? FOR UPDATE/);
    const [insert] = sqls(simulada.comandos, "INSERT INTO abatimento");
    assert.match(insert.sql, /'APROVADO'/);
    assert.deepEqual(insert.parametros, [8, 50, 20, "Peça usada", 2]);
    const e = evento(simulada.comandos);
    assert.equal(e.tipo, "ABATIMENTO");
    assert.equal(e.descricao, "Abatimento nº 70 de R$ 20,00 registrado.");
    assert.deepEqual(e.anteriores, { total_devido: 100, saldo: 70 });
    assert.deepEqual(e.novos, { id_abatimento: 70, id_orcamento: 50, valor: 20, motivo: "Peça usada", status: "APROVADO", total_devido: 80, saldo: 50 });
    // Nenhuma alteração de OS, orçamento ou expedição (AB7)
    for (const tabela of ["UPDATE ordem_servico", "UPDATE orcamento", "UPDATE expedicao"]) assert.equal(sqls(simulada.comandos, tabela).length, 0);
    assert.ok(simulada.comandos.includes("COMMIT"));
});

test("R1 registro (A4): limite = devido − pago − pendentes; acima disso 409 sem gravar", async (teste) => {
    let simulada = preparar(teste, { antes: valores({ pago: 5000, pendente: 3000 }) }); // disponível 20,00
    await assert.rejects(
        abatimentoRepository.registrar({ id_os: 8, valor_centavos: 2001, motivo: "x", id_usuario: 2 }),
        { statusCode: 409, message: /R\$ 20,00/ }
    );
    assert.equal(sqls(simulada.comandos, "INSERT").length, 0);
    assert.ok(simulada.comandos.includes("ROLLBACK"));

    simulada = preparar(teste, { antes: valores({ pago: 5000, pendente: 3000 }) });
    await abatimentoRepository.registrar({ id_os: 8, valor_centavos: 2000, motivo: "x", id_usuario: 2 });
    assert.equal(sqls(simulada.comandos, "INSERT INTO abatimento").length, 1);
});

test("R1 registro (A7): abatimento integral leva o total devido a zero", async (teste) => {
    const simulada = preparar(teste, { antes: valores(), depois: valores({ abatido: 10000 }) });
    await abatimentoRepository.registrar({ id_os: 8, valor_centavos: 10000, motivo: "Cortesia", id_usuario: 1 });
    assert.deepEqual(evento(simulada.comandos).novos.total_devido, 0);
});

test("R1 registro (A3): bloqueado em FINALIZADA, ENCERRADA_SEM_REPARO e etapas sem orçamento aprovado", async (teste) => {
    for (const status of ["FINALIZADA", "ENCERRADA_SEM_REPARO", "RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO"]) {
        const simulada = preparar(teste, { status });
        await assert.rejects(abatimentoRepository.registrar({ id_os: 8, valor_centavos: 100, motivo: "x", id_usuario: 2 }), { statusCode: 409 }, status);
        assert.equal(sqls(simulada.comandos, "INSERT").length, 0, status);
    }
    const semOrcamento = preparar(teste, { antes: valores({ aprovado: false }) });
    await assert.rejects(abatimentoRepository.registrar({ id_os: 8, valor_centavos: 100, motivo: "x", id_usuario: 2 }), { statusCode: 409, message: /orçamento aprovado/ });
    assert.equal(sqls(semOrcamento.comandos, "INSERT").length, 0);
});

// ---------- Cancelamento ----------

test("R1 cancelamento (A5, C1): preserva o registro, grava responsável e justificativa, com evento e saldo", async (teste) => {
    const simulada = preparar(teste, {
        status: "AGUARDANDO_EXPEDICAO",
        antes: valores({ abatido: 2000, pago: 8000 }),
        depois: valores({ pago: 8000 }),
        abatimento: { id_abatimento: 70, id_os: 8, valor: "20.00", status: "APROVADO" }
    });

    await abatimentoRepository.cancelar(70, { justificativa: "Lançado por engano", id_usuario: 1 });

    const [update] = sqls(simulada.comandos, "UPDATE abatimento");
    assert.match(update.sql, /status = 'CANCELADO', id_usuario_cancelamento = \?, data_cancelamento = CURRENT_TIMESTAMP, justificativa_cancelamento = \?/);
    assert.deepEqual(update.parametros, [1, "Lançado por engano", 70]);
    assert.equal(sqls(simulada.comandos, "DELETE").length, 0);
    // Bloqueio: OS e depois o abatimento
    const bloqueios = simulada.comandos.filter((c) => typeof c === "object" && /FOR UPDATE/.test(c.sql)).map((c) => c.sql);
    assert.match(bloqueios[0], /FROM ordem_servico/);
    assert.match(bloqueios[1], /FROM abatimento/);
    const e = evento(simulada.comandos);
    assert.equal(e.descricao, "Abatimento nº 70 de R$ 20,00 cancelado.");
    assert.deepEqual(e.anteriores, { id_abatimento: 70, status: "APROVADO", total_devido: 80, saldo: 0 });
    assert.deepEqual(e.novos, { id_abatimento: 70, status: "CANCELADO", valor: 20, justificativa_cancelamento: "Lançado por engano", total_devido: 100, saldo: 20 });
});

test("R1 cancelamento: recusado depois da entrega (FINALIZADA), em OS sem reparo e se já cancelado", async (teste) => {
    for (const status of ["FINALIZADA", "ENCERRADA_SEM_REPARO"]) {
        const simulada = preparar(teste, { status, abatimento: { id_abatimento: 70, id_os: 8, valor: "20.00", status: "APROVADO" } });
        await assert.rejects(abatimentoRepository.cancelar(70, { justificativa: "x", id_usuario: 1 }), { statusCode: 409 }, status);
        assert.equal(sqls(simulada.comandos, "UPDATE abatimento").length, 0, status);
    }
    const jaCancelado = preparar(teste, { abatimento: { id_abatimento: 70, id_os: 8, valor: "20.00", status: "CANCELADO" } });
    await assert.rejects(abatimentoRepository.cancelar(70, { justificativa: "x", id_usuario: 1 }), { statusCode: 409, message: /já foi cancelado/ });
    assert.equal(sqls(jaCancelado.comandos, "UPDATE abatimento").length, 0);
});

// ---------- Service: perfis e validações ----------

const usuarios = { 1: { id_usuario: 1, perfil: "ADMINISTRADOR", ativo: 1 }, 2: { id_usuario: 2, perfil: "ATENDENTE", ativo: 1 }, 3: { id_usuario: 3, perfil: "ATENDENTE", ativo: 0 }, 7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 } };

test("R1 service (A2, C1, C2): técnico e inativo recebem 403 em registrar, cancelar e listar", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, abatimentoRepository, {
        registrar: async () => assert.fail("não deveria registrar"),
        cancelar: async () => assert.fail("não deveria cancelar"),
        listarPorOs: async () => assert.fail("não deveria listar")
    });
    for (const usuario of [{ id_usuario: 7, perfil: "TECNICO" }, { id_usuario: 3, perfil: "ATENDENTE" }]) {
        await assert.rejects(abatimentoService.registrar(8, { valor: 10, motivo: "x" }, usuario), { statusCode: 403 });
        await assert.rejects(abatimentoService.cancelar(70, { justificativa: "x" }, usuario), { statusCode: 403 });
        await assert.rejects(abatimentoService.listarPorOs(8, usuario), { statusCode: 403 });
    }
});

test("R1 service: valor, motivo e justificativa validados; qualquer ADM/ATD ativo cancela (C1)", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    const recebidos = [];
    substituirMetodos(teste, abatimentoRepository, {
        registrar: async (d) => (recebidos.push(d), d),
        cancelar: async (id, d) => (recebidos.push({ id, ...d }), d)
    });
    const ATD = { id_usuario: 2, perfil: "ATENDENTE" };
    for (const valor of [0, -1, "abc", 10.555, undefined]) {
        await assert.rejects(abatimentoService.registrar(8, { valor, motivo: "x" }, ATD), { statusCode: 400 }, String(valor));
    }
    await assert.rejects(abatimentoService.registrar(8, { valor: 10, motivo: "  " }, ATD), { statusCode: 400 });
    await assert.rejects(abatimentoService.cancelar(70, { justificativa: "" }, ATD), { statusCode: 400 });
    assert.equal(recebidos.length, 0);

    await abatimentoService.registrar(8, { valor: "12.50", motivo: " Desconto negociado " }, ATD);
    await abatimentoService.cancelar(70, { justificativa: " Erro " }, { id_usuario: 1, perfil: "ADMINISTRADOR" });
    assert.deepEqual(recebidos, [
        { id_os: 8, valor_centavos: 1250, motivo: "Desconto negociado", id_usuario: 2 },
        { id: 70, justificativa: "Erro", id_usuario: 1 }
    ]);
});

// ---------- Cálculo único e histórico ----------

test("R1 cálculo: total devido = orçamento aprovado − abatimentos APROVADO desse orçamento; saldo sobre o devido", async (teste) => {
    const simulada = conexaoFalsa((sql) => {
        if (sql.includes("SELECT valor_total, id_orcamento")) return [[{ valor_total: "100.00", id_orcamento: 50 }], []];
        if (sql.includes("SUM(CASE")) return [[{ total_confirmado: "40.00", total_pendente: "10.00" }], []];
        if (sql.includes("FROM reembolso r")) return [[{ total_reembolsado: "5.00" }], []];
        if (sql.includes("FROM abatimento")) return [[{ total_abatido: "30.00" }], []];
        return undefined;
    });
    const v = await pagamentoRepository.buscarValoresOs(8, simulada.conexao);
    assert.deepEqual(
        [v.total_orcado_centavos, v.total_abatido_centavos, v.total_devido_centavos, v.total_confirmado_centavos, v.total_pendente_centavos],
        [10000, 3000, 7000, 3500, 1000]
    );
    const consulta = sqls(simulada.comandos, "FROM abatimento")[0];
    assert.match(consulta.sql, /WHERE id_orcamento = \? AND status = 'APROVADO'/);
    assert.deepEqual(consulta.parametros, [50]);

    substituirMetodos(teste, pagamentoRepository, { buscarValoresOs: async () => v });
    const resumo = await pagamentoRepository.calcularResumo(8);
    assert.deepEqual(
        [resumo.total_orcado, resumo.total_abatido, resumo.total_devido, resumo.total_pago, resumo.pagamentos_pendentes, resumo.saldo_devedor],
        [100, 30, 70, 35, 10, 35]
    );
});

test("R1 histórico (A6, C2): ABATIMENTO é tipo válido e o técnico não recebe esses eventos", async (teste) => {
    assert.ok(historicoRepository.TIPOS_EVENTO.includes("ABATIMENTO"));
    substituirMetodos(teste, historicoRepository, {
        listarPorOs: async () => [{ tipo_evento: "CRIACAO" }, { tipo_evento: "PAGAMENTO" }, { tipo_evento: "ABATIMENTO" }, { tipo_evento: "REPARO" }]
    });
    const tecnico = await ordemServicoService.listarHistorico(8, { id_usuario: 7, perfil: "TECNICO" });
    assert.deepEqual(tecnico.map((e) => e.tipo_evento), ["CRIACAO", "REPARO"]);
    const atendente = await ordemServicoService.listarHistorico(8, { id_usuario: 2, perfil: "ATENDENTE" });
    assert.equal(atendente.length, 4);
});

test("R1 service: listar exige OS existente", async (teste) => {
    substituirMetodos(teste, usuarioRepository, { buscarPorId: async (id) => usuarios[id] ?? null });
    substituirMetodos(teste, ordemServicoRepository, { buscarPorId: async () => null });
    await assert.rejects(abatimentoService.listarPorOs(999, { id_usuario: 2, perfil: "ATENDENTE" }), { statusCode: 404 });
});
