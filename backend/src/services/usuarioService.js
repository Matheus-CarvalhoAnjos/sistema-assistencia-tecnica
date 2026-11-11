
const usuarioRepository = require("../repositories/usuarioRepository");
const bcrypt = require("bcrypt");

// Política mínima de senha (S5): vale para o cadastro e para a definição de nova senha.
// O login não aplica a regra, para não bloquear contas já existentes.
const SENHA_TAMANHO_MINIMO = 8;
const SENHA_TAMANHO_MAXIMO = 72; // limite efetivo do bcrypt (bytes)

function validarNovaSenha(senha) {
    if (senha.length < SENHA_TAMANHO_MINIMO) {
        const erro = new Error(`A senha deve ter pelo menos ${SENHA_TAMANHO_MINIMO} caracteres.`);
        erro.statusCode = 400;
        throw erro;
    }
    if (Buffer.byteLength(senha, "utf8") > SENHA_TAMANHO_MAXIMO) {
        const erro = new Error(`A senha deve ter no máximo ${SENHA_TAMANHO_MAXIMO} caracteres.`);
        erro.statusCode = 400;
        throw erro;
    }
}

// Listar todos os usuários
// Filtros opcionais: ?perfil=TECNICO&ativo=1 (usado para escolher o técnico de uma OS)
async function listarTodos(consulta = {}) {
    const filtros = {};

    if (consulta.perfil) {
        const perfil = String(consulta.perfil).toUpperCase();

        if (!["ADMINISTRADOR", "ATENDENTE", "TECNICO"].includes(perfil)) {
            const erro = new Error("Perfil inválido. Use ADMINISTRADOR, ATENDENTE ou TECNICO.");
            erro.statusCode = 400;
            throw erro;
        }

        filtros.perfil = perfil;
    }

    if (consulta.ativo !== undefined && consulta.ativo !== "") {
        if (!["0", "1"].includes(String(consulta.ativo))) {
            const erro = new Error("O filtro ativo deve ser 0 ou 1.");
            erro.statusCode = 400;
            throw erro;
        }

        filtros.ativo = Number(consulta.ativo);
    }

    return await usuarioRepository.listarTodos(filtros);
}

// Buscar usuário pelo ID
async function buscarPorId(id) {
    const usuario = await usuarioRepository.buscarPorId(id);

    if (!usuario) {
        const erro = new Error("Usuário não encontrado.");
        erro.statusCode = 404;
        throw erro;
    }

    return usuario;
}

// Cadastrar usuário
async function criar(dados) {
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
        const erro = new Error("Os dados do usuário são inválidos.");
        erro.statusCode = 400;
        throw erro;
    }

    const {
        nome,
        email,
        senha,
        perfil
    } = dados;

    // Verificar campos obrigatórios
    if (!nome || !email || !senha || !perfil) {
        const erro = new Error(
            "Nome, e-mail, senha e perfil são obrigatórios."
        );
        erro.statusCode = 400;
        throw erro;
    }

    // Verificar se os campos são textos
    if (
        typeof nome !== "string" ||
        typeof email !== "string" ||
        typeof senha !== "string" ||
        typeof perfil !== "string"
    ) {
        const erro = new Error(
            "Os campos informados devem possuir valores válidos."
        );
        erro.statusCode = 400;
        throw erro;
    }

    const nomeFormatado = nome.trim();
    const emailFormatado = email.trim().toLowerCase();

    if (!nomeFormatado || !emailFormatado || !senha.trim()) {
        const erro = new Error(
            "Nome, e-mail e senha não podem estar vazios."
        );
        erro.statusCode = 400;
        throw erro;
    }

    validarNovaSenha(senha);

    // Validar formato básico do e-mail
    const formatoEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formatoEmail.test(emailFormatado)) {
        const erro = new Error("O e-mail informado é inválido.");
        erro.statusCode = 400;
        throw erro;
    }

    // Validar perfil
    const perfisPermitidos = [
        "ADMINISTRADOR",
        "ATENDENTE",
        "TECNICO"
    ];

    if (!perfisPermitidos.includes(perfil)) {
        const erro = new Error(
            "Perfil inválido. Use ADMINISTRADOR, ATENDENTE ou TECNICO."
        );
        erro.statusCode = 400;
        throw erro;
    }

    // Verificar e-mail duplicado
    const usuarioExistente =
        await usuarioRepository.buscarPorEmail(emailFormatado);

    if (usuarioExistente) {
        const erro = new Error(
            "Já existe um usuário cadastrado com esse e-mail."
        );
        erro.statusCode = 409;
        throw erro;
    }

    // Gerar hash da senha
    const senhaHash = await bcrypt.hash(senha, 10);

    // Preparar dados para o cadastro
    const dadosUsuario = {
        nome: nomeFormatado,
        email: emailFormatado,
        senha_hash: senhaHash,
        perfil: perfil,
        ativo: 1
    };

    return await usuarioRepository.criar(dadosUsuario);
}

const PERFIS = ["ADMINISTRADOR", "ATENDENTE", "TECNICO"];
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function validarId(id) {
    const numero = Number(id);

    if (!Number.isInteger(numero) || numero <= 0) {
        throw erroComStatus("ID de usuário inválido.", 400);
    }

    return numero;
}

// Gestão de usuários: somente ADMINISTRADOR (a rota também confere)
function exigirAdministrador(usuarioLogado) {
    if (!usuarioLogado || usuarioLogado.perfil !== "ADMINISTRADOR") {
        throw erroComStatus("Somente o administrador pode gerenciar usuários.", 403);
    }
}

// Editar nome, e-mail, perfil e, opcionalmente, definir uma nova senha (gravada como hash)
async function atualizar(id, dados, usuarioLogado) {
    exigirAdministrador(usuarioLogado);
    const idUsuario = validarId(id);

    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
        throw erroComStatus("Os dados do usuário são inválidos.", 400);
    }

    const { nome, email, perfil, senha } = dados;

    if (typeof nome !== "string" || typeof email !== "string" || typeof perfil !== "string" || !nome.trim() || !email.trim()) {
        throw erroComStatus("Nome, e-mail e perfil são obrigatórios.", 400);
    }

    const nomeFormatado = nome.trim();
    const emailFormatado = email.trim().toLowerCase();

    if (nomeFormatado.length > 100 || emailFormatado.length > 150) {
        throw erroComStatus("Nome (até 100 caracteres) ou e-mail (até 150 caracteres) muito longo.", 400);
    }

    if (!FORMATO_EMAIL.test(emailFormatado)) {
        throw erroComStatus("O e-mail informado é inválido.", 400);
    }

    if (!PERFIS.includes(perfil)) {
        throw erroComStatus("Perfil inválido. Use ADMINISTRADOR, ATENDENTE ou TECNICO.", 400);
    }

    let senhaHash = null;

    if (senha !== undefined && senha !== null && senha !== "") {
        if (typeof senha !== "string" || !senha.trim()) {
            throw erroComStatus("A nova senha não pode estar vazia.", 400);
        }
        validarNovaSenha(senha);
        senhaHash = await bcrypt.hash(senha, 10);
    }

    return await usuarioRepository.atualizar(idUsuario, {
        nome: nomeFormatado,
        email: emailFormatado,
        perfil,
        senha_hash: senhaHash
    });
}

// Ativar ou desativar; o sistema nunca fica sem administrador ativo
async function alterarAtivo(id, dados, usuarioLogado) {
    exigirAdministrador(usuarioLogado);
    const idUsuario = validarId(id);

    if (!dados || typeof dados.ativo !== "boolean") {
        throw erroComStatus("Informe ativo como true ou false.", 400);
    }

    return await usuarioRepository.alterarAtivo(idUsuario, dados.ativo ? 1 : 0);
}

module.exports = {
    listarTodos,
    buscarPorId,
    criar,
    atualizar,
    alterarAtivo
};
