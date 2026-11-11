const ordemServicoService = require("../services/ordemServicoService");
const acessorioRecebidoService = require("../services/acessorioRecebidoService");

class OrdemServicoController {
    async criarParaItem(req, res, next) {
        try {
            const ordem = await ordemServicoService.criarParaItem(req.body, req.usuario);

            return res.status(201).json({
                mensagem: "Ordem de serviço criada com sucesso.",
                ordem
            });
        } catch (erro) {
            next(erro);
        }
    }

    async listarTodos(req, res, next) {
        try {
            // Filtros opcionais: ?status=&id_tecnico=&sem_tecnico=true&busca=&data_inicio=&data_fim=
            const ordens = await ordemServicoService.listarTodos(req.usuario, req.query);
            return res.status(200).json(ordens);
        } catch (erro) {
            next(erro);
        }
    }

    async buscarPorId(req, res, next) {
        try {
            // Acesso já verificado pelo middleware autorizarAcessoOs; devolve os detalhes da tela
            const detalhes = await ordemServicoService.buscarDetalhes(req.params.id, req.usuario);
            return res.status(200).json(detalhes);
        } catch (erro) {
            next(erro);
        }
    }

    async atribuirTecnico(req, res, next) {
        try {
            await ordemServicoService.atribuirTecnico(req.params.id, req.body?.id_tecnico, req.usuario);
            const ordem = await ordemServicoService.buscarDetalhes(req.params.id, req.usuario);

            return res.status(200).json({
                mensagem: "Técnico atribuído com sucesso.",
                ordem
            });
        } catch (erro) {
            next(erro);
        }
    }

    async atualizarGarantia(req, res, next) {
        try {
            const garantia = await ordemServicoService.atualizarGarantia(
                req.params.id,
                req.body?.garantia_status,
                req.usuario
            );

            return res.status(200).json({
                mensagem: "Situação da garantia atualizada com sucesso.",
                garantia
            });
        } catch (erro) {
            next(erro);
        }
    }

    async encerrarSemReparo(req, res, next) {
        try {
            const encerramento = await ordemServicoService.encerrarSemReparo(req.params.id, req.body, req.usuario);
            const ordem = await ordemServicoService.buscarDetalhes(req.params.id, req.usuario);

            return res.status(200).json({
                mensagem: "Ordem de serviço encerrada sem reparo.",
                encerramento,
                ordem
            });
        } catch (erro) {
            next(erro);
        }
    }

    async listarHistorico(req, res, next) {
        try {
            const historico = await ordemServicoService.listarHistorico(req.params.id, req.usuario);
            return res.status(200).json(historico);
        } catch (erro) {
            next(erro);
        }
    }

    async listarAcessoriosRecebidos(req, res, next) {
        try {
            const ordem = req.ordemServico
                ?? await ordemServicoService.buscarPorId(req.params.id, req.usuario);
            const acessorios = await acessorioRecebidoService.listarPorItem(ordem.id_item, req.usuario);

            return res.status(200).json(acessorios);
        } catch (erro) {
            next(erro);
        }
    }

    async registrarAcessoriosRecebidos(req, res, next) {
        try {
            const ordem = req.ordemServico
                ?? await ordemServicoService.buscarPorId(req.params.id, req.usuario);
            const registros = Array.isArray(req.body)
                ? req.body.map((item) => ({ ...item, id_item: ordem.id_item }))
                : { ...req.body, id_item: ordem.id_item };

            const resultado = await acessorioRecebidoService.registrar(registros, req.usuario, {
                id_os: Number(ordem.id_os)
            });

            return res.status(201).json({
                mensagem: "Acessórios recebidos registrados com sucesso.",
                registros: resultado
            });
        } catch (erro) {
            next(erro);
        }
    }

    // D7: o acessório precisa ser do equipamento desta OS (o repository confere item × OS)
    async alterarAcessorioRecebido(req, res, next) {
        try {
            const ordem = req.ordemServico
                ?? await ordemServicoService.buscarPorId(req.params.id, req.usuario);
            const { registro, alterado } = await acessorioRecebidoService.atualizar(
                req.params.id_acessorio_recebido,
                req.body,
                req.usuario,
                { id_os: Number(ordem.id_os), id_item: Number(ordem.id_item) }
            );

            return res.status(200).json({
                mensagem: alterado ? "Acessório recebido alterado." : "Nenhuma alteração.",
                registro
            });
        } catch (erro) {
            next(erro);
        }
    }
}

module.exports = new OrdemServicoController();
