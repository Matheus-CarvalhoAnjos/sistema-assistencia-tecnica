const BaseService = require("./BaseService");
const acessorioRepository = require("../repositories/acessorioRepository");

class AcessorioService extends BaseService {
    async listarTodos() {
        return await acessorioRepository.listarTodos();
    }

    async buscarPorId(id) {
        const idAcessorio = this.validarIdPositivo(id, "ID do acessório");

        const acessorio = await acessorioRepository.buscarPorId(idAcessorio);

        if (!acessorio) {
            const erro = new Error("Acessório não encontrado.");
            erro.statusCode = 404;
            throw erro;
        }

        return acessorio;
    }

    async criar(dados) {
        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            const erro = new Error("Os dados do acessório são inválidos.");
            erro.statusCode = 400;
            throw erro;
        }

        const descricao = this.validarTexto(dados.descricao, "Descrição do acessório");

        if (descricao.length > 150) {
            const erro = new Error("A descrição do acessório deve ter no máximo 150 caracteres.");
            erro.statusCode = 400;
            throw erro;
        }

        const acessorioExistente = await acessorioRepository.buscarPorDescricao(descricao);

        if (acessorioExistente) {
            const erro = new Error("Já existe um acessório cadastrado com essa descrição.");
            erro.statusCode = 409;
            throw erro;
        }

        // Preço é opcional: ausente, null ou texto vazio ficam como null (não como zero)
        const precoInformado = dados.preco_atual !== undefined &&
            dados.preco_atual !== null &&
            String(dados.preco_atual).trim() !== "";
        let preco_atual = null;

        if (precoInformado) {
            preco_atual = Number(dados.preco_atual);

            // DECIMAL(10,2): até 99.999.999,99
            if (!Number.isFinite(preco_atual) || preco_atual < 0 || preco_atual > 99999999.99) {
                const erro = new Error("O preço do acessório deve ser um valor numérico maior ou igual a zero.");
                erro.statusCode = 400;
                throw erro;
            }
        }

        const dadosAcessorio = {
            descricao,
            preco_atual,
            ativo: 1
        };

        return await acessorioRepository.criar(dadosAcessorio);
    }
}

module.exports = new AcessorioService();
