const pagamentoService = require("../services/pagamentoService");

class PagamentoController {
    async listarPorOs(req, res, next) {
        try {
            const resultado = await pagamentoService.listarPorOs(req.params.id_os);
            return res.status(200).json(resultado);
        } catch (erro) {
            next(erro);
        }
    }

    async criar(req, res, next) {
        try {
            const pagamento = await pagamentoService.criar(req.params.id_os, req.body, req.usuario);

            return res.status(201).json({
                mensagem: "Pagamento registrado como pendente.",
                pagamento
            });
        } catch (erro) {
            next(erro);
        }
    }

    async atualizarStatus(req, res, next) {
        try {
            const pagamento = await pagamentoService.atualizarStatus(
                req.params.id_pagamento,
                req.body,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Status do pagamento atualizado com sucesso.",
                pagamento
            });
        } catch (erro) {
            next(erro);
        }
    }

    async reembolsar(req, res, next) {
        try {
            const pagamento = await pagamentoService.reembolsar(
                req.params.id_pagamento,
                req.body,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Reembolso registrado com sucesso.",
                pagamento
            });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new PagamentoController();
