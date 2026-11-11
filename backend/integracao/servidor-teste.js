/*
 * Inicia a API apontando para o banco de TESTES (nunca para o banco principal).
 * Uso: node integracao/servidor-teste.js   (ou a configuração "backend-teste" do .claude/launch.json)
 *
 * O banco usado é DB_NAME_TESTE ou "<DB_NAME>_teste". O nome precisa terminar em "_teste".
 * Prepare o banco antes (por exemplo, com MANTER_BANCO_TESTE=1 npm run test:integracao).
 */
const path = require("node:path");

// Carrega backend/.env mesmo quando o processo é iniciado a partir de outra pasta
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const bancoReal = process.env.DB_NAME;
const bancoTeste = process.env.DB_NAME_TESTE || `${bancoReal}_teste`;

if (!bancoReal || !/_teste$/.test(bancoTeste) || bancoTeste === bancoReal) {
    console.error(`Banco de testes inválido (${bancoTeste}). O nome precisa terminar em "_teste".`);
    process.exit(1);
}

// dotenv não sobrescreve variáveis já definidas: a aplicação passa a usar o banco de testes
process.env.DB_NAME = bancoTeste;
console.log(`API em modo de teste, usando o banco "${bancoTeste}".`);

require("../src/server");
