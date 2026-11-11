
const { pool } = require("../config/database");
const Usuario = require("../models/usuario");

// Listar usuários (filtros opcionais: perfil e ativo, já validados pelo service)
async function listarTodos(filtros = {}) {
    const condicoes = [];
    const parametros = [];

    if (filtros.perfil) {
        condicoes.push("perfil = ?");
        parametros.push(filtros.perfil);
    }

    if (filtros.ativo !== undefined) {
        condicoes.push("ativo = ?");
        parametros.push(filtros.ativo);
    }

    const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

    const [usuarios] = await pool.execute(
        `SELECT
            id_usuario,
            nome,
            email,
            perfil,
            ativo
         FROM usuario
         ${where}
         ORDER BY nome`,
        parametros
    );

    return usuarios.map(usuario => new Usuario(usuario));
}

// Buscar usuário pelo ID
async function buscarPorId(id) {
    const [usuarios] = await pool.execute(
        `SELECT
            id_usuario,
            nome,
            email,
            perfil,
            ativo
         FROM USUARIO
         WHERE id_usuario = ?`,
        [id]
    );

    if (usuarios.length === 0) {
        return null;
    }

    return new Usuario(usuarios[0]);
}

// Buscar usuário pelo e-mail
async function buscarPorEmail(email) {
    const [usuarios] = await pool.execute(
        `SELECT id_usuario
         FROM USUARIO
         WHERE email = ?`,
        [email]
    );

    return usuarios[0] || null;
}

// Buscar usuário pelo e-mail para autenticação
async function buscarPorEmailParaLogin(email) {
    const [usuarios] = await pool.execute(
        `SELECT
            id_usuario,
            nome,
            email,
            senha_hash,
            perfil,
            ativo
         FROM USUARIO
         WHERE email = ?`,
        [email]
    );

    return usuarios[0] || null;
}

// Cadastrar usuário
async function criar(dados) {
    const {
        nome,
        email,
        senha_hash,
        perfil,
        ativo = 1
    } = dados;

    const [resultado] = await pool.execute(
        `INSERT INTO USUARIO (
            nome,
            email,
            senha_hash,
            perfil,
            ativo
        ) VALUES (?, ?, ?, ?, ?)`,
        [
            nome,
            email,
            senha_hash,
            perfil,
            ativo
        ]
    );

    return buscarPorId(resultado.insertId);
}

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

/*
 * Executa uma alteração de usuário em transação, garantindo que o sistema
 * nunca fique sem ADMINISTRADOR ativo.
 * Os administradores ativos são bloqueados primeiro, sempre na mesma ordem: duas
 * alterações simultâneas (por exemplo, dois administradores desativando um ao outro)
 * passam a ser executadas uma depois da outra, e a segunda vê o resultado da primeira.
 */
async function alterarComGarantiaDeAdministrador(id, calcularNovoEstado, aplicar) {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const [administradores] = await conexao.execute(
            `SELECT id_usuario
             FROM usuario
             WHERE perfil = 'ADMINISTRADOR' AND ativo = 1
             ORDER BY id_usuario
             FOR UPDATE`
        );

        const [linhas] = await conexao.execute(
            `SELECT id_usuario, perfil, ativo
             FROM usuario
             WHERE id_usuario = ?
             FOR UPDATE`,
            [id]
        );

        if (linhas.length === 0) {
            throw erroComStatus("Usuário não encontrado.", 404);
        }

        const atual = linhas[0];
        const novo = calcularNovoEstado(atual);
        const eraAdministradorAtivo = atual.perfil === "ADMINISTRADOR" && Number(atual.ativo) === 1;
        const continuaAdministradorAtivo = novo.perfil === "ADMINISTRADOR" && Number(novo.ativo) === 1;

        if (eraAdministradorAtivo && !continuaAdministradorAtivo && administradores.length <= 1) {
            throw erroComStatus("O sistema precisa de ao menos um administrador ativo.", 409);
        }

        await aplicar(conexao);
        await conexao.commit();
    } catch (erro) {
        await conexao.rollback();

        if (erro.code === "ER_DUP_ENTRY") {
            throw erroComStatus("Já existe um usuário cadastrado com esse e-mail.", 409);
        }

        throw erro;
    } finally {
        conexao.release();
    }

    // Pelo objeto exportado: permite substituir a consulta nos testes
    return module.exports.buscarPorId(id);
}

// Atualizar nome, e-mail, perfil e (opcionalmente) a senha, já em hash
async function atualizar(id, dados) {
    return alterarComGarantiaDeAdministrador(
        id,
        (atual) => ({ perfil: dados.perfil, ativo: atual.ativo }),
        async (conexao) => {
            const [duplicados] = await conexao.execute(
                `SELECT id_usuario FROM usuario WHERE email = ? AND id_usuario <> ?`,
                [dados.email, id]
            );

            if (duplicados.length > 0) {
                throw erroComStatus("Já existe um usuário cadastrado com esse e-mail.", 409);
            }

            if (dados.senha_hash) {
                await conexao.execute(
                    `UPDATE usuario SET nome = ?, email = ?, perfil = ?, senha_hash = ? WHERE id_usuario = ?`,
                    [dados.nome, dados.email, dados.perfil, dados.senha_hash, id]
                );
            } else {
                await conexao.execute(
                    `UPDATE usuario SET nome = ?, email = ?, perfil = ? WHERE id_usuario = ?`,
                    [dados.nome, dados.email, dados.perfil, id]
                );
            }
        }
    );
}

// Ativar ou desativar (o usuário inativo não autentica e perde a sessão na próxima requisição)
async function alterarAtivo(id, ativo) {
    return alterarComGarantiaDeAdministrador(
        id,
        (atual) => ({ perfil: atual.perfil, ativo }),
        async (conexao) => {
            await conexao.execute(`UPDATE usuario SET ativo = ? WHERE id_usuario = ?`, [ativo, id]);
        }
    );
}

module.exports = {
    listarTodos,
    buscarPorId,
    buscarPorEmail,
    buscarPorEmailParaLogin,
    criar,
    atualizar,
    alterarAtivo
};
