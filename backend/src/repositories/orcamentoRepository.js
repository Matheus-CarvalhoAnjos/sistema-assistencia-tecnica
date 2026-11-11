const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const Orcamento = require("../models/orcamento");
const ItemOrcamento = require("../models/itemOrcamento");
const RespostaOrcamento = require("../models/respostaOrcamento");
const historicoRepository = require("./historicoRepository");

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

class OrcamentoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async buscarOrdemServico(id_os) {
        return await this.buscarUm(
            `SELECT os.id_os, os.id_tecnico, os.status, os.garantia_status
             FROM ordem_servico os
             INNER JOIN item_solicitacao i
                 ON i.id_item = os.id_item
             WHERE os.id_os = ?`,
            [id_os]
        );
    }

    /*
     * Marca como VENCIDO os orçamentos pendentes já expirados da OS, usando a
     * conexão (transação) recebida, e grava um evento automático (sem usuário)
     * para cada orçamento que realmente mudou. Com reverterOs, a OS que aguardava
     * aprovação volta para EM_ANALISE quando não sobra orçamento pendente.
     */
    async _vencerExpirados(conexao, id_os, reverterOs) {
        const [vencidos] = await conexao.execute(
            `SELECT id_orcamento
             FROM orcamento
             WHERE id_os = ?
               AND status = 'PENDENTE'
               AND data_validade <= CURRENT_TIMESTAMP
             FOR UPDATE`,
            [id_os]
        );

        if (!Array.isArray(vencidos) || vencidos.length === 0) {
            return;
        }

        await conexao.execute(
            `UPDATE orcamento
             SET status = 'VENCIDO'
             WHERE id_os = ?
               AND status = 'PENDENTE'
               AND data_validade <= CURRENT_TIMESTAMP`,
            [id_os]
        );

        let voltouParaAnalise = false;

        if (reverterOs) {
            const [mudanca] = await conexao.execute(
                `UPDATE ordem_servico os
                 SET status = 'EM_ANALISE'
                 WHERE os.id_os = ?
                   AND os.status = 'AGUARDANDO_APROVACAO'
                   AND NOT EXISTS (
                       SELECT 1
                       FROM orcamento o
                       WHERE o.id_os = os.id_os
                         AND o.status = 'PENDENTE'
                   )`,
                [id_os]
            );
            voltouParaAnalise = mudanca.affectedRows > 0;
        }

        for (const [indice, { id_orcamento }] of vencidos.entries()) {
            const comMudancaOs = voltouParaAnalise && indice === 0;

            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario: null, // evento automático
                tipo_evento: "ORCAMENTO",
                descricao: `Orçamento nº ${id_orcamento} vencido sem resposta.`,
                dados_anteriores: { id_orcamento, status: "PENDENTE", status_os: comMudancaOs ? "AGUARDANDO_APROVACAO" : undefined },
                dados_novos: { id_orcamento, status: "VENCIDO", status_os: comMudancaOs ? "EM_ANALISE" : undefined }
            });
        }
    }

    // Chamado nas consultas: vence os orçamentos expirados em uma transação própria
    async atualizarVencidos(id_os) {
        const conexao = await this.pool.getConnection();

        try {
            await conexao.beginTransaction();
            await this._vencerExpirados(conexao, id_os, true);
            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }
    }

    async listarPorOs(id_os) {
        await this.atualizarVencidos(id_os);

        const linhas = await this.buscarTodos(
            `SELECT id_orcamento
             FROM orcamento
             WHERE id_os = ?
             ORDER BY data_emissao DESC, id_orcamento DESC`,
            [id_os]
        );

        const orcamentos = [];

        for (const linha of linhas) {
            orcamentos.push(await this.buscarPorId(linha.id_orcamento));
        }

        return orcamentos;
    }

    async buscarPorId(id_orcamento) {
        const inicial = await this.buscarUm(
            `SELECT id_orcamento, id_os
             FROM orcamento
             WHERE id_orcamento = ?`,
            [id_orcamento]
        );

        if (!inicial) {
            return null;
        }

        await this.atualizarVencidos(inicial.id_os);

        const linha = await this.buscarUm(
            `SELECT id_orcamento, id_os, id_tecnico, data_emissao,
                    data_validade, valor_total, status
             FROM orcamento
             WHERE id_orcamento = ?`,
            [id_orcamento]
        );

        const itens = await this.buscarTodos(
            `SELECT id_item_orcamento, id_orcamento, tipo_item,
                    descricao, quantidade, valor_unitario
             FROM item_orcamento
             WHERE id_orcamento = ?
             ORDER BY id_item_orcamento`,
            [id_orcamento]
        );

        const resposta = await this.buscarUm(
            `SELECT id_resposta, id_orcamento, id_usuario,
                    decisao, data_resposta, observacoes
             FROM resposta_orcamento
             WHERE id_orcamento = ?`,
            [id_orcamento]
        );

        return new Orcamento({
            ...linha,
            itens: itens.map((item) => new ItemOrcamento(item)),
            resposta: resposta ? new RespostaOrcamento(resposta) : null
        });
    }

    async criar(dados) {
        const conexao = await this.pool.getConnection();
        let idOrcamento;

        try {
            await conexao.beginTransaction();

            const [ordens] = await conexao.execute(
                `SELECT os.id_os, os.id_tecnico, os.status, os.garantia_status
                 FROM ordem_servico os
                 INNER JOIN item_solicitacao i
                     ON i.id_item = os.id_item
                 WHERE os.id_os = ?
                 FOR UPDATE`,
                [dados.id_os]
            );

            if (ordens.length === 0) {
                throw erroComStatus("Ordem de serviço não encontrada.", 404);
            }

            const ordem = ordens[0];

            if (!ordem.id_tecnico || ordem.id_tecnico !== dados.id_tecnico) {
                throw erroComStatus("A ordem de serviço precisa ter um técnico atribuído.", 409);
            }

            if (ordem.garantia_status !== dados.garantia_status) {
                throw erroComStatus("A situação da garantia foi alterada. Revalide o orçamento.", 409);
            }

            if (!["RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO"].includes(ordem.status)) {
                throw erroComStatus("Não é possível criar orçamento para esta ordem de serviço.", 409);
            }

            // A OS seguirá para AGUARDANDO_APROVACAO com o novo orçamento: não reverte o status
            await this._vencerExpirados(conexao, dados.id_os, false);

            const [pendentes] = await conexao.execute(
                `SELECT id_orcamento
                 FROM orcamento
                 WHERE id_os = ?
                   AND status = 'PENDENTE'
                   AND data_validade > CURRENT_TIMESTAMP
                 LIMIT 1
                 FOR UPDATE`,
                [dados.id_os]
            );

            if (pendentes.length > 0) {
                throw erroComStatus("Já existe um orçamento válido aguardando resposta.", 409);
            }

            const [resultado] = await conexao.execute(
                `INSERT INTO orcamento (
                    id_os,
                    id_tecnico,
                    data_emissao,
                    data_validade,
                    valor_total,
                    status
                ) VALUES (?, ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3 DAY), ?, 'PENDENTE')`,
                [dados.id_os, ordem.id_tecnico, dados.valor_total]
            );

            idOrcamento = resultado.insertId;

            for (const item of dados.itens) {
                await conexao.execute(
                    `INSERT INTO item_orcamento (
                        id_orcamento,
                        tipo_item,
                        descricao,
                        quantidade,
                        valor_unitario
                    ) VALUES (?, ?, ?, ?, ?)`,
                    [
                        idOrcamento,
                        item.tipo_item,
                        item.descricao,
                        item.quantidade,
                        item.valor_unitario
                    ]
                );
            }

            await conexao.execute(
                `UPDATE ordem_servico
                 SET status = 'AGUARDANDO_APROVACAO'
                 WHERE id_os = ?`,
                [dados.id_os]
            );

            await historicoRepository.registrar(conexao, {
                id_os: dados.id_os,
                id_usuario: dados.id_usuario ?? null,
                tipo_evento: "ORCAMENTO",
                descricao: `Orçamento nº ${idOrcamento} emitido.`,
                dados_anteriores: ordem.status !== "AGUARDANDO_APROVACAO" ? { status_os: ordem.status } : null,
                dados_novos: {
                    id_orcamento: idOrcamento,
                    status: "PENDENTE",
                    valor_total: dados.valor_total,
                    status_os: "AGUARDANDO_APROVACAO"
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorId(idOrcamento);
    }

    async registrarResposta(id_orcamento, id_usuario, decisao, observacoes) {
        await this.buscarPorId(id_orcamento);

        const conexao = await this.pool.getConnection();
        let expirado = false;

        try {
            await conexao.beginTransaction();

            const [orcamentos] = await conexao.execute(
                `SELECT o.id_orcamento, o.id_os, o.status,
                        (o.data_validade > CURRENT_TIMESTAMP) AS vigente,
                        os.status AS status_os
                 FROM orcamento o
                 INNER JOIN ordem_servico os
                     ON os.id_os = o.id_os
                 WHERE o.id_orcamento = ?
                 FOR UPDATE`,
                [id_orcamento]
            );

            if (orcamentos.length === 0) {
                throw erroComStatus("Orçamento não encontrado.", 404);
            }

            const orcamento = orcamentos[0];

            if (orcamento.status !== "PENDENTE") {
                throw erroComStatus("Este orçamento não está aguardando resposta.", 409);
            }

            if (!orcamento.vigente) {
                await this._vencerExpirados(conexao, orcamento.id_os, true);
                await conexao.commit();
                expirado = true;
            } else {
                if (orcamento.status_os !== "AGUARDANDO_APROVACAO") {
                    throw erroComStatus("A ordem de serviço não está aguardando a resposta do orçamento.", 409);
                }

                await conexao.execute(
                    `INSERT INTO resposta_orcamento (
                        id_orcamento,
                        id_usuario,
                        decisao,
                        data_resposta,
                        observacoes
                    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`,
                    [id_orcamento, id_usuario, decisao, observacoes]
                );

                await conexao.execute(
                    `UPDATE orcamento SET status = ? WHERE id_orcamento = ?`,
                    [decisao, id_orcamento]
                );

                await historicoRepository.registrar(conexao, {
                    id_os: orcamento.id_os,
                    id_usuario,
                    tipo_evento: "ORCAMENTO",
                    descricao: `Orçamento nº ${id_orcamento} ${decisao === "APROVADO" ? "aprovado" : "rejeitado"} pelo cliente.`,
                    dados_anteriores: { id_orcamento, status: "PENDENTE" },
                    dados_novos: { id_orcamento, status: decisao, decisao, observacoes }
                });

                if (decisao === "REJEITADO") {
                    // RN09/RN11: encerramento sem reparo com tipo, motivo, data e usuário responsável
                    await conexao.execute(
                        `UPDATE ordem_servico
                         SET status = 'ENCERRADA_SEM_REPARO',
                             data_encerramento = CURRENT_TIMESTAMP,
                             motivo_encerramento = 'Orçamento rejeitado.',
                             tipo_encerramento = 'ORCAMENTO_REJEITADO',
                             id_usuario_encerramento = ?
                         WHERE id_os = ?`,
                        [id_usuario, orcamento.id_os]
                    );

                    await historicoRepository.registrar(conexao, {
                        id_os: orcamento.id_os,
                        id_usuario,
                        tipo_evento: "ENCERRAMENTO",
                        descricao: "OS encerrada sem reparo: orçamento rejeitado.",
                        dados_anteriores: { status_os: orcamento.status_os },
                        dados_novos: {
                            status_os: "ENCERRADA_SEM_REPARO",
                            tipo_encerramento: "ORCAMENTO_REJEITADO",
                            motivo_encerramento: "Orçamento rejeitado."
                        }
                    });
                } else {
                    await conexao.execute(
                        `UPDATE ordem_servico
                         SET status = 'EM_REPARO'
                         WHERE id_os = ?`,
                        [orcamento.id_os]
                    );

                    await historicoRepository.registrar(conexao, {
                        id_os: orcamento.id_os,
                        id_usuario,
                        tipo_evento: "REPARO",
                        descricao: "Reparo iniciado após a aprovação do orçamento.",
                        dados_anteriores: { status_os: orcamento.status_os },
                        dados_novos: { status_os: "EM_REPARO" }
                    });
                }

                await conexao.commit();
            }
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        if (expirado) {
            return { expirado: true };
        }

        return await this.buscarPorId(id_orcamento);
    }
}

module.exports = new OrcamentoRepository();
