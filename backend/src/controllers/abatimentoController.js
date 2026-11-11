const abatimentoService = require("../services/abatimentoService");

class AbatimentoController {
    async listarPorOs(req, res, next) {
        try {
            return res.status(200).json(await abatimentoService.listarPorOs(req.params.id_os, req.usuario));
        } catch (erro) {
            next(erro);
        }
    }

    async registrar(req, res, next) {
        try {
            const abatimento = await abatimentoService.registrar(req.params.id_os, req.body, req.usuario);
            return res.status(201).json({ mensagem: "Abatimento registrado.", abatimento });
        } catch (erro) {
            next(erro);
        }
    }

    async cancelar(req, res, next) {
        try {
            const abatimento = await abatimentoService.cancelar(req.params.id_abatimento, req.body, req.usuario);
            return res.status(200).json({ mensagem: "Abatimento cancelado.", abatimento });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new AbatimentoController();
