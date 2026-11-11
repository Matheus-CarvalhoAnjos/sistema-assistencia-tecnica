
const authService = require("../services/authService");

// Realizar login
async function login(req, res, next) {
    try {
        const resultado = await authService.login(req.body);

        return res.status(200).json({
            mensagem: "Login realizado com sucesso.",
            usuario: resultado.usuario,
            token: resultado.token
        });

    } catch (erro) {
        next(erro);
    }
}

module.exports = {
    login
};
