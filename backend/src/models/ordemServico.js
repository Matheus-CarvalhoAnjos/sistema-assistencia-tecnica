class OrdemServico {
    constructor(dados = {}) {
        this.id_os = dados.id_os;
        this.id_item = dados.id_item;
        this.id_tecnico = dados.id_tecnico;
        this.data_abertura = dados.data_abertura;
        this.status = dados.status;
        this.data_encerramento = dados.data_encerramento;
        this.motivo_encerramento = dados.motivo_encerramento;
        this.id_item_ativo = dados.id_item_ativo;

        // Dados complementares das consultas com JOIN (equipamento, técnico e cliente)
        this.tipo_equipamento = dados.tipo_equipamento;
        this.marca = dados.marca;
        this.modelo = dados.modelo;
        this.numero_serie = dados.numero_serie;
        this.garantia_status = dados.garantia_status;
        this.nome_tecnico = dados.nome_tecnico;
        this.id_solicitacao = dados.id_solicitacao;
        this.id_cliente = dados.id_cliente;
        this.nome_cliente = dados.nome_cliente;
    }
}

module.exports = OrdemServico;
