const express = require("express");
const router = express.Router();

const pagamentoController = require("../controllers/pagamentoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");
const autorizarAcessoOs = require("../middlewares/autorizarAcessoOs");

// Dados financeiros: somente ADMINISTRADOR e ATENDENTE (o técnico não precisa deles na sua função; P3)
router.get(
    "/:id_os/pagamentos",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    autorizarAcessoOs("id_os"),
    pagamentoController.listarPorOs
);

router.post(
    "/:id_os/pagamentos",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    pagamentoController.criar
);

module.exports = router;
