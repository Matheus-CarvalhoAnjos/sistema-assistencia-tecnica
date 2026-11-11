class ItemOrcamento {
    constructor(dados = {}) {
        this.id_item_orcamento = dados.id_item_orcamento;
        this.id_orcamento = dados.id_orcamento;
        this.tipo_item = dados.tipo_item;
        this.descricao = dados.descricao;
        this.quantidade = dados.quantidade;
        this.valor_unitario = dados.valor_unitario;
    }
}

module.exports = ItemOrcamento;
