const express = require("express");
const router = express.Router();

const orcamentoController = require("../controllers/orcamentoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

router.patch(
    "/:id_orcamento/resposta",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    orcamentoController.responder
);

module.exports = router;
