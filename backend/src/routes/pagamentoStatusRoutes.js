const express = require("express");
const router = express.Router();

const pagamentoController = require("../controllers/pagamentoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

router.patch(
    "/:id_pagamento/status",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    pagamentoController.atualizarStatus
);

// RN16: reembolso integral de um pagamento confirmado
router.patch(
    "/:id_pagamento/reembolso",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    pagamentoController.reembolsar
);

module.exports = router;
