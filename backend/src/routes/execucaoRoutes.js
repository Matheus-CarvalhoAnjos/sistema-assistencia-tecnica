const express = require("express");
const router = express.Router();

const execucaoController = require("../controllers/execucaoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");
const autorizarAcessoOs = require("../middlewares/autorizarAcessoOs");

router.get(
    "/:id_os/execucao",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id_os"),
    execucaoController.buscarPorOs
);

// Diagnóstico: somente o técnico atribuído (o service confere a atribuição)
router.post(
    "/:id_os/execucao",
    autenticar,
    autorizarPerfil("TECNICO"),
    execucaoController.registrar
);

router.patch(
    "/:id_os/execucao",
    autenticar,
    autorizarPerfil("TECNICO"),
    execucaoController.atualizar
);

router.patch(
    "/:id_os/execucao/concluir",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "TECNICO"),
    execucaoController.concluirReparo
);

module.exports = router;
