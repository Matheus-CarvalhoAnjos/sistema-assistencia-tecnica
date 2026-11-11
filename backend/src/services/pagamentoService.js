const BaseService = require("./BaseService");
const pagamentoRepository = require("../repositories/pagamentoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");
const MAX_BYTES_TEXT = 65535; // pagamento.justificativa_reembolso TEXT
const VALOR_MAXIMO_CENTAVOS = 9999999999;
const FORMAS_PAGAMENTO = [
    "DINHEIRO",
    "PIX",
    "CARTAO_CREDITO",
    "CARTAO_DEBITO",
    "TRANSFERENCIA"
];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function validarValor(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero <= 0) {
        throw erroComStatus("O valor do pagamento deve ser maior que zero.", 400);
    }

    const centavos = Math.round(numero * 100);

    if (Math.abs(numero * 100 - centavos) > 0.00001 || centavos > VALOR_MAXIMO_CENTAVOS) {
        throw erroComStatus("O pagamento deve ter no máximo duas casas decimais e respeitar o limite do banco.", 400);
    }

    return centavos;
}

class PagamentoService extends BaseService {
    async listarPorOs(id_os) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const ordem = await pagamentoRepository.buscarOrdemServico(idOs);

        if (!ordem) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        const [pagamentos, resumo] = await Promise.all([
            pagamentoRepository.listarPorOs(idOs),
            pagamentoRepository.calcularResumo(idOs)
        ]);

        return { pagamentos, resumo };
    }

    async criar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados do pagamento são inválidos.", 400);
        }

        if (!FORMAS_PAGAMENTO.includes(dados.forma_pagamento)) {
            throw erroComStatus("Forma de pagamento inválida.", 400);
        }

        const valorCentavos = validarValor(dados.valor);

        return await pagamentoRepository.criar({
            id_os: idOs,
            valor_centavos: valorCentavos,
            valor: valorCentavos / 100,
            forma_pagamento: dados.forma_pagamento,
            id_usuario: usuario?.id_usuario ?? null
        });
    }

    async atualizarStatus(id_pagamento, dados, usuario) {
        const idPagamento = this.validarIdPositivo(id_pagamento, "ID do pagamento");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados do pagamento são inválidos.", 400);
        }

        if (!["CONFIRMADO", "CANCELADO"].includes(dados.status)) {
            throw erroComStatus("O status deve ser CONFIRMADO ou CANCELADO.", 400);
        }

        const pagamento = await pagamentoRepository.atualizarStatus(idPagamento, dados.status, usuario?.id_usuario ?? null);

        if (!pagamento) {
            throw erroComStatus("Pagamento não encontrado.", 404);
        }

        return pagamento;
    }

    // RN16: somente ADMINISTRADOR ou ATENDENTE ativo; justificativa obrigatória
    async reembolsar(id_pagamento, dados, usuario) {
        const idPagamento = this.validarIdPositivo(id_pagamento, "ID do pagamento");

        if (!usuario || !["ADMINISTRADOR", "ATENDENTE"].includes(usuario.perfil)) {
            throw erroComStatus("Somente um administrador ou atendente pode registrar reembolsos.", 403);
        }

        const funcionario = await usuarioRepository.buscarPorId(Number(usuario.id_usuario));

        if (!funcionario || !funcionario.ativo ||
            !["ADMINISTRADOR", "ATENDENTE"].includes(String(funcionario.perfil).toUpperCase())) {
            throw erroComStatus("Funcionário não encontrado, inativo ou sem autorização.", 403);
        }

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados do reembolso são inválidos.", 400);
        }

        const justificativa = this.validarTexto(dados.justificativa_reembolso, "Justificativa do reembolso");

        if (Buffer.byteLength(justificativa, "utf8") > MAX_BYTES_TEXT) {
            throw erroComStatus(`A justificativa excede o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`, 400);
        }

        // D6: valor opcional; sem valor, devolve todo o valor ainda disponível do pagamento
        let valorCentavos = null;
        if (dados.valor !== undefined && dados.valor !== null && dados.valor !== "") {
            try {
                valorCentavos = validarValor(dados.valor);
            } catch {
                throw erroComStatus("O valor do reembolso deve ser maior que zero, com no máximo duas casas decimais.", 400);
            }
        }

        return await pagamentoRepository.reembolsar(
            idPagamento,
            Number(funcionario.id_usuario),
            justificativa,
            valorCentavos
        );
    }
}

module.exports = new PagamentoService();
module.exports.validarValor = validarValor;
