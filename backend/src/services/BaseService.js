class BaseService {
    validarIdPositivo(valor, nomeCampo) {
        const id = Number(valor);

        if (!Number.isInteger(id) || id <= 0) {
            const erro = new Error(`${nomeCampo} inválido.`);
            erro.statusCode = 400;
            throw erro;
        }

        return id;
    }

    validarTexto(valor, nomeCampo) {
        if (typeof valor !== "string") {
            const erro = new Error(`${nomeCampo} deve ser informado como texto.`);
            erro.statusCode = 400;
            throw erro;
        }

        const texto = valor.trim();

        if (!texto) {
            const erro = new Error(`${nomeCampo} não pode estar vazio.`);
            erro.statusCode = 400;
            throw erro;
        }

        return texto;
    }
}

module.exports = BaseService;
