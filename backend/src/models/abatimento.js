class Abatimento {
    constructor(dados = {}) {
        this.id_abatimento = dados.id_abatimento;
        this.id_os = dados.id_os;
        this.id_orcamento = dados.id_orcamento;
        this.valor = dados.valor;
        this.motivo = dados.motivo;
        this.status = dados.status;
        this.id_usuario_registro = dados.id_usuario_registro;
        this.nome_usuario_registro = dados.nome_usuario_registro ?? null;
        this.data_registro = dados.data_registro;
        this.id_usuario_cancelamento = dados.id_usuario_cancelamento ?? null;
        this.nome_usuario_cancelamento = dados.nome_usuario_cancelamento ?? null;
        this.data_cancelamento = dados.data_cancelamento ?? null;
        this.justificativa_cancelamento = dados.justificativa_cancelamento ?? null;
    }
}

module.exports = Abatimento;
