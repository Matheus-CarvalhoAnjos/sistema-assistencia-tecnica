/*
 * RN05 (MER v1.4) — herança da garantia entre OS do mesmo equipamento.
 * Usa um banco simulado em memória: nenhum teste acessa o MySQL.
 *
 * O "mesmo equipamento" é o mesmo id_item: é a única identidade segura no modelo atual
 * (itens de solicitações diferentes não têm vínculo entre si).
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const solicitacaoRepository = require("../src/repositories/solicitacaoRepository");
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

// Banco simulado: OS gravadas só após COMMIT; ROLLBACK descarta o que estava pendente
function bancoSimulado(ordensIniciais, { falharNoInsert = false } = {}) {
    const banco = { ordens: ordensIniciais.map((os) => ({ ...os })), historico: [], comandos: [] };
    let pendentes = [];
    let historicoPendente = [];
    let proximoId = 1000;

    banco.conexao = {
        beginTransaction: async () => banco.comandos.push("BEGIN"),
        commit: async () => {
            banco.comandos.push("COMMIT");
            banco.ordens.push(...pendentes);
            banco.historico.push(...historicoPendente);
            pendentes = [];
            historicoPendente = [];
        },
        rollback: async () => {
            banco.comandos.push("ROLLBACK");
            pendentes = [];
            historicoPendente = [];
        },
        release: () => banco.comandos.push("RELEASE"),
        execute: async (sql, parametros) => {
            if (sql.includes("FROM item_solicitacao")) {
                return [[{ id_item: parametros[0] }], []];
            }
            if (sql.includes("status NOT IN")) {
                return [[], []]; // nenhuma OS ativa
            }
            if (sql.includes("SELECT id_os, garantia_status")) {
                banco.comandos.push("BUSCA_OS_ANTERIOR");
                const doItem = banco.ordens
                    .filter((os) => os.id_item === parametros[0])
                    .sort((a, b) => b.id_os - a.id_os);
                return [doItem.slice(0, 1).map(({ id_os, garantia_status }) => ({ id_os, garantia_status })), []];
            }
            if (sql.includes("INSERT INTO ordem_servico")) {
                if (falharNoInsert) {
                    throw new Error("falha simulada no banco");
                }
                const nova = {
                    id_os: proximoId++,
                    id_item: parametros[0],
                    id_tecnico: parametros[1],
                    status: parametros[2],
                    garantia_status: parametros[3]
                };
                pendentes.push(nova);
                return [{ insertId: nova.id_os }, []];
            }
            if (sql.includes("INSERT INTO historico_os")) {
                banco.comandos.push("HISTORICO");
                historicoPendente.push({
                    id_os: parametros[0], id_usuario: parametros[1], tipo_evento: parametros[2],
                    descricao: parametros[3], dados_novos: JSON.parse(parametros[5])
                });
                return [{ insertId: 1 }, []];
            }
            throw new Error(`Comando não previsto no teste: ${sql}`);
        }
    };

    return banco;
}

async function criarOs(teste, banco, id_item) {
    substituirMetodos(teste, ordemServicoRepository.pool, { getConnection: async () => banco.conexao });
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async (id) => banco.ordens.find((os) => os.id_os === id) || null
    });
    return ordemServicoRepository.criar({ id_item, id_tecnico: null });
}

test("RN05: equipment without a previous OS starts with PENDENTE", async (teste) => {
    const banco = bancoSimulado([]);
    const nova = await criarOs(teste, banco, 1);

    assert.equal(nova.garantia_status, "PENDENTE");
    assert.equal(nova.status, "RECEBIDA");
});

test("RN05: previous OS with SIM is inherited as SIM", async (teste) => {
    const banco = bancoSimulado([{ id_os: 5, id_item: 1, status: "FINALIZADA", garantia_status: "SIM" }]);
    const nova = await criarOs(teste, banco, 1);

    assert.equal(nova.garantia_status, "SIM");
});

test("RN05: previous OS with NAO is inherited as NAO", async (teste) => {
    const banco = bancoSimulado([{ id_os: 5, id_item: 1, status: "ENCERRADA_SEM_REPARO", garantia_status: "NAO" }]);
    const nova = await criarOs(teste, banco, 1);

    assert.equal(nova.garantia_status, "NAO");
});

test("RN05: with several previous OS, the most recent one is used", async (teste) => {
    const banco = bancoSimulado([
        { id_os: 3, id_item: 1, status: "FINALIZADA", garantia_status: "NAO" },
        { id_os: 9, id_item: 1, status: "ENCERRADA_SEM_REPARO", garantia_status: "SIM" },
        { id_os: 6, id_item: 1, status: "FINALIZADA", garantia_status: "PENDENTE" }
    ]);
    const nova = await criarOs(teste, banco, 1);

    assert.equal(nova.garantia_status, "SIM");
});

test("RN05: warranties of different equipments are not mixed", async (teste) => {
    const banco = bancoSimulado([
        { id_os: 5, id_item: 1, status: "FINALIZADA", garantia_status: "SIM" },
        { id_os: 7, id_item: 2, status: "FINALIZADA", garantia_status: "NAO" }
    ]);

    const doItem2 = await criarOs(teste, banco, 2);
    const doItem3 = await criarOs(teste, banco, 3);

    assert.equal(doItem2.garantia_status, "NAO");
    assert.equal(doItem3.garantia_status, "PENDENTE");
});

test("RN05: the previous OS is read inside the same transaction, before the insert", async (teste) => {
    const banco = bancoSimulado([{ id_os: 5, id_item: 1, status: "FINALIZADA", garantia_status: "SIM" }]);
    await criarOs(teste, banco, 1);

    const relevantes = banco.comandos.filter((c) => c !== "RELEASE");
    assert.deepEqual(relevantes, ["BEGIN", "BUSCA_OS_ANTERIOR", "HISTORICO", "COMMIT"]);

    // RN21: o evento de criação registra a garantia herdada e de qual OS ela veio
    assert.equal(banco.historico.length, 1);
    assert.equal(banco.historico[0].tipo_evento, "CRIACAO");
    assert.deepEqual(banco.historico[0].dados_novos, {
        status: "RECEBIDA", garantia_status: "SIM", garantia_herdada_da_os: 5, id_item: 1, id_tecnico: null
    });
});

test("RN05: a failure while creating the OS rolls back without partial records", async (teste) => {
    const banco = bancoSimulado([{ id_os: 5, id_item: 1, status: "FINALIZADA", garantia_status: "SIM" }], { falharNoInsert: true });

    await assert.rejects(criarOs(teste, banco, 1), /falha simulada/);

    assert.equal(banco.ordens.length, 1);
    assert.equal(banco.historico.length, 0);
    assert.ok(banco.comandos.includes("ROLLBACK"));
    assert.ok(!banco.comandos.includes("COMMIT"));
});

test("RN05: a request with several new equipments gives each new OS its own PENDENTE warranty", async (teste) => {
    const parametrosOs = [];
    let id = 0;
    const conexao = {
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {},
        release: () => {},
        execute: async (sql, parametros) => {
            if (sql.includes("INSERT INTO ordem_servico")) {
                parametrosOs.push(parametros);
            }
            if (sql.trim().startsWith("SELECT")) {
                return [[{ data_abertura: null, status: "RECEBIDA" }]];
            }
            return [{ insertId: ++id }];
        }
    };
    substituirMetodos(teste, pool, { getConnection: async () => conexao });

    await solicitacaoRepository.criar({
        id_cliente: 1,
        id_atendente: 6,
        descricao_inicial: "Três equipamentos",
        itens: ["A", "B", "C"].map((nome) => ({
            tipo_equipamento: nome, marca: "M", modelo: "X", estado_fisico: "ok", garantia_status: "PENDENTE", acessorios: []
        }))
    });

    // Cada equipamento novo recebe sua OS com garantia própria (PENDENTE: não há OS anterior)
    assert.equal(parametrosOs.length, 3);
    assert.equal(new Set(parametrosOs.map((p) => p[0])).size, 3);
    assert.ok(parametrosOs.every((p) => p[3] === "PENDENTE"));
});
