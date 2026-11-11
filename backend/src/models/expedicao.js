class Expedicao {
    constructor(dados = {}) {
        this.id_expedicao = dados.id_expedicao;
        this.id_os = dados.id_os;
        this.id_usuario = dados.id_usuario;
        this.data_envio = dados.data_envio;
        this.forma_entrega = dados.forma_entrega;
        this.codigo_rastreio = dados.codigo_rastreio;
        this.status = dados.status;
        this.data_entrega = dados.data_entrega;
    }
}

module.exports = Expedicao;
