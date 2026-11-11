const express = require("express");
const router = express.Router();

const avaliacaoReembolsoController = require("../controllers/avaliacaoReembolsoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

// Avaliação financeira (D1–D4): dado financeiro, somente ADMINISTRADOR e ATENDENTE (R8, P3).
// Não há rota de alteração nem de exclusão: correção = revisão (D2).
router.get(
    "/:id_os/avaliacao-financeira",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    avaliacaoReembolsoController.consultar
);

router.post(
    "/:id_os/avaliacao-financeira",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    avaliacaoReembolsoController.registrar
);

router.post(
    "/:id_os/avaliacao-financeira/revisoes",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    avaliacaoReembolsoController.revisar
);

module.exports = router;
