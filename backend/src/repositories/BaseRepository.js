class BaseRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async executar(sql, parametros = []) {
        const [resultado] = await this.pool.execute(sql, parametros);
        return resultado;
    }

    async buscarTodos(sql, parametros = []) {
        const [linhas] = await this.pool.execute(sql, parametros);
        return linhas;
    }

    async buscarUm(sql, parametros = []) {
        const [linhas] = await this.pool.execute(sql, parametros);
        return linhas[0] || null;
    }
}

module.exports = BaseRepository;
