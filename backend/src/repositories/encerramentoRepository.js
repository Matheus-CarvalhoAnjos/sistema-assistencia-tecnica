const { pool } = require("../config/database");
const historicoRepository = require("./historicoRepository");
const orcamentoRepository = require("./orcamentoRepository");

/*
 * Encerramento sem reparo (MER v1.4: RN07, RN08, RN11, RN12 e RN13).
 * Tudo acontece em UMA transação, com a linha da OS bloqueada:
 *   1. confere a etapa da OS e (na impossibilidade técnica) o diagnóstico;
 *   2. encerra a OS com tipo, motivo, data e usuário responsável;
 *   3. cancela orçamentos PENDENTE (os vencidos viram VENCIDO antes) e pagamentos PENDENTE;
 *   4. grava os eventos do histórico.
 * Orçamentos já respondidos e pagamentos CONFIRMADO/REEMBOLSADO são preservados.
 */

// Etapas em que cada tipo de encerramento é permitido
const ETAPAS_PERMITIDAS = {
    IMPOSSIBILIDADE_TECNICA: ["RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO", "EM_REPARO"],
    DESISTENCIA_CLIENTE: ["RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO"]
};

const DESCRICOES = {
    IMPOSSIBILIDADE_TECNICA: "impossibilidade técnica",
    DESISTENCIA_CLIENTE: "desistência do cliente"
};

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

async function encerrarSemReparo({ id_os, tipo_encerramento, motivo, id_usuario }) {
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        const [ordens] = await conexao.execute(
            `SELECT id_os, status
             FROM ordem_servico
             WHERE id_os = ?
             FOR UPDATE`,
            [id_os]
        );

        if (ordens.length === 0) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        const statusAnterior = ordens[0].status;

        if (!ETAPAS_PERMITIDAS[tipo_encerramento].includes(statusAnterior)) {
            throw erroComStatus(
                tipo_encerramento === "DESISTENCIA_CLIENTE"
                    ? "A desistência do cliente só pode ser registrada antes do início do reparo."
                    : "A impossibilidade técnica só pode ser registrada antes da conclusão do reparo.",
                409
            );
        }

        if (tipo_encerramento === "IMPOSSIBILIDADE_TECNICA") {
            const [execucoes] = await conexao.execute(
                `SELECT id_execucao FROM execucao WHERE id_os = ?`,
                [id_os]
            );

            if (execucoes.length === 0) {
                throw erroComStatus("Registre o diagnóstico antes de encerrar por impossibilidade técnica.", 409);
            }
        }

        // Orçamentos pendentes já expirados passam a VENCIDO (com o seu próprio evento)
        await orcamentoRepository._vencerExpirados(conexao, id_os, false);

        await conexao.execute(
            `UPDATE ordem_servico
             SET status = 'ENCERRADA_SEM_REPARO',
                 data_encerramento = CURRENT_TIMESTAMP,
                 tipo_encerramento = ?,
                 motivo_encerramento = ?,
                 id_usuario_encerramento = ?
             WHERE id_os = ?`,
            [tipo_encerramento, motivo, id_usuario, id_os]
        );

        await historicoRepository.registrar(conexao, {
            id_os,
            id_usuario,
            tipo_evento: "ENCERRAMENTO",
            descricao: `OS encerrada sem reparo por ${DESCRICOES[tipo_encerramento]}.`,
            dados_anteriores: { status_os: statusAnterior },
            dados_novos: {
                status_os: "ENCERRADA_SEM_REPARO",
                tipo_encerramento,
                motivo_encerramento: motivo
            }
        });

        // RN12: orçamentos ainda pendentes são cancelados (respostas e orçamentos anteriores ficam)
        const [orcamentos] = await conexao.execute(
            `SELECT id_orcamento
             FROM orcamento
             WHERE id_os = ?
               AND status = 'PENDENTE'
             FOR UPDATE`,
            [id_os]
        );

        for (const { id_orcamento } of orcamentos) {
            await conexao.execute(
                `UPDATE orcamento SET status = 'CANCELADO' WHERE id_orcamento = ?`,
                [id_orcamento]
            );
            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario,
                tipo_evento: "ORCAMENTO",
                descricao: `Orçamento nº ${id_orcamento} cancelado pelo encerramento da OS.`,
                dados_anteriores: { id_orcamento, status: "PENDENTE" },
                dados_novos: { id_orcamento, status: "CANCELADO" }
            });
        }

        // RN13: pagamentos pendentes são cancelados; confirmados e reembolsados são preservados
        const [pagamentos] = await conexao.execute(
            `SELECT id_pagamento, valor
             FROM pagamento
             WHERE id_os = ?
               AND status = 'PENDENTE'
             FOR UPDATE`,
            [id_os]
        );

        for (const { id_pagamento, valor } of pagamentos) {
            await conexao.execute(
                `UPDATE pagamento SET status = 'CANCELADO' WHERE id_pagamento = ?`,
                [id_pagamento]
            );
            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario,
                tipo_evento: "PAGAMENTO",
                descricao: `Pagamento nº ${id_pagamento} cancelado pelo encerramento da OS.`,
                dados_anteriores: { id_pagamento, status: "PENDENTE" },
                dados_novos: { id_pagamento, status: "CANCELADO", valor }
            });
        }

        await conexao.commit();

        return {
            id_os,
            status: "ENCERRADA_SEM_REPARO",
            tipo_encerramento,
            orcamentos_cancelados: orcamentos.map((o) => o.id_orcamento),
            pagamentos_cancelados: pagamentos.map((p) => p.id_pagamento)
        };
    } catch (erro) {
        await conexao.rollback();
        throw erro;
    } finally {
        conexao.release();
    }
}

module.exports = {
    ETAPAS_PERMITIDAS,
    encerrarSemReparo
};
