
const express = require("express");

const router = express.Router();

const solicitacaoController = require("../controllers/solicitacaoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

// Cadastrar solicitação
router.post(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    solicitacaoController.criar
);

// Listar todas as solicitações (TECNICO não acessa Solicitações)
router.get(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    solicitacaoController.listarTodos
);

// Buscar solicitação pelo ID (TECNICO não acessa Solicitações)
router.get(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    solicitacaoController.buscarPorId
);

module.exports = router;
