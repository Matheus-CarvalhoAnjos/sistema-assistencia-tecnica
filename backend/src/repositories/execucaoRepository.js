const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const Execucao = require("../models/execucao");
const historicoRepository = require("./historicoRepository");

const CAMPOS_DIAGNOSTICO = ["diagnostico", "laudo_tecnico", "resultado", "data_inicio", "data_conclusao"];

// Compara valores do banco e da requisição (datas pelo instante, textos pelo conteúdo)
function normalizar(valor) {
    if (valor === null || valor === undefined) return null;
    if (valor instanceof Date) return valor.getTime();
    return valor;
}

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

class ExecucaoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async buscarPorOs(id_os) {
        const linha = await this.buscarUm(
            `SELECT id_execucao, id_os, id_tecnico, diagnostico,
                    laudo_tecnico, resultado, data_inicio, data_conclusao
             FROM execucao
             WHERE id_os = ?`,
            [id_os]
        );

        return linha ? new Execucao(linha) : null;
    }

    // RN03 (MER v1.4): o primeiro diagnóstico válido cria a execução e muda a OS
    // de RECEBIDA para EM_ANALISE, na mesma transação.
    // A3: etapa, técnico e diagnóstico existente são conferidos de novo com a OS bloqueada
    // (SELECT ... FOR UPDATE), para não haver corrida com a troca de técnico ou o encerramento.
    async criar(dados) {
        const conexao = await this.pool.getConnection();

        try {
            await conexao.beginTransaction();

            const [ordens] = await conexao.execute(
                `SELECT status, id_tecnico FROM ordem_servico WHERE id_os = ? FOR UPDATE`,
                [dados.id_os]
            );

            if (ordens.length === 0) {
                throw erroComStatus("Ordem de serviço não encontrada.", 404);
            }

            if (["FINALIZADA", "ENCERRADA_SEM_REPARO"].includes(ordens[0].status)) {
                throw erroComStatus("Não é possível alterar a execução de uma ordem encerrada.", 409);
            }

            if (dados.id_usuario !== undefined && Number(ordens[0].id_tecnico) !== Number(dados.id_usuario)) {
                throw erroComStatus("Somente o técnico atribuído pode registrar esta execução.", 403);
            }

            const [existentes] = await conexao.execute(
                `SELECT id_execucao FROM execucao WHERE id_os = ?`,
                [dados.id_os]
            );

            if (existentes.length > 0) {
                throw erroComStatus("Já existe uma execução técnica para esta ordem de serviço.", 409);
            }

            await conexao.execute(
                `INSERT INTO execucao (
                    id_os,
                    id_tecnico,
                    diagnostico,
                    laudo_tecnico,
                    resultado,
                    data_inicio,
                    data_conclusao
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    dados.id_os,
                    // técnico lido com a OS bloqueada (o mesmo conferido acima)
                    ordens[0].id_tecnico ?? dados.id_tecnico,
                    dados.diagnostico,
                    dados.laudo_tecnico,
                    dados.resultado,
                    dados.data_inicio,
                    dados.data_conclusao
                ]
            );

            const [mudanca] = await conexao.execute(
                `UPDATE ordem_servico
                 SET status = 'EM_ANALISE'
                 WHERE id_os = ?
                   AND status = 'RECEBIDA'`,
                [dados.id_os]
            );
            const iniciouAnalise = mudanca.affectedRows > 0;

            await historicoRepository.registrar(conexao, {
                id_os: dados.id_os,
                id_usuario: dados.id_usuario ?? null,
                tipo_evento: "DIAGNOSTICO",
                descricao: iniciouAnalise
                    ? "Diagnóstico registrado; OS em análise."
                    : "Diagnóstico registrado.",
                dados_anteriores: iniciouAnalise ? { status_os: "RECEBIDA" } : null,
                dados_novos: {
                    diagnostico: dados.diagnostico,
                    data_inicio: dados.data_inicio,
                    status_os: iniciouAnalise ? "EM_ANALISE" : undefined
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return this.buscarPorOs(dados.id_os);
    }

    // Edição do diagnóstico/laudo: grava o evento só com os campos que mudaram.
    // D8 (O2): permitida ao técnico atualmente atribuído até a OS ser FINALIZADA (inclusive
    // CONCLUIDA e AGUARDANDO_EXPEDICAO). Etapa e técnico são conferidos com a OS bloqueada,
    // para não haver corrida com a finalização, o encerramento ou a troca de técnico.
    async atualizar(id_os, dados) {
        const conexao = await this.pool.getConnection();

        try {
            await conexao.beginTransaction();

            const [ordens] = await conexao.execute(
                `SELECT status, id_tecnico FROM ordem_servico WHERE id_os = ? FOR UPDATE`,
                [id_os]
            );

            if (ordens.length === 0) {
                const erro = new Error("Ordem de serviço não encontrada.");
                erro.statusCode = 404;
                throw erro;
            }

            if (["FINALIZADA", "ENCERRADA_SEM_REPARO"].includes(ordens[0].status)) {
                const erro = new Error("Não é possível alterar a execução de uma ordem encerrada.");
                erro.statusCode = 409;
                throw erro;
            }

            if (dados.id_usuario !== undefined && Number(ordens[0].id_tecnico) !== Number(dados.id_usuario)) {
                const erro = new Error("Somente o técnico atualmente atribuído pode editar o laudo.");
                erro.statusCode = 403;
                throw erro;
            }

            const [linhas] = await conexao.execute(
                `SELECT diagnostico, laudo_tecnico, resultado, data_inicio, data_conclusao
                 FROM execucao
                 WHERE id_os = ?
                 FOR UPDATE`,
                [id_os]
            );

            await conexao.execute(
                `UPDATE execucao
                 SET diagnostico = ?,
                     laudo_tecnico = ?,
                     resultado = ?,
                     data_inicio = ?,
                     data_conclusao = ?
                 WHERE id_os = ?`,
                [
                    dados.diagnostico,
                    dados.laudo_tecnico,
                    dados.resultado,
                    dados.data_inicio,
                    dados.data_conclusao,
                    id_os
                ]
            );

            const atual = linhas[0] ?? {};
            const anteriores = {};
            const novos = {};

            for (const campo of CAMPOS_DIAGNOSTICO) {
                if (normalizar(atual[campo]) !== normalizar(dados[campo])) {
                    anteriores[campo] = atual[campo] ?? null;
                    novos[campo] = dados[campo] ?? null;
                }
            }

            if (Object.keys(novos).length > 0) {
                await historicoRepository.registrar(conexao, {
                    id_os,
                    id_usuario: dados.id_usuario ?? null,
                    tipo_evento: "DIAGNOSTICO",
                    descricao: "Diagnóstico ou laudo técnico atualizado.",
                    dados_anteriores: anteriores,
                    dados_novos: novos
                });
            }

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return this.buscarPorOs(id_os);
    }
}

module.exports = new ExecucaoRepository();
