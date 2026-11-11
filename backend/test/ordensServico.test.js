/*
 * Testes do módulo de Ordens de Serviço: filtros da listagem, detalhes por perfil,
 * atribuição de técnico e lista de técnicos ativos.
 * Usam repositories simulados: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const ordemServicoService = require("../src/services/ordemServicoService");
const acessorioRecebidoRepository = require("../src/repositories/acessorioRecebidoRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const usuarioService = require("../src/services/usuarioService");

const ADMIN = { id_usuario: 5, perfil: "ADMINISTRADOR" };
const ATENDENTE = { id_usuario: 6, perfil: "ATENDENTE" };
const TECNICO = { id_usuario: 7, perfil: "TECNICO" };

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

async function esperarStatus(promessa, status) {
    await assert.rejects(promessa, (erro) => {
        assert.equal(erro.statusCode, status);
        return true;
    });
}

// ---------- Listagem ----------

test("listing filters are validated and passed to the repository", async (teste) => {
    const chamadas = [];
    substituirMetodos(teste, ordemServicoRepository, {
        listarTodos: async (filtros) => {
            chamadas.push(filtros);
            return [];
        }
    });

    await ordemServicoService.listarTodos(ADMIN, {
        status: "em_reparo, RECEBIDA",
        id_tecnico: "7",
        busca: "  dell  ",
        data_inicio: "2026-11-01",
        data_fim: "2026-11-30"
    });
    await ordemServicoService.listarTodos(ATENDENTE, { sem_tecnico: "true" });

    assert.deepEqual(chamadas[0], {
        status: ["EM_REPARO", "RECEBIDA"],
        id_tecnico: 7,
        busca: "dell",
        data_inicio: "2026-11-01",
        data_fim: "2026-11-30"
    });
    assert.deepEqual(chamadas[1], { sem_tecnico: true });

    await esperarStatus(ordemServicoService.listarTodos(ADMIN, { status: "APROVADA" }), 400);
    await esperarStatus(ordemServicoService.listarTodos(ADMIN, { id_tecnico: "x" }), 400);
    await esperarStatus(ordemServicoService.listarTodos(ADMIN, { data_inicio: "01/11/2026" }), 400);
});

test("technician filters are forced to their own orders and the request is hidden", async (teste) => {
    const chamadas = [];
    substituirMetodos(teste, ordemServicoRepository, {
        listarTodos: async (filtros) => {
            chamadas.push(filtros);
            return [{ id_os: 2, id_tecnico: 7, id_solicitacao: 9, nome_cliente: "Maria" }];
        }
    });

    const ordens = await ordemServicoService.listarTodos(TECNICO, {
        id_tecnico: "2",
        sem_tecnico: "true",
        status: "EM_REPARO"
    });

    assert.deepEqual(chamadas[0], { id_tecnico: 7, status: ["EM_REPARO"] });
    assert.equal(ordens[0].id_solicitacao, undefined);
    assert.equal(ordens[0].nome_cliente, "Maria");
});

// ---------- Detalhes ----------

const LINHA = {
    id_os: 2,
    status: "EM_REPARO",
    data_abertura: "2026-11-01",
    data_encerramento: null,
    motivo_encerramento: null,
    id_tecnico: 7,
    nome_tecnico: "Tecnico Teste",
    tecnico_ativo: 1,
    id_item: 20,
    tipo_equipamento: "Notebook",
    marca: "Dell",
    modelo: "X",
    numero_serie: null,
    estado_fisico: "ok",
    garantia_status: "PENDENTE",
    observacoes_equipamento: null,
    id_cliente: 1,
    nome_razao_social: "Maria Cliente",
    telefone: "11999990000",
    email: "maria@teste.test",
    id_solicitacao: 9,
    data_solicitacao: "2026-11-01",
    descricao_inicial: "Não liga"
};

function simularDetalhes(teste, linha = LINHA) {
    substituirMetodos(teste, ordemServicoRepository, {
        buscarDetalhes: async (id) => (id === linha.id_os ? { ...linha } : null)
    });
    substituirMetodos(teste, acessorioRecebidoRepository, {
        listarPorItem: async () => [{ id_acessorio_recebido: 1, descricao_acessorio: "Carregador", quantidade: 1 }]
    });
}

test("details for administrator include client contact and the source request", async (teste) => {
    simularDetalhes(teste);

    const detalhes = await ordemServicoService.buscarDetalhes(2, ATENDENTE);

    assert.deepEqual(detalhes.tecnico, { id_usuario: 7, nome: "Tecnico Teste", ativo: true });
    assert.equal(detalhes.equipamento.marca, "Dell");
    assert.equal(detalhes.cliente.telefone, "11999990000");
    assert.equal(detalhes.solicitacao.descricao_inicial, "Não liga");
    assert.equal(detalhes.acessorios[0].descricao_acessorio, "Carregador");
});

test("details for the technician show only the client name and no request data", async (teste) => {
    simularDetalhes(teste);

    const detalhes = await ordemServicoService.buscarDetalhes(2, TECNICO);

    assert.deepEqual(detalhes.cliente, { id_cliente: 1, nome_razao_social: "Maria Cliente" });
    assert.equal(detalhes.solicitacao, undefined);
});

test("details of an order without technician and of another technician's order", async (teste) => {
    simularDetalhes(teste, { ...LINHA, id_tecnico: null, nome_tecnico: null, tecnico_ativo: null });

    const detalhes = await ordemServicoService.buscarDetalhes(2, ADMIN);
    assert.equal(detalhes.tecnico, null);

    await esperarStatus(ordemServicoService.buscarDetalhes(2, TECNICO), 404);
    await esperarStatus(ordemServicoService.buscarDetalhes(99, ADMIN), 404);
});

test("an inactive assigned technician is flagged in the details", async (teste) => {
    simularDetalhes(teste, { ...LINHA, id_tecnico: 2, nome_tecnico: "Tiago", tecnico_ativo: 0 });

    const detalhes = await ordemServicoService.buscarDetalhes(2, ADMIN);
    assert.equal(detalhes.tecnico.ativo, false);
});

// ---------- Atribuição ----------

function simularAtribuicao(teste, status) {
    const atribuicoes = [];
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async (id) => (id === 2 ? { id_os: 2, id_tecnico: null, status } : null),
        atribuirTecnico: async (id_os, id_tecnico) => {
            atribuicoes.push([id_os, id_tecnico]);
            return true;
        }
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => ({
            6: { id_usuario: 6, perfil: "ATENDENTE", ativo: 1 },
            7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 },
            8: { id_usuario: 8, perfil: "TECNICO", ativo: 0 }
        })[id] ?? null
    });
    return atribuicoes;
}

test("assigns an active technician and rejects other profiles or inactive users", async (teste) => {
    const atribuicoes = simularAtribuicao(teste, "RECEBIDA");

    await ordemServicoService.atribuirTecnico(2, 7);
    assert.deepEqual(atribuicoes, [[2, 7]]);

    await esperarStatus(ordemServicoService.atribuirTecnico(2, 6), 403);
    await esperarStatus(ordemServicoService.atribuirTecnico(2, 8), 404);
    await esperarStatus(ordemServicoService.atribuirTecnico(2, "x"), 400);
    assert.equal(atribuicoes.length, 1);
});

test("the technician of a closed order cannot be changed (A6)", async (teste) => {
    for (const status of ["FINALIZADA", "ENCERRADA_SEM_REPARO"]) {
        await teste.test(status, async (sub) => {
            const atribuicoes = simularAtribuicao(sub, status);
            await esperarStatus(ordemServicoService.atribuirTecnico(2, 7), 409);
            assert.equal(atribuicoes.length, 0);
        });
    }
});

// ---------- Técnicos ativos (A5) ----------

test("user listing accepts profile and active filters", async (teste) => {
    const chamadas = [];
    substituirMetodos(teste, usuarioRepository, {
        listarTodos: async (filtros) => {
            chamadas.push(filtros);
            return [];
        }
    });

    await usuarioService.listarTodos({ perfil: "tecnico", ativo: "1" });
    await usuarioService.listarTodos({});

    assert.deepEqual(chamadas, [{ perfil: "TECNICO", ativo: 1 }, {}]);
    await esperarStatus(usuarioService.listarTodos({ perfil: "CLIENTE" }), 400);
    await esperarStatus(usuarioService.listarTodos({ ativo: "sim" }), 400);
});
