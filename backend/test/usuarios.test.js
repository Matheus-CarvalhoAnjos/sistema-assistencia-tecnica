/*
 * P5 — gestão de usuários e P4 — gravação de acessórios recebidos em lote.
 * Conexões e repositories simulados: nenhum teste acessa o MySQL.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const usuarioRepository = require("../src/repositories/usuarioRepository");
const usuarioService = require("../src/services/usuarioService");
const acessorioRecebidoRepository = require("../src/repositories/acessorioRecebidoRepository");
const acessorioRecebidoService = require("../src/services/acessorioRecebidoService");
const acessorioRepository = require("../src/repositories/acessorioRepository");
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

const ADMIN = { id_usuario: 1, perfil: "ADMINISTRADOR" };
const ATENDENTE = { id_usuario: 2, perfil: "ATENDENTE" };

/*
 * Banco simulado da tabela usuario para a transação de alteração.
 * Guarda os comandos; o ROLLBACK desfaz as alterações.
 */
function bancoUsuarios(usuarios) {
    const banco = { usuarios: usuarios.map((u) => ({ ...u })), comandos: [] };
    let copia = null;

    banco.conexao = {
        beginTransaction: async () => {
            banco.comandos.push("BEGIN");
            copia = JSON.stringify(banco.usuarios);
        },
        commit: async () => banco.comandos.push("COMMIT"),
        rollback: async () => {
            banco.comandos.push("ROLLBACK");
            banco.usuarios = JSON.parse(copia);
        },
        release: () => banco.comandos.push("RELEASE"),
        execute: async (sql, p) => {
            const texto = sql.replace(/\s+/g, " ").trim();
            banco.comandos.push(texto);

            if (texto.includes("WHERE perfil = 'ADMINISTRADOR' AND ativo = 1")) {
                return [banco.usuarios.filter((u) => u.perfil === "ADMINISTRADOR" && u.ativo === 1).map(({ id_usuario }) => ({ id_usuario })), []];
            }
            if (texto.startsWith("SELECT id_usuario, perfil, ativo")) {
                return [banco.usuarios.filter((u) => u.id_usuario === p[0]).map(({ id_usuario, perfil, ativo }) => ({ id_usuario, perfil, ativo })), []];
            }
            if (texto.startsWith("SELECT id_usuario FROM usuario WHERE email")) {
                return [banco.usuarios.filter((u) => u.email === p[0] && u.id_usuario !== p[1]), []];
            }
            if (texto.startsWith("UPDATE usuario SET ativo")) {
                banco.usuarios.find((u) => u.id_usuario === p[1]).ativo = p[0];
                return [{ affectedRows: 1 }, []];
            }
            if (texto.startsWith("UPDATE usuario SET nome")) {
                const u = banco.usuarios.find((x) => x.id_usuario === p.at(-1));
                Object.assign(u, { nome: p[0], email: p[1], perfil: p[2] });
                if (p.length === 5) u.senha_hash = p[3];
                return [{ affectedRows: 1 }, []];
            }
            throw new Error(`Comando não previsto: ${texto}`);
        }
    };
    return banco;
}

function usarBanco(teste, banco) {
    substituirMetodos(teste, pool, { getConnection: async () => banco.conexao });
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => {
            const u = banco.usuarios.find((x) => x.id_usuario === id);
            return u ? { id_usuario: u.id_usuario, nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo } : null;
        }
    });
}

const base = () => [
    { id_usuario: 1, nome: "Admin", email: "admin@t.test", perfil: "ADMINISTRADOR", ativo: 1, senha_hash: "hash-antigo" },
    { id_usuario: 2, nome: "Ana", email: "ana@t.test", perfil: "ATENDENTE", ativo: 1, senha_hash: "x" },
    { id_usuario: 3, nome: "Tiago", email: "tiago@t.test", perfil: "TECNICO", ativo: 1, senha_hash: "x" }
];

// ---------- Último administrador ----------

test("the only active administrator cannot be deactivated, not even by himself", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);

    await assert.rejects(usuarioService.alterarAtivo(1, { ativo: false }, ADMIN), { statusCode: 409 });
    assert.equal(banco.usuarios[0].ativo, 1);
    assert.ok(banco.comandos.includes("ROLLBACK"));
});

test("the only active administrator cannot lose the ADMINISTRADOR profile", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);

    await assert.rejects(
        usuarioService.atualizar(1, { nome: "Admin", email: "admin@t.test", perfil: "ATENDENTE" }, ADMIN),
        { statusCode: 409 }
    );
    assert.equal(banco.usuarios[0].perfil, "ADMINISTRADOR");
});

test("with another active administrator, an administrator can deactivate himself", async (teste) => {
    const banco = bancoUsuarios([...base(), { id_usuario: 4, nome: "Admin 2", email: "a2@t.test", perfil: "ADMINISTRADOR", ativo: 1 }]);
    usarBanco(teste, banco);

    const usuario = await usuarioService.alterarAtivo(1, { ativo: false }, ADMIN);
    assert.equal(usuario.ativo, 0);

    // Agora o administrador 4 é o único: ele não pode ser desativado
    await assert.rejects(usuarioService.alterarAtivo(4, { ativo: false }, { id_usuario: 4, perfil: "ADMINISTRADOR" }), { statusCode: 409 });
    // Reativar continua permitido
    assert.equal((await usuarioService.alterarAtivo(1, { ativo: true }, { id_usuario: 4, perfil: "ADMINISTRADOR" })).ativo, 1);
});

test("an inactive administrator does not count as the active one", async (teste) => {
    const banco = bancoUsuarios([...base(), { id_usuario: 4, nome: "Admin 2", email: "a2@t.test", perfil: "ADMINISTRADOR", ativo: 0 }]);
    usarBanco(teste, banco);

    await assert.rejects(usuarioService.alterarAtivo(1, { ativo: false }, ADMIN), { statusCode: 409 });
});

test("the active administrators are locked before the target user (concurrent changes are serialized)", async (teste) => {
    const banco = bancoUsuarios([...base(), { id_usuario: 4, nome: "Admin 2", email: "a2@t.test", perfil: "ADMINISTRADOR", ativo: 1 }]);
    usarBanco(teste, banco);

    await usuarioService.alterarAtivo(3, { ativo: false }, ADMIN);

    const selecoes = banco.comandos.filter((c) => typeof c === "string" && c.startsWith("SELECT"));
    assert.match(selecoes[0], /WHERE perfil = 'ADMINISTRADOR' AND ativo = 1 ORDER BY id_usuario FOR UPDATE/);
    assert.match(selecoes[1], /WHERE id_usuario = \? FOR UPDATE/);
});

// ---------- Edição ----------

test("edit: data is normalized, password is stored only as a hash and never returned", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);

    const resultado = await usuarioService.atualizar(3, { nome: "  Tiago Silva ", email: " TIAGO.S@T.TEST ", perfil: "TECNICO", senha: "nova-senha-123" }, ADMIN);

    const gravado = banco.usuarios.find((u) => u.id_usuario === 3);
    assert.equal(gravado.nome, "Tiago Silva");
    assert.equal(gravado.email, "tiago.s@t.test");
    assert.ok(await bcrypt.compare("nova-senha-123", gravado.senha_hash));
    assert.equal("senha_hash" in resultado, false);
    assert.equal("senha" in resultado, false);
});

test("edit without password keeps the current hash", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);

    await usuarioService.atualizar(1, { nome: "Admin Geral", email: "admin@t.test", perfil: "ADMINISTRADOR", senha: "" }, ADMIN);
    assert.equal(banco.usuarios[0].senha_hash, "hash-antigo");
});

test("edit: duplicated e-mail returns 409 and invalid data returns 400", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);

    await assert.rejects(usuarioService.atualizar(3, { nome: "T", email: "ana@t.test", perfil: "TECNICO" }, ADMIN), { statusCode: 409 });

    for (const dados of [
        { nome: "", email: "x@t.test", perfil: "TECNICO" },
        { nome: "X", email: "sem-arroba", perfil: "TECNICO" },
        { nome: "X", email: "x@t.test", perfil: "CLIENTE" },
        { nome: "X", email: "x@t.test", perfil: "TECNICO", senha: "   " },
        { nome: "X".repeat(101), email: "x@t.test", perfil: "TECNICO" },
        null
    ]) {
        await assert.rejects(usuarioService.atualizar(3, dados, ADMIN), { statusCode: 400 }, JSON.stringify(dados)?.slice(0, 40));
    }
    await assert.rejects(usuarioService.alterarAtivo(3, { ativo: "sim" }, ADMIN), { statusCode: 400 });
    await assert.rejects(usuarioService.alterarAtivo("abc", { ativo: true }, ADMIN), { statusCode: 400 });
    await assert.rejects(usuarioService.alterarAtivo(99, { ativo: true }, ADMIN), { statusCode: 404 });
});

test("only the administrator manages users, even calling the service directly", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);

    await assert.rejects(usuarioService.atualizar(3, { nome: "X", email: "x@t.test", perfil: "TECNICO" }, ATENDENTE), { statusCode: 403 });
    await assert.rejects(usuarioService.alterarAtivo(3, { ativo: false }, { id_usuario: 3, perfil: "TECNICO" }), { statusCode: 403 });
    assert.equal(banco.comandos.length, 0);
});

// ---------- HTTP ----------

test("HTTP: attendant and technician get 403 on user management; responses never contain the hash", async (teste) => {
    const banco = bancoUsuarios(base());
    usarBanco(teste, banco);
    substituirMetodos(teste, usuarioRepository, {
        listarTodos: async () => banco.usuarios.map(({ senha_hash, ...u }) => u),
        buscarPorId: async (id) => {
            const u = banco.usuarios.find((x) => x.id_usuario === Number(id));
            return u ? { id_usuario: u.id_usuario, nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo } : null;
        }
    });

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const url = `http://127.0.0.1:${servidor.address().port}/api/usuarios`;
    const chamar = (metodo, caminho, id, corpo) => fetch(url + caminho, {
        method: metodo,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ id_usuario: id }, process.env.JWT_SECRET)}` },
        body: corpo ? JSON.stringify(corpo) : undefined
    });

    for (const id of [2, 3]) {
        assert.equal((await chamar("POST", "", id, { nome: "X", email: "x@t.test", senha: "123456", perfil: "TECNICO" })).status, 403);
        assert.equal((await chamar("PUT", "/3", id, { nome: "X", email: "x@t.test", perfil: "TECNICO" })).status, 403);
        assert.equal((await chamar("PATCH", "/3/ativo", id, { ativo: false })).status, 403);
    }
    assert.equal((await chamar("GET", "", 3)).status, 403); // técnico não lista usuários

    const lista = await chamar("GET", "", 1);
    const texto = await lista.text();
    assert.equal(lista.status, 200);
    assert.doesNotMatch(texto, /senha/);

    const desativar = await chamar("PATCH", "/3/ativo", 1, { ativo: false });
    assert.equal(desativar.status, 200);
    assert.doesNotMatch(await desativar.text(), /senha/);

    // O usuário desativado perde o acesso na próxima requisição
    assert.equal((await chamar("GET", "/3", 3)).status, 401);
});

// ---------- P4: acessórios recebidos em lote ----------

test("P4: a batch is fully validated before writing; an invalid item writes nothing", async (teste) => {
    const gravacoes = [];
    substituirMetodos(teste, acessorioRecebidoRepository, {
        verificarItemExiste: async () => true,
        criarVarios: async (registros) => {
            gravacoes.push(...registros);
            return registros;
        }
    });
    substituirMetodos(teste, acessorioRepository, {
        buscarPorId: async (id) => ({ 3: { id_acessorio: 3, descricao: "Carregador", ativo: 1 }, 5: { id_acessorio: 5, descricao: "Bolsa", ativo: 0 } })[id] ?? null
    });

    await assert.rejects(acessorioRecebidoService.registrar([{ id_item: 1, id_acessorio: 3 }, { id_item: 1, id_acessorio: 99 }], ATENDENTE), { statusCode: 404 });
    await assert.rejects(acessorioRecebidoService.registrar([{ id_item: 1, id_acessorio: 3 }, { id_item: 1, id_acessorio: 5 }], ATENDENTE), { statusCode: 409 });
    await assert.rejects(acessorioRecebidoService.registrar([{ id_item: 1, id_acessorio: 3, observacoes: 12 }], ATENDENTE), { statusCode: 400 });
    assert.equal(gravacoes.length, 0);

    // Mesmo acessório repetido: linhas separadas (RN23)
    const criados = await acessorioRecebidoService.registrar([{ id_item: 1, id_acessorio: 3, observacoes: " a " }, { id_item: 1, id_acessorio: 3 }], ATENDENTE);
    assert.equal(criados.length, 2);
    assert.deepEqual(gravacoes.map((g) => [g.id_acessorio, g.observacoes]), [[3, "a"], [3, null]]);
});

test("P4: the batch insert uses one transaction and rolls back everything on failure", async (teste) => {
    const comandos = [];
    let insercoes = 0;
    const conexao = {
        beginTransaction: async () => comandos.push("BEGIN"),
        commit: async () => comandos.push("COMMIT"),
        rollback: async () => comandos.push("ROLLBACK"),
        release: () => comandos.push("RELEASE"),
        execute: async (sql) => {
            if (sql.includes("FROM ordem_servico")) {
                comandos.push("LOCK OS");
                return [[{ id_os: 5, id_item: 1, status: "RECEBIDA", id_tecnico: null }]];
            }
            if (sql.includes("INSERT INTO historico_os")) {
                comandos.push("HISTORICO");
                return [{ insertId: 1 }];
            }
            insercoes += 1;
            if (insercoes === 2) throw new Error("falha simulada no banco");
            comandos.push("INSERT");
            return [{ insertId: insercoes }];
        }
    };
    substituirMetodos(teste, acessorioRecebidoRepository.pool, { getConnection: async () => conexao });

    await assert.rejects(acessorioRecebidoRepository.criarVarios(
        [{ id_item: 1, id_acessorio: 3, quantidade: 1 }, { id_item: 1, id_acessorio: 4, quantidade: 1 }],
        { id_usuario: 2, perfil: "ATENDENTE" }
    ), /falha simulada/);
    assert.deepEqual(comandos, ["BEGIN", "LOCK OS", "INSERT", "HISTORICO", "ROLLBACK", "RELEASE"]);
});
