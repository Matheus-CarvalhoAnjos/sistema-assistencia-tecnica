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

/**
 * Fuso horário da aplicação. Os dados são gravados no horário de Brasília; servidores
 * hospedados (Vercel, TiDB Cloud) usam UTC, por isso o padrão na Vercel é -03:00.
 * "local" (padrão fora da Vercel) mantém o comportamento original: fuso da máquina no
 * driver e fuso padrão do servidor MySQL na sessão.
 */
function fusoHorario() {
    const valor = (process.env.DB_TIMEZONE || (emServerless ? '-03:00' : 'local')).trim();

    if (valor === 'local' || valor === 'Z' || /^[+-](0\d|1[0-4]):[0-5]\d$/.test(valor)) {
        return valor;
    }

    throw new Error('DB_TIMEZONE inválido. Use "local", "Z" ou um deslocamento como "-03:00".');
}

const fuso = fusoHorario();

// Fuso da SESSÃO SQL (CURRENT_TIMESTAMP, NOW()), aplicado a cada conexão nova do pool.
// Sem isso, um servidor em UTC gravaria os valores padrão 3 horas à frente das datas
// enviadas pelo Node. Em "local" nada é alterado.
const fusoSessao = fuso === 'local' ? null : (fuso === 'Z' ? '+00:00' : fuso);

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: inteiroPositivo(process.env.DB_PORT, 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: configuracaoSsl(),
    // Fuso usado pelo driver para converter DATETIME <-> Date
    timezone: fuso,
    waitForConnections: true,
    connectionLimit: inteiroPositivo(process.env.DB_CONNECTION_LIMIT, emServerless ? 3 : 10),
    maxIdle: emServerless ? 1 : inteiroPositivo(process.env.DB_CONNECTION_LIMIT, 10),
    idleTimeout: 60000,
    enableKeepAlive: true,
    queueLimit: 0
});

if (fusoSessao) {
    // O evento ocorre antes de a conexão ser entregue; o mysql2 executa os comandos de
    // uma conexão em ordem, então o SET roda antes de qualquer consulta da aplicação.
    pool.on('connection', (conexao) => {
        conexao.query('SET time_zone = ?', [fusoSessao], (erro) => {
            if (erro) {
                console.error('Não foi possível definir o fuso da sessão MySQL:', erro.message);
                conexao.destroy();
            }
        });
    });
}

/** Testa a conexão e informa o destino (sem credenciais). */
async function testarConexao() {
    let conexao;

    try {
        conexao = await pool.getConnection();

        const [[sessao]] = await conexao.query(
            'SELECT @@session.time_zone AS fuso_sessao, VERSION() AS versao'
        );
        const [statusSsl] = await conexao.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
        const cifra = statusSsl[0]?.Value;

        console.log('Conexão com o MySQL realizada com sucesso!');
        console.log(`Servidor: ${process.env.DB_HOST}:${inteiroPositivo(process.env.DB_PORT, 3306)}`);
        console.log(`Banco conectado: ${process.env.DB_NAME}`);
        console.log(`SSL/TLS: ${cifra ? `ativo (${cifra})` : 'inativo'}`);
        console.log(`Fuso: driver ${fuso} | sessão ${sessao.fuso_sessao}`);
        console.log(`Versão do servidor: ${sessao.versao}`);
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
