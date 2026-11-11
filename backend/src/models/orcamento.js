class Orcamento {
    constructor(dados = {}) {
        this.id_orcamento = dados.id_orcamento;
        this.id_os = dados.id_os;
        this.id_tecnico = dados.id_tecnico;
        this.data_emissao = dados.data_emissao;
        this.data_validade = dados.data_validade;
        this.valor_total = dados.valor_total;
        this.status = dados.status;
        this.itens = dados.itens || [];
        this.resposta = dados.resposta || null;
    }
}

module.exports = Orcamento;
