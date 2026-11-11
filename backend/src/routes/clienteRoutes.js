
const express = require("express");
const router = express.Router();

const clienteController = require("../controllers/clienteController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

// Listar todos os clientes
router.get(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    clienteController.listarTodos
);

// Buscar cliente pelo ID
router.get(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    clienteController.buscarPorId
);

// Cadastrar um novo cliente
router.post(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    clienteController.criar
);

// Atualizar um cliente
router.put(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    clienteController.atualizar
);

module.exports = router;
