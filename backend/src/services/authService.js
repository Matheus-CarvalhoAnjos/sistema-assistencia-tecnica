
const usuarioRepository = require("../repositories/usuarioRepository");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Realizar login
async function login(dados) {

    // Verificar se os dados foram enviados corretamente
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
        const erro = new Error("Os dados de login são inválidos.");
        erro.statusCode = 400;
        throw erro;
    }

    const { email, senha } = dados;

    // Verificar campos obrigatórios
    if (
        typeof email !== "string" ||
        typeof senha !== "string" ||
        !email.trim() ||
        !senha
    ) {
        const erro = new Error("E-mail e senha são obrigatórios.");
        erro.statusCode = 400;
        throw erro;
    }

    const emailFormatado = email.trim().toLowerCase();

    // Buscar usuário pelo e-mail
    const usuario =
        await usuarioRepository.buscarPorEmailParaLogin(emailFormatado);

    // Verificar se o usuário existe
    if (!usuario) {
        const erro = new Error("E-mail ou senha inválidos.");
        erro.statusCode = 401;
        throw erro;
    }

    // Comparar senha informada com o hash armazenado
    const senhaValida = await bcrypt.compare(
        senha,
        usuario.senha_hash
    );

    if (!senhaValida) {
        const erro = new Error("E-mail ou senha inválidos.");
        erro.statusCode = 401;
        throw erro;
    }

    // Verificar se o usuário está ativo
    if (!usuario.ativo) {
        const erro = new Error("Este usuário está inativo.");
        erro.statusCode = 403;
        throw erro;
    }

    // Verificar se a chave JWT está configurada
    if (!process.env.JWT_SECRET) {
        const erro = new Error("Chave de autenticação não configurada.");
        erro.statusCode = 500;
        throw erro;
    }

    // Gerar token JWT
    const token = jwt.sign(
        {
            id_usuario: usuario.id_usuario,
            perfil: usuario.perfil
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || "1h"
        }
    );

    // Retornar dados do usuário e token
    return {
        usuario: {
            id_usuario: usuario.id_usuario,
            nome: usuario.nome,
            email: usuario.email,
            perfil: usuario.perfil
        },
        token
    };
}

module.exports = {
    login
};
