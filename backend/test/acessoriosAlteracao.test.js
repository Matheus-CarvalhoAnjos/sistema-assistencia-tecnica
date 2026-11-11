/*
 * D7 — alteração de acessórios recebidos depois da abertura (sem exclusão).
 * Conexões e repositories simulados: nenhum teste acessa o MySQL
 * (a gravação real está em integracao/fluxoCompleto.integracao.js).
 */
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const acessorioRecebidoRepository = require("../src/repositories/acessorioRecebidoRepository");
const acessorioRecebidoService = require("../src/services/acessorioRecebidoService");
const acessorioRepository = require("../src/repositories/acessorioRepository");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");

function substituirMetodos(teste, alvo, substitutos) {
    const originais = {};
    for (const [nome, metodo] of Object.entries(substitutos)) {
        originais[nome] = alvo[nome];
        alvo[nome] = metodo;
    }
    teste.after(() => Object.assign(alvo, originais));
}

const ATUAL = { id_acessorio_recebido: 40, id_item: 4, id_acessorio: 3, quantidade: 1, observacoes: "original", descricao_acessorio: "Carregador" };

function conexao(os, atual = ATUAL) {
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
                if (texto.includes("FROM ordem_servico")) return [[os], []];
                if (texto.includes("FROM acessorio_recebido ar INNER JOIN acessorio")) return [[atual], []];
                return [{ affectedRows: 1 }, []];
            }
        }
    };
}

function preparar(teste, os, atual) {
    const simulada = conexao(os, atual);
    substituirMetodos(teste, acessorioRecebidoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, acessorioRecebidoRepository, { buscarPorId: async () => ({ ...ATUAL }) });
    return simulada;
}

const sqls = (comandos, trecho) => comandos.filter((c) => typeof c === "object" && c.sql.includes(trecho));
const evento = (comandos) => {
    const [e] = sqls(comandos, "INSERT INTO historico_os");
    const [id_os, id_usuario, tipo, descricao, ant, nov] = e.parametros;
    return { id_os, id_usuario, tipo, descricao, anteriores: JSON.parse(ant), novos: JSON.parse(nov) };
};

test("D7 alteração: grava só os campos que mudaram, com valores anteriores e novos, no histórico da OS do equipamento", async (teste) => {
    const simulada = preparar(teste, { id_os: 9, id_item: 4, status: "EM_REPARO", id_tecnico: 7 });

    const { alterado } = await acessorioRecebidoRepository.atualizar(40, { quantidade: 2, observacoes: "com cabo" }, { id_usuario: 7, perfil: "TECNICO" });

    assert.equal(alterado, true);
    // A OS é bloqueada antes do registro (mesma ordem da inclusão)
    const bloqueios = simulada.comandos.filter((c) => typeof c === "object" && /FOR UPDATE/.test(c.sql)).map((c) => c.sql);
    assert.match(bloqueios[0], /FROM ordem_servico WHERE id_item = \? ORDER BY id_os DESC LIMIT 1 FOR UPDATE/);
    assert.match(bloqueios[1], /FROM acessorio_recebido ar/);
    assert.deepEqual(sqls(simulada.comandos, "UPDATE acessorio_recebido")[0].parametros, [3, 2, "com cabo", 40]);
    assert.deepEqual(evento(simulada.comandos), {
        id_os: 9, id_usuario: 7, tipo: "ACESSORIO", descricao: "Acessório recebido nº 40 alterado.",
        anteriores: { id_acessorio_recebido: 40, quantidade: 1, observacoes: "original" },
        novos: { id_acessorio_recebido: 40, quantidade: 2, observacoes: "com cabo" }
    });
    assert.ok(simulada.comandos.includes("COMMIT"));
});

test("D7 alteração: troca do acessório registra o anterior e o novo; sem mudança, nada é gravado", async (teste) => {
    let simulada = preparar(teste, { id_os: 9, id_item: 4, status: "RECEBIDA", id_tecnico: null });
    await acessorioRecebidoRepository.atualizar(40, { id_acessorio: 5, descricao_acessorio: "Fonte" }, { id_usuario: 2, perfil: "ATENDENTE" });
    const e = evento(simulada.comandos);
    assert.deepEqual(e.anteriores, { id_acessorio_recebido: 40, id_acessorio: 3, descricao_acessorio: "Carregador" });
    assert.deepEqual(e.novos, { id_acessorio_recebido: 40, id_acessorio: 5, descricao_acessorio: "Fonte" });

    simulada = preparar(teste, { id_os: 9, id_item: 4, status: "RECEBIDA", id_tecnico: null });
    const { alterado } = await acessorioRecebidoRepository.atualizar(40, { quantidade: 1, observacoes: " original ".trim() }, { id_usuario: 2, perfil: "ATENDENTE" });
    assert.equal(alterado, false);
    assert.equal(sqls(simulada.comandos, "UPDATE acessorio_recebido").length, 0);
    assert.equal(sqls(simulada.comandos, "INSERT INTO historico_os").length, 0);
});

test("D7 alteração: bloqueada a partir de CONCLUIDA e para técnico de outra OS; nada é gravado", async (teste) => {
    for (const [os, perfil, codigo] of [
        [{ id_os: 9, id_item: 4, status: "CONCLUIDA", id_tecnico: 7 }, "ATENDENTE", 409],
        [{ id_os: 9, id_item: 4, status: "AGUARDANDO_EXPEDICAO", id_tecnico: 7 }, "ADMINISTRADOR", 409],
        [{ id_os: 9, id_item: 4, status: "FINALIZADA", id_tecnico: 7 }, "TECNICO", 409],
        [{ id_os: 9, id_item: 4, status: "ENCERRADA_SEM_REPARO", id_tecnico: 7 }, "ATENDENTE", 409],
        [{ id_os: 9, id_item: 4, status: "EM_REPARO", id_tecnico: 8 }, "TECNICO", 403]
    ]) {
        const simulada = preparar(teste, os);
        await assert.rejects(
            acessorioRecebidoRepository.atualizar(40, { quantidade: 5 }, { id_usuario: 7, perfil }),
            { statusCode: codigo },
            `${os.status}/${perfil}`
        );
        assert.equal(sqls(simulada.comandos, "UPDATE acessorio_recebido").length, 0);
        assert.equal(sqls(simulada.comandos, "INSERT").length, 0);
        assert.ok(simulada.comandos.includes("ROLLBACK"));
    }
});

test("D7 alteração (service): validações, acessório inativo, acessório de outra OS e técnico sem relação", async (teste) => {
    const recebidas = [];
    substituirMetodos(teste, acessorioRecebidoRepository, {
        buscarPorId: async (id) => (id === 40 ? { ...ATUAL } : null),
        atualizar: async (id, dados, contexto) => (recebidas.push({ id, dados, contexto }), { registro: { ...ATUAL }, alterado: true })
    });
    substituirMetodos(teste, acessorioRepository, {
        buscarPorId: async (id) => ({ 5: { id_acessorio: 5, descricao: "Fonte", ativo: 1 }, 6: { id_acessorio: 6, descricao: "Bolsa", ativo: 0 } })[id] ?? null
    });
    substituirMetodos(teste, ordemServicoRepository, { existeOsDoTecnicoParaItem: async (_item, tecnico) => tecnico === 7 });
    const ATD = { id_usuario: 2, perfil: "ATENDENTE" };

    await assert.rejects(acessorioRecebidoService.atualizar(40, {}, ATD), { statusCode: 400 });
    await assert.rejects(acessorioRecebidoService.atualizar(40, { quantidade: 0 }, ATD), { statusCode: 400 });
    await assert.rejects(acessorioRecebidoService.atualizar(40, { quantidade: 1.5 }, ATD), { statusCode: 400 });
    await assert.rejects(acessorioRecebidoService.atualizar(40, { observacoes: 12 }, ATD), { statusCode: 400 });
    await assert.rejects(acessorioRecebidoService.atualizar(41, { quantidade: 2 }, ATD), { statusCode: 404 });
    await assert.rejects(acessorioRecebidoService.atualizar(40, { id_acessorio: 99 }, ATD), { statusCode: 404 });
    await assert.rejects(acessorioRecebidoService.atualizar(40, { id_acessorio: 6 }, ATD), { statusCode: 409 });
    // Pela rota da OS: acessório de outro equipamento → 404
    await assert.rejects(acessorioRecebidoService.atualizar(40, { quantidade: 2 }, ATD, { id_os: 9, id_item: 5 }), { statusCode: 404 });
    // Técnico sem OS no equipamento → 404 (não revela o registro)
    await assert.rejects(acessorioRecebidoService.atualizar(40, { quantidade: 2 }, { id_usuario: 8, perfil: "TECNICO" }), { statusCode: 404 });
    assert.equal(recebidas.length, 0);

    // Mantém o acessório atual mesmo que esteja inativo (não há troca)
    substituirMetodos(teste, acessorioRepository, { buscarPorId: async () => assert.fail("não deveria consultar o catálogo") });
    await acessorioRecebidoService.atualizar(40, { id_acessorio: 3, quantidade: "2", observacoes: "  " }, { id_usuario: 7, perfil: "TECNICO" }, { id_os: 9, id_item: 4 });
    assert.deepEqual(recebidas[0], { id: 40, dados: { quantidade: 2, observacoes: null }, contexto: { id_usuario: 7, perfil: "TECNICO", id_os: 9 } });
});
