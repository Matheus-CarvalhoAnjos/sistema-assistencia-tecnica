const BaseService = require("./BaseService");
const acessorioRecebidoRepository = require("../repositories/acessorioRecebidoRepository");
const acessorioRepository = require("../repositories/acessorioRepository");
const ordemServicoRepository = require("../repositories/ordemServicoRepository");

const MAX_QUANTIDADE = 2147483647; // acessorio_recebido.quantidade INT
const MAX_BYTES_TEXT = 65535; // acessorio_recebido.observacoes TEXT

// O TÉCNICO só acessa equipamentos que tenham uma OS atribuída a ele.
// Para os demais, responde 404 sem revelar que o equipamento existe.
async function verificarAcessoItem(id_item, usuario) {
    if (String(usuario?.perfil ?? "").toUpperCase() !== "TECNICO") {
        return;
    }

    const permitido = await ordemServicoRepository.existeOsDoTecnicoParaItem(
        id_item,
        Number(usuario.id_usuario)
    );

    if (!permitido) {
        const erro = new Error("Item da solicitação não encontrado.");
        erro.statusCode = 404;
        throw erro;
    }
}

class AcessorioRecebidoService extends BaseService {
    async listarPorItem(id_item, usuario) {
        const idItem = this.validarIdPositivo(id_item, "ID do item");

        await verificarAcessoItem(idItem, usuario);

        return await acessorioRecebidoRepository.listarPorItem(idItem);
    }

    /**
     * D7 (P4): ADMINISTRADOR e ATENDENTE em qualquer OS ativa; TÉCNICO só na OS atribuída a ele;
     * bloqueado a partir de CONCLUIDA. Etapa e técnico são conferidos de novo no repository,
     * dentro da transação. Cada inclusão gera evento ACESSORIO no histórico da OS.
     * @param opcoes { id_os } quando a inclusão vem da rota da OS
     */
    async registrar(dados, usuario, opcoes = {}) {
        const registros = Array.isArray(dados) ? dados : [dados];

        if (registros.length === 0) {
            const erro = new Error("Informe ao menos um acessório recebido.");
            erro.statusCode = 400;
            throw erro;
        }

        // 1. Valida TODOS os registros antes de gravar qualquer um
        const validados = [];

        for (const item of registros) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                const erro = new Error("Cada acessório recebido deve ser um objeto válido.");
                erro.statusCode = 400;
                throw erro;
            }

            const id_item = this.validarIdPositivo(item.id_item, "ID do item");
            const id_acessorio = this.validarIdPositivo(item.id_acessorio, "ID do acessório");
            const quantidade = Number(item.quantidade ?? 1);

            if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > MAX_QUANTIDADE) {
                const erro = new Error("A quantidade do acessório deve ser um número inteiro maior que zero.");
                erro.statusCode = 400;
                throw erro;
            }

            let observacoes = null;
            if (item.observacoes !== undefined && item.observacoes !== null) {
                if (typeof item.observacoes !== "string") {
                    const erro = new Error("As observações do acessório devem ser um texto.");
                    erro.statusCode = 400;
                    throw erro;
                }
                observacoes = item.observacoes.trim() || null;
                if (observacoes && Buffer.byteLength(observacoes, "utf8") > MAX_BYTES_TEXT) {
                    const erro = new Error(`As observações excedem o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`);
                    erro.statusCode = 400;
                    throw erro;
                }
            }

            const itemExiste = await acessorioRecebidoRepository.verificarItemExiste(id_item);

            if (!itemExiste) {
                const erro = new Error("Item da solicitação não encontrado.");
                erro.statusCode = 404;
                throw erro;
            }

            await verificarAcessoItem(id_item, usuario);

            const acessorio = await acessorioRepository.buscarPorId(id_acessorio);

            if (!acessorio) {
                const erro = new Error("Acessório não encontrado.");
                erro.statusCode = 404;
                throw erro;
            }

            // MER v1.4: "ativo" indica se o acessório pode ser selecionado (mesma regra da abertura)
            if (!acessorio.ativo) {
                const erro = new Error(`O acessório ${acessorio.descricao} está inativo.`);
                erro.statusCode = 409;
                throw erro;
            }

            validados.push({ id_item, id_acessorio, descricao_acessorio: acessorio.descricao, quantidade, observacoes });
        }

        // 2. Grava todos em uma única transação (sem gravação parcial), com o histórico
        const resultados = await acessorioRecebidoRepository.criarVarios(validados, {
            id_usuario: usuario?.id_usuario ?? null,
            perfil: usuario?.perfil,
            id_os: opcoes.id_os
        });

        return resultados.length === 1 ? resultados[0] : resultados;
    }

    /**
     * D7: alteração de um acessório recebido (quantidade, observações ou o acessório do catálogo).
     * Mesmas regras da inclusão; etapa e técnico são conferidos de novo no repository, com a OS
     * bloqueada. Não há exclusão (não aprovada).
     * @param opcoes { id_os } quando a alteração vem da rota da OS
     */
    async atualizar(id_acessorio_recebido, dados, usuario, opcoes = {}) {
        const id = this.validarIdPositivo(id_acessorio_recebido, "ID do acessório recebido");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            const erro = new Error("Os dados do acessório recebido são inválidos.");
            erro.statusCode = 400;
            throw erro;
        }

        const campos = ["id_acessorio", "quantidade", "observacoes"].filter((c) => dados[c] !== undefined);

        if (campos.length === 0) {
            const erro = new Error("Informe o acessório, a quantidade ou as observações a alterar.");
            erro.statusCode = 400;
            throw erro;
        }

        const registro = await acessorioRecebidoRepository.buscarPorId(id);

        // Pela rota da OS, o acessório precisa ser do equipamento dessa OS
        if (!registro || (opcoes.id_item !== undefined && Number(registro.id_item) !== Number(opcoes.id_item))) {
            const erro = new Error("Acessório recebido não encontrado.");
            erro.statusCode = 404;
            throw erro;
        }

        // Técnico sem relação com o equipamento: 404, sem revelar que o registro existe
        await verificarAcessoItem(registro.id_item, usuario);

        const alteracao = {};

        if (dados.quantidade !== undefined) {
            const quantidade = Number(dados.quantidade);
            if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > MAX_QUANTIDADE) {
                const erro = new Error("A quantidade do acessório deve ser um número inteiro maior que zero.");
                erro.statusCode = 400;
                throw erro;
            }
            alteracao.quantidade = quantidade;
        }

        if (dados.observacoes !== undefined) {
            if (dados.observacoes !== null && typeof dados.observacoes !== "string") {
                const erro = new Error("As observações do acessório devem ser um texto.");
                erro.statusCode = 400;
                throw erro;
            }
            const observacoes = dados.observacoes === null ? null : dados.observacoes.trim() || null;
            if (observacoes && Buffer.byteLength(observacoes, "utf8") > MAX_BYTES_TEXT) {
                const erro = new Error(`As observações excedem o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`);
                erro.statusCode = 400;
                throw erro;
            }
            alteracao.observacoes = observacoes;
        }

        if (dados.id_acessorio !== undefined) {
            const idAcessorio = this.validarIdPositivo(dados.id_acessorio, "ID do acessório");
            if (idAcessorio !== Number(registro.id_acessorio)) {
                const acessorio = await acessorioRepository.buscarPorId(idAcessorio);
                if (!acessorio) {
                    const erro = new Error("Acessório não encontrado.");
                    erro.statusCode = 404;
                    throw erro;
                }
                // Mesma regra da inclusão: só acessórios ativos podem ser escolhidos
                if (!acessorio.ativo) {
                    const erro = new Error(`O acessório ${acessorio.descricao} está inativo.`);
                    erro.statusCode = 409;
                    throw erro;
                }
                alteracao.id_acessorio = idAcessorio;
                alteracao.descricao_acessorio = acessorio.descricao;
            }
        }

        return await acessorioRecebidoRepository.atualizar(id, alteracao, {
            id_usuario: usuario?.id_usuario ?? null,
            perfil: usuario?.perfil,
            id_os: opcoes.id_os
        });
    }
}

module.exports = new AcessorioRecebidoService();
