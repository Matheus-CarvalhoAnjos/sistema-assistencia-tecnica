// Verificar se o usuário possui o perfil necessário
function autorizarPerfil(...perfisPermitidos) {

    return (req, res, next) => {

        // Verificar se o usuário está autenticado
        if (!req.usuario) {
            return res.status(401).json({
                mensagem: "Usuário não autenticado."
            });
        }

        // Verificar se o perfil possui autorização
        if (!perfisPermitidos.includes(req.usuario.perfil)) {
            return res.status(403).json({
                mensagem: "Você não possui permissão para realizar esta ação."
            });
        }

        // Permitir que a requisição continue
        next();
    };
}

module.exports = autorizarPerfil;