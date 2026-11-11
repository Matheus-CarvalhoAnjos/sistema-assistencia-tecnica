const acessorioService = require("../services/acessorioService");

class AcessorioController {
    async listarTodos(req, res, next) {
        try {
            const acessorios = await acessorioService.listarTodos();
            return res.status(200).json(acessorios);
        } catch (erro) {
            next(erro);
        }
    }

    async buscarPorId(req, res, next) {
        try {
            const id = req.params.id;
            const acessorio = await acessorioService.buscarPorId(id);
            return res.status(200).json(acessorio);
        } catch (erro) {
            next(erro);
        }
    }

    async criar(req, res, next) {
        try {
            const novoAcessorio = await acessorioService.criar(req.body);

            return res.status(201).json({
                mensagem: "Acessório cadastrado com sucesso.",
                acessorio: novoAcessorio
            });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new AcessorioController();
