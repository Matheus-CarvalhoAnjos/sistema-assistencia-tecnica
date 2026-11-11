const BaseService = require("./BaseService");
const expedicaoRepository = require("../repositories/expedicaoRepository");
const pagamentoRepository = require("../repositories/pagamentoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");

// Domínios do banco real e do MER v1.4 (RN18 e RN19)
const FORMAS_ENTREGA = ["RETIRADA", "ENVIO"];
const STATUS_EXPEDICAO = ["PENDENTE", "EM_TRANSITO", "AGUARDANDO_RETIRADA", "ENTREGUE", "RETIRADO"];
const TAMANHO_RASTREIO = 100; // expedicao.codigo_rastreio VARCHAR(100)

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function validarTexto(valor, nomeCampo, tamanhoMaximo, obrigatorio = true) {
    if (valor === undefined || valor === null || valor === "") {
        if (!obrigatorio) {
            return null;
        }
        throw erroComStatus(`${nomeCampo} é obrigatório.`, 400);
    }

    if (typeof valor !== "string") {
        throw erroComStatus(`${nomeCampo} deve ser informado como texto.`, 400);
    }

    const texto = valor.trim();

    if (!texto && obrigatorio) {
        throw erroComStatus(`${nomeCampo} é obrigatório.`, 400);
    }

    if (texto.length > tamanhoMaximo) {
        throw erroComStatus(`${nomeCampo} não pode ultrapassar ${tamanhoMaximo} caracteres.`, 400);
    }

    return texto || null;
}

class ExpedicaoService extends BaseService {
    async _validarFuncionario(usuario) {
        if (!usuario || !["ADMINISTRADOR", "ATENDENTE"].includes(usuario.perfil)) {
            throw erroComStatus("Somente um administrador ou atendente pode gerenciar expedições.", 403);
        }

        const funcionario = await usuarioRepository.buscarPorId(Number(usuario.id_usuario));

        if (!funcionario || !funcionario.ativo ||
            !["ADMINISTRADOR", "ATENDENTE"].includes(String(funcionario.perfil).toUpperCase())) {
            throw erroComStatus("Funcionário não encontrado, inativo ou sem autorização.", 403);
        }

        return funcionario;
    }

    async buscarPorOs(id_os) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const ordem = await pagamentoRepository.buscarOrdemServico(idOs);

        if (!ordem) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        return await expedicaoRepository.buscarPorOs(idOs);
    }

    async criar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados da expedição são inválidos.", 400);
        }

        const funcionario = await this._validarFuncionario(usuario);
        const forma_entrega = validarTexto(dados.forma_entrega, "Forma de entrega", 20).toUpperCase();

        if (!FORMAS_ENTREGA.includes(forma_entrega)) {
            throw erroComStatus("A forma de entrega deve ser RETIRADA ou ENVIO.", 400);
        }

        const codigo_rastreio = validarTexto(dados.codigo_rastreio, "Código de rastreio", TAMANHO_RASTREIO, false);

        if (codigo_rastreio && forma_entrega === "RETIRADA") {
            throw erroComStatus("Código de rastreio só se aplica à forma de entrega ENVIO.", 400);
        }

        return await expedicaoRepository.criar({
            id_os: idOs,
            id_usuario: Number(funcionario.id_usuario),
            forma_entrega,
            codigo_rastreio
        });
    }

    async atualizarStatus(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados de atualização são inválidos.", 400);
        }

        const funcionario = await this._validarFuncionario(usuario);

        if (!STATUS_EXPEDICAO.includes(dados.status)) {
            throw erroComStatus("Status de expedição inválido.", 400);
        }

        // Rastreio opcional, informado quando o envio é despachado (EM_TRANSITO)
        const codigo_rastreio = validarTexto(dados.codigo_rastreio, "Código de rastreio", TAMANHO_RASTREIO, false);

        if (codigo_rastreio && dados.status !== "EM_TRANSITO") {
            throw erroComStatus("O código de rastreio é informado ao marcar o envio como EM_TRANSITO.", 400);
        }

        const expedicao = await expedicaoRepository.atualizarStatus(idOs, dados.status, codigo_rastreio, Number(funcionario.id_usuario));

        if (!expedicao) {
            throw erroComStatus("Expedição não encontrada.", 404);
        }

        return expedicao;
    }
}

module.exports = new ExpedicaoService();
