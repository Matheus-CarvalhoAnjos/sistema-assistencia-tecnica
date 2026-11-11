/**
 * Cria e/ou confere as 17 tabelas (banco/sql/01..17) no banco assistencia_tecnica do TiDB Cloud.
 *
 * Uso (dentro de backend/, com a conexão ADMINISTRATIVA do .env.tidb):
 *   node --env-file=.env.tidb scripts/criar-tabelas-tidb.js --verificar   (somente leitura)
 *   node --env-file=.env.tidb scripts/criar-tabelas-tidb.js --executar    (cria e confere)
 *
 * Proteções:
 * - recusa qualquer host que não seja do TiDB Cloud (nunca toca o MySQL local);
 * - exige o usuário root da instância e o TLS com certificado verificado;
 * - exige tidb_enable_check_constraint = ON (sem isso o TiDB descarta os CHECKs);
 * - --executar recusa um banco que já tenha tabelas (evita mascarar execução parcial com IF NOT EXISTS);
 * - para no primeiro erro ou aviso (SHOW WARNINGS) de cada script;
 * - confere o resultado com banco/esquema_esperado.json, collation e AUTO_ID_CACHE.
 * Não executa migrações, não insere dados e nunca exibe credenciais.
 */
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const BANCO = "assistencia_tecnica";
const COLLATION = "utf8mb4_0900_ai_ci";
const PASTA_SQL = path.join(__dirname, "..", "..", "banco", "sql");
const ESQUEMA = require(path.join(__dirname, "..", "..", "banco", "esquema_esperado.json"));

const modo = process.argv.includes("--executar") ? "executar"
    : process.argv.includes("--verificar") ? "verificar" : null;

function falhar(mensagem) {
    console.error(`INTERROMPIDO: ${mensagem}`);
    process.exit(1);
}

/** Tipo normalizado: o TiDB pode exibir largura em inteiros (int(11)); o esquema usa "int". */
function normalizarTipo(tipo) {
    const t = String(tipo).toLowerCase().trim();
    return /^(int|bigint|smallint|mediumint)\(\d+\)/.test(t) ? t.replace(/\(\d+\)/, "") : t;
}

async function conferir(c) {
    const divergencias = [];
    const q = async (sql, p) => (await c.query(sql, p))[0];

    const reais = (await q(
        "SELECT TABLE_NAME AS nome, TABLE_COLLATION AS col FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
        [BANCO]
    ));
    const nomesReais = reais.map((t) => t.nome.toLowerCase());
    const esperadas = ESQUEMA.tabelas.map((t) => t.nome);
    for (const n of nomesReais) if (!esperadas.includes(n)) divergencias.push(`tabela não prevista: ${n}`);

    let checks = 0, fks = 0, unicas = 0;
    for (const t of ESQUEMA.tabelas) {
        const real = reais.find((r) => r.nome.toLowerCase() === t.nome);
        if (!real) { divergencias.push(`${t.nome}: tabela ausente`); continue; }
        const d = (m) => divergencias.push(`${t.nome}: ${m}`);

        if (real.col !== COLLATION) d(`collation ${real.col} (esperado ${COLLATION})`);

        // Colunas
        const cols = await q(
            "SELECT COLUMN_NAME n, COLUMN_TYPE t, IS_NULLABLE nl, EXTRA x FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            [BANCO, t.nome]
        );
        for (const ce of t.colunas) {
            const cr = cols.find((x) => x.n.toLowerCase() === ce.nome);
            if (!cr) { d(`coluna ausente: ${ce.nome}`); continue; }
            if (normalizarTipo(cr.t) !== normalizarTipo(ce.tipo)) d(`coluna ${ce.nome}: tipo ${cr.t} (esperado ${ce.tipo})`);
            if ((cr.nl === "YES") !== Boolean(ce.nulo)) d(`coluna ${ce.nome}: nulidade divergente`);
            if (ce.auto && !/auto_increment/i.test(cr.x)) d(`coluna ${ce.nome}: deveria ser AUTO_INCREMENT`);
        }
        for (const cr of cols) if (!t.colunas.some((ce) => ce.nome === cr.n.toLowerCase())) d(`coluna não prevista: ${cr.n}`);

        // Chave primária
        const pk = (await q(
            "SELECT COLUMN_NAME n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
            [BANCO, t.nome]
        )).map((r) => r.n.toLowerCase()).join(",");
        if (pk !== t.pk.join(",")) d(`chave primária (${pk}) esperada (${t.pk.join(",")})`);

        // UNIQUE
        const uqReal = (await q(
            "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY' GROUP BY INDEX_NAME",
            [BANCO, t.nome]
        )).map((r) => r.c.toLowerCase());
        const uqEsp = (t.unicas || []).map((u) => u.toLowerCase());
        for (const u of uqEsp) if (!uqReal.includes(u)) d(`falta UNIQUE (${u})`);
        for (const u of uqReal) if (!uqEsp.includes(u)) d(`UNIQUE não previsto (${u})`);
        unicas += uqReal.length;

        // Chaves estrangeiras e ações
        const fkReal = (await q(
            "SELECT COLUMN_NAME c, REFERENCED_TABLE_NAME t, REFERENCED_COLUMN_NAME r FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
            [BANCO, t.nome]
        )).map((r) => `${r.c} -> ${r.t}.${r.r}`.toLowerCase());
        const fkEsp = (t.fks || []).map((f) => `${f.coluna} -> ${f.ref_tabela}.${f.ref_coluna}`.toLowerCase());
        for (const f of fkEsp) if (!fkReal.includes(f)) d(`falta FOREIGN KEY ${f}`);
        for (const f of fkReal) if (!fkEsp.includes(f)) d(`FOREIGN KEY não prevista ${f}`);
        fks += fkReal.length;
        for (const r of await q(
            "SELECT CONSTRAINT_NAME n, DELETE_RULE dr, UPDATE_RULE ur FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?",
            [BANCO, t.nome]
        )) if (/CASCADE|SET/.test(`${r.dr} ${r.ur}`)) d(`FOREIGN KEY ${r.n} com ação ${r.dr}/${r.ur} (esperado RESTRICT)`);

        // CHECKs e AUTO_ID_CACHE, lidos do SHOW CREATE TABLE (forma única no MySQL e no TiDB)
        const [[criacao]] = await c.query(`SHOW CREATE TABLE \`${t.nome}\``);
        const ddl = criacao["Create Table"];
        const ckReal = [...ddl.matchAll(/CONSTRAINT `(\w+)` CHECK \(.*?\)( \/\*!80016 NOT ENFORCED \*\/)?,?$/gm)];
        const ckEsp = (t.checks || []).map((x) => x.toLowerCase());
        for (const x of ckEsp) if (!ckReal.some((m) => m[1].toLowerCase() === x)) d(`falta CHECK ${x}`);
        for (const m of ckReal) {
            if (!ckEsp.includes(m[1].toLowerCase())) d(`CHECK não previsto ${m[1]}`);
            if (m[2]) d(`CHECK ${m[1]} NÃO está sendo aplicado (NOT ENFORCED)`);
        }
        checks += ckReal.length;
        if (!/AUTO_ID_CACHE=1\b/.test(ddl)) d("sem AUTO_ID_CACHE=1");
    }

    return { divergencias, tabelas: nomesReais.length, checks, fks, unicas };
}

(async () => {
    if (!modo) falhar("informe --verificar (somente leitura) ou --executar.");

    const host = process.env.DB_HOST || "";
    if (!/\.tidbcloud\.com$/i.test(host)) falhar("DB_HOST não é do TiDB Cloud. Use --env-file=.env.tidb.");

    const c = await mysql.createConnection({
        host,
        port: Number(process.env.DB_PORT) || 4000,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: true },
    });
    const q = async (sql, p) => (await c.query(sql, p))[0];

    try {
        const [{ cu }] = await q("SELECT CURRENT_USER() AS cu");
        if (!/^[^.]+\.root@/.test(cu)) falhar("a conexão não é o usuário root da instância.");
        const [{ ck }] = await q("SELECT @@global.tidb_enable_check_constraint AS ck");
        if (Number(ck) !== 1) falhar("tidb_enable_check_constraint está desligado; os CHECKs seriam descartados.");
        if (!(await q("SHOW DATABASES LIKE ?", [BANCO])).length) falhar(`banco ${BANCO} não existe.`);

        await c.query(`USE \`${BANCO}\``);
        await c.query("SET SESSION time_zone = '-03:00'");
        await c.query("SET SESSION foreign_key_checks = 1");

        if (modo === "executar") {
            const [{ n }] = await q("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [BANCO]);
            if (Number(n) > 0) falhar(`o banco já tem ${n} tabela(s). Use --verificar ou esvazie o banco antes.`);

            const arquivos = fs.readdirSync(PASTA_SQL).filter((f) => /^\d{2}_.+\.sql$/.test(f)).sort();
            if (arquivos.length !== 17) falhar(`esperados 17 scripts em banco/sql, encontrados ${arquivos.length}.`);

            for (const arquivo of arquivos) {
                const sql = fs.readFileSync(path.join(PASTA_SQL, arquivo), "utf8");
                try {
                    await c.query(sql);
                } catch (erro) {
                    falhar(`${arquivo}: ${erro.code} ${erro.message}. As tabelas anteriores permanecem criadas.`);
                }
                const avisos = await q("SHOW WARNINGS");
                if (avisos.length) {
                    falhar(`${arquivo}: ${avisos.length} aviso(s): ${avisos.map((a) => a.Message).join(" | ")}`);
                }
                console.log(`criada: ${arquivo}`);
            }
        }

        const r = await conferir(c);
        console.log(`\nConferência: ${r.tabelas} tabelas | ${r.fks} chaves estrangeiras | ${r.unicas} UNIQUE | ${r.checks} CHECKs`);
        if (r.divergencias.length) {
            r.divergencias.forEach((x) => console.log(`  DIVERGÊNCIA: ${x}`));
            process.exitCode = 1;
        } else {
            console.log(`Estrutura conforme banco/esquema_esperado.json (collation ${COLLATION}, AUTO_ID_CACHE=1, CHECKs aplicados).`);
        }
    } finally {
        await c.end();
    }
})().catch((erro) => falhar(`${erro.code || ""} ${erro.message}`));
