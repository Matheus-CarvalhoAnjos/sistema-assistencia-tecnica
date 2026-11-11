const paraCentavos = (valor) => Math.round(Number(valor || 0) * 100);

class Pagamento {
    constructor(dados = {}) {
        this.id_pagamento = dados.id_pagamento;
        this.id_os = dados.id_os;
        this.data_pagamento = dados.data_pagamento;
        this.valor = dados.valor;
        this.forma_pagamento = dados.forma_pagamento;
        this.status = dados.status;
        // Resumo de compatibilidade (RN16), preenchido quando a devolução fica integral
        this.data_reembolso = dados.data_reembolso ?? null;
        this.id_usuario_reembolso = dados.id_usuario_reembolso ?? null;
        this.justificativa_reembolso = dados.justificativa_reembolso ?? null;

        // Reembolsos parciais ou integrais (tabela reembolso), quando carregados
        if (Array.isArray(dados.reembolsos)) {
            const reembolsado = dados.reembolsos.reduce((total, r) => total + paraCentavos(r.valor), 0);
            this.reembolsos = dados.reembolsos;
            this.valor_reembolsado = reembolsado / 100;
            this.valor_disponivel_reembolso = this.status === "CONFIRMADO"
                ? Math.max(0, paraCentavos(this.valor) - reembolsado) / 100
                : 0;
        }
    }
}

module.exports = Pagamento;
