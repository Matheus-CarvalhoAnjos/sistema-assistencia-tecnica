class AcessorioRecebido {
    constructor(dados = {}) {
        this.id_acessorio_recebido = dados.id_acessorio_recebido;
        this.id_item = dados.id_item;
        this.id_acessorio = dados.id_acessorio;
        this.quantidade = dados.quantidade;
        this.observacoes = dados.observacoes;

        // Descrição do catálogo (presente nas consultas com JOIN)
        this.descricao_acessorio = dados.descricao_acessorio;
    }
}

module.exports = AcessorioRecebido;
