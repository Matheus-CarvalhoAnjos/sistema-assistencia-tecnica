/*
 * Testes do cadastro do catálogo de acessórios.
 * Usam o repository simulado: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const acessorioRepository = require("../src/repositories/acessorioRepository");
const acessorioService = require("../src/services/acessorioService");

function simular(teste, existentes = []) {
    const gravados = [];
    const originais = {
        buscarPorDescricao: acessorioRepository.buscarPorDescricao,
        criar: acessorioRepository.criar
    };

    acessorioRepository.buscarPorDescricao = async (descricao) =>
        existentes.find((d) => d.toLowerCase() === descricao.toLowerCase()) ? { id_acessorio: 1 } : null;
    acessorioRepository.criar = async (dados) => {
        gravados.push(dados);
        return { id_acessorio: 10, ...dados };
    };

    teste.after(() => Object.assign(acessorioRepository, originais));
    return gravados;
}

async function esperarStatus(promessa, status) {
    await assert.rejects(promessa, (erro) => {
        assert.equal(erro.statusCode, status);
        return true;
    });
}

test("empty price is stored as null, not as zero (regression)", async (teste) => {
    const gravados = simular(teste);

    await acessorioService.criar({ descricao: "Carregador" });
    await acessorioService.criar({ descricao: "Cabo", preco_atual: null });
    await acessorioService.criar({ descricao: "Bateria", preco_atual: "" });
    await acessorioService.criar({ descricao: "Bolsa", preco_atual: "35.5" });

    assert.deepEqual(gravados.map((g) => g.preco_atual), [null, null, null, 35.5]);
});

test("description is required, trimmed, limited to 150 chars and unique", async (teste) => {
    const gravados = simular(teste, ["Carregador"]);

    await acessorioService.criar({ descricao: "  Mouse  " });
    assert.equal(gravados[0].descricao, "Mouse");

    await esperarStatus(acessorioService.criar({ descricao: "   " }), 400);
    await esperarStatus(acessorioService.criar({ descricao: "a".repeat(151) }), 400);
    await esperarStatus(acessorioService.criar({ descricao: "carregador" }), 409);
});

test("invalid prices return 400", async (teste) => {
    simular(teste);

    await esperarStatus(acessorioService.criar({ descricao: "X", preco_atual: -1 }), 400);
    await esperarStatus(acessorioService.criar({ descricao: "X", preco_atual: "abc" }), 400);
    await esperarStatus(acessorioService.criar({ descricao: "X", preco_atual: 100000000 }), 400);
});
