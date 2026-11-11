/*
 * SIMULAÇÃO DE BACKUP, FALHA PARCIAL DA MIGRAÇÃO 2 E RECUPERAÇÃO — somente bancos "*_teste"
 *
 * Execução:  node integracao/simularRecuperacaoMigracao.js
 *
 * 1. Cria "<DB_NAME>_recuperacao_teste" (papel do banco principal): estrutura e dados do principal
 *    (somente leitura; senhas NÃO copiadas) + linhas de controle (texto acentuado, reembolso integral
 *    antigo e evento de histórico).
 * 2. Backup com o comando documentado (PowerShell, mysqldump, --login-path).
 * 3. Teste do backup: restauração pelo comando antes documentado (PowerShell + pipe) e por "source",
 *    comparando as "impressões digitais" (contagem + soma de verificação) dos dados.
 * 4. Migração 1 completa + migração 2 interrompida depois do primeiro CREATE TABLE (falha simulada).
 *    Confere que repetir a migração 2 é bloqueada pela guarda de pré-condição, sem alterar nada.
 * 5. Recuperação A (documentada): recriar o banco a partir do backup e executar todas as migrações.
 * 6. Recuperação B (manual): no banco restaurado, desfazer a parte criada e repetir as migrações da 2 em diante.
 * 7. Confere que os dados foram preservados; apaga os bancos de teste e o arquivo de backup;
 *    grava o relatório em banco/relatorios.
 *
 * O banco principal é apenas lido (contagem de linhas conferida antes e depois).
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
const ALVO = `${REAL}_recuperacao_teste`;
const RESTAURADOS = {
    documentado: `${REAL}_restauracao_ps_teste`,
    source: `${REAL}_restauracao_source_teste`
};
const BIN = process.env.MYSQL_BIN || "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin";
// Credenciais dos comandos: login-path quando informado (MYSQL_LOGIN_PATH); senão o usuário do .env
// com a senha em MYSQL_PWD (variável de ambiente do processo, nunca na linha de comando).
// Observação: o login-path "assistencia" (usuário assistencia_dev) não tem acesso a bancos _teste.
const CRED = process.env.MYSQL_LOGIN_PATH
    ? `--login-path=${process.env.MYSQL_LOGIN_PATH}`
    : `-h ${process.env.DB_HOST || "localhost"} -u ${ADMIN.user}`;
const RAIZ = path.join(__dirname, "..", "..");
const PASTA_MIGRACOES = path.join(RAIZ, "banco", "migracoes");
const q = (n) => `\`${String(n).replace(/`/g, "")}\``;
const TEXTO_ACENTUADO = "Controle de acentuação: ação, coração, João, ç ã õ é — 100%";

const relatorio = [];
const anotar = (l = "") => { relatorio.push(l); console.log(l); };

function powershell(script) {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, MYSQL_PWD: process.env.MYSQL_LOGIN_PATH ? "" : ADMIN.password ?? "" }
    });
}

async function tabelas(c, banco) {
    const [l] = await c.query("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", [banco]);
    return l.map((x) => x.t);
}

/** Contagem + soma de verificação por tabela, sobre as colunas indicadas (padrão: todas). */
async function impressoes(c, banco, colunasPorTabela = null) {
    const r = {};
    for (const t of colunasPorTabela ? Object.keys(colunasPorTabela) : await tabelas(c, banco)) {
        let cols = colunasPorTabela?.[t];
        if (!cols) {
            const [l] = await c.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [banco, t]);
            cols = l.map((x) => x.c);
        }
        const expr = cols.map((col) => `IFNULL(CAST(${q(col)} AS CHAR), '<NULL>')`).join(", ");
        const [[x]] = await c.query(`SELECT COUNT(*) n, COALESCE(BIT_XOR(CRC32(CONCAT_WS('#', ${expr}))), 0) h FROM ${q(banco)}.${q(t)}`);
        r[t] = `${x.n}:${x.h}`;
    }
    return r;
}

async function colunasDe(c, banco, excluir = {}) {
    const r = {};
    for (const t of await tabelas(c, banco)) {
        const [l] = await c.query("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", [banco, t]);
        r[t] = l.map((x) => x.c).filter((col) => !(excluir[t] ?? []).includes(col));
    }
    return r;
}

const iguais = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diferencas = (a, b) => Object.keys({ ...a, ...b }).filter((t) => a[t] !== b[t]);

async function executarArquivo(c, banco, arquivo) {
    exigirBancoTeste(banco);
    await c.query(`USE ${q(banco)}`);
    await c.query(fs.readFileSync(path.join(PASTA_MIGRACOES, arquivo), "utf8"));
}

async function main() {
    for (const b of [ALVO, ...Object.values(RESTAURADOS)]) exigirBancoTeste(b);
    if (listarPendentes().length === 0) {
        // Ensaio feito ANTES da execução no principal. Em 09/11/2026 as migrações 20261109_01..04 foram
        // executadas no banco principal; os relatórios em banco/relatorios registram os ensaios.
        // As guardas e a recuperação da falha parcial continuam testadas em migracoes.integracao.js.
        console.log("Nenhuma migração pendente: ensaio pré-implantação não se aplica (ver banco/migracoes/pendentes.json).");
        return;
    }
    const c = await mysql.createConnection({ host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password, multipleStatements: true });
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "recuperacao-teste-"));
    const arquivo = path.join(pasta, "backup_recuperacao_teste.sql");
    let ok = true;
    const conferir = (condicao, texto) => { ok = ok && condicao; anotar(`   ${condicao ? "OK " : "FALHOU"} ${texto}`); };

    try {
        anotar(`Simulação de backup, falha parcial da migração 2 e recuperação — ${new Date().toISOString()}`);
        anotar(`Banco principal (somente leitura): ${REAL} | banco simulado: ${ALVO}`);
        const realAntes = await contar(c, REAL);

        // 1. Banco simulado
        for (const b of [ALVO, ...Object.values(RESTAURADOS)]) await c.query(`DROP DATABASE IF EXISTS ${q(b)}`);
        await c.query(`CREATE DATABASE ${q(ALVO)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        await c.query(`USE ${q(ALVO)}`);
        await c.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const t of await tabelas(c, REAL)) {
            const [[d]] = await c.query(`SHOW CREATE TABLE ${q(REAL)}.${q(t)}`);
            await c.query(d["Create Table"]);
            if (t === "usuario") {
                await c.query(`INSERT INTO usuario (id_usuario, nome, email, senha_hash, perfil, ativo) SELECT id_usuario, nome, email, 'senha-nao-copiada', perfil, ativo FROM ${q(REAL)}.usuario`);
            } else {
                await c.query(`INSERT INTO ${q(t)} SELECT * FROM ${q(REAL)}.${q(t)}`);
            }
        }
        await c.query("SET FOREIGN_KEY_CHECKS = 1");
        // Linhas de controle: texto acentuado, reembolso integral antigo e evento de histórico
        const [[base]] = await c.query("SELECT os.id_os, s.id_cliente, s.id_atendente FROM ordem_servico os JOIN item_solicitacao i ON i.id_item = os.id_item JOIN solicitacao s ON s.id_solicitacao = i.id_solicitacao ORDER BY os.id_os LIMIT 1");
        await c.query("INSERT INTO solicitacao (id_cliente, id_atendente, descricao_inicial) VALUES (?, ?, ?)", [base.id_cliente, base.id_atendente, TEXTO_ACENTUADO]);
        await c.query(
            "INSERT INTO pagamento (id_os, data_pagamento, valor, forma_pagamento, status, data_reembolso, id_usuario_reembolso, justificativa_reembolso) VALUES (?, NOW(), 50.00, 'PIX', 'REEMBOLSADO', NOW(), ?, ?)",
            [base.id_os, base.id_atendente, `Reembolso antigo — ${TEXTO_ACENTUADO}`]
        );
        await c.query("INSERT INTO historico_os (id_os, id_usuario, tipo_evento, descricao) VALUES (?, ?, 'PAGAMENTO', ?)", [base.id_os, base.id_atendente, "Evento de controle (simulação)"]);
        const original = await impressoes(c, ALVO);
        // Referência para depois das migrações: solicitacao sem a coluna removida; demais tabelas iguais
        const colsSolicitacao = (await colunasDe(c, ALVO)).solicitacao.filter((col) => col !== "status");
        const referencia = { ...original, ...(await impressoes(c, ALVO, { solicitacao: colsSolicitacao })) };
        const total = (imp) => Object.values(imp).reduce((s, v) => s + Number(v.split(":")[0]), 0);
        anotar(`1. Banco simulado: ${Object.keys(original).length} tabelas, ${total(original)} linhas (dados do principal sem senhas + 3 linhas de controle)`);

        // 2. Backup (comando documentado, seção 5.1)
        const saidaBackup = powershell(
            `$bin = "${BIN}"; $arquivo = "${arquivo}"; ` +
            `& "$bin\\mysqldump.exe" ${CRED} --single-transaction --routines --triggers ` +
            `--no-tablespaces --default-character-set=utf8mb4 --set-gtid-purged=OFF ${ALVO} --result-file=$arquivo; ` +
            `if ($LASTEXITCODE -ne 0) { throw "mysqldump falhou" }`
        );
        const conteudo = fs.readFileSync(arquivo, "utf8");
        anotar(`2. Backup com mysqldump (seção 5.1): ${Math.round(fs.statSync(arquivo).size / 1024)} KB${saidaBackup.trim() ? ` (${saidaBackup.trim()})` : ""}`);
        conferir(/-- Dump completed/.test(conteudo), "o arquivo termina com \"-- Dump completed\"");
        conferir(conteudo.includes(TEXTO_ACENTUADO), "o texto acentuado está íntegro no arquivo (UTF-8)");

        // 3. Teste do backup: três formas de restaurar
        anotar("3. Teste do backup (restauração em bancos _teste):");
        const formas = {
            documentado: `Get-Content $arquivo -Raw | & "$bin\\mysql.exe" ${CRED} --default-character-set=utf8mb4 ${RESTAURADOS.documentado}`,
            source: `& "$bin\\mysql.exe" ${CRED} --default-character-set=utf8mb4 ${RESTAURADOS.source} -e ("source " + ($arquivo -replace '\\\\','/'))`
        };
        const resultadoFormas = {};
        for (const [nome, comando] of Object.entries(formas)) {
            await c.query(`CREATE DATABASE ${q(RESTAURADOS[nome])} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
            try {
                powershell(`$bin = "${BIN}"; $arquivo = "${arquivo}"; ${comando}; if ($LASTEXITCODE -ne 0) { throw "mysql falhou ($LASTEXITCODE)" }`);
                const imp = await impressoes(c, RESTAURADOS[nome]);
                const [[txt]] = await c.query(`SELECT COUNT(*) n FROM ${q(RESTAURADOS[nome])}.solicitacao WHERE descricao_inicial = ?`, [TEXTO_ACENTUADO]);
                resultadoFormas[nome] = iguais(imp, original) && Number(txt.n) === 1;
                anotar(`   ${resultadoFormas[nome] ? "OK " : "FALHOU"} ${nome}: ${iguais(imp, original) ? "dados idênticos" : `diferenças em ${diferencas(imp, original).join(", ")}`}; texto acentuado ${Number(txt.n) === 1 ? "preservado" : "CORROMPIDO"}`);
            } catch (e) {
                resultadoFormas[nome] = false;
                anotar(`   FALHOU ${nome}: ${e.message.split("\n")[0]}`);
            }
            anotar(`      comando: ${comando}`);
        }
        const forma = ["source", "documentado"].find((f) => resultadoFormas[f]);
        conferir(!!forma, `há forma de restauração que preserva os dados (usada a seguir: ${forma ?? "nenhuma"})`);
        if (!forma) throw new Error("nenhuma forma de restauração preservou os dados");

        // 4. Migração 1 + falha parcial da migração 2
        const [m1, m2, ...demais] = listarPendentes();
        await executarArquivo(c, ALVO, m1);
        const sql2 = fs.readFileSync(path.join(PASTA_MIGRACOES, m2), "utf8");
        const primeiroCreate = sql2.slice(0, sql2.indexOf(";", sql2.indexOf("CREATE TABLE avaliacao_reembolso")) + 1);
        await c.query(`USE ${q(ALVO)}`);
        await c.query(primeiroCreate);
        anotar(`4. Migração 1 executada; migração 2 interrompida após "CREATE TABLE avaliacao_reembolso" (falha simulada antes de "CREATE TABLE reembolso")`);
        const existe = async (banco, t) => Number((await c.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", [banco, t]))[0][0].n) === 1;
        conferir(await existe(ALVO, "avaliacao_reembolso") && !(await existe(ALVO, "reembolso")), "estado parcial: avaliacao_reembolso existe e reembolso não");
        // Com a guarda de pré-condição, a repetição para na guarda (ER_SP_DOES_NOT_EXIST) antes de qualquer CREATE
        let erroRepeticao = null;
        try { await executarArquivo(c, ALVO, m2); } catch (e) { erroRepeticao = e.code; }
        conferir(erroRepeticao === "ER_SP_DOES_NOT_EXIST"
            && await existe(ALVO, "avaliacao_reembolso") && !(await existe(ALVO, "reembolso")),
        `repetir a migração 2 é bloqueada pela guarda sem alterar nada (${erroRepeticao})`);

        // 5. Recuperação A: recriar a partir do backup (seção 5.4)
        await c.query(`DROP DATABASE ${q(ALVO)}`);
        await c.query(`CREATE DATABASE ${q(ALVO)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
        powershell(`$bin = "${BIN}"; $arquivo = "${arquivo}"; ${formas[forma].replace(RESTAURADOS[forma], ALVO)}; if ($LASTEXITCODE -ne 0) { throw "mysql falhou" }`);
        anotar(`5. Recuperação A — banco recriado a partir do backup (forma "${forma}"):`);
        conferir(iguais(await impressoes(c, ALVO), original), "dados idênticos ao estado anterior à migração (inclui solicitacao.status)");
        await aplicarPendentes(ALVO);
        conferir(await validarMigrado(c, ALVO, referencia), `as ${listarPendentes().length} migrações executadas depois da recuperação; dados preservados; reembolso antigo copiado`);

        // 6. Recuperação B: desfazer só a parte criada e repetir (banco restaurado pela forma escolhida)
        const B = RESTAURADOS[forma];
        await executarArquivo(c, B, m1);
        await c.query(`USE ${q(B)}`);
        await c.query(primeiroCreate);
        await c.query("DROP TABLE IF EXISTS reembolso; DROP TABLE IF EXISTS avaliacao_reembolso;");
        await executarArquivo(c, B, m2);
        for (const m of demais) await executarArquivo(c, B, m);
        anotar(`6. Recuperação B — em ${B}: migração 1, falha parcial da 2, "DROP TABLE IF EXISTS reembolso; DROP TABLE IF EXISTS avaliacao_reembolso;", migrações 2 em diante repetidas:`);
        conferir(await validarMigrado(c, B, referencia), "dados preservados; estrutura final completa");

        const realDepois = await contar(c, REAL);
        anotar("7. Banco principal:");
        conferir(iguais(realAntes, realDepois), "contagem de linhas inalterada (somente leitura)");
    } catch (erro) {
        ok = false;
        const linhasErro = String(erro.message).split(/\r?\n/).filter((l) => /mysql|Falha|falhou/.test(l));
        anotar(`FALHA: ${linhasErro.slice(0, 3).join(" | ") || erro.message}`);
    } finally {
        if (process.env.MANTER_BANCO_TESTE !== "1") {
            for (const b of [ALVO, ...Object.values(RESTAURADOS)]) await c.query(`DROP DATABASE IF EXISTS ${q(b)}`);
            anotar("Bancos de teste apagados.");
        }
        await c.end();
        fs.rmSync(pasta, { recursive: true, force: true });
        anotar("Arquivo de backup temporário apagado.");
        anotar("");
        anotar(`RESULTADO: ${ok ? "OK" : "FALHOU"}`);
        process.exitCode = ok ? 0 : 1;
        const destino = path.join(RAIZ, "banco", "relatorios", `recuperacao_migracao_teste_${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
        fs.writeFileSync(destino, relatorio.join("\n") + "\n", "utf8");
        console.log(`Relatório: ${destino}`);
    }

    /** Dados anteriores preservados depois de todas as migrações (referência calculada antes de migrar). */
    async function validarMigrado(conexao, banco, referencia) {
        const colunas = await colunasDe(conexao, banco);
        delete colunas.avaliacao_reembolso;
        delete colunas.reembolso;
        delete colunas.abatimento;
        const depois = await impressoes(conexao, banco, colunas);
        const [[reemb]] = await conexao.query(`SELECT COUNT(*) n FROM ${q(banco)}.reembolso r JOIN ${q(banco)}.pagamento p ON p.id_pagamento = r.id_pagamento WHERE p.status = 'REEMBOLSADO' AND r.valor = p.valor`);
        const [[status]] = await conexao.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='solicitacao' AND COLUMN_NAME='status'", [banco]);
        const iguaisDados = iguais(depois, referencia);
        if (!iguaisDados) anotar(`      diferenças: ${diferencas(depois, referencia).join(", ")}`);
        return iguaisDados && Number(reemb.n) === 1 && Number(status.n) === 0;
    }
}

async function contar(c, banco) {
    const r = {};
    for (const t of await tabelas(c, banco)) r[t] = Number((await c.query(`SELECT COUNT(*) n FROM ${q(banco)}.${q(t)}`))[0][0].n);
    return r;
}

main().catch((e) => {
    console.error("Falha:", e.message);
    process.exitCode = 1;
});
