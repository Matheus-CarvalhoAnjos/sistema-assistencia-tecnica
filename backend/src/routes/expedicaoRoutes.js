const express = require("express");
const router = express.Router();

const expedicaoController = require("../controllers/expedicaoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");
const autorizarAcessoOs = require("../middlewares/autorizarAcessoOs");

router.get(
    "/:id_os/expedicao",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id_os"),
    expedicaoController.buscarPorOs
);

router.post(
    "/:id_os/expedicao",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    expedicaoController.criar
);

module.exports = router;
