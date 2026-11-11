// Ponto de entrada da API na Vercel (Vercel Functions).
// A aplicação Express completa é exportada como handler; o vercel.json encaminha
// todas as rotas para esta função. Localmente, continue usando "npm start" (src/server.js).
module.exports = require("../src/app");
