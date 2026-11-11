const express = require("express");
const router = express.Router();

const expedicaoController = require("../controllers/expedicaoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

router.patch(
    "/:id_os/status",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    expedicaoController.atualizarStatus
);

module.exports = router;
