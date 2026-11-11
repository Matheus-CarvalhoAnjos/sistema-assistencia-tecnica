require('dotenv').config();

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
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