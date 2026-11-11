const express = require("express");
const router = express.Router();

const usuarioController = require("../controllers/usuarioController");

const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

// Listar usuários (atendente precisa listar técnicos para atribuir OS)
router.get(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    usuarioController.listarTodos
);

// Buscar usuário por ID
router.get(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    usuarioController.buscarPorId
);

// Cadastrar usuário (somente administrador)
router.post(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR"),
    usuarioController.criar
);

// Editar usuário (somente administrador)
router.put(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR"),
    usuarioController.atualizar
);

// Ativar ou desativar usuário (somente administrador)
router.patch(
    "/:id/ativo",
    autenticar,
    autorizarPerfil("ADMINISTRADOR"),
    usuarioController.alterarAtivo
);

module.exports = router;