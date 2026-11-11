const orcamentoService = require("../services/orcamentoService");

class OrcamentoController {
    async listarPorOs(req, res, next) {
        try {
            const orcamentos = await orcamentoService.listarPorOs(req.params.id_os);
            return res.status(200).json(orcamentos);
        } catch (erro) {
            next(erro);
        }
    }

    async buscarPorId(req, res, next) {
        try {
            const orcamento = await orcamentoService.buscarPorId(
                req.params.id_orcamento,
                req.params.id_os
            );

            if (Number(orcamento.id_os) !== Number(req.params.id_os)) {
                const erro = new Error("Orçamento não encontrado para esta ordem de serviço.");
                erro.statusCode = 404;
                throw erro;
            }

            return res.status(200).json(orcamento);
        } catch (erro) {
            next(erro);
        }
    }

    async criar(req, res, next) {
        try {
            const orcamento = await orcamentoService.criar(
                req.params.id_os,
                req.body,
                req.usuario
            );

            return res.status(201).json({
                mensagem: "Orçamento criado com sucesso.",
                orcamento
            });
        } catch (erro) {
            next(erro);
        }
    }

    async responder(req, res, next) {
        try {
            const orcamento = await orcamentoService.responder(
                req.params.id_orcamento,
                req.body,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Resposta do orçamento registrada com sucesso.",
                orcamento
            });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new OrcamentoController();
