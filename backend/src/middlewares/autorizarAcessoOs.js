const ordemServicoService = require("../services/ordemServicoService");

/*
 * Garante que o usuário autenticado pode acessar a OS indicada na rota.
 * - ADMINISTRADOR e ATENDENTE: qualquer OS existente.
 * - TECNICO: somente OS atribuídas a ele (outras respondem 404).
 * Deve ser usado depois de autenticar e autorizarPerfil.
 * A OS carregada fica disponível em req.ordemServico.
 */
function autorizarAcessoOs(nomeParametro = "id_os") {
    return async (req, res, next) => {
        try {
            req.ordemServico = await ordemServicoService.verificarAcessoOs(
                req.params[nomeParametro],
                req.usuario
            );

            next();
        } catch (erro) {
            next(erro);
        }
    };
}

module.exports = autorizarAcessoOs;
