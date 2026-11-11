class Acessorio {
    constructor(dados = {}) {
        this.id_acessorio = dados.id_acessorio;
        this.descricao = dados.descricao;
        this.preco_atual = dados.preco_atual;
        this.ativo = dados.ativo;
    }
}

module.exports = Acessorio;
