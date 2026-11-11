const express = require("express");
const router = express.Router();

const acessorioRecebidoController = require("../controllers/acessorioRecebidoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

router.post(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    acessorioRecebidoController.registrar
);

// D7: alteração (sem exclusão). Perfil, etapa e técnico atribuído são conferidos no service/repository
router.patch(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    acessorioRecebidoController.atualizar
);

router.get(
    "/item/:id_item",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    acessorioRecebidoController.listarPorItem
);

module.exports = router;
