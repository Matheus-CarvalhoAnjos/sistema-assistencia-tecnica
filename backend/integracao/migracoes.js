/*
 * Aplica as migrações pendentes (banco/migracoes/pendentes.json) em um banco de TESTE.
 * Situação em 09/11/2026: as migrações 20261109_01..04 foram EXECUTADAS no banco principal (com autorização);
 * a lista de pendentes está vazia e elas ficam registradas em "executadas_no_principal".
 *
 * Segurança: recusa qualquer banco cujo nome não termine em "_teste". Nunca é chamado
 * para o banco principal; a execução no banco principal depende de autorização e segue
 * documentacao/MIGRACOES_BACKUP_RECUPERACAO.md.
 */
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const PASTA = path.join(__dirname, "..", "..", "banco", "migracoes");

/**
 * Credencial ADMINISTRATIVA das ferramentas de teste e migração (criam e apagam bancos _teste,
 * leem a estrutura do principal). A API nunca usa estas variáveis: ela conecta com DB_USER,
 * usuário de privilégio mínimo (S1). Sem DB_ADMIN_USER, usa DB_USER (compatibilidade).
 */
function credenciaisAdmin() {
    return {
        host: process.env.DB_HOST,
        user: process.env.DB_ADMIN_USER || process.env.DB_USER,
        password: process.env.DB_ADMIN_USER ? (process.env.DB_ADMIN_PASSWORD ?? "") : process.env.DB_PASSWORD
    };
}

function lerControle() {
    return JSON.parse(fs.readFileSync(path.join(PASTA, "pendentes.json"), "utf8"));
}

function validarOrdem(lista, origem) {
    // A ordem de execução precisa ser a mesma da ordem alfabética dos arquivos (AAAAMMDD_NN_nome.sql):
    // assim ninguém executa "todos os arquivos da pasta" em ordem diferente da prevista.
    const ordenadas = [...lista].sort();
    if (lista.some((m, i) => m !== ordenadas[i]) || new Set(lista).size !== lista.length) {
        throw new Error(`${origem} fora da ordem alfabética ou com repetição: ${lista.join(", ")}`);
    }
    for (const m of lista) {
        if (!/^\d{8}_\d{2}_[a-z0-9_]+\.sql$/.test(m)) throw new Error(`Nome de migração fora do padrão AAAAMMDD_NN_nome.sql: ${m}`);
        if (!fs.existsSync(path.join(PASTA, m))) throw new Error(`Migração listada e inexistente: ${m}`);
    }
    return lista;
}

/** Migrações ainda não executadas no banco principal (pode ser vazia). */
function listarPendentes() {
    return validarOrdem(lerControle().migracoes, "pendentes.json (migracoes)");
}

/** Migrações já executadas no banco principal (registro em pendentes.json). */
function listarExecutadas() {
    return validarOrdem((lerControle().executadas_no_principal || []).map((e) => e.arquivo), "pendentes.json (executadas_no_principal)");
}

/** Sequência completa com guarda (executadas + pendentes), na ordem de execução. */
function listarSequencia() {
    return validarOrdem([...listarExecutadas(), ...listarPendentes()], "sequência de migrações");
}

/** Arquivo com a estrutura (sem dados) do banco principal antes da primeira migração da sequência. */
function arquivoEstruturaAnterior() {
    const { estrutura_anterior: nome } = lerControle();
    return nome ? path.join(PASTA, nome) : null;
}

function exigirBancoTeste(banco) {
    if (!/_teste$/.test(String(banco || ""))) {
        throw new Error(`Migrações só podem ser aplicadas por este módulo em banco terminado em "_teste" (recebido: ${banco}).`);
    }
}

/**
 * Executa cada migração pendente, em ordem, no banco de teste informado.
 * @returns lista com { arquivo, resultados } (resultados dos SELECTs de conferência)
 */
async function aplicarPendentes(banco, credenciais = {}, lista = listarPendentes()) {
    exigirBancoTeste(banco);

    const conexao = await mysql.createConnection({
        host: credenciais.host ?? process.env.DB_HOST,
        user: credenciais.user ?? credenciaisAdmin().user,
        password: credenciais.password ?? credenciaisAdmin().password,
        database: banco,
        multipleStatements: true
    });

    const aplicadas = [];

    try {
        const [[{ atual }]] = await conexao.query("SELECT DATABASE() AS atual");
        exigirBancoTeste(atual);

        for (const arquivo of lista) {
            const sql = fs.readFileSync(path.join(PASTA, arquivo), "utf8");
            const [resultado] = await conexao.query(sql);
            const conjuntos = Array.isArray(resultado) ? resultado : [resultado];
            aplicadas.push({
                arquivo,
                conferencias: conjuntos.filter(Array.isArray)
            });
        }
    } finally {
        await conexao.end();
    }

    return aplicadas;
}

module.exports = { credenciaisAdmin, aplicarPendentes, listarPendentes, listarExecutadas, listarSequencia, arquivoEstruturaAnterior, exigirBancoTeste };
