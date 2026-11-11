const { rateLimit } = require("express-rate-limit");

// Limitar tentativas de login por IP para dificultar força bruta.
// Apenas tentativas com falha contam para o limite.
const limitarLogin = rateLimit({
    windowMs: Number(process.env.LOGIN_LIMITE_JANELA_MIN || 15) * 60 * 1000,
    limit: Number(process.env.LOGIN_LIMITE_TENTATIVAS || 5),
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res, next, options) => {
        return res.status(options.statusCode).json({
            mensagem: "Muitas tentativas de login. Tente novamente mais tarde."
        });
    }
});

module.exports = limitarLogin;
