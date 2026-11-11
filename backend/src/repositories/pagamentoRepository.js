const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const Pagamento = require("../models/pagamento");
const historicoRepository = require("./historicoRepository");
const avaliacaoReembolsoRepository = require("./avaliacaoReembolsoRepository");

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

function paraCentavos(valor) {
    return Math.round(Number(valor || 0) * 100);
}

class PagamentoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async buscarOrdemServico(id_os) {
        return await this.buscarUm(
            `SELECT id_os, status
             FROM ordem_servico
             WHERE id_os = ?`,
            [id_os]
        );
    }

    async listarPorOs(id_os) {
        const linhas = await this.buscarTodos(
            `SELECT id_pagamento, id_os, data_pagamento,
                    valor, forma_pagamento, status,
                    data_reembolso, id_usuario_reembolso, justificativa_reembolso
             FROM pagamento
             WHERE id_os = ?
             ORDER BY id_pagamento DESC`,
            [id_os]
        );

        const reembolsos = await this.buscarTodos(
            `SELECT r.id_reembolso, r.id_pagamento, r.id_avaliacao, r.valor, r.justificativa,
                    r.id_usuario, u.nome AS nome_usuario, r.data_reembolso
             FROM reembolso r
             INNER JOIN pagamento p ON p.id_pagamento = r.id_pagamento
             LEFT JOIN usuario u ON u.id_usuario = r.id_usuario
             WHERE p.id_os = ?
             ORDER BY r.id_reembolso`,
            [id_os]
        );

        return linhas.map((linha) => new Pagamento({
            ...linha,
            reembolsos: reembolsos.filter((r) => Number(r.id_pagamento) === Number(linha.id_pagamento))
        }));
    }

    async buscarPorId(id_pagamento) {
        const linha = await this.buscarUm(
            `SELECT id_pagamento, id_os, data_pagamento,
                    valor, forma_pagamento, status,
                    data_reembolso, id_usuario_reembolso, justificativa_reembolso
             FROM pagamento
             WHERE id_pagamento = ?`,
            [id_pagamento]
        );

        return linha ? new Pagamento(linha) : null;
    }

    /**
     * Ponto único do cálculo financeiro da OS (RN14 redefinida por R1 e R6):
     * - total original = valor do orçamento APROVADO (nunca alterado);
     * - total abatido = soma dos abatimentos APROVADO desse orçamento (R1);
     * - total devido = total original − total abatido;
     * - total pago = confirmados − reembolsos (R6); pendentes ficam à parte (reservam saldo).
     * Usado pelos limites de pagamento e confirmação (RN15), pelo abatimento (A4), pela
     * quitação da expedição (RN20) e pelo resumo.
     */
    async buscarValoresOs(id_os, executor = this.pool) {
        const [orcamentos] = await executor.execute(
            `SELECT valor_total, id_orcamento
             FROM orcamento
             WHERE id_os = ?
               AND status = 'APROVADO'
             ORDER BY data_emissao DESC, id_orcamento DESC
             LIMIT 1`,
            [id_os]
        );

        const [pagamentos] = await executor.execute(
            `SELECT
                COALESCE(SUM(CASE WHEN status = 'CONFIRMADO' THEN valor ELSE 0 END), 0) AS total_confirmado,
                COALESCE(SUM(CASE WHEN status = 'PENDENTE' THEN valor ELSE 0 END), 0) AS total_pendente
             FROM pagamento
             WHERE id_os = ?`,
            [id_os]
        );

        // R6 (RN14 revisada): reembolsos parciais de pagamentos CONFIRMADO deixam de contar como pagos.
        // REEMBOLSADO (devolução integral) já não entra na soma acima.
        const [reembolsos] = await executor.execute(
            `SELECT COALESCE(SUM(r.valor), 0) AS total_reembolsado
             FROM reembolso r
             INNER JOIN pagamento p ON p.id_pagamento = r.id_pagamento
             WHERE p.id_os = ? AND p.status = 'CONFIRMADO'`,
            [id_os]
        );

        // R1: abatimentos aprovados do orçamento aprovado reduzem o total devido
        let totalAbatidoCentavos = 0;
        if (orcamentos.length > 0) {
            const [abatimentos] = await executor.execute(
                `SELECT COALESCE(SUM(valor), 0) AS total_abatido
                 FROM abatimento
                 WHERE id_orcamento = ? AND status = 'APROVADO'`,
                [orcamentos[0].id_orcamento ?? null]
            );
            totalAbatidoCentavos = paraCentavos(abatimentos?.[0]?.total_abatido);
        }

        const totalOrcadoCentavos = paraCentavos(orcamentos[0]?.valor_total);

        return {
            tem_orcamento_aprovado: orcamentos.length > 0,
            id_orcamento_aprovado: orcamentos[0]?.id_orcamento ?? null,
            total_orcado_centavos: totalOrcadoCentavos,
            total_abatido_centavos: totalAbatidoCentavos,
            total_devido_centavos: totalOrcadoCentavos - totalAbatidoCentavos,
            total_confirmado_centavos: paraCentavos(pagamentos[0]?.total_confirmado) -
                paraCentavos(reembolsos?.[0]?.total_reembolsado),
            total_pendente_centavos: paraCentavos(pagamentos[0]?.total_pendente)
        };
    }

    async calcularResumo(id_os) {
        const valores = await this.buscarValoresOs(id_os);

        return {
            id_os,
            tem_orcamento_aprovado: valores.tem_orcamento_aprovado,
            // total_orcado mantém o significado de sempre: valor do orçamento aprovado (total original)
            total_orcado: valores.total_orcado_centavos / 100,
            total_abatido: valores.total_abatido_centavos / 100,
            total_devido: valores.total_devido_centavos / 100,
            total_pago: valores.total_confirmado_centavos / 100,
            pagamentos_pendentes: valores.total_pendente_centavos / 100,
            saldo_devedor: Math.max(
                0,
                valores.total_devido_centavos - valores.total_confirmado_centavos
            ) / 100
        };
    }

    async criar(dados) {
        const conexao = await this.pool.getConnection();
        let idPagamento;

        try {
            await conexao.beginTransaction();

            const [ordens] = await conexao.execute(
                `SELECT id_os, status
                 FROM ordem_servico
                 WHERE id_os = ?
                 FOR UPDATE`,
                [dados.id_os]
            );

            if (ordens.length === 0) {
                throw erroComStatus("Ordem de serviço não encontrada.", 404);
            }

            if (!["EM_REPARO", "CONCLUIDA", "AGUARDANDO_EXPEDICAO"].includes(ordens[0].status)) {
                throw erroComStatus("A ordem de serviço não está em uma etapa que permita registrar pagamento.", 409);
            }

            const valores = await this.buscarValoresOs(dados.id_os, conexao);

            if (!valores.tem_orcamento_aprovado) {
                throw erroComStatus("Não existe orçamento aprovado para esta ordem de serviço.", 409);
            }

            const valorReservado = valores.total_confirmado_centavos + valores.total_pendente_centavos;

            if (valorReservado + dados.valor_centavos > valores.total_devido_centavos) {
                throw erroComStatus("O pagamento excede o saldo disponível desta ordem de serviço.", 409);
            }

            const [resultado] = await conexao.execute(
                `INSERT INTO pagamento (
                    id_os,
                    data_pagamento,
                    valor,
                    forma_pagamento,
                    status
                ) VALUES (?, NULL, ?, ?, 'PENDENTE')`,
                [dados.id_os, dados.valor, dados.forma_pagamento]
            );

            idPagamento = resultado.insertId;

            await historicoRepository.registrar(conexao, {
                id_os: dados.id_os,
                id_usuario: dados.id_usuario ?? null,
                tipo_evento: "PAGAMENTO",
                descricao: `Pagamento nº ${idPagamento} registrado como pendente.`,
                dados_novos: {
                    id_pagamento: idPagamento,
                    valor: dados.valor,
                    forma_pagamento: dados.forma_pagamento,
                    status: "PENDENTE"
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorId(idPagamento);
    }

    async atualizarStatus(id_pagamento, status, id_usuario = null) {
        const pagamentoInicial = await this.buscarPorId(id_pagamento);

        if (!pagamentoInicial) {
            throw erroComStatus("Pagamento não encontrado.", 404);
        }

        const conexao = await this.pool.getConnection();
        const idOs = pagamentoInicial.id_os;

        try {
            await conexao.beginTransaction();

            const [ordens] = await conexao.execute(
                `SELECT id_os, status
                 FROM ordem_servico
                 WHERE id_os = ?
                 FOR UPDATE`,
                [idOs]
            );

            if (ordens.length === 0) {
                throw erroComStatus("Ordem de serviço não encontrada.", 404);
            }

            // RN13: depois do encerramento sem reparo não há novas confirmações
            if (status === "CONFIRMADO" && ordens[0].status === "ENCERRADA_SEM_REPARO") {
                throw erroComStatus("Não é possível confirmar pagamentos de uma ordem encerrada sem reparo.", 409);
            }

            const [pagamentos] = await conexao.execute(
                `SELECT id_pagamento, id_os, valor, status
                 FROM pagamento
                 WHERE id_pagamento = ?
                 FOR UPDATE`,
                [id_pagamento]
            );

            if (pagamentos.length === 0) {
                throw erroComStatus("Pagamento não encontrado.", 404);
            }

            const pagamento = pagamentos[0];

            if (pagamento.status !== "PENDENTE") {
                throw erroComStatus("Somente pagamentos pendentes podem ser confirmados ou cancelados.", 409);
            }

            if (status === "CONFIRMADO") {
                const valores = await this.buscarValoresOs(idOs, conexao);
                const valorEmCentavos = paraCentavos(pagamento.valor);

                if (!valores.tem_orcamento_aprovado ||
                    valores.total_confirmado_centavos + valorEmCentavos > valores.total_devido_centavos) {
                    throw erroComStatus("Não é possível confirmar o pagamento: o orçamento aprovado ou o saldo foi alterado.", 409);
                }

            }

            // data_pagamento fica NULL enquanto PENDENTE e é gravada na confirmação (MER v1.4)
            await conexao.execute(
                `UPDATE pagamento
                 SET status = ?,
                     data_pagamento = CASE WHEN ? = 'CONFIRMADO' THEN CURRENT_TIMESTAMP ELSE data_pagamento END
                 WHERE id_pagamento = ?`,
                [status, status, id_pagamento]
            );

            await historicoRepository.registrar(conexao, {
                id_os: idOs,
                id_usuario,
                tipo_evento: "PAGAMENTO",
                descricao: `Pagamento nº ${id_pagamento} ${status === "CONFIRMADO" ? "confirmado" : "cancelado"}.`,
                dados_anteriores: { id_pagamento: Number(id_pagamento), status: "PENDENTE" },
                dados_novos: { id_pagamento: Number(id_pagamento), status, valor: pagamento.valor }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorId(id_pagamento);
    }

    /**
     * Reembolso parcial ou integral (D5, D6; RN16 revisada).
     * - valor_centavos null = todo o valor ainda disponível do pagamento (comportamento anterior).
     * - OS que exige avaliação financeira (D1): só depois da avaliação e até o valor definido vigente.
     * - Quando a soma devolvida atinge o valor do pagamento, ele passa a REEMBOLSADO.
     */
    async reembolsar(id_pagamento, id_usuario, justificativa, valor_centavos = null) {
        const pagamentoInicial = await this.buscarPorId(id_pagamento);

        if (!pagamentoInicial) {
            throw erroComStatus("Pagamento não encontrado.", 404);
        }

        const idOs = pagamentoInicial.id_os;
        const conexao = await this.pool.getConnection();
        let idReembolso;

        try {
            await conexao.beginTransaction();

            // Mesma ordem de bloqueio das demais operações financeiras: OS e depois pagamento
            const financeiro = await avaliacaoReembolsoRepository.situacao(conexao, idOs, true);

            const [pagamentos] = await conexao.execute(
                `SELECT id_pagamento, id_os, valor, status
                 FROM pagamento
                 WHERE id_pagamento = ?
                 FOR UPDATE`,
                [id_pagamento]
            );

            if (pagamentos.length === 0) {
                throw erroComStatus("Pagamento não encontrado.", 404);
            }

            const pagamento = pagamentos[0];

            if (pagamento.status === "REEMBOLSADO") {
                throw erroComStatus("Este pagamento já foi reembolsado.", 409);
            }

            if (pagamento.status !== "CONFIRMADO") {
                throw erroComStatus("Somente pagamentos confirmados podem ser reembolsados.", 409);
            }

            const [[soma]] = await conexao.execute(
                `SELECT COALESCE(SUM(valor), 0) AS total FROM reembolso WHERE id_pagamento = ? FOR UPDATE`,
                [id_pagamento]
            );

            const valorPagamento = paraCentavos(pagamento.valor);
            const jaReembolsado = paraCentavos(soma?.total);
            const disponivel = valorPagamento - jaReembolsado;
            const valor = valor_centavos ?? disponivel;

            if (disponivel <= 0) {
                throw erroComStatus("Este pagamento já foi reembolsado.", 409);
            }

            if (valor > disponivel) {
                throw erroComStatus(
                    `O reembolso ultrapassa o valor disponível para devolução deste pagamento (${avaliacaoReembolsoRepository.formatar(disponivel)}).`,
                    409
                );
            }

            let idAvaliacao = null;

            if (financeiro.obrigatoria) {
                if (!financeiro.vigente) {
                    throw erroComStatus("Registre a avaliação financeira desta OS antes de reembolsar.", 409);
                }

                const restante = paraCentavos(financeiro.vigente.valor_definido) - financeiro._reembolsado_avaliacao_centavos;

                if (valor > restante) {
                    throw erroComStatus(
                        `O reembolso ultrapassa o valor definido na avaliação financeira (restam ${avaliacaoReembolsoRepository.formatar(Math.max(0, restante))}).`,
                        409
                    );
                }

                idAvaliacao = financeiro.vigente.id_avaliacao;
            }

            const [resultado] = await conexao.execute(
                `INSERT INTO reembolso (id_pagamento, id_avaliacao, valor, justificativa, id_usuario)
                 VALUES (?, ?, ?, ?, ?)`,
                [id_pagamento, idAvaliacao, valor / 100, justificativa, id_usuario]
            );
            idReembolso = resultado.insertId;

            const integral = jaReembolsado + valor === valorPagamento;

            if (integral) {
                // Resumo de compatibilidade (RN16): dados do reembolso que completou a devolução
                await conexao.execute(
                    `UPDATE pagamento
                     SET status = 'REEMBOLSADO',
                         data_reembolso = CURRENT_TIMESTAMP,
                         id_usuario_reembolso = ?,
                         justificativa_reembolso = ?
                     WHERE id_pagamento = ?`,
                    [id_usuario, justificativa, id_pagamento]
                );
            }

            const valorTexto = avaliacaoReembolsoRepository.formatar(valor);
            let descricao;
            if (integral && jaReembolsado === 0) {
                descricao = `Pagamento nº ${id_pagamento} reembolsado integralmente.`;
            } else if (integral) {
                descricao = `Reembolso de ${valorTexto} concluiu a devolução do pagamento nº ${id_pagamento}.`;
            } else {
                descricao = `Reembolso parcial de ${valorTexto} do pagamento nº ${id_pagamento}.`;
            }

            await historicoRepository.registrar(conexao, {
                id_os: idOs,
                id_usuario,
                tipo_evento: "PAGAMENTO",
                descricao,
                // A situação só entra no evento quando muda (CONFIRMADO → REEMBOLSADO)
                dados_anteriores: {
                    id_pagamento: Number(id_pagamento),
                    status: integral ? "CONFIRMADO" : undefined,
                    valor_reembolsado: jaReembolsado / 100
                },
                dados_novos: {
                    id_pagamento: Number(id_pagamento),
                    id_reembolso: idReembolso,
                    id_avaliacao: idAvaliacao ?? undefined,
                    status: integral ? "REEMBOLSADO" : undefined,
                    valor_reembolso: valor / 100,
                    valor_reembolsado: (jaReembolsado + valor) / 100,
                    justificativa_reembolso: justificativa
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        const lista = await this.listarPorOs(idOs);
        return lista.find((p) => Number(p.id_pagamento) === Number(id_pagamento)) ?? null;
    }

}

module.exports = new PagamentoRepository();
