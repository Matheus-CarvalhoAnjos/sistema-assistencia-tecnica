const BaseService = require("./BaseService");
const orcamentoRepository = require("../repositories/orcamentoRepository");
const execucaoRepository = require("../repositories/execucaoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");

const VALOR_MAXIMO_CENTAVOS = 9999999999;

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function validarValorEmCentavos(valor, nomeCampo) {
    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero < 0) {
        throw erroComStatus(`${nomeCampo} deve ser um valor numérico maior ou igual a zero.`, 400);
    }

    const centavos = Math.round(numero * 100);

    if (Math.abs(numero * 100 - centavos) > 0.00001 || centavos > VALOR_MAXIMO_CENTAVOS) {
        throw erroComStatus(`${nomeCampo} deve ter no máximo duas casas decimais e respeitar o limite do banco.`, 400);
    }

    return centavos;
}

class OrcamentoService extends BaseService {
    async _validarTecnicoAtribuido(ordem, usuario) {
        if (!usuario || !["ADMINISTRADOR", "TECNICO"].includes(usuario.perfil)) {
            throw erroComStatus("Você não possui permissão para criar orçamento.", 403);
        }

        if (!ordem.id_tecnico) {
            throw erroComStatus("Atribua um técnico à ordem de serviço antes de criar o orçamento.", 409);
        }

        const tecnico = await usuarioRepository.buscarPorId(Number(ordem.id_tecnico));

        if (!tecnico || !tecnico.ativo || String(tecnico.perfil).toUpperCase() !== "TECNICO") {
            throw erroComStatus("O técnico atribuído não está ativo ou não possui perfil TECNICO.", 409);
        }

        if (usuario.perfil === "TECNICO" && Number(usuario.id_usuario) !== Number(ordem.id_tecnico)) {
            throw erroComStatus("Somente o técnico atribuído pode criar este orçamento.", 403);
        }
    }

    async listarPorOs(id_os) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const ordem = await orcamentoRepository.buscarOrdemServico(idOs);

        if (!ordem) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        return await orcamentoRepository.listarPorOs(idOs);
    }

    // id_os (opcional): quando informado, o orçamento precisa pertencer a essa OS
    async buscarPorId(id_orcamento, id_os) {
        const idOrcamento = this.validarIdPositivo(id_orcamento, "ID do orçamento");
        const orcamento = await orcamentoRepository.buscarPorId(idOrcamento);

        if (!orcamento) {
            throw erroComStatus("Orçamento não encontrado.", 404);
        }

        if (id_os !== undefined) {
            const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

            if (Number(orcamento.id_os) !== idOs) {
                throw erroComStatus("Orçamento não encontrado.", 404);
            }
        }

        return orcamento;
    }

    async criar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados) || !Array.isArray(dados.itens) || dados.itens.length === 0) {
            throw erroComStatus("Informe ao menos um item válido para o orçamento.", 400);
        }

        const ordem = await orcamentoRepository.buscarOrdemServico(idOs);

        if (!ordem) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        await this._validarTecnicoAtribuido(ordem, usuario);

        if (!["RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO"].includes(ordem.status)) {
            throw erroComStatus("Não é possível criar orçamento para esta ordem de serviço.", 409);
        }

        if (ordem.garantia_status === "PENDENTE") {
            throw erroComStatus("Verifique a garantia (técnico atribuído) antes de criar o orçamento.", 409);
        }

        // Garantia SIM não dispensa o orçamento nem a aprovação do cliente: os serviços
        // cobertos saem a R$ 0,00 e as peças mantêm o valor informado (ver cobertoPelaGarantia).

        const execucao = await execucaoRepository.buscarPorOs(idOs);

        if (!execucao) {
            throw erroComStatus("Registre o diagnóstico técnico antes de criar o orçamento.", 409);
        }

        const itens = dados.itens.map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw erroComStatus("Cada item do orçamento deve ser um objeto válido.", 400);
            }

            if (!["PECA", "SERVICO"].includes(item.tipo_item)) {
                throw erroComStatus("O tipo do item deve ser PECA ou SERVICO.", 400);
            }

            const descricao = this.validarTexto(item.descricao, "Descrição do item");

            if (descricao.length > 255) {
                throw erroComStatus("A descrição do item não pode ultrapassar 255 caracteres.", 400);
            }

            const quantidade = Number(item.quantidade);

            if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > 2147483647) {
                throw erroComStatus("A quantidade deve ser um número inteiro maior que zero.", 400);
            }

            const cobertoPelaGarantia = ordem.garantia_status === "SIM" && item.tipo_item === "SERVICO";
            const valorCentavos = cobertoPelaGarantia
                ? 0
                : validarValorEmCentavos(item.valor_unitario, "Valor unitário");
            const subtotalCentavos = valorCentavos * quantidade;

            if (!Number.isSafeInteger(subtotalCentavos) || subtotalCentavos > VALOR_MAXIMO_CENTAVOS) {
                throw erroComStatus("O subtotal excede o limite permitido pelo banco.", 400);
            }

            return {
                tipo_item: item.tipo_item,
                descricao,
                quantidade,
                valor_unitario: valorCentavos / 100,
                subtotal_centavos: subtotalCentavos
            };
        });

        const totalCentavos = itens.reduce((total, item) => total + item.subtotal_centavos, 0);

        if (!Number.isSafeInteger(totalCentavos) || totalCentavos > VALOR_MAXIMO_CENTAVOS) {
            throw erroComStatus("O valor total excede o limite permitido pelo banco.", 400);
        }

        const dadosOrcamento = {
            id_os: idOs,
            id_usuario: Number(usuario.id_usuario),
            id_tecnico: Number(ordem.id_tecnico),
            garantia_status: ordem.garantia_status,
            itens: itens.map(({ subtotal_centavos, ...item }) => item),
            valor_total: totalCentavos / 100
        };

        return await orcamentoRepository.criar(dadosOrcamento);
    }

    async responder(id_orcamento, dados, usuario) {
        const idOrcamento = this.validarIdPositivo(id_orcamento, "ID do orçamento");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados da resposta são inválidos.", 400);
        }

        if (!usuario || !["ADMINISTRADOR", "ATENDENTE"].includes(usuario.perfil)) {
            throw erroComStatus("Somente um funcionário autorizado pode responder ao orçamento.", 403);
        }

        const funcionario = await usuarioRepository.buscarPorId(Number(usuario.id_usuario));

        if (!funcionario || !funcionario.ativo || !["ADMINISTRADOR", "ATENDENTE"].includes(String(funcionario.perfil).toUpperCase())) {
            throw erroComStatus("Funcionário não encontrado, inativo ou sem autorização.", 403);
        }

        if (!["APROVADO", "REJEITADO"].includes(dados.decisao)) {
            throw erroComStatus("A decisão deve ser APROVADO ou REJEITADO.", 400);
        }

        let observacoes = null;

        if (dados.observacoes !== undefined && dados.observacoes !== null) {
            if (typeof dados.observacoes !== "string") {
                throw erroComStatus("As observações devem ser informadas como texto.", 400);
            }

            observacoes = dados.observacoes.trim() || null;
        }

        const resposta = await orcamentoRepository.registrarResposta(
            idOrcamento,
            Number(funcionario.id_usuario),
            dados.decisao,
            observacoes
        );

        if (resposta && resposta.expirado) {
            throw erroComStatus("O orçamento expirou e não pode mais receber uma resposta.", 409);
        }

        return resposta;
    }
}

module.exports = new OrcamentoService();
