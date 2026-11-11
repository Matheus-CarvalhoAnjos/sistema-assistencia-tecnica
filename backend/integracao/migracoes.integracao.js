/*
 * TESTES DE INTEGRAÇÃO REAIS (MySQL) — ordem e repetição das migrações pendentes.
 *
 * Execução:  npm run test:integracao   (junto com o fluxo completo)
 *
 * Usa SOMENTE o banco "<DB_NAME>_migracoes_teste", criado com a ESTRUTURA anterior às migrações
 * (banco/migracoes/estrutura_antes_migracoes_20261109.sql, sem dados, desde que o principal foi migrado
 * em 09/11/2026) e apagado ao final. Nenhum dado do banco principal é copiado.
 *
 * Confere que cada migração tem uma guarda de pré-condição que:
 *  - impede execução fora de ordem (ex.: 3 antes da 2, 4 antes da 3);
 *  - impede repetição (ex.: 3 depois da 4, que removeria ABATIMENTO do ENUM);
 *  - não altera nada quando bloqueia;
 *  - funciona pelo executor Node e pelo cliente mysql com "source" (procedimento documentado).
 */
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env"), quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const { aplicarPendentes, listarSequencia, listarExecutadas, arquivoEstruturaAnterior, exigirBancoTeste, credenciaisAdmin } = require("./migracoes");
const ADMIN = credenciaisAdmin();

const REAL = process.env.DB_NAME;
const BANCO = `${REAL}_migracoes_teste`;
const PASTA = path.join(__dirname, "..", "..", "banco", "migracoes");
const MYSQL = path.join(process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin", "mysql.exe");
const q = (n) => `\`${n}\``;

let admin;
let contagemRealAntes;

async function conectar() {
    return mysql.createConnection({
        host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password,
        database: BANCO, multipleStatements: true
    });
}

/**
 * Recria o banco de teste no estado ANTERIOR à primeira migração da sequência.
 * - Enquanto houver migrações executadas no principal: a partir do arquivo de estrutura (sem dados)
 *   extraído do principal antes da execução (pendentes.json → estrutura_anterior).
 * - Sem esse arquivo (situação antiga, nada executado): a partir da estrutura atual do principal.
 */
async function recriarComEstruturaAnterior() {
    exigirBancoTeste(BANCO);
    await admin.query(`DROP DATABASE IF EXISTS ${q(BANCO)}`);
    await admin.query(`CREATE DATABASE ${q(BANCO)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    const c = await conectar();
    try {
        const arquivo = arquivoEstruturaAnterior();
        if (listarExecutadas().length > 0) {
            assert.ok(arquivo && fs.existsSync(arquivo), "estrutura anterior às migrações executadas não encontrada");
            const ddl = fs.readFileSync(arquivo, "utf8");
            assert.doesNotMatch(ddl, /INSERT INTO/i, "o arquivo de estrutura não pode conter dados");
            await c.query(ddl);
            return;
        }
        await c.query("SET FOREIGN_KEY_CHECKS = 0");
        const [ts] = await admin.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [REAL]);
        for (const { t } of ts) {
            const [[d]] = await admin.query(`SHOW CREATE TABLE ${q(REAL)}.${q(t)}`);
            await c.query(d["Create Table"].replace(/ AUTO_INCREMENT=\d+/, ""));
        }
        await c.query("SET FOREIGN_KEY_CHECKS = 1");
    } finally {
        await c.end();
    }
}

async function estruturaReal() {
    const r = {};
    const [ts] = await admin.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [REAL]);
    for (const { t } of ts) r[t] = (await admin.query(`SHOW CREATE TABLE ${q(REAL)}.${q(t)}`))[0][0]["Create Table"].replace(/ AUTO_INCREMENT=\d+/, "");
    return r;
}
let estruturaRealAntes;

/** Estrutura completa (DDL de todas as tabelas): prova de que uma tentativa bloqueada não mudou nada. */
async function estrutura() {
    const r = {};
    const [ts] = await admin.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [BANCO]);
    for (const { t } of ts) {
        const [[d]] = await admin.query(`SHOW CREATE TABLE ${q(BANCO)}.${q(t)}`);
        r[t] = d["Create Table"];
    }
    return r;
}

async function executar(arquivo) {
    const c = await conectar();
    try {
        await c.query(fs.readFileSync(path.join(PASTA, arquivo), "utf8"));
        return null;
    } catch (erro) {
        return erro;
    } finally {
        await c.end();
    }
}

async function tentarBloqueada(arquivo) {
    const antes = await estrutura();
    const erro = await executar(arquivo);
    const codigo = arquivo.slice(0, 11);
    assert.ok(erro, `${arquivo} deveria ser bloqueada`);
    assert.equal(erro.code, "ER_SP_DOES_NOT_EXIST", `${arquivo}: ${erro.message}`);
    assert.match(erro.message, new RegExp(`migracao_${codigo}_bloqueada_ja_aplicada_ou_fora_de_ordem`));
    assert.deepEqual(await estrutura(), antes, `${arquivo} alterou a estrutura apesar de bloqueada`);
}

const tipoEvento = async () => (await admin.query(
    "SELECT COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'historico_os' AND COLUMN_NAME = 'tipo_evento'", [BANCO]
))[0][0].t;

async function contarReais() {
    const [ts] = await admin.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'", [REAL]);
    const r = {};
    for (const { t } of ts) r[t] = Number((await admin.query(`SELECT COUNT(*) n FROM ${q(REAL)}.${q(t)}`))[0][0].n);
    return r;
}

test.before(async () => {
    exigirBancoTeste(BANCO);
    admin = await mysql.createConnection({ host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password });
    contagemRealAntes = await contarReais();
    estruturaRealAntes = await estruturaReal();
});

test.after(async () => {
    if (admin) {
        // Banco só de estrutura, sem dados: sempre apagado (MANTER_BANCO_TESTE vale para o banco do fluxo completo)
        await admin.query(`DROP DATABASE IF EXISTS ${q(BANCO)}`);
        await admin.end();
    }
});

test(`migrações: ordem, repetição e guardas no banco "${BANCO}"`, async (t) => {
    const [m1, m2, m3, m4] = listarSequencia();

    await t.test("nomes em ordem: a ordem alfabética é a ordem de execução", () => {
        assert.deepEqual([m1, m2, m3, m4], [...listarSequencia()].sort());
        assert.deepEqual([m1, m2, m3, m4].map((m) => m.slice(0, 11)), ["20261109_01", "20261109_02", "20261109_03", "20261109_04"]);
    });

    await t.test("fora de ordem: 2, 3 e 4 antes da 1 são bloqueadas sem alterar nada", async () => {
        await recriarComEstruturaAnterior();
        for (const m of [m2, m3, m4]) await tentarBloqueada(m);
    });

    await t.test("fora de ordem: depois da 1, a 3 e a 4 continuam bloqueadas; depois da 2, a 4 continua bloqueada", async () => {
        assert.equal(await executar(m1), null);
        await tentarBloqueada(m3);
        await tentarBloqueada(m4);
        assert.equal(await executar(m2), null);
        await tentarBloqueada(m4);
        assert.equal(await executar(m3), null);
        assert.equal(await executar(m4), null);
        assert.match(await tipoEvento(), /'ACESSORIO','ABATIMENTO'\)$/);
    });

    await t.test("repetição: cada migração repetida é bloqueada; a 3 depois da 4 não remove ABATIMENTO", async () => {
        for (const m of [m1, m2, m3, m4]) await tentarBloqueada(m);
        assert.match(await tipoEvento(), /'ACESSORIO','ABATIMENTO'\)$/);
    });

    await t.test("sequência completa pelo executor (aplicarPendentes) e nova tentativa bloqueada", async () => {
        await recriarComEstruturaAnterior();
        const aplicadas = await aplicarPendentes(BANCO, {}, listarSequencia());
        assert.deepEqual(aplicadas.map((a) => a.arquivo), [m1, m2, m3, m4]);
        await assert.rejects(aplicarPendentes(BANCO, {}, listarSequencia()), { code: "ER_SP_DOES_NOT_EXIST" });
        if (listarExecutadas().length === listarSequencia().length) {
            // Principal já migrado: estrutura anterior + sequência completa = estrutura atual do principal
            // (sem a tabela auxiliar solicitacao_status_backup, criada no passo 2 do procedimento)
            const real = await estruturaReal();
            delete real.solicitacao_status_backup;
            const teste = Object.fromEntries(Object.entries(await estrutura()).map(([t, d]) => [t, d.replace(/ AUTO_INCREMENT=\d+/, "")]));
            assert.deepEqual(teste, real);
        }
        assert.match(await tipoEvento(), /'ABATIMENTO'\)$/);
    });

    await t.test("falha parcial da 4 (tabela criada, ENUM não): bloqueada; recuperação documentada funciona", async () => {
        await recriarComEstruturaAnterior();
        for (const m of [m1, m2, m3]) assert.equal(await executar(m), null);
        const sql4 = fs.readFileSync(path.join(PASTA, m4), "utf8");
        const create = sql4.slice(sql4.indexOf("CREATE TABLE abatimento"), sql4.indexOf(";", sql4.indexOf("CREATE TABLE abatimento")) + 1);
        const c = await conectar();
        await c.query(create);
        await c.end();
        await tentarBloqueada(m4);
        const c2 = await conectar();
        await c2.query("DROP TABLE IF EXISTS abatimento");
        await c2.end();
        assert.equal(await executar(m4), null);
        assert.match(await tipoEvento(), /'ACESSORIO','ABATIMENTO'\)$/);
    });

    await t.test("cliente mysql com source (procedimento documentado): para na guarda e não altera nada", async (st) => {
        if (!fs.existsSync(MYSQL)) {
            st.skip("mysql.exe não encontrado");
            return;
        }
        // O banco já tem as 4 migrações (passo anterior). Repetir a 3 pelo cliente precisa falhar.
        const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "migracoes-guarda-"));
        try {
            const copia = path.join(pasta, m3);
            fs.copyFileSync(path.join(PASTA, m3), copia);
            const antes = await estrutura();
            const r = spawnSync(MYSQL, ["-h", process.env.DB_HOST || "localhost", "-u", ADMIN.user,
                "--default-character-set=utf8mb4", BANCO, "-e", `source ${copia.replace(/\\/g, "/")}`],
            { env: { ...process.env, MYSQL_PWD: ADMIN.password ?? "" }, encoding: "utf8" });
            assert.notEqual(r.status, 0, "o cliente mysql deveria terminar com erro");
            assert.match(r.stderr, /migracao_20261109_03_bloqueada_ja_aplicada_ou_fora_de_ordem/);
            assert.deepEqual(await estrutura(), antes);
            assert.match(await tipoEvento(), /'ACESSORIO','ABATIMENTO'\)$/);
        } finally {
            fs.rmSync(pasta, { recursive: true, force: true });
        }
    });

    await t.test("banco real preservado (somente leitura): dados e estrutura iguais aos do início", async () => {
        assert.deepEqual(await contarReais(), contagemRealAntes);
        assert.deepEqual(await estruturaReal(), estruturaRealAntes);
    });
});
