/*
 * Testes da regra "somente um orçamento PENDENTE por OS".
 * Usam um banco simulado em memória: nenhum teste acessa o MySQL.
 *
 * O banco simulado imita o comportamento do InnoDB que importa para a regra:
 * - cada getConnection() devolve uma conexão própria;
 * - o SELECT ... FOR UPDATE na OS bloqueia a linha até o COMMIT ou ROLLBACK;
 *   outra transação que pedir o mesmo bloqueio fica esperando;
 * - o ROLLBACK desfaz o que a transação alterou.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const orcamentoRepository = require("../src/repositories/orcamentoRepository");
const orcamentoService = require("../src/services/orcamentoService");
const execucaoRepository = require("../src/repositories/execucaoRepository");
const usuarioRepository = require("../src/repositories/usuarioRepository");

const UM_DIA = 24 * 60 * 60 * 1000;
const ID_OS = 10;
const ID_TECNICO = 7;
const TECNICO = { id_usuario: ID_TECNICO, perfil: "TECNICO" };

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

function criarBancoSimulado(orcamentosIniciais) {
    const banco = {
        ordem: { id_os: ID_OS, id_tecnico: ID_TECNICO, status: "AGUARDANDO_APROVACAO", garantia_status: "NAO" },
        orcamentos: orcamentosIniciais.map((orcamento) => ({ ...orcamento })),
        itens: [],
        historico: [],
        comandos: [],
        bloqueioOs: null // promessa que só termina quando a transação dona do bloqueio acaba
    };
    let proximoId = 100;
    let proximaConexao = 1;

    const estaPendenteValido = (orcamento) =>
        orcamento.status === "PENDENTE" && orcamento.data_validade.getTime() > Date.now();

    const copiarDados = () => ({
        ordem: { ...banco.ordem },
        itens: banco.itens.map((item) => ({ ...item })),
        historico: banco.historico.map((evento) => ({ ...evento })),
        orcamentos: banco.orcamentos.map((orcamento) => ({ ...orcamento }))
    });

    banco.novaConexao = () => {
        const nome = `T${proximaConexao++}`;
        let copiaAntesDaTransacao = null;
        let liberarBloqueio = null;

        const registrar = (comando) => banco.comandos.push(comando);
        const registrarNaConexao = (comando) => banco.comandos.push(`${nome}:${comando}`);

        const encerrarTransacao = () => {
            if (liberarBloqueio) {
                banco.bloqueioOs = null;
                liberarBloqueio();
                liberarBloqueio = null;
            }
        };

        return {
            nome,
            beginTransaction: async () => {
                registrar("BEGIN");
                registrarNaConexao("BEGIN");
                copiaAntesDaTransacao = copiarDados();
            },
            execute: async (sql, parametros) => {
                if (sql.includes("FROM ordem_servico os") && sql.includes("FOR UPDATE")) {
                    // Espera enquanto outra transação estiver com a OS bloqueada
                    while (banco.bloqueioOs) {
                        registrarNaConexao("ESPERA_BLOQUEIO");
                        await banco.bloqueioOs;
                    }
                    banco.bloqueioOs = new Promise((resolver) => {
                        liberarBloqueio = resolver;
                    });
                    copiaAntesDaTransacao = copiarDados();
                    registrar("BLOQUEIA_OS");
                    registrarNaConexao("BLOQUEIA_OS");
                    return [[{ ...banco.ordem }], []];
                }

                if (sql.includes("UPDATE orcamento") && sql.includes("'VENCIDO'")) {
                    registrar("MARCA_VENCIDOS");
                    let alterados = 0;

                    for (const orcamento of banco.orcamentos) {
                        if (orcamento.id_os === parametros[0] && orcamento.status === "PENDENTE" && orcamento.data_validade.getTime() <= Date.now()) {
                            orcamento.status = "VENCIDO";
                            alterados++;
                        }
                    }

                    return [{ affectedRows: alterados }, []];
                }

                if (sql.includes("SELECT id_orcamento") && sql.includes("data_validade <=")) {
                    registrar("BUSCA_VENCIDOS");
                    const vencidos = banco.orcamentos
                        .filter((orcamento) => orcamento.id_os === parametros[0] && orcamento.status === "PENDENTE" && orcamento.data_validade.getTime() <= Date.now())
                        .map(({ id_orcamento }) => ({ id_orcamento }));
                    return [vencidos, []];
                }

                if (sql.includes("INSERT INTO historico_os")) {
                    registrar("HISTORICO");
                    banco.historico.push({
                        id_os: parametros[0], id_usuario: parametros[1], tipo_evento: parametros[2], descricao: parametros[3],
                        dados_anteriores: parametros[4] && JSON.parse(parametros[4]), dados_novos: parametros[5] && JSON.parse(parametros[5])
                    });
                    return [{ insertId: banco.historico.length }, []];
                }

                if (sql.includes("SELECT id_orcamento") && sql.includes("'PENDENTE'")) {
                    registrar("BUSCA_PENDENTE");
                    // Pausa curta: dá chance à outra requisição de tentar entrar ao mesmo tempo
                    await new Promise((resolver) => setImmediate(resolver));
                    const pendentes = banco.orcamentos
                        .filter((orcamento) => orcamento.id_os === parametros[0] && estaPendenteValido(orcamento))
                        .map(({ id_orcamento }) => ({ id_orcamento }));
                    return [pendentes.slice(0, 1), []];
                }

                if (sql.includes("INSERT INTO orcamento")) {
                    registrar("INSERE_ORCAMENTO");
                    const novo = {
                        id_orcamento: proximoId++,
                        id_os: parametros[0],
                        id_tecnico: parametros[1],
                        valor_total: parametros[2],
                        status: "PENDENTE",
                        data_validade: new Date(Date.now() + 3 * UM_DIA)
                    };
                    banco.orcamentos.push(novo);
                    return [{ insertId: novo.id_orcamento }, []];
                }

                if (sql.includes("INSERT INTO item_orcamento")) {
                    registrar("INSERE_ITEM");
                    banco.itens.push({ id_orcamento: parametros[0], descricao: parametros[2] });
                    return [{ affectedRows: 1 }, []];
                }

                if (sql.includes("UPDATE ordem_servico")) {
                    registrar("ATUALIZA_OS");
                    banco.ordem.status = "AGUARDANDO_APROVACAO";
                    return [{ affectedRows: 1 }, []];
                }

                throw new Error(`Comando SQL não previsto no teste: ${sql}`);
            },
            commit: async () => {
                registrar("COMMIT");
                registrarNaConexao("COMMIT");
                encerrarTransacao();
            },
            rollback: async () => {
                registrar("ROLLBACK");
                registrarNaConexao("ROLLBACK");
                Object.assign(banco, copiaAntesDaTransacao);
                encerrarTransacao();
            },
            release: () => {
                registrar("RELEASE");
            }
        };
    };

    return banco;
}

// Liga o service e o repository ao banco simulado (sem tocar no MySQL)
function simularDependencias(teste, banco) {
    substituirMetodos(teste, orcamentoRepository.pool, {
        getConnection: async () => banco.novaConexao()
    });
    substituirMetodos(teste, orcamentoRepository, {
        buscarOrdemServico: async () => ({ ...banco.ordem }),
        buscarPorId: async (id) => banco.orcamentos.find((orcamento) => orcamento.id_orcamento === id) || null
    });
    substituirMetodos(teste, execucaoRepository, {
        buscarPorOs: async () => ({ id_execucao: 1, id_os: ID_OS })
    });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => ({ id_usuario: id, perfil: "TECNICO", ativo: 1 })
    });
}

async function iniciarServidor(teste) {
    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));

    const base = `http://127.0.0.1:${servidor.address().port}/api`;
    const token = `Bearer ${jwt.sign({ id_usuario: ID_TECNICO, perfil: "TECNICO" }, process.env.JWT_SECRET)}`;

    return (caminho, corpo) => fetch(base + caminho, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify(corpo)
    });
}

const novoOrcamento = {
    itens: [{ tipo_item: "PECA", descricao: "Tela nova", quantidade: 1, valor_unitario: 250 }]
};

const pendentesDaOs = (banco) =>
    banco.orcamentos.filter((orcamento) => orcamento.id_os === ID_OS && orcamento.status === "PENDENTE");

// ---------- Duas tentativas seguidas ----------

test("two quotes registered one after the other: the second is blocked with 409", async (teste) => {
    const banco = criarBancoSimulado([
        { id_orcamento: 1, id_os: ID_OS, id_tecnico: ID_TECNICO, status: "REJEITADO", data_validade: new Date(Date.now() - 10 * UM_DIA) }
    ]);
    simularDependencias(teste, banco);
    const enviar = await iniciarServidor(teste);

    const primeira = await enviar(`/ordens-servico/${ID_OS}/orcamentos`, novoOrcamento);
    assert.equal(primeira.status, 201);

    const segunda = await enviar(`/ordens-servico/${ID_OS}/orcamentos`, novoOrcamento);
    const corpo = await segunda.json();

    assert.equal(segunda.status, 409);
    assert.equal(corpo.mensagem, "Já existe um orçamento válido aguardando resposta.");

    // O histórico é mantido: o REJEITADO continua e há só um PENDENTE
    assert.equal(banco.orcamentos.length, 2);
    assert.equal(banco.orcamentos[0].status, "REJEITADO");
    assert.equal(pendentesDaOs(banco).length, 1);
    assert.equal(banco.itens.length, 1);
});

// ---------- Cenário A: bloqueio de orçamento duplicado ----------

test("A: second quote for an OS with a valid PENDENTE quote returns 409 and rolls back", async (teste) => {
    const banco = criarBancoSimulado([
        { id_orcamento: 1, id_os: ID_OS, id_tecnico: ID_TECNICO, status: "REJEITADO", data_validade: new Date(Date.now() - 10 * UM_DIA) },
        { id_orcamento: 2, id_os: ID_OS, id_tecnico: ID_TECNICO, status: "PENDENTE", data_validade: new Date(Date.now() + 2 * UM_DIA) }
    ]);
    simularDependencias(teste, banco);
    const enviar = await iniciarServidor(teste);

    const resposta = await enviar(`/ordens-servico/${ID_OS}/orcamentos`, novoOrcamento);
    const corpo = await resposta.json();

    assert.equal(resposta.status, 409);
    assert.equal(corpo.mensagem, "Já existe um orçamento válido aguardando resposta.");

    // Nenhum orçamento novo: continuam os dois originais, com o mesmo status
    assert.deepEqual(banco.orcamentos.map(({ id_orcamento, status }) => [id_orcamento, status]), [[1, "REJEITADO"], [2, "PENDENTE"]]);
    assert.equal(banco.itens.length, 0);
    assert.ok(!banco.comandos.includes("INSERE_ORCAMENTO"));

    // A transação foi revertida e a conexão devolvida ao pool
    assert.ok(banco.comandos.includes("ROLLBACK"));
    assert.ok(!banco.comandos.includes("COMMIT"));
    assert.equal(banco.comandos.at(-1), "RELEASE");
});

test("A: the OS row is locked before the pending check, inside the same transaction", async (teste) => {
    const banco = criarBancoSimulado([
        { id_orcamento: 2, id_os: ID_OS, id_tecnico: ID_TECNICO, status: "PENDENTE", data_validade: new Date(Date.now() + 2 * UM_DIA) }
    ]);
    simularDependencias(teste, banco);

    await assert.rejects(
        orcamentoService.criar(ID_OS, novoOrcamento, TECNICO),
        (erro) => erro.statusCode === 409
    );

    const semConexao = banco.comandos.filter((comando) => !comando.startsWith("T"));
    assert.deepEqual(semConexao, ["BEGIN", "BLOQUEIA_OS", "BUSCA_VENCIDOS", "BUSCA_PENDENTE", "ROLLBACK", "RELEASE"]);
    assert.equal(banco.historico.length, 0);
});

// ---------- Cenário B: criação após vencimento ----------

test("B: an expired PENDENTE quote becomes VENCIDO and the new quote is created as PENDENTE", async (teste) => {
    const banco = criarBancoSimulado([
        { id_orcamento: 3, id_os: ID_OS, id_tecnico: ID_TECNICO, status: "PENDENTE", data_validade: new Date(Date.now() - UM_DIA) }
    ]);
    simularDependencias(teste, banco);
    const enviar = await iniciarServidor(teste);

    const resposta = await enviar(`/ordens-servico/${ID_OS}/orcamentos`, novoOrcamento);
    const corpo = await resposta.json();

    assert.equal(resposta.status, 201);
    assert.equal(corpo.orcamento.status, "PENDENTE");

    const anterior = banco.orcamentos.find((orcamento) => orcamento.id_orcamento === 3);
    const novo = banco.orcamentos.find((orcamento) => orcamento.id_orcamento === corpo.orcamento.id_orcamento);

    assert.equal(anterior.status, "VENCIDO");
    assert.equal(novo.status, "PENDENTE");
    assert.equal(novo.id_os, ID_OS);
    assert.equal(pendentesDaOs(banco).length, 1);
    assert.equal(banco.itens.length, 1);

    // O vencimento acontece antes da verificação, e a transação é confirmada
    const semConexao = banco.comandos.filter((comando) => !comando.startsWith("T"));
    assert.deepEqual(semConexao, [
        "BEGIN", "BLOQUEIA_OS", "BUSCA_VENCIDOS", "MARCA_VENCIDOS", "HISTORICO", "BUSCA_PENDENTE",
        "INSERE_ORCAMENTO", "INSERE_ITEM", "ATUALIZA_OS", "HISTORICO", "COMMIT", "RELEASE"
    ]);

    // RN21: vencimento automático (sem usuário) e emissão pelo técnico, na mesma transação
    assert.deepEqual(banco.historico.map((h) => [h.tipo_evento, h.id_usuario, h.dados_novos.status]), [
        ["ORCAMENTO", null, "VENCIDO"],
        ["ORCAMENTO", ID_TECNICO, "PENDENTE"]
    ]);
    assert.equal(banco.historico[1].dados_novos.id_orcamento, novo.id_orcamento);
});

// ---------- Concorrência ----------

test("two simultaneous requests: the second waits for the OS lock and receives 409", async (teste) => {
    const banco = criarBancoSimulado([]);
    simularDependencias(teste, banco);

    const resultados = await Promise.allSettled([
        orcamentoService.criar(ID_OS, novoOrcamento, TECNICO),
        orcamentoService.criar(ID_OS, novoOrcamento, TECNICO)
    ]);

    const criados = resultados.filter((resultado) => resultado.status === "fulfilled");
    const recusados = resultados.filter((resultado) => resultado.status === "rejected");

    assert.equal(criados.length, 1);
    assert.equal(recusados.length, 1);
    assert.equal(recusados[0].reason.statusCode, 409);
    assert.equal(pendentesDaOs(banco).length, 1);

    // A segunda transação só obteve o bloqueio depois do COMMIT da primeira
    // (a ordem dos dois BEGIN não importa; importa a ordem do bloqueio)
    const porConexao = banco.comandos.filter((comando) => comando.startsWith("T") && !comando.endsWith("BEGIN"));
    assert.deepEqual(porConexao, [
        "T1:BLOQUEIA_OS",
        "T2:ESPERA_BLOQUEIO",
        "T1:COMMIT",
        "T2:BLOQUEIA_OS",
        "T2:ROLLBACK"
    ]);
});

// ---------- Alteração de status ----------

test("the response route cannot move a quote back to PENDENTE", async (teste) => {
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => ({ id_usuario: id, perfil: "ATENDENTE", ativo: 1 })
    });
    substituirMetodos(teste, orcamentoRepository, {
        registrarResposta: async () => {
            throw new Error("O repository não deveria ser chamado.");
        }
    });

    await assert.rejects(
        orcamentoService.responder(2, { decisao: "PENDENTE" }, { id_usuario: 6, perfil: "ATENDENTE" }),
        (erro) => erro.statusCode === 400
    );
});
