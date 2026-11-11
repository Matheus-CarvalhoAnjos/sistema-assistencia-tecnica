
const express = require("express");
const cors = require("cors");
const app = express();

// S4: não anunciar a tecnologia do servidor
app.disable("x-powered-by");

// Na Vercel a requisição chega por um proxy que grava o IP real do cliente em
// X-Forwarded-For; confiar em um salto permite ao limitador de login identificar o IP.
// Fora da Vercel (sem proxy) o cabeçalho continua sendo ignorado.
if (process.env.VERCEL) {
    app.set("trust proxy", 1);
}

// S4: cabeçalhos básicos de segurança (API JSON; sem dependência adicional)
app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-site",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
    });
    next();
});

const clienteRoutes = require("./routes/clienteRoutes");
const usuarioRoutes = require("./routes/usuarioRoutes");
const authRoutes = require("./routes/authRoutes");
const solicitacaoRoutes = require("./routes/solicitacaoRoutes");
const ordemServicoRoutes = require("./routes/ordemServicoRoutes");
const acessorioRoutes = require("./routes/acessorioRoutes");
const acessorioRecebidoRoutes = require("./routes/acessorioRecebidoRoutes");
const execucaoRoutes = require("./routes/execucaoRoutes");
const orcamentoRoutes = require("./routes/orcamentoRoutes");
const respostaOrcamentoRoutes = require("./routes/respostaOrcamentoRoutes");
const pagamentoRoutes = require("./routes/pagamentoRoutes");
const avaliacaoReembolsoRoutes = require("./routes/avaliacaoReembolsoRoutes");
const abatimentoRoutes = require("./routes/abatimentoRoutes");
const pagamentoStatusRoutes = require("./routes/pagamentoStatusRoutes");
const expedicaoRoutes = require("./routes/expedicaoRoutes");
const expedicaoStatusRoutes = require("./routes/expedicaoStatusRoutes");

// Permitir requisições do frontend Angular (origens separadas por vírgula em CORS_ORIGIN)
const origensPermitidas = (process.env.CORS_ORIGIN || "http://localhost:4200")
    .split(",")
    .map(origem => origem.trim())
    .filter(Boolean);

app.use(cors({
    origin: origensPermitidas,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// Permitir que a API receba dados em JSON
app.use(express.json());


// Rota principal para verificar se a API está funcionando
app.get("/", (req, res) => {
    res.send("API do sistema de assistência técnica está funcionando!");
});

// Rotas de clientes
app.use("/api/clientes", clienteRoutes);
app.use("/api/usuarios", usuarioRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/solicitacoes", solicitacaoRoutes);
app.use("/api/ordens-servico", ordemServicoRoutes);
app.use("/api/ordens-servico", execucaoRoutes);
app.use("/api/ordens-servico", orcamentoRoutes);
app.use("/api/orcamentos", respostaOrcamentoRoutes);
app.use("/api/ordens-servico", pagamentoRoutes);
app.use("/api/ordens-servico", avaliacaoReembolsoRoutes);
app.use("/api/ordens-servico", abatimentoRoutes.porOs);
app.use("/api/abatimentos", abatimentoRoutes.porAbatimento);
app.use("/api/pagamentos", pagamentoStatusRoutes);
app.use("/api/ordens-servico", expedicaoRoutes);
app.use("/api/expedicoes", expedicaoStatusRoutes);
app.use("/api/acessorios", acessorioRoutes);
app.use("/api/acessorios-recebidos", acessorioRecebidoRoutes);

// S4: rota inexistente responde em JSON, como o restante da API
app.use((req, res) => {
    res.status(404).json({ mensagem: "Rota não encontrada." });
});

// Erros do leitor de JSON (express.json): mensagens padronizadas, sem detalhes do parser
const ERROS_CORPO = {
    "entity.parse.failed": [400, "O corpo da requisição não é um JSON válido."],
    "entity.too.large": [413, "O corpo da requisição excede o tamanho máximo permitido."],
    "encoding.unsupported": [415, "Codificação do corpo da requisição não suportada."],
    "charset.unsupported": [415, "Codificação do corpo da requisição não suportada."]
};

// Tratamento centralizado de erros
app.use((erro, req, res, next) => {
    const erroCorpo = ERROS_CORPO[erro.type];
    if (erroCorpo) {
        return res.status(erroCorpo[0]).json({ mensagem: erroCorpo[1] });
    }

    console.error(erro);

    const statusCode = erro.statusCode || 500;

    res.status(statusCode).json({
        mensagem: statusCode === 500
            ? "Ocorreu um erro interno no servidor."
            : erro.message
    });
});

module.exports = app;
