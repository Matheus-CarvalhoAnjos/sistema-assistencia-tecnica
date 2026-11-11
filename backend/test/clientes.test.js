/*
 * Testes do módulo de Clientes.
 * Usam o repository simulado: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const clienteRepository = require("../src/repositories/clienteRepository");
const clienteService = require("../src/services/clienteService");
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

function clienteValido(alteracoes = {}) {
    return {
        tipo_pessoa: "FISICA",
        nome_razao_social: "  Maria Cliente  ",
        cpf_cnpj: "123.456.789-01",
        telefone: "(11) 99999-0000",
        email: "Maria@Teste.com",
        cep: "01001-000",
        logradouro: "Rua Teste",
        numero: "100",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "sp",
        ...alteracoes
    };
}

async function esperarStatus(promessa, status, trechoMensagem) {
    await assert.rejects(promessa, (erro) => {
        assert.equal(erro.statusCode, status);
        if (trechoMensagem) {
            assert.match(erro.message, trechoMensagem);
        }
        return true;
    });
}

// Repository em memória para os testes de cadastro e edição
function simularRepositorio(teste, clientes = []) {
    const gravados = [];

    substituirMetodos(teste, clienteRepository, {
        buscarPorDocumento: async (doc, idIgnorado = null) =>
            clientes.find((c) => c.cpf_cnpj === doc && c.id_cliente !== idIgnorado) || null,
        buscarPorId: async (id) => clientes.find((c) => c.id_cliente === id) || null,
        criar: async (dados) => {
            gravados.push(dados);
            return { id_cliente: 99, ...dados };
        },
        atualizar: async (id, dados) => {
            gravados.push(dados);
            return { id_cliente: id, ...dados };
        }
    });

    return gravados;
}

// ---------- Cadastro ----------

test("registers an individual removing masks and normalizing fields", async (teste) => {
    const gravados = simularRepositorio(teste);

    const cliente = await clienteService.criar(clienteValido());

    assert.equal(cliente.id_cliente, 99);
    assert.deepEqual(gravados[0], {
        tipo_pessoa: "FISICA",
        nome_razao_social: "Maria Cliente",
        logradouro: "Rua Teste",
        numero: "100",
        bairro: "Centro",
        cidade: "São Paulo",
        cpf_cnpj: "12345678901",
        telefone: "11999990000",
        email: "maria@teste.com",
        cep: "01001000",
        uf: "SP",
        complemento: null
    });
});

test("registers a company without complemento (regression: used to return 500)", async (teste) => {
    const gravados = simularRepositorio(teste);

    await clienteService.criar(clienteValido({
        tipo_pessoa: "JURIDICA",
        cpf_cnpj: "12.345.678/0001-99"
    }));

    assert.equal(gravados[0].cpf_cnpj, "12345678000199");
    assert.equal(gravados[0].complemento, null);
});

test("empty complemento is stored as null and a filled one is trimmed", async (teste) => {
    const gravados = simularRepositorio(teste);

    await clienteService.criar(clienteValido({ complemento: "   " }));
    await clienteService.criar(clienteValido({ complemento: " Apto 12 " }));

    assert.equal(gravados[0].complemento, null);
    assert.equal(gravados[1].complemento, "Apto 12");
});

test("each required field missing returns 400", async (teste) => {
    simularRepositorio(teste);
    const obrigatorios = [
        "tipo_pessoa", "nome_razao_social", "cpf_cnpj", "telefone",
        "cep", "logradouro", "numero", "bairro", "cidade", "uf"
    ];

    for (const campo of obrigatorios) {
        const dados = clienteValido();
        delete dados[campo];
        await esperarStatus(clienteService.criar(dados), 400, /obrigatório/);
    }

    await esperarStatus(clienteService.criar(null), 400);
    await esperarStatus(clienteService.criar([]), 400);
});

// MER v1.4: e-mail do cliente é opcional (a coluna aceita NULL)
test("e-mail is optional: missing or blank becomes null; when informed it must be valid", async (teste) => {
    const gravados = simularRepositorio(teste);

    for (const email of [undefined, null, "   "]) {
        const dados = clienteValido({ cpf_cnpj: `5299822472${gravados.length}` });
        if (email === undefined) delete dados.email; else dados.email = email;
        await clienteService.criar(dados);
        assert.equal(gravados.at(-1).email, null);
    }

    await esperarStatus(clienteService.criar(clienteValido({ email: 123 })), 400, /E-mail/);
    await esperarStatus(clienteService.criar(clienteValido({ email: "sem-arroba" })), 400, /e-mail/);
});

test("document, CEP, phone, e-mail and UF formats are validated", async (teste) => {
    simularRepositorio(teste);

    await esperarStatus(clienteService.criar(clienteValido({ cpf_cnpj: "1234567890" })), 400, /CPF deve conter 11/);
    await esperarStatus(clienteService.criar(clienteValido({ cpf_cnpj: "12345678000199" })), 400, /CPF deve conter 11/);
    await esperarStatus(
        clienteService.criar(clienteValido({ tipo_pessoa: "JURIDICA", cpf_cnpj: "1234567800019" })),
        400,
        /CNPJ deve conter 14/
    );
    await esperarStatus(clienteService.criar(clienteValido({ tipo_pessoa: "OUTRO" })), 400, /Tipo de pessoa/);
    await esperarStatus(clienteService.criar(clienteValido({ cep: "0100100" })), 400, /CEP/);
    await esperarStatus(clienteService.criar(clienteValido({ telefone: "9999-0000" })), 400, /Telefone/);
    await esperarStatus(clienteService.criar(clienteValido({ email: "maria@teste" })), 400, /e-mail/);
    await esperarStatus(clienteService.criar(clienteValido({ uf: "XX" })), 400, /UF/);
});

test("texts longer than the database columns return 400", async (teste) => {
    simularRepositorio(teste);

    await esperarStatus(
        clienteService.criar(clienteValido({ nome_razao_social: "a".repeat(201) })),
        400,
        /no máximo 200/
    );
    await esperarStatus(clienteService.criar(clienteValido({ numero: "12345678901" })), 400, /no máximo 10/);
    await esperarStatus(clienteService.criar(clienteValido({ complemento: "c".repeat(101) })), 400, /no máximo 100/);
});

test("duplicate document returns 409, also when the database UNIQUE fires", async (teste) => {
    simularRepositorio(teste, [{ id_cliente: 1, cpf_cnpj: "12345678901" }]);
    await esperarStatus(clienteService.criar(clienteValido()), 409, /CPF\/CNPJ/);

    // Corrida: a checagem prévia passa, mas o banco recusa o duplicado
    substituirMetodos(teste, clienteRepository, {
        buscarPorDocumento: async () => null,
        criar: async () => {
            const erro = new Error("Duplicate entry");
            erro.code = "ER_DUP_ENTRY";
            throw erro;
        }
    });
    await esperarStatus(clienteService.criar(clienteValido({ cpf_cnpj: "98765432100" })), 409);
});

// ---------- Edição ----------

test("updating keeps the client's own document without reporting duplicates", async (teste) => {
    const gravados = simularRepositorio(teste, [{ id_cliente: 1, cpf_cnpj: "12345678901" }]);

    const cliente = await clienteService.atualizar(1, clienteValido({ cidade: "Campinas" }));

    assert.equal(cliente.id_cliente, 1);
    assert.equal(gravados[0].cidade, "Campinas");
});

test("updating with another client's document returns 409", async (teste) => {
    simularRepositorio(teste, [
        { id_cliente: 1, cpf_cnpj: "12345678901" },
        { id_cliente: 2, cpf_cnpj: "98765432100" }
    ]);

    await esperarStatus(clienteService.atualizar(1, clienteValido({ cpf_cnpj: "98765432100" })), 409);
});

test("updating a missing client returns 404 and invalid data returns 400", async (teste) => {
    simularRepositorio(teste, [{ id_cliente: 1, cpf_cnpj: "12345678901" }]);

    await esperarStatus(clienteService.atualizar(50, clienteValido()), 404, /não encontrado/);
    await esperarStatus(clienteService.atualizar(1, clienteValido({ cep: "1" })), 400);
});

// ---------- Busca ----------

test("search uses document prefix for numbers and name otherwise", async (teste) => {
    const filtros = [];
    substituirMetodos(teste, clienteRepository, {
        listarTodos: async (filtro) => {
            filtros.push(filtro);
            return [];
        }
    });

    await clienteService.listarTodos("maria");
    await clienteService.listarTodos("123.456");
    await clienteService.listarTodos("12.345.678/0001");
    await clienteService.listarTodos("a");
    await clienteService.listarTodos(undefined);

    assert.deepEqual(filtros, [
        { nome: "maria" },
        { documento: "123456" },
        { documento: "123456780001" },
        undefined,
        undefined
    ]);
});

// ---------- Autorização (HTTP, sem banco) ----------

test("only administrator and attendant can use the client routes", async (teste) => {
    const usuarios = {
        5: { id_usuario: 5, perfil: "ADMINISTRADOR", ativo: 1 },
        6: { id_usuario: 6, perfil: "ATENDENTE", ativo: 1 },
        7: { id_usuario: 7, perfil: "TECNICO", ativo: 1 }
    };
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => usuarios[id] || null
    });
    simularRepositorio(teste, [{ id_cliente: 1, cpf_cnpj: "12345678901" }]);
    substituirMetodos(teste, clienteRepository, { listarTodos: async () => [] });

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const base = `http://127.0.0.1:${servidor.address().port}/api/clientes`;

    const chamar = (metodo, caminho, idUsuario, corpo) => fetch(base + caminho, {
        method: metodo,
        headers: {
            "Content-Type": "application/json",
            ...(idUsuario
                ? { Authorization: `Bearer ${jwt.sign({ id_usuario: idUsuario, perfil: usuarios[idUsuario].perfil }, process.env.JWT_SECRET)}` }
                : {})
        },
        body: corpo ? JSON.stringify(corpo) : undefined
    });

    const chamadas = [
        ["GET", ""],
        ["GET", "/1"],
        ["POST", "", clienteValido({ cpf_cnpj: "11122233344" })],
        ["PUT", "/1", clienteValido()]
    ];

    for (const [metodo, caminho, corpo] of chamadas) {
        assert.equal((await chamar(metodo, caminho, 7, corpo)).status, 403, `TECNICO ${metodo} ${caminho}`);
        assert.equal((await chamar(metodo, caminho, null, corpo)).status, 401, `sem token ${metodo} ${caminho}`);
    }

    assert.equal((await chamar("GET", "?busca=maria", 6)).status, 200);
    assert.equal((await chamar("POST", "", 6, clienteValido({ cpf_cnpj: "11122233344" }))).status, 201);
    assert.equal((await chamar("PUT", "/1", 5, clienteValido())).status, 200);
    assert.equal((await chamar("PUT", "/abc", 5, clienteValido())).status, 400);
});
