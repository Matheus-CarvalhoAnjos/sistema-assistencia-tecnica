const express = require("express");
const router = express.Router();

const acessorioController = require("../controllers/acessorioController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

router.get(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    acessorioController.listarTodos
);

router.get(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    acessorioController.buscarPorId
);

router.post(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    acessorioController.criar
);

module.exports = router;
