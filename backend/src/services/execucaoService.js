const BaseService = require("./BaseService");
const execucaoRepository = require("../repositories/execucaoRepository");
const ordemServicoRepository = require("../repositories/ordemServicoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function normalizarData(valor, nomeCampo) {
    if (valor === null || valor === undefined || valor === "") {
        return null;
    }

    const data = valor instanceof Date ? valor : new Date(valor);

    if (Number.isNaN(data.getTime())) {
        throw erroComStatus(`${nomeCampo} inválida.`, 400);
    }

    return data;
}

function normalizarTextoOpcional(valor, nomeCampo) {
    if (valor === null || valor === undefined) {
        return null;
    }

    if (typeof valor !== "string") {
        throw erroComStatus(`${nomeCampo} deve ser informado como texto.`, 400);
    }

    const texto = valor.trim();
    return texto || null;
}

// O diagnóstico é ação exclusiva do técnico atribuído (MER v1.4: "Diagnóstico/garantia:
// técnico atualmente atribuído"). ADMINISTRADOR e ATENDENTE não registram nem editam.
function exigirTecnico(usuario) {
    if (!usuario || usuario.perfil !== "TECNICO") {
        throw erroComStatus("Somente o técnico atribuído pode registrar ou editar o diagnóstico.", 403);
    }
}

class ExecucaoService extends BaseService {
    async _validarAcessoTecnico(id_os, usuario) {
        if (!usuario || !["ADMINISTRADOR", "TECNICO"].includes(usuario.perfil)) {
            throw erroComStatus("Você não possui permissão para registrar execução técnica.", 403);
        }

        const ordem = await ordemServicoRepository.buscarPorId(id_os);

        if (!ordem) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        if (!ordem.id_tecnico) {
            throw erroComStatus("Atribua um técnico à ordem de serviço antes de registrar a execução.", 409);
        }

        const tecnico = await usuarioRepository.buscarPorId(Number(ordem.id_tecnico));

        if (!tecnico || !tecnico.ativo || String(tecnico.perfil).toUpperCase() !== "TECNICO") {
            throw erroComStatus("O técnico atribuído não está ativo ou não possui perfil TECNICO.", 409);
        }

        if (usuario.perfil === "TECNICO" && Number(usuario.id_usuario) !== Number(ordem.id_tecnico)) {
            throw erroComStatus("Somente o técnico atribuído pode registrar esta execução.", 403);
        }

        if (["FINALIZADA", "ENCERRADA_SEM_REPARO"].includes(ordem.status)) {
            throw erroComStatus("Não é possível alterar a execução de uma ordem encerrada.", 409);
        }

        return ordem;
    }

    async buscarPorOs(id_os) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const ordem = await ordemServicoRepository.buscarPorId(idOs);

        if (!ordem) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        const execucao = await execucaoRepository.buscarPorOs(idOs);

        if (!execucao) {
            throw erroComStatus("Execução técnica não encontrada.", 404);
        }

        return execucao;
    }

    async registrar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados da execução são inválidos.", 400);
        }

        exigirTecnico(usuario);
        const ordem = await this._validarAcessoTecnico(idOs, usuario);
        const existente = await execucaoRepository.buscarPorOs(idOs);

        if (existente) {
            throw erroComStatus("Já existe uma execução técnica para esta ordem de serviço.", 409);
        }

        const diagnostico = this.validarTexto(dados.diagnostico, "Diagnóstico");
        const data_inicio = normalizarData(dados.data_inicio ?? new Date(), "Data de início");
        const data_conclusao = normalizarData(dados.data_conclusao, "Data de conclusão");

        if (data_conclusao && data_inicio && data_conclusao < data_inicio) {
            throw erroComStatus("A data de conclusão não pode ser anterior à data de início.", 400);
        }

        return await execucaoRepository.criar({
            id_os: idOs,
            id_usuario: Number(usuario.id_usuario),
            id_tecnico: Number(ordem.id_tecnico),
            diagnostico,
            laudo_tecnico: normalizarTextoOpcional(dados.laudo_tecnico, "Laudo técnico"),
            resultado: normalizarTextoOpcional(dados.resultado, "Resultado"),
            data_inicio,
            data_conclusao
        });
    }

    async atualizar(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados da execução são inválidos.", 400);
        }

        exigirTecnico(usuario);
        const ordem = await this._validarAcessoTecnico(idOs, usuario);
        const existente = await execucaoRepository.buscarPorOs(idOs);

        if (!existente) {
            throw erroComStatus("Execução técnica não encontrada.", 404);
        }

        const diagnostico = dados.diagnostico === undefined
            ? existente.diagnostico
            : this.validarTexto(dados.diagnostico, "Diagnóstico");
        const laudo_tecnico = dados.laudo_tecnico === undefined
            ? existente.laudo_tecnico
            : normalizarTextoOpcional(dados.laudo_tecnico, "Laudo técnico");
        const resultado = dados.resultado === undefined
            ? existente.resultado
            : normalizarTextoOpcional(dados.resultado, "Resultado");
        const data_inicio = dados.data_inicio === undefined
            ? normalizarData(existente.data_inicio, "Data de início")
            : normalizarData(dados.data_inicio, "Data de início");
        const data_conclusao = dados.data_conclusao === undefined
            ? normalizarData(existente.data_conclusao, "Data de conclusão")
            : normalizarData(dados.data_conclusao, "Data de conclusão");

        if (data_conclusao && data_inicio && data_conclusao < data_inicio) {
            throw erroComStatus("A data de conclusão não pode ser anterior à data de início.", 400);
        }

        return await execucaoRepository.atualizar(idOs, {
            id_usuario: Number(usuario.id_usuario),
            id_tecnico: Number(ordem.id_tecnico),
            diagnostico,
            laudo_tecnico,
            resultado,
            data_inicio,
            data_conclusao
        });
    }

    async concluirReparo(id_os, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const ordem = await this._validarAcessoTecnico(idOs, usuario);

        if (ordem.status !== "EM_REPARO") {
            throw erroComStatus("Somente uma ordem em reparo pode ser concluída.", 409);
        }

        const execucao = await execucaoRepository.buscarPorOs(idOs);

        if (!execucao || !execucao.data_conclusao) {
            throw erroComStatus("Registre a data de conclusão no laudo técnico antes de concluir o reparo.", 409);
        }

        const atualizado = await ordemServicoRepository.marcarConcluida(idOs, Number(usuario.id_usuario));

        if (!atualizado) {
            throw erroComStatus("A ordem de serviço deixou de estar em reparo antes da conclusão.", 409);
        }

        return await ordemServicoRepository.buscarPorId(idOs);
    }
}

module.exports = new ExecucaoService();
