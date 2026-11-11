/*
 * DEMONSTRAÇÃO DAS MIGRAÇÕES PENDENTES EM BANCO DE TESTE (P2 / decisão D9)
 *
 * Execução:  node integracao/demonstrarMigracoes.js        (MANTER_BANCO_TESTE=1 para não apagar as cópias)
 *
 * O que faz, nesta ordem:
 *  1. Lê o banco principal (somente leitura) e cria a cópia "<DB_NAME>_migracao_teste" com estrutura e
 *     dados. As senhas (senha_hash) NÃO são copiadas: recebem um valor fixo sem uso.
 *  2. Backup da cópia com mysqldump e restauração em "<DB_NAME>_restauracao_teste" (prova o procedimento
 *     de recuperação). O arquivo de backup fica em uma pasta temporária e é apagado ao final.
 *  3. Aplica as migrações pendentes (banco/migracoes/pendentes.json) na cópia.
 *  4. Confere: linhas preservadas, coluna solicitacao.status removida, tabelas novas, evento ACESSORIO.
 *  5. Cria "<DB_NAME>_scripts_teste" a partir de banco/sql e compara a estrutura com a cópia migrada.
 *  6. Apaga os três bancos de teste e grava um relatório (sem dados pessoais) em banco/relatorios.
 *
 * Segurança: todo banco criado ou alterado termina em "_teste"; o banco principal só é lido, e a
 * contagem de linhas dele é conferida antes e depois.
 */
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env"), quiet: true });

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const mysql = require("mysql2/promise");
const { aplicarPendentes, listarPendentes, exigirBancoTeste, credenciaisAdmin } = require("./migracoes");
const ADMIN = credenciaisAdmin();

const REAL = process.env.DB_NAME;
const COPIA = `${REAL}_migracao_teste`;
const RESTAURADO = `${REAL}_restauracao_teste`;
const SCRIPTS = `${REAL}_scripts_teste`;
const PASTA_BIN = process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin";
const RAIZ = path.join(__dirname, "..", "..");
const q = (n) => `\`${String(n).replace(/`/g, "")}\``;

const relatorio = [];
const anotar = (linha = "") => {
    relatorio.push(linha);
    console.log(linha);
};

async function tabelas(conexao, banco) {
    const [linhas] = await conexao.query(
        "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        [banco]
    );
    return linhas.map((l) => l.t);
}

async function contar(conexao, banco) {
    const resultado = {};
    for (const t of await tabelas(conexao, banco)) {
        const [[{ n }]] = await conexao.query(`SELECT COUNT(*) AS n FROM ${q(banco)}.${q(t)}`);
        resultado[t] = Number(n);
    }
    return resultado;
}

async function estrutura(conexao, banco) {
    const ddl = {};
    for (const t of await tabelas(conexao, banco)) {
        const [[linha]] = await conexao.query(`SHOW CREATE TABLE ${q(banco)}.${q(t)}`);
        ddl[t] = linha["Create Table"].replace(/ AUTO_INCREMENT=\d+/, "");
    }
    return ddl;
}

/**
 * Estrutura lógica de cada tabela, sem nomes gerados automaticamente nem comentários:
 * colunas (tipo, NULL, padrão, extra, expressão gerada), PK, chaves únicas, FKs e CHECKs.
 */
async function estruturaLogica(conexao, banco) {
    const consulta = async (sql) => (await conexao.query(sql, [banco]))[0];
    const colunas = await consulta(
        `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE tipo, IS_NULLABLE nulo, COLUMN_DEFAULT padrao, EXTRA extra, GENERATION_EXPRESSION expr
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`
    );
    const indices = await consulta(
        `SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE`
    );
    const fks = await consulta(
        `SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc
         FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    const checks = await consulta(
        `SELECT tc.TABLE_NAME t, cc.CHECK_CLAUSE clausula
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.CHECK_CONSTRAINTS cc
           ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
         WHERE tc.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`
    );

    const resultado = {};
    const de = (t) => (resultado[t] ??= { colunas: [], pk: "", unicas: [], fks: [], checks: [] });
    for (const c of colunas) {
        const extra = String(c.extra).replace(/DEFAULT_GENERATED ?/, "").trim();
        de(c.t).colunas.push([c.c, c.tipo, c.nulo, c.padrao, extra, c.expr || ""].join("|"));
    }
    for (const i of indices) {
        if (i.i === "PRIMARY") de(i.t).pk = i.cols;
        else if (Number(i.nu) === 0) de(i.t).unicas.push(i.cols);
    }
    for (const f of fks) de(f.t).fks.push(`${f.c}->${f.rt}.${f.rc}`);
    for (const c of checks) de(c.t).checks.push(c.clausula);
    for (const t of Object.values(resultado)) {
        t.unicas.sort();
        t.fks.sort();
        t.checks.sort();
    }
    return resultado;
}

function credenciaisCli() {
    return {
        args: ["-h", process.env.DB_HOST || "localhost", "-u", ADMIN.user],
        env: { ...process.env, MYSQL_PWD: ADMIN.password ?? "" }
    };
}

async function main() {
    for (const banco of [COPIA, RESTAURADO, SCRIPTS]) exigirBancoTeste(banco);
    if (listarPendentes().length === 0) {
        // Ensaio feito ANTES da execução no principal. Em 09/11/2026 as migrações 20261109_01..04 foram
        // executadas no banco principal; os relatórios em banco/relatorios registram os ensaios.
        // As guardas e a recuperação da falha parcial continuam testadas em migracoes.integracao.js.
        console.log("Nenhuma migração pendente: ensaio pré-implantação não se aplica (ver banco/migracoes/pendentes.json).");
        return;
    }

    const admin = await mysql.createConnection({
        host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password, multipleStatements: true
    });
    const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), "migracao-teste-"));
    const arquivoBackup = path.join(pastaTemp, "copia.sql");

    try {
        anotar(`Demonstração das migrações pendentes — ${new Date().toISOString()}`);
        anotar(`Banco principal (somente leitura): ${REAL}`);
        anotar(`Migrações: ${listarPendentes().join(", ")}`);
        const realAntes = await contar(admin, REAL);

        // 1. Cópia com dados (senhas não são copiadas)
        for (const banco of [COPIA, RESTAURADO, SCRIPTS]) await admin.query(`DROP DATABASE IF EXISTS ${q(banco)}`);
        await admin.query(`CREATE DATABASE ${q(COPIA)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        await admin.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const t of await tabelas(admin, REAL)) {
            const [[linha]] = await admin.query(`SHOW CREATE TABLE ${q(REAL)}.${q(t)}`);
            await admin.query(`USE ${q(COPIA)}`);
            await admin.query(linha["Create Table"]);
            if (t === "usuario") {
                await admin.query(
                    `INSERT INTO ${q(COPIA)}.usuario (id_usuario, nome, email, senha_hash, perfil, ativo)
                     SELECT id_usuario, nome, email, 'senha-nao-copiada', perfil, ativo FROM ${q(REAL)}.usuario`
                );
            } else {
                await admin.query(`INSERT INTO ${q(COPIA)}.${q(t)} SELECT * FROM ${q(REAL)}.${q(t)}`);
            }
        }
        await admin.query("SET FOREIGN_KEY_CHECKS = 1");
        const copiaAntes = await contar(admin, COPIA);
        anotar("");
        anotar(`1. Cópia criada: ${COPIA} (${Object.keys(copiaAntes).length} tabelas, ${Object.values(copiaAntes).reduce((a, b) => a + b, 0)} linhas; senhas não copiadas)`);

        // 2. Backup e restauração (procedimento de recuperação)
        const cli = credenciaisCli();
        const dump = execFileSync(path.join(PASTA_BIN, "mysqldump.exe"), [
            ...cli.args, "--single-transaction", "--routines", "--triggers", "--no-tablespaces",
            "--default-character-set=utf8mb4", "--set-gtid-purged=OFF", COPIA
        ], { env: cli.env, maxBuffer: 256 * 1024 * 1024 });
        fs.writeFileSync(arquivoBackup, dump);
        await admin.query(`CREATE DATABASE ${q(RESTAURADO)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        execFileSync(path.join(PASTA_BIN, "mysql.exe"), [...cli.args, "--default-character-set=utf8mb4", RESTAURADO], {
            env: cli.env, input: fs.readFileSync(arquivoBackup)
        });
        const restaurado = await contar(admin, RESTAURADO);
        const restauracaoOk = JSON.stringify(restaurado) === JSON.stringify(copiaAntes);
        const estruturaRestauradaOk = JSON.stringify(await estrutura(admin, RESTAURADO)) === JSON.stringify(await estrutura(admin, COPIA));
        anotar(`2. Backup (mysqldump, ${Math.round(dump.length / 1024)} KB) e restauração em ${RESTAURADO}: ` +
            `linhas ${restauracaoOk ? "idênticas" : "DIFERENTES"}, estrutura ${estruturaRestauradaOk ? "idêntica" : "DIFERENTE"}`);

        // 3. Migrações na cópia
        const aplicadas = await aplicarPendentes(COPIA);
        anotar("3. Migrações aplicadas na cópia:");
        for (const m of aplicadas) {
            const conferencias = m.conferencias.map((c) => JSON.stringify(c)).join(" ");
            anotar(`   - ${m.arquivo}${conferencias ? ` (conferência: ${conferencias})` : ""}`);
        }

        // 4. Conferências
        const copiaDepois = await contar(admin, COPIA);
        const preservadas = Object.entries(copiaAntes).every(([t, n]) => copiaDepois[t] === n);
        const [[{ status }]] = await admin.query(
            "SELECT COUNT(*) AS status FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'solicitacao' AND COLUMN_NAME = 'status'",
            [COPIA]
        );
        const [[{ legado }]] = await admin.query(`SELECT COUNT(*) AS legado FROM ${q(COPIA)}.pagamento WHERE status = 'REEMBOLSADO'`);
        const [[{ tipo }]] = await admin.query(
            "SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'historico_os' AND COLUMN_NAME = 'tipo_evento'",
            [COPIA]
        );
        anotar("4. Conferências na cópia migrada:");
        anotar(`   - linhas das ${Object.keys(copiaAntes).length} tabelas existentes preservadas: ${preservadas ? "sim" : "NÃO"}`);
        anotar(`   - coluna solicitacao.status removida: ${Number(status) === 0 ? "sim" : "NÃO"}`);
        anotar(`   - tabelas novas: avaliacao_reembolso (${copiaDepois.avaliacao_reembolso ?? "ausente"} linhas), reembolso (${copiaDepois.reembolso ?? "ausente"} linhas; reembolsos integrais antigos: ${legado})`);
        anotar(`   - historico_os.tipo_evento aceita ACESSORIO: ${/'ACESSORIO'/.test(tipo) ? "sim" : "NÃO"}`);

        // 5. Scripts (estado de destino) × cópia migrada
        await admin.query(`CREATE DATABASE ${q(SCRIPTS)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        await admin.query(`USE ${q(SCRIPTS)}`);
        const arquivos = fs.readdirSync(path.join(RAIZ, "banco", "sql")).filter((a) => a.endsWith(".sql")).sort();
        for (const arquivo of arquivos) {
            await admin.query(fs.readFileSync(path.join(RAIZ, "banco", "sql", arquivo), "utf8"));
        }
        const logicaScripts = await estruturaLogica(admin, SCRIPTS);
        const logicaMigrada = await estruturaLogica(admin, COPIA);
        const nomes = [...new Set([...Object.keys(logicaScripts), ...Object.keys(logicaMigrada)])].sort();
        const diferentes = nomes.filter((t) => JSON.stringify(logicaScripts[t]) !== JSON.stringify(logicaMigrada[t]));
        anotar(`5. Estrutura criada por banco/sql (${arquivos.length} scripts) × cópia migrada ` +
            "(colunas, tipos, NULL, padrões, PK, chaves únicas, FKs e CHECKs; nomes automáticos e comentários não contam): " +
            (diferentes.length === 0 ? `equivalentes (${nomes.length} tabelas)` : `DIFERENÇAS em ${diferentes.join(", ")}`));
        for (const t of diferentes) {
            anotar(`   --- ${t}\n   scripts: ${JSON.stringify(logicaScripts[t] ?? null)}\n   migrado: ${JSON.stringify(logicaMigrada[t] ?? null)}`);
        }

        // Banco principal intacto
        const realDepois = await contar(admin, REAL);
        const [[real]] = await admin.query(
            "SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'solicitacao' AND COLUMN_NAME = 'status') AS status_existe, " +
            "(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('avaliacao_reembolso','reembolso')) AS novas",
            [REAL, REAL]
        );
        anotar(`6. Banco principal: linhas inalteradas: ${JSON.stringify(realAntes) === JSON.stringify(realDepois) ? "sim" : "NÃO"}; ` +
            `solicitacao.status existe: ${Number(real.status_existe) === 1 ? "sim" : "não"}; tabelas novas: ${real.novas}`);

        const ok = restauracaoOk && estruturaRestauradaOk && preservadas && Number(status) === 0 && diferentes.length === 0 &&
            JSON.stringify(realAntes) === JSON.stringify(realDepois) && Number(real.status_existe) === 1 && Number(real.novas) === 0;
        anotar("");
        anotar(`RESULTADO: ${ok ? "OK" : "FALHOU"}`);
        process.exitCode = ok ? 0 : 1;
    } finally {
        if (process.env.MANTER_BANCO_TESTE !== "1") {
            for (const banco of [COPIA, RESTAURADO, SCRIPTS]) await admin.query(`DROP DATABASE IF EXISTS ${q(banco)}`);
            anotar("Bancos de teste apagados.");
        }
        await admin.end();
        fs.rmSync(pastaTemp, { recursive: true, force: true });
        const destino = path.join(RAIZ, "banco", "relatorios", `migracoes_teste_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
        fs.writeFileSync(destino, relatorio.join("\n") + "\n", "utf8");
        console.log(`Relatório: ${destino}`);
    }
}

main().catch((erro) => {
    console.error("Falha:", erro.message);
    process.exitCode = 1;
});
