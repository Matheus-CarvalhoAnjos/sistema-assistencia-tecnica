const BaseService = require("./BaseService");
const abatimentoRepository = require("../repositories/abatimentoRepository");
const ordemServicoRepository = require("../repositories/ordemServicoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");
const { validarValor } = require("./pagamentoService");

const MAX_BYTES_TEXT = 65535; // TEXT
const PERFIS_FINANCEIROS = ["ADMINISTRADOR", "ATENDENTE"];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

/**
 * Abatimento formal (R1). A2/C1/C2: somente ADMINISTRADOR ou ATENDENTE ativo (perfil lido do
 * banco) registra, cancela e consulta; o TÉCNICO não tem acesso.
 */
class AbatimentoService extends BaseService {
    async _exigirFuncionarioFinanceiro(usuario) {
        if (!usuario || !PERFIS_FINANCEIROS.includes(usuario.perfil)) {
            throw erroComStatus("Somente um administrador ou atendente pode operar abatimentos.", 403);
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
            throw erroComStatus("Os dados do abatimento são inválidos.", 400);
        }
    }

    async listarPorOs(id_os, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        await this._exigirFuncionarioFinanceiro(usuario);

        if (!(await ordemServicoRepository.buscarPorId(idOs))) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        return await abatimentoRepository.listarPorOs(idOs);
    }

    async registrar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const idUsuario = await this._exigirFuncionarioFinanceiro(usuario);
        this._dados(dados);

        let valorCentavos;
        try {
            valorCentavos = validarValor(dados.valor);
        } catch {
            throw erroComStatus("O valor do abatimento deve ser maior que zero, com no máximo duas casas decimais.", 400);
        }

        return await abatimentoRepository.registrar({
            id_os: idOs,
            valor_centavos: valorCentavos,
            motivo: this._texto(dados.motivo, "Motivo do abatimento"),
            id_usuario: idUsuario
        });
    }

    async cancelar(id_abatimento, dados, usuario) {
        const id = this.validarIdPositivo(id_abatimento, "ID do abatimento");
        const idUsuario = await this._exigirFuncionarioFinanceiro(usuario);
        this._dados(dados);

        return await abatimentoRepository.cancelar(id, {
            justificativa: this._texto(dados.justificativa, "Justificativa do cancelamento"),
            id_usuario: idUsuario
        });
    }
}

module.exports = new AbatimentoService();
