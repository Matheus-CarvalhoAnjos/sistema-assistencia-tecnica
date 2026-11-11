const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const Acessorio = require("../models/acessorio");

class AcessorioRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async listarTodos() {
        const linhas = await this.buscarTodos(
            `SELECT *
             FROM acessorio
             WHERE ativo = 1
             ORDER BY descricao`
        );

        return linhas.map((linha) => new Acessorio(linha));
    }

    async buscarPorId(id) {
        const linha = await this.buscarUm(
            `SELECT *
             FROM acessorio
             WHERE id_acessorio = ?`,
            [id]
        );

        return linha ? new Acessorio(linha) : null;
    }

    async buscarPorDescricao(descricao) {
        const linha = await this.buscarUm(
            `SELECT *
             FROM acessorio
             WHERE LOWER(descricao) = LOWER(?)
             LIMIT 1`,
            [descricao]
        );

        return linha ? new Acessorio(linha) : null;
    }

    async criar(dados) {
        const [resultado] = await this.pool.execute(
            `INSERT INTO acessorio (
                descricao,
                preco_atual,
                ativo
            ) VALUES (?, ?, ?)`,
            [
                dados.descricao,
                dados.preco_atual ?? null,
                dados.ativo ?? 1
            ]
        );

        return this.buscarPorId(resultado.insertId);
    }
}

module.exports = new AcessorioRepository();
