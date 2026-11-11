const execucaoService = require("../services/execucaoService");

class ExecucaoController {
    async buscarPorOs(req, res, next) {
        try {
            const execucao = await execucaoService.buscarPorOs(req.params.id_os);
            return res.status(200).json(execucao);
        } catch (erro) {
            next(erro);
        }
    }

    async registrar(req, res, next) {
        try {
            const execucao = await execucaoService.registrar(
                req.params.id_os,
                req.body,
                req.usuario
            );

            return res.status(201).json({
                mensagem: "Execução técnica registrada com sucesso.",
                execucao
            });
        } catch (erro) {
            next(erro);
        }
    }

    async atualizar(req, res, next) {
        try {
            const execucao = await execucaoService.atualizar(
                req.params.id_os,
                req.body,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Execução técnica atualizada com sucesso.",
                execucao
            });
        } catch (erro) {
            next(erro);
        }
    }

    async concluirReparo(req, res, next) {
        try {
            const ordem = await execucaoService.concluirReparo(
                req.params.id_os,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Reparo concluído com sucesso.",
                ordem
            });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new ExecucaoController();
