const express = require("express");

const abatimentoController = require("../controllers/abatimentoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");

// R1 — abatimento formal: dado financeiro, somente ADMINISTRADOR e ATENDENTE (A2, C1, C2).
// Não há rota de alteração nem de exclusão: correção = cancelamento com justificativa (A5).

// Montado em /api/ordens-servico
const porOs = express.Router();

porOs.get(
    "/:id_os/abatimentos",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    abatimentoController.listarPorOs
);

porOs.post(
    "/:id_os/abatimentos",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    abatimentoController.registrar
);

// Montado em /api/abatimentos
const porAbatimento = express.Router();

porAbatimento.patch(
    "/:id_abatimento/cancelamento",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    abatimentoController.cancelar
);

module.exports = { porOs, porAbatimento };
