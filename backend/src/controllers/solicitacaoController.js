
const solicitacaoService = require("../services/solicitacaoService");

class SolicitacaoController {

    async criar(req, res, next) {
        try {
            const dados = {
                ...req.body,

                // O atendente vem do token JWT
                id_atendente: req.usuario.id_usuario
            };

            const solicitacao = await solicitacaoService.criar(dados);

            return res.status(201).json({
                mensagem: "Solicitação cadastrada com sucesso.",
                solicitacao
            });

        } catch (erro) {
            next(erro);
        }
    }
        // Listar todas as solicitações
    async listarTodos(req, res, next) {
        try {
            const solicitacoes = await solicitacaoService.listarTodos(
                req.usuario
            );

            return res.status(200).json({
                quantidade: solicitacoes.length,
                solicitacoes
            });

        } catch (erro) {
            next(erro);
        }
    }


    // Buscar uma solicitação pelo ID
    async buscarPorId(req, res, next) {
        try {
            const solicitacao = await solicitacaoService.buscarPorId(
                req.params.id,
                req.usuario
            );

            return res.status(200).json({
                solicitacao
            });

        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new SolicitacaoController();
