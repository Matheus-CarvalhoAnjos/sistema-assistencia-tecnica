
const { pool } = require("../config/database");

const LIMITE_LISTAGEM = 200;

const COLUNAS = `
    id_cliente,
    tipo_pessoa,
    nome_razao_social,
    cpf_cnpj,
    telefone,
    email,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf`;

// Escapa os caracteres especiais do LIKE (% e _) digitados na busca
function escaparLike(texto) {
    return texto.replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

/*
 * filtros.nome: parte do nome/razão social
 * filtros.documento: prefixo do CPF/CNPJ (somente dígitos)
 */
async function listarTodos(filtros = {}) {
    const condicoes = [];
    const parametros = [];

    if (filtros.nome) {
        condicoes.push("nome_razao_social LIKE ?");
        parametros.push(`%${escaparLike(filtros.nome)}%`);
    }

    if (filtros.documento) {
        condicoes.push("cpf_cnpj LIKE ?");
        parametros.push(`${escaparLike(filtros.documento)}%`);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

    const [clientes] = await pool.execute(
        `SELECT ${COLUNAS}
         FROM cliente
         ${where}
         ORDER BY nome_razao_social
         LIMIT ${LIMITE_LISTAGEM}`,
        parametros
    );

    return clientes;
}

async function buscarPorId(id) {
    const [clientes] = await pool.execute(
        `SELECT ${COLUNAS}
         FROM cliente
         WHERE id_cliente = ?`,
        [id]
    );

    return clientes[0] || null;
}

// idIgnorado: permite que o próprio cliente mantenha seu documento na edição
async function buscarPorDocumento(cpfCnpj, idIgnorado = null) {
    const [clientes] = await pool.execute(
        `SELECT id_cliente
         FROM cliente
         WHERE cpf_cnpj = ?
           AND (? IS NULL OR id_cliente <> ?)`,
        [cpfCnpj, idIgnorado, idIgnorado]
    );

    return clientes[0] || null;
}

function valoresCliente(dados) {
    return [
        dados.tipo_pessoa,
        dados.nome_razao_social,
        dados.cpf_cnpj,
        dados.telefone,
        dados.email,
        dados.cep,
        dados.logradouro,
        dados.numero,
        dados.complemento ?? null,
        dados.bairro,
        dados.cidade,
        dados.uf
    ];
}

async function criar(dados) {
    const [resultado] = await pool.execute(
        `INSERT INTO cliente (
            tipo_pessoa,
            nome_razao_social,
            cpf_cnpj,
            telefone,
            email,
            cep,
            logradouro,
            numero,
            complemento,
            bairro,
            cidade,
            uf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        valoresCliente(dados)
    );

    return buscarPorId(resultado.insertId);
}

async function atualizar(id, dados) {
    await pool.execute(
        `UPDATE cliente
         SET tipo_pessoa = ?,
             nome_razao_social = ?,
             cpf_cnpj = ?,
             telefone = ?,
             email = ?,
             cep = ?,
             logradouro = ?,
             numero = ?,
             complemento = ?,
             bairro = ?,
             cidade = ?,
             uf = ?
         WHERE id_cliente = ?`,
        [...valoresCliente(dados), id]
    );

    return buscarPorId(id);
}

module.exports = {
    listarTodos,
    buscarPorId,
    buscarPorDocumento,
    criar,
    atualizar
};
