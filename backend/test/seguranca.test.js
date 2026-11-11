/*
 * S4 e S5 (auditoria de 09/11/2026): respostas padronizadas da API e política mínima de senha.
 * Sem banco: as validações acontecem antes de qualquer acesso ao repositório.
 */
require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const usuarioService = require("../src/services/usuarioService");

const ADMIN = { id_usuario: 1, perfil: "ADMINISTRADOR" };

function semRepositorio(teste) {
    // Qualquer acesso ao banco faria o teste falhar: a validação precisa vir antes
    const originais = {};
    for (const nome of ["buscarPorEmail", "criar", "atualizar", "buscarPorId"]) {
        originais[nome] = usuarioRepository[nome];
        usuarioRepository[nome] = async () => { throw new Error(`repositório chamado: ${nome}`); };
    }
    teste.after(() => Object.assign(usuarioRepository, originais));
}

async function iniciar(teste) {
    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    return `http://127.0.0.1:${servidor.address().port}`;
}

test("S5: cadastro recusa senha com menos de 8 caracteres ou acima de 72 bytes, sem acessar o banco", async (teste) => {
    semRepositorio(teste);
    for (const senha of ["1234567", "abc", "x".repeat(73)]) {
        await assert.rejects(
            usuarioService.criar({ nome: "Novo", email: "novo@t.test", senha, perfil: "TECNICO" }),
            { statusCode: 400, message: /pelo menos 8|no máximo 72/ },
            `senha de ${senha.length} caracteres`
        );
    }
});

test("S5: nova senha na edição segue a mesma regra; edição sem senha continua permitida", async (teste) => {
    semRepositorio(teste);
    await assert.rejects(
        usuarioService.atualizar(3, { nome: "X", email: "x@t.test", perfil: "TECNICO", senha: "curta" }, ADMIN),
        { statusCode: 400, message: /pelo menos 8/ }
    );

    let gravado = null;
    usuarioRepository.atualizar = async (id, dados) => { gravado = dados; return { id_usuario: id }; };
    await usuarioService.atualizar(3, { nome: "X", email: "x@t.test", perfil: "TECNICO", senha: "" }, ADMIN);
    assert.equal(gravado.senha_hash, null);
    await usuarioService.atualizar(3, { nome: "X", email: "x@t.test", perfil: "TECNICO", senha: "senha-forte-1" }, ADMIN);
    assert.match(gravado.senha_hash, /^\$2[aby]\$10\$/);
});

test("S4: rota inexistente responde 404 em JSON", async (teste) => {
    const base = await iniciar(teste);
    for (const caminho of ["/api/rota-inexistente", "/api/ordens-servico/1/nada", "/qualquer"]) {
        const r = await fetch(base + caminho);
        assert.equal(r.status, 404, caminho);
        assert.match(r.headers.get("content-type"), /application\/json/);
        assert.deepEqual(await r.json(), { mensagem: "Rota não encontrada." });
    }
});

test("S4: JSON malformado e corpo grande recebem mensagens padronizadas, sem detalhes do parser", async (teste) => {
    const base = await iniciar(teste);
    const malformado = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{json quebrado" });
    assert.equal(malformado.status, 400);
    assert.deepEqual(await malformado.json(), { mensagem: "O corpo da requisição não é um JSON válido." });

    const grande = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(200000) }) });
    assert.equal(grande.status, 413);
    assert.deepEqual(await grande.json(), { mensagem: "O corpo da requisição excede o tamanho máximo permitido." });
});

test("S4: sem X-Powered-By e com cabeçalhos básicos de segurança; rotas existentes inalteradas", async (teste) => {
    const base = await iniciar(teste);
    const r = await fetch(base + "/");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-powered-by"), null);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");

    const semToken = await fetch(base + "/api/clientes");
    assert.equal(semToken.status, 401);
    assert.deepEqual(await semToken.json(), { mensagem: "Token de autenticação não informado." });
});
