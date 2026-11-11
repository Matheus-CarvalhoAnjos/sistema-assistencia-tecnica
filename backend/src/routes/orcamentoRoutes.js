const express = require("express");
const router = express.Router();

const orcamentoController = require("../controllers/orcamentoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");
const autorizarAcessoOs = require("../middlewares/autorizarAcessoOs");

router.get(
    "/:id_os/orcamentos",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id_os"),
    orcamentoController.listarPorOs
);

router.get(
    "/:id_os/orcamentos/:id_orcamento",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id_os"),
    orcamentoController.buscarPorId
);

router.post(
    "/:id_os/orcamentos",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "TECNICO"),
    orcamentoController.criar
);

module.exports = router;
