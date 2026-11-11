
const clienteRepository = require("../repositories/clienteRepository");

const UFS = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
    "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
    "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Campos de texto obrigatórios com o tamanho máximo da coluna no banco
const CAMPOS_TEXTO = [
    { campo: "nome_razao_social", rotulo: "Nome/razão social", max: 200 },
    { campo: "logradouro", rotulo: "Logradouro", max: 150 },
    { campo: "numero", rotulo: "Número", max: 10 },
    { campo: "bairro", rotulo: "Bairro", max: 100 },
    { campo: "cidade", rotulo: "Cidade", max: 100 }
];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function somenteDigitos(valor) {
    return valor.replace(/\D/g, "");
}

function textoObrigatorio(dados, campo, rotulo) {
    const valor = dados[campo];

    if (valor === undefined || valor === null || (typeof valor === "string" && !valor.trim())) {
        throw erroComStatus(`O campo ${rotulo} é obrigatório.`, 400);
    }

    if (typeof valor !== "string") {
        throw erroComStatus(`O campo ${rotulo} deve ser um texto.`, 400);
    }

    return valor.trim();
}

function limitarTamanho(valor, rotulo, max) {
    if (valor.length > max) {
        throw erroComStatus(`O campo ${rotulo} deve ter no máximo ${max} caracteres.`, 400);
    }

    return valor;
}

/*
 * Valida e normaliza os dados de um cliente (cadastro e edição).
 * Remove máscaras de CPF/CNPJ, CEP e telefone e devolve somente
 * os campos da tabela cliente.
 */
function validarCliente(dados) {
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
        throw erroComStatus("Os dados do cliente são inválidos.", 400);
    }

    const tipo_pessoa = textoObrigatorio(dados, "tipo_pessoa", "Tipo de pessoa").toUpperCase();

    if (!["FISICA", "JURIDICA"].includes(tipo_pessoa)) {
        throw erroComStatus("Tipo de pessoa inválido. Use FISICA ou JURIDICA.", 400);
    }

    const cliente = { tipo_pessoa };

    for (const { campo, rotulo, max } of CAMPOS_TEXTO) {
        cliente[campo] = limitarTamanho(textoObrigatorio(dados, campo, rotulo), rotulo, max);
    }

    // CPF/CNPJ: somente dígitos, 11 para pessoa física e 14 para jurídica
    const documento = somenteDigitos(textoObrigatorio(dados, "cpf_cnpj", "CPF/CNPJ"));

    if (tipo_pessoa === "FISICA" && documento.length !== 11) {
        throw erroComStatus("CPF deve conter 11 dígitos.", 400);
    }

    if (tipo_pessoa === "JURIDICA" && documento.length !== 14) {
        throw erroComStatus("CNPJ deve conter 14 dígitos.", 400);
    }

    cliente.cpf_cnpj = documento;

    // Telefone: somente dígitos, com DDD (10 ou 11 dígitos)
    const telefone = somenteDigitos(textoObrigatorio(dados, "telefone", "Telefone"));

    if (telefone.length < 10 || telefone.length > 11) {
        throw erroComStatus("Telefone deve conter DDD e número (10 ou 11 dígitos).", 400);
    }

    cliente.telefone = telefone;

    // E-mail é opcional (MER v1.4; a coluna aceita NULL). Se informado, o formato é validado.
    if (dados.email === undefined || dados.email === null ||
        (typeof dados.email === "string" && !dados.email.trim())) {
        cliente.email = null;
    } else if (typeof dados.email !== "string") {
        throw erroComStatus("O campo E-mail deve ser um texto.", 400);
    } else {
        const email = limitarTamanho(dados.email.trim().toLowerCase(), "E-mail", 150);

        if (!FORMATO_EMAIL.test(email)) {
            throw erroComStatus("O e-mail informado é inválido.", 400);
        }

        cliente.email = email;
    }

    const cep = somenteDigitos(textoObrigatorio(dados, "cep", "CEP"));

    if (cep.length !== 8) {
        throw erroComStatus("CEP deve conter 8 dígitos.", 400);
    }

    cliente.cep = cep;

    const uf = textoObrigatorio(dados, "uf", "UF").toUpperCase();

    if (!UFS.includes(uf)) {
        throw erroComStatus("UF inválida.", 400);
    }

    cliente.uf = uf;

    // Complemento é opcional: texto vazio vira null
    if (dados.complemento === undefined || dados.complemento === null) {
        cliente.complemento = null;
    } else if (typeof dados.complemento !== "string") {
        throw erroComStatus("O campo Complemento deve ser um texto.", 400);
    } else {
        cliente.complemento = limitarTamanho(dados.complemento.trim(), "Complemento", 100) || null;
    }

    return cliente;
}

// Converte erros de restrição do MySQL em respostas HTTP adequadas
function traduzirErroBanco(erro) {
    if (erro && erro.code === "ER_DUP_ENTRY") {
        return erroComStatus("Já existe um cliente cadastrado com esse CPF/CNPJ.", 409);
    }

    if (erro && erro.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
        return erroComStatus("Os dados do cliente não atendem às regras de cadastro.", 400);
    }

    return erro;
}

async function garantirDocumentoUnico(cpf_cnpj, idIgnorado) {
    const existente = await clienteRepository.buscarPorDocumento(cpf_cnpj, idIgnorado);

    if (existente) {
        throw erroComStatus("Já existe um cliente cadastrado com esse CPF/CNPJ.", 409);
    }
}

/*
 * Busca opcional:
 * - termo só com números e pontuação de documento → prefixo do CPF/CNPJ;
 * - demais termos → parte do nome/razão social;
 * - termo com menos de 2 caracteres → sem filtro.
 */
async function listarTodos(busca) {
    const termo = typeof busca === "string" ? busca.trim() : "";

    if (termo.length < 2) {
        return await clienteRepository.listarTodos();
    }

    if (/^[\d.\-/\s]+$/.test(termo)) {
        const digitos = somenteDigitos(termo);

        if (digitos.length >= 2) {
            return await clienteRepository.listarTodos({ documento: digitos });
        }
    }

    return await clienteRepository.listarTodos({ nome: termo });
}

async function buscarPorId(id) {
    const cliente = await clienteRepository.buscarPorId(id);

    if (!cliente) {
        throw erroComStatus("Cliente não encontrado.", 404);
    }

    return cliente;
}

async function criar(dados) {
    const cliente = validarCliente(dados);

    await garantirDocumentoUnico(cliente.cpf_cnpj);

    try {
        return await clienteRepository.criar(cliente);
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
}

async function atualizar(id, dados) {
    const cliente = validarCliente(dados);

    await buscarPorId(id);
    await garantirDocumentoUnico(cliente.cpf_cnpj, id);

    try {
        return await clienteRepository.atualizar(id, cliente);
    } catch (erro) {
        throw traduzirErroBanco(erro);
    }
}

module.exports = {
    listarTodos,
    buscarPorId,
    criar,
    atualizar,
    validarCliente
};
