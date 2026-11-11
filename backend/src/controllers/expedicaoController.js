const expedicaoService = require("../services/expedicaoService");

class ExpedicaoController {
    async buscarPorOs(req, res, next) {
        try {
            const expedicao = await expedicaoService.buscarPorOs(req.params.id_os);
            return res.status(200).json(expedicao);
        } catch (erro) {
            next(erro);
        }
    }

    async criar(req, res, next) {
        try {
            const expedicao = await expedicaoService.criar(
                req.params.id_os,
                req.body,
                req.usuario
            );

            return res.status(201).json({
                mensagem: "Expedição registrada com sucesso.",
                expedicao
            });
        } catch (erro) {
            next(erro);
        }
    }

    async atualizarStatus(req, res, next) {
        try {
            const expedicao = await expedicaoService.atualizarStatus(
                req.params.id_os,
                req.body,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Status da expedição atualizado com sucesso.",
                expedicao
            });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new ExpedicaoController();
