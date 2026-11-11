const avaliacaoReembolsoService = require("../services/avaliacaoReembolsoService");

class AvaliacaoReembolsoController {
    async consultar(req, res, next) {
        try {
            return res.status(200).json(await avaliacaoReembolsoService.consultar(req.params.id_os));
        } catch (erro) {
            next(erro);
        }
    }

    async registrar(req, res, next) {
        try {
            const avaliacao = await avaliacaoReembolsoService.registrar(req.params.id_os, req.body, req.usuario);

            return res.status(201).json({ mensagem: "Avaliação financeira registrada.", avaliacao });
        } catch (erro) {
            next(erro);
        }
    }

    async revisar(req, res, next) {
        try {
            const avaliacao = await avaliacaoReembolsoService.revisar(req.params.id_os, req.body, req.usuario);

            return res.status(201).json({ mensagem: "Revisão da avaliação financeira registrada.", avaliacao });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new AvaliacaoReembolsoController();
