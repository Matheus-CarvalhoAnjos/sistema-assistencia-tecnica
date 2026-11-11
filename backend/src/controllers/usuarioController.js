
const usuarioService = require("../services/usuarioService");

// Listar todos os usuários
async function listarTodos(req, res, next) {
    try {
        const usuarios = await usuarioService.listarTodos(req.query);

        return res.status(200).json(usuarios);

    } catch (erro) {
        next(erro);
    }
}

// Buscar usuário pelo ID
async function buscarPorId(req, res, next) {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                mensagem: "ID de usuário inválido."
            });
        }

        const usuario = await usuarioService.buscarPorId(id);

        return res.status(200).json(usuario);

    } catch (erro) {
        next(erro);
    }
}

// Cadastrar usuário
async function criar(req, res, next) {
    try {
        const novoUsuario = await usuarioService.criar(req.body);

        return res.status(201).json({
            mensagem: "Usuário cadastrado com sucesso.",
            usuario: novoUsuario
        });

    } catch (erro) {
        next(erro);
    }
}

// Editar usuário (somente administrador)
async function atualizar(req, res, next) {
    try {
        const usuario = await usuarioService.atualizar(req.params.id, req.body, req.usuario);

        return res.status(200).json({
            mensagem: "Usuário atualizado com sucesso.",
            usuario
        });

    } catch (erro) {
        next(erro);
    }
}

// Ativar ou desativar usuário (somente administrador)
async function alterarAtivo(req, res, next) {
    try {
        const usuario = await usuarioService.alterarAtivo(req.params.id, req.body, req.usuario);

        return res.status(200).json({
            mensagem: usuario.ativo ? "Usuário ativado." : "Usuário desativado.",
            usuario
        });

    } catch (erro) {
        next(erro);
    }
}

module.exports = {
    listarTodos,
    buscarPorId,
    criar,
    atualizar,
    alterarAtivo
};
