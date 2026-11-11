class Execucao {
    constructor(dados = {}) {
        this.id_execucao = dados.id_execucao;
        this.id_os = dados.id_os;
        this.id_tecnico = dados.id_tecnico;
        this.diagnostico = dados.diagnostico;
        this.laudo_tecnico = dados.laudo_tecnico;
        this.resultado = dados.resultado;
        this.data_inicio = dados.data_inicio;
        this.data_conclusao = dados.data_conclusao;
    }
}

module.exports = Execucao;
