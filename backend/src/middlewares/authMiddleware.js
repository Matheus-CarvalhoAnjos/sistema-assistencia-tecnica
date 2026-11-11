
const jwt = require("jsonwebtoken");
const usuarioRepository = require("../repositories/usuarioRepository");

// Verificar autenticação do usuário
async function autenticar(req, res, next) {

    // Obter o cabeçalho Authorization
    const authorization = req.headers.authorization;

    // Verificar se o token foi enviado
    if (!authorization) {
        return res.status(401).json({
            mensagem: "Token de autenticação não informado."
        });
    }

    // Separar o tipo de autenticação e o token
    const [tipo, token] = authorization.split(" ");

    // Verificar se o formato é Bearer Token
    if (tipo !== "Bearer" || !token) {
        return res.status(401).json({
            mensagem: "Formato do token inválido."
        });
    }

    let dadosToken;

    try {

        // Verificar a validade do token
        dadosToken = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

    } catch (erro) {

        return res.status(401).json({
            mensagem: "Token inválido ou expirado."
        });

    }

    try {

        // Buscar o usuário atual no banco para refletir desativação
        // ou mudança de perfil sem esperar o token expirar
        const usuario = await usuarioRepository.buscarPorId(
            dadosToken.id_usuario
        );

        if (!usuario || !usuario.ativo) {
            return res.status(401).json({
                mensagem: "Usuário não encontrado ou inativo."
            });
        }

        // Disponibilizar os dados atuais do usuário na requisição
        req.usuario = {
            id_usuario: usuario.id_usuario,
            perfil: String(usuario.perfil).toUpperCase()
        };

        // Permitir que a requisição continue
        next();

    } catch (erro) {

        // Falha ao consultar o banco: erro interno
        next(erro);

    }
}

module.exports = autenticar;
