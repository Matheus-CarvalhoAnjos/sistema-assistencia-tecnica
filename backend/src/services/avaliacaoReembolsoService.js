const BaseService = require("./BaseService");
const avaliacaoReembolsoRepository = require("../repositories/avaliacaoReembolsoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");

const MAX_BYTES_TEXT = 65535; // TEXT
const VALOR_MAXIMO_CENTAVOS = 9999999999; // DECIMAL(10,2)
const PERFIS_FINANCEIROS = ["ADMINISTRADOR", "ATENDENTE"];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

// D1: o valor definido pode ser zero ("não reembolsar")
function validarValorDefinido(valor) {
    if (valor === undefined || valor === null || valor === "") {
        throw erroComStatus("Informe o valor definido para reembolso (pode ser zero).", 400);
    }

    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero < 0) {
        throw erroComStatus("O valor definido para reembolso deve ser zero ou maior.", 400);
    }

    const centavos = Math.round(numero * 100);

    if (Math.abs(numero * 100 - centavos) > 0.00001 || centavos > VALOR_MAXIMO_CENTAVOS) {
        throw erroComStatus("O valor definido deve ter no máximo duas casas decimais.", 400);
    }

    return centavos;
}

class AvaliacaoReembolsoService extends BaseService {
    // R8: avaliação e reembolsos só para ADMINISTRADOR ou ATENDENTE ativo (perfil conferido no banco)
    async _exigirFuncionarioFinanceiro(usuario) {
        if (!usuario || !PERFIS_FINANCEIROS.includes(usuario.perfil)) {
            throw erroComStatus("Somente um administrador ou atendente pode registrar a avaliação financeira.", 403);
        }

        const funcionario = await usuarioRepository.buscarPorId(Number(usuario.id_usuario));

        if (!funcionario || !funcionario.ativo ||
            !PERFIS_FINANCEIROS.includes(String(funcionario.perfil).toUpperCase())) {
            throw erroComStatus("Funcionário não encontrado, inativo ou sem autorização.", 403);
        }

        return Number(funcionario.id_usuario);
    }

    _texto(valor, campo) {
        const texto = this.validarTexto(valor, campo);

        if (Buffer.byteLength(texto, "utf8") > MAX_BYTES_TEXT) {
            throw erroComStatus(`${campo} excede o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`, 400);
        }

        return texto;
    }

    _dados(dados) {
        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados da avaliação financeira são inválidos.", 400);
        }
    }

    async consultar(id_os) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        return await avaliacaoReembolsoRepository.consultar(idOs);
    }

    async registrar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const idUsuario = await this._exigirFuncionarioFinanceiro(usuario);
        this._dados(dados);

        return await avaliacaoReembolsoRepository.registrar({
            id_os: idOs,
            valor_centavos: validarValorDefinido(dados.valor_definido),
            justificativa: this._texto(dados.justificativa, "Justificativa"),
            id_usuario: idUsuario
        });
    }

    // D2: a avaliação anterior é preservada; a revisão exige o motivo da correção
    async revisar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const idUsuario = await this._exigirFuncionarioFinanceiro(usuario);
        this._dados(dados);

        return await avaliacaoReembolsoRepository.registrar({
            id_os: idOs,
            id_avaliacao_revisada: this.validarIdPositivo(dados.id_avaliacao_revisada, "Avaliação revisada"),
            valor_centavos: validarValorDefinido(dados.valor_definido),
            justificativa: this._texto(dados.justificativa, "Justificativa"),
            motivo_revisao: this._texto(dados.motivo_revisao, "Motivo da revisão"),
            id_usuario: idUsuario
        });
    }
}

module.exports = new AvaliacaoReembolsoService();
