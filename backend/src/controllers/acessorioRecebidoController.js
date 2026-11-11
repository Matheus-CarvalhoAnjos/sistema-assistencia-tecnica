const acessorioRecebidoService = require("../services/acessorioRecebidoService");

class AcessorioRecebidoController {
    async registrar(req, res, next) {
        try {
            const registro = await acessorioRecebidoService.registrar(req.body, req.usuario);

            return res.status(201).json({
                mensagem: "Acessório recebido registrado com sucesso.",
                registro
            });
        } catch (erro) {
            next(erro);
        }
    }

    async atualizar(req, res, next) {
        try {
            const { registro, alterado } = await acessorioRecebidoService.atualizar(req.params.id, req.body, req.usuario);

            return res.status(200).json({
                mensagem: alterado ? "Acessório recebido alterado." : "Nenhuma alteração.",
                registro
            });
        } catch (erro) {
            next(erro);
        }
    }

    async listarPorItem(req, res, next) {
        try {
            const registros = await acessorioRecebidoService.listarPorItem(req.params.id_item, req.usuario);
            return res.status(200).json(registros);
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new AcessorioRecebidoController();
