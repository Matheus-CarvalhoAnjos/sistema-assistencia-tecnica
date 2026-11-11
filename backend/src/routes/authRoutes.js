const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const limitarLogin = require("../middlewares/limitarLogin");

// Realizar login (com limite de tentativas com falha por IP)
router.post("/login", limitarLogin, authController.login);

// Testar autenticação
router.get("/teste", authMiddleware, (req, res) => {
    return res.status(200).json({
        mensagem: "Autenticação validada com sucesso.",
        usuario: req.usuario
    });
});

module.exports = router;