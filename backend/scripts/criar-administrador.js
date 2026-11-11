/**
 * Cadastro do PRIMEIRO administrador no banco remoto (TiDB Cloud).
 *
 * Uso (dentro de backend/, em um terminal interativo):
 *   node --env-file=.env.tidb --env-file=.env.tidb.app scripts/criar-administrador.js \
 *        --nome "Nome Completo" --email "pessoa@exemplo.com"
 *
 * - O .env.tidb.app vem por último e define o usuário da APLICAÇÃO (assistencia_app):
 *   o script recusa o root e qualquer outro usuário.
 * - A senha é pedida no terminal, sem eco, duas vezes. Nunca é aceita por argumento,
 *   arquivo ou variável de ambiente, e nunca aparece em logs ou mensagens de erro.
 * - O cadastro é feito por usuarioService.criar(): mesmas validações (nome, e-mail
 *   normalizado e sem duplicidade, senha de 8 a 72 bytes), bcrypt custo 10 e gravação
 *   pelo usuarioRepository. O perfil é sempre ADMINISTRADOR.
 * - Interrompe sem gravar se já houver administrador ativo ou se o e-mail já existir.
 *   Não atualiza, não exclui e não recupera contas.
 */
const usuarioService = require("../src/services/usuarioService");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const { pool } = require("../src/config/database");

const BANCO_ESPERADO = "assistencia_tecnica";
const USUARIO_APP = "assistencia_app";
const PERFIL = "ADMINISTRADOR";
const MAX_TENTATIVAS_SENHA = 3;

class Interrupcao extends Error {}

function interromper(mensagem) {
    throw new Interrupcao(mensagem);
}

/** Lê --nome e --email da linha de comando (nenhum outro parâmetro é aceito). */
function lerArgumentos(argv) {
    const permitidos = new Set(["--nome", "--email"]);
    const valores = {};

    for (let i = 0; i < argv.length; i += 2) {
        const chave = argv[i];
        if (!permitidos.has(chave)) {
            interromper(`Parâmetro não aceito: ${chave}. Use apenas --nome e --email (a senha é pedida no terminal).`);
        }
        const valor = argv[i + 1];
        if (typeof valor !== "string" || valor.startsWith("--")) {
            interromper(`Informe um valor para ${chave}.`);
        }
        valores[chave.slice(2)] = valor;
    }

    if (!valores.nome || !valores.email) {
        interromper('Uso: --nome "Nome Completo" --email "pessoa@exemplo.com"');
    }

    return valores;
}

/** Pede um texto no terminal sem exibir os caracteres digitados. */
function perguntarOculto(pergunta) {
    return new Promise((resolve, reject) => {
        const entrada = process.stdin;
        let valor = "";

        process.stdout.write(pergunta);
        entrada.setRawMode(true);
        entrada.resume();
        entrada.setEncoding("utf8");

        const encerrar = () => {
            entrada.setRawMode(false);
            entrada.pause();
            entrada.removeListener("data", aoDigitar);
            process.stdout.write("\n");
        };

        function aoDigitar(bloco) {
            for (const caractere of bloco) {
                if (caractere === "\r" || caractere === "\n") {
                    encerrar();
                    return resolve(valor);
                }
                if (caractere === "\u0003") { // Ctrl+C
                    encerrar();
                    return reject(new Interrupcao("Cancelado pelo usuário. Nada foi gravado."));
                }
                if (caractere === "\u0008" || caractere === "\u007f") { // Backspace
                    valor = valor.slice(0, -1);
                    continue;
                }
                if (caractere >= " ") {
                    valor += caractere;
                }
            }
        }

        entrada.on("data", aoDigitar);
    });
}

/** Verificações de ambiente e de estado antes de qualquer gravação (somente leitura). */
async function verificarAmbiente(emailNormalizado) {
    const host = process.env.DB_HOST || "";
    if (!/\.tidbcloud\.com$/i.test(host)) {
        interromper("A conexão não aponta para o TiDB Cloud. Use --env-file=.env.tidb --env-file=.env.tidb.app.");
    }
    if (String(process.env.DB_SSL).toLowerCase() !== "true"
        || String(process.env.DB_SSL_REJECT_UNAUTHORIZED).toLowerCase() === "false") {
        interromper("O TLS com verificação de certificado precisa estar ativo (DB_SSL=true).");
    }
    if (process.env.DB_NAME !== BANCO_ESPERADO) {
        interromper(`DB_NAME deve ser ${BANCO_ESPERADO}.`);
    }

    let estado;
    try {
        const [[linha]] = await pool.query(
            "SELECT DATABASE() AS banco, CURRENT_USER() AS usuario, VERSION() AS versao"
        );
        const [ssl] = await pool.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
        estado = { ...linha, cifra: ssl[0]?.Value };
    } catch (erro) {
        interromper(`Não foi possível conectar ao banco (${erro.code || "erro de conexão"}). Nada foi gravado.`);
    }

    if (estado.banco !== BANCO_ESPERADO) interromper(`Banco conectado não é ${BANCO_ESPERADO}.`);
    if (!/TiDB/i.test(estado.versao)) interromper("O servidor conectado não é TiDB.");
    if (!estado.cifra) interromper("A conexão não está usando TLS.");

    const nomeUsuario = String(estado.usuario).split("@")[0];
    if (!nomeUsuario.endsWith(`.${USUARIO_APP}`)) {
        interromper(`A conexão deve usar o usuário da aplicação (${USUARIO_APP}), não ${nomeUsuario.endsWith(".root") ? "o root" : "outro usuário"}.`);
    }

    const [[admins]] = await pool.query(
        "SELECT COUNT(*) AS total FROM usuario WHERE perfil = 'ADMINISTRADOR' AND ativo = 1"
    );
    if (Number(admins.total) > 0) {
        interromper("Já existe administrador ativo. Novos usuários devem ser criados pelo sistema. Nada foi gravado.");
    }

    if (await usuarioRepository.buscarPorEmail(emailNormalizado)) {
        interromper("Já existe um usuário com esse e-mail. A conta não foi alterada. Nada foi gravado.");
    }

    console.log(`Ambiente conferido: TiDB Cloud, banco ${BANCO_ESPERADO}, usuário ${USUARIO_APP}, TLS ativo.`);
    console.log("Nenhum administrador ativo e e-mail disponível.\n");
}

async function executar() {
    if (!process.stdin.isTTY) {
        interromper("Execute em um terminal interativo: a senha é digitada sem exibição.");
    }

    const { nome, email } = lerArgumentos(process.argv.slice(2));
    // Mesma normalização que usuarioService.criar() aplica antes de procurar duplicidade
    const emailNormalizado = email.trim().toLowerCase();

    await verificarAmbiente(emailNormalizado);

    console.log(`Cadastro do administrador: ${nome.trim()} <${emailNormalizado}>`);

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_SENHA; tentativa++) {
        let senha = await perguntarOculto("Senha (8 a 72 caracteres): ");
        const confirmacao = await perguntarOculto("Confirme a senha: ");

        if (senha !== confirmacao) {
            senha = null;
            console.log("As senhas não conferem.\n");
            continue;
        }

        try {
            // Toda a validação, o hash e a gravação ficam com o service existente
            const usuario = await usuarioService.criar({ nome, email, senha, perfil: PERFIL });
            senha = null;

            console.log("\nAdministrador cadastrado:");
            console.log(`  ID:     ${usuario.id_usuario}`);
            console.log(`  Nome:   ${usuario.nome}`);
            console.log(`  E-mail: ${usuario.email}`);
            console.log(`  Perfil: ${usuario.perfil}`);
            return;
        } catch (erro) {
            senha = null;
            const ehErroDeSenha = erro.statusCode === 400 && /senha/i.test(erro.message);

            if (ehErroDeSenha && tentativa < MAX_TENTATIVAS_SENHA) {
                console.log(`${erro.message} Tente novamente.\n`);
                continue;
            }
            if (erro.statusCode) {
                // Mensagens do service: não contêm senha nem hash
                interromper(`${erro.message} Nada foi gravado.`);
            }
            if (erro.code === "ER_DUP_ENTRY") {
                interromper("Já existe um usuário com esse e-mail. Nada foi gravado.");
            }
            interromper(`Falha ao gravar no banco (${erro.code || "erro inesperado"}). Confira o banco antes de tentar de novo.`);
        }
    }

    interromper("Número máximo de tentativas de senha atingido. Nada foi gravado.");
}

executar()
    .catch((erro) => {
        // Só mensagens próprias são exibidas; erros inesperados mostram apenas o código
        const mensagem = erro instanceof Interrupcao
            ? erro.message
            : `Erro inesperado (${erro.code || erro.name}). Nada foi exibido do conteúdo por segurança.`;
        console.error(`\nINTERROMPIDO: ${mensagem}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end().catch(() => {}));
