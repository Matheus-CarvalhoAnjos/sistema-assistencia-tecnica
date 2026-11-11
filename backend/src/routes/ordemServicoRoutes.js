const express = require("express");
const router = express.Router();

const ordemServicoController = require("../controllers/ordemServicoController");
const autenticar = require("../middlewares/authMiddleware");
const autorizarPerfil = require("../middlewares/autorizarPerfil");
const autorizarAcessoOs = require("../middlewares/autorizarAcessoOs");

router.post(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    ordemServicoController.criarParaItem
);

router.get(
    "/",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    ordemServicoController.listarTodos
);

router.get(
    "/:id",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.buscarPorId
);

router.patch(
    "/:id/tecnico",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE"),
    ordemServicoController.atribuirTecnico
);

// Garantia (RN05): somente o técnico atribuído verifica e corrige; OS de outro técnico → 404.
// ADMINISTRADOR e ATENDENTE apenas consultam a garantia nos detalhes da OS.
router.patch(
    "/:id/garantia",
    autenticar,
    autorizarPerfil("TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.atualizarGarantia
);

// Encerramento sem reparo (RN07/RN08): o service confere tipo, perfil e etapa da OS
router.patch(
    "/:id/encerramento",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.encerrarSemReparo
);

// Histórico (RN21): somente consulta; não há rota de alteração ou exclusão
router.get(
    "/:id/historico",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.listarHistorico
);

router.get(
    "/:id/acessorios",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.listarAcessoriosRecebidos
);

router.post(
    "/:id/acessorios",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.registrarAcessoriosRecebidos
);

// D7: alteração de um acessório do equipamento desta OS (sem exclusão)
router.patch(
    "/:id/acessorios/:id_acessorio_recebido",
    autenticar,
    autorizarPerfil("ADMINISTRADOR", "ATENDENTE", "TECNICO"),
    autorizarAcessoOs("id"),
    ordemServicoController.alterarAcessorioRecebido
);

module.exports = router;
