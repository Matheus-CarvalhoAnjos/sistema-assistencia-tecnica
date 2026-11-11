/*
 * Etapa 2 — autenticação e ações exclusivas do técnico atribuído.
 * MER v1.4: "Diagnóstico/garantia: técnico atualmente atribuído" (RN03, RN05).
 * Usam repositories simulados: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const ordemServicoService = require("../src/services/ordemServicoService");
const execucaoRepository = require("../src/repositories/execucaoRepository");
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

const USUARIOS = {
    1: { id_usuario: 1, nome: "Admin", perfil: "ADMINISTRADOR", ativo: 1 },
    2: { id_usuario: 2, nome: "Atendente", perfil: "ATENDENTE", ativo: 1 },
    7: { id_usuario: 7, nome: "Técnico atribuído", perfil: "TECNICO", ativo: 1 },
    8: { id_usuario: 8, nome: "Outro técnico", perfil: "TECNICO", ativo: 1 },
    9: { id_usuario: 9, nome: "Técnico inativo", perfil: "TECNICO", ativo: 0 }
};

// OS 11 atribuída ao técnico 7, ainda RECEBIDA
function simularOs(teste, gravacoes, statusOs = "RECEBIDA") {
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => USUARIOS[id] ?? null
    });
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async (id) => (Number(id) === 11 ? { id_os: 11, id_item: 3, id_tecnico: 7, status: statusOs } : null),
        atualizarGarantia: async (id, garantia) => {
            gravacoes.push({ acao: "garantia", id, garantia });
            return true;
        }
    });
    substituirMetodos(teste, execucaoRepository, {
        buscarPorOs: async () => null,
        criar: async (dados) => {
            gravacoes.push({ acao: "diagnostico", ...dados });
            return { id_os: dados.id_os, diagnostico: dados.diagnostico };
        }
    });
}

async function iniciarServidor(teste) {
    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const base = `http://127.0.0.1:${servidor.address().port}/api`;

    return (metodo, caminho, idUsuario, corpo) => fetch(base + caminho, {
        method: metodo,
        headers: {
            "Content-Type": "application/json",
            ...(idUsuario ? { Authorization: `Bearer ${jwt.sign({ id_usuario: idUsuario, perfil: USUARIOS[idUsuario]?.perfil }, process.env.JWT_SECRET)}` } : {})
        },
        body: corpo ? JSON.stringify(corpo) : undefined
    });
}

// ---------- Diagnóstico ----------

test("diagnosis: administrator and attendant get 403; only the assigned technician records it", async (teste) => {
    const gravacoes = [];
    simularOs(teste, gravacoes);
    const chamar = await iniciarServidor(teste);
    const corpo = { diagnostico: "Placa com oxidação" };

    for (const id of [1, 2]) {
        assert.equal((await chamar("POST", "/ordens-servico/11/execucao", id, corpo)).status, 403, `POST perfil ${id}`);
        assert.equal((await chamar("PATCH", "/ordens-servico/11/execucao", id, corpo)).status, 403, `PATCH perfil ${id}`);
    }

    assert.equal((await chamar("POST", "/ordens-servico/11/execucao", 8, corpo)).status, 403, "outro técnico");
    assert.equal(gravacoes.length, 0);

    const resposta = await chamar("POST", "/ordens-servico/11/execucao", 7, corpo);
    assert.equal(resposta.status, 201);
    assert.equal(gravacoes.length, 1);
    assert.equal(gravacoes[0].id_tecnico, 7);
});

// ---------- Garantia ----------

// Regra atual: a verificação da garantia é do ATENDENTE (substituiu a regra do técnico atribuído)
test("warranty: administrator and technicians get 403 on the API; the attendant records it", async (teste) => {
    const gravacoes = [];
    simularOs(teste, gravacoes, "EM_ANALISE");
    const chamar = await iniciarServidor(teste);

    // Requisição direta à API: técnico (atribuído ou não) e administrador não alteram a garantia
    for (const id of [1, 7, 8]) {
        assert.equal((await chamar("PATCH", "/ordens-servico/11/garantia", id, { garantia_status: "SIM" })).status, 403, `perfil ${id}`);
    }
    assert.equal(gravacoes.length, 0);

    // Não volta para PENDENTE
    assert.equal((await chamar("PATCH", "/ordens-servico/11/garantia", 2, { garantia_status: "PENDENTE" })).status, 400);

    const resposta = await chamar("PATCH", "/ordens-servico/11/garantia", 2, { garantia_status: "NAO" });
    assert.equal(resposta.status, 200);
    assert.deepEqual(gravacoes, [{ acao: "garantia", id: 11, garantia: "NAO" }]);
});

test("warranty service refuses everyone but an active attendant, even when called directly", async (teste) => {
    const gravacoes = [];
    simularOs(teste, gravacoes, "EM_ANALISE");

    for (const usuario of [USUARIOS[1], USUARIOS[7], USUARIOS[8], undefined]) {
        await assert.rejects(ordemServicoService.atualizarGarantia(11, "SIM", usuario), { statusCode: 403 });
    }

    // Token com perfil ATENDENTE, mas o usuário no banco não é atendente ativo
    await assert.rejects(ordemServicoService.atualizarGarantia(11, "SIM", { id_usuario: 9, perfil: "ATENDENTE" }), { statusCode: 403 });
    assert.equal(gravacoes.length, 0);

    const resultado = await ordemServicoService.atualizarGarantia(11, "SIM", USUARIOS[2]);
    assert.deepEqual(resultado, { id_os: 11, garantia_status: "SIM", status: "EM_REPARO" });
    assert.deepEqual(gravacoes, [{ acao: "garantia", id: 11, garantia: "SIM" }]);
});

// ---------- RN03: primeiro diagnóstico muda RECEBIDA → EM_ANALISE ----------

function conexaoSimulada({ falhar } = {}) {
    const comandos = [];
    return {
        comandos,
        conexao: {
            beginTransaction: async () => comandos.push("BEGIN"),
            commit: async () => comandos.push("COMMIT"),
            rollback: async () => comandos.push("ROLLBACK"),
            release: () => comandos.push("RELEASE"),
            execute: async (sql, parametros) => {
                if (sql.includes("INSERT INTO execucao")) {
                    comandos.push("INSERE_EXECUCAO");
                } else if (sql.includes("UPDATE ordem_servico")) {
                    if (falhar) throw new Error("falha simulada no banco");
                    comandos.push({ sql: sql.replace(/\s+/g, " ").trim(), parametros });
                }
                return [{ affectedRows: 1 }];
            }
        }
    };
}

test("RN03: the first diagnosis moves the order from RECEBIDA to EM_ANALISE in the same transaction", async (teste) => {
    const simulada = conexaoSimulada();
    substituirMetodos(teste, execucaoRepository.pool, { getConnection: async () => simulada.conexao });
    substituirMetodos(teste, execucaoRepository, { buscarPorOs: async () => ({ id_os: 11 }) });

    await execucaoRepository.criar({ id_os: 11, id_tecnico: 7, diagnostico: "ok", data_inicio: new Date() });

    const [inicio, insercao, atualizacao, fim] = simulada.comandos;
    assert.equal(inicio, "BEGIN");
    assert.equal(insercao, "INSERE_EXECUCAO");
    assert.match(atualizacao.sql, /SET status = 'EM_ANALISE' WHERE id_os = \? AND status = 'RECEBIDA'/);
    assert.deepEqual(atualizacao.parametros, [11]);
    assert.equal(fim, "COMMIT");
});

test("RN03: a failure while updating the order rolls back the diagnosis", async (teste) => {
    const simulada = conexaoSimulada({ falhar: true });
    substituirMetodos(teste, execucaoRepository.pool, { getConnection: async () => simulada.conexao });

    await assert.rejects(
        execucaoRepository.criar({ id_os: 11, id_tecnico: 7, diagnostico: "ok", data_inicio: new Date() }),
        /falha simulada/
    );

    assert.ok(simulada.comandos.includes("ROLLBACK"));
    assert.ok(!simulada.comandos.includes("COMMIT"));
    assert.equal(simulada.comandos.at(-1), "RELEASE");
});

// ---------- Login e token ----------

test("login: wrong password 401, inactive user 403, valid user receives a token with id and profile", async (teste) => {
    const hash = await bcrypt.hash("senha-de-teste", 4);
    substituirMetodos(teste, usuarioRepository, {
        buscarPorEmailParaLogin: async (email) => ({
            "ativo@teste.test": { id_usuario: 7, nome: "Téc", email, perfil: "TECNICO", ativo: 1, senha_hash: hash },
            "inativo@teste.test": { id_usuario: 9, nome: "Ina", email, perfil: "TECNICO", ativo: 0, senha_hash: hash }
        })[email] ?? null
    });
    const chamar = await iniciarServidor(teste);

    assert.equal((await chamar("POST", "/auth/login", null, { email: "ativo@teste.test", senha: "errada" })).status, 401);
    assert.equal((await chamar("POST", "/auth/login", null, { email: "ninguem@teste.test", senha: "x" })).status, 401);
    assert.equal((await chamar("POST", "/auth/login", null, { email: "inativo@teste.test", senha: "senha-de-teste" })).status, 403);
    assert.equal((await chamar("POST", "/auth/login", null, { email: "" })).status, 400);

    const resposta = await chamar("POST", "/auth/login", null, { email: " ATIVO@teste.test ", senha: "senha-de-teste" });
    const corpo = await resposta.json();
    assert.equal(resposta.status, 200);
    assert.equal(corpo.usuario.perfil, "TECNICO");
    assert.equal(corpo.usuario.senha_hash, undefined);

    const dados = jwt.verify(corpo.token, process.env.JWT_SECRET);
    assert.equal(dados.id_usuario, 7);
    assert.equal(dados.perfil, "TECNICO");
});

test("token: missing, malformed, invalid or belonging to an inactive user returns 401", async (teste) => {
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => USUARIOS[id] ?? null
    });
    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const url = `http://127.0.0.1:${servidor.address().port}/api/auth/teste`;
    const comToken = (valor) => fetch(url, { headers: { Authorization: valor } });

    assert.equal((await fetch(url)).status, 401);
    assert.equal((await comToken("Basic abc")).status, 401);
    assert.equal((await comToken("Bearer token-falso")).status, 401);
    assert.equal((await comToken(`Bearer ${jwt.sign({ id_usuario: 7 }, "outra-chave")}`)).status, 401);
    assert.equal((await comToken(`Bearer ${jwt.sign({ id_usuario: 7 }, process.env.JWT_SECRET, { expiresIn: -10 })}`)).status, 401);

    // Usuário desativado depois do login: o token deixa de valer
    assert.equal((await comToken(`Bearer ${jwt.sign({ id_usuario: 9, perfil: "TECNICO" }, process.env.JWT_SECRET)}`)).status, 401);

    // O perfil vem do banco, não do token: um token "ADMINISTRADOR" de um técnico não dá acesso de administrador
    const forjado = `Bearer ${jwt.sign({ id_usuario: 7, perfil: "ADMINISTRADOR" }, process.env.JWT_SECRET)}`;
    const resposta = await comToken(forjado);
    assert.equal(resposta.status, 200);
    assert.equal((await resposta.json()).usuario.perfil, "TECNICO");
});
