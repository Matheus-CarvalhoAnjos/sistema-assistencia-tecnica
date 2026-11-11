
class Usuario {
    constructor(dados) {
        this.id_usuario = dados.id_usuario;
        this.nome = dados.nome;
        this.email = dados.email;
        this.perfil = dados.perfil;
        this.ativo = dados.ativo;
    }
}

module.exports = Usuario;
