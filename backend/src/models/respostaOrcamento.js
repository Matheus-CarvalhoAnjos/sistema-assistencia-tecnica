class RespostaOrcamento {
    constructor(dados = {}) {
        this.id_resposta = dados.id_resposta;
        this.id_orcamento = dados.id_orcamento;
        this.id_usuario = dados.id_usuario;
        this.decisao = dados.decisao;
        this.data_resposta = dados.data_resposta;
        this.observacoes = dados.observacoes;
    }
}

module.exports = RespostaOrcamento;
