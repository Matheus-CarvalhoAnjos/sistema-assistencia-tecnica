require('dotenv').config();

const mysql = require('mysql2/promise');

// Na Vercel cada instância da função tem o próprio pool; poucas conexões por instância
// evitam esgotar o max_connections do MySQL quando várias instâncias estão ativas.
const emServerless = Boolean(process.env.VERCEL);

/** Lê um inteiro positivo de uma variável de ambiente, com valor padrão. */
function inteiroPositivo(valor, padrao) {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 ? numero : padrao;
}

/**
 * SSL/TLS da conexão com o MySQL (exigido pela maioria dos serviços externos).
 * DB_SSL=true ativa; DB_SSL_CA recebe o certificado da autoridade (PEM) quando o
 * provedor fornece um; DB_SSL_REJECT_UNAUTHORIZED=false só deve ser usado se o
 * provedor não oferecer certificado verificável.
 */
function configuracaoSsl() {
    if (String(process.env.DB_SSL).toLowerCase() !== 'true') {
        return undefined;
    }

    const ssl = {
        rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() !== 'false'
    };

    if (process.env.DB_SSL_CA) {
        // Permite informar o PEM em uma única linha, com "\n" literais
        ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
    }

    return ssl;
}

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: inteiroPositivo(process.env.DB_PORT, 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: configuracaoSsl(),
    // Fuso usado para converter DATETIME <-> Date. Os dados são gravados no horário de
    // Brasília; na Vercel o fuso do servidor é UTC, por isso o padrão lá é -03:00.
    timezone: process.env.DB_TIMEZONE || (emServerless ? '-03:00' : 'local'),
    waitForConnections: true,
    connectionLimit: inteiroPositivo(process.env.DB_CONNECTION_LIMIT, emServerless ? 3 : 10),
    maxIdle: emServerless ? 1 : inteiroPositivo(process.env.DB_CONNECTION_LIMIT, 10),
    idleTimeout: 60000,
    enableKeepAlive: true,
    queueLimit: 0
});

async function testarConexao() {
    let conexao;

    try {
        conexao = await pool.getConnection();

        console.log('Conexão com o MySQL realizada com sucesso!');
        console.log(`Banco conectado: ${process.env.DB_NAME}`);
    } catch (erro) {
        console.error('Erro ao conectar ao MySQL:', erro.message);
        throw erro;
    } finally {
        if (conexao) {
            conexao.release();
        }
    }
}

module.exports = {
    pool,
    testarConexao
};
