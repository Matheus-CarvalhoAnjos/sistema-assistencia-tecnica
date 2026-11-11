
const clienteService = require("../services/clienteService");

// Validar o ID recebido na URL
function lerId(req, res) {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({
            mensagem: "O ID informado deve ser um número inteiro positivo."
        });
        return null;
    }

    return id;
}

// Listar clientes (com busca opcional por nome ou CPF/CNPJ: ?busca=)
async function listarTodos(req, res, next) {
    try {
        const clientes = await clienteService.listarTodos(req.query.busca);

        return res.status(200).json(clientes);
    } catch (erro) {
        next(erro);
    }
}

// Buscar um cliente pelo ID
async function buscarPorId(req, res, next) {
    try {
        const id = lerId(req, res);

        if (id === null) {
            return;
        }

        const cliente = await clienteService.buscarPorId(id);

        return res.status(200).json(cliente);
    } catch (erro) {
        next(erro);
    }
}

// Cadastrar um novo cliente
async function criar(req, res, next) {
    try {
        const novoCliente = await clienteService.criar(req.body);

        return res.status(201).json({
            mensagem: "Cliente cadastrado com sucesso.",
            cliente: novoCliente
        });
    } catch (erro) {
        next(erro);
    }
}

// Atualizar os dados de um cliente
async function atualizar(req, res, next) {
    try {
        const id = lerId(req, res);

        if (id === null) {
            return;
        }

        const cliente = await clienteService.atualizar(id, req.body);

        return res.status(200).json({
            mensagem: "Cliente atualizado com sucesso.",
            cliente
        });
    } catch (erro) {
        next(erro);
    }
}

module.exports = {
    listarTodos,
    buscarPorId,
    criar,
    atualizar
};
