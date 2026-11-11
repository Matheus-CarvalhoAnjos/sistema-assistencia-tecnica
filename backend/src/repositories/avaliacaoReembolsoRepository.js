const { pool } = require("../config/database");
const historicoRepository = require("./historicoRepository");

/*
 * Avaliação financeira da OS e cálculo do valor disponível para devolução
 * (decisões D1–D6 de 09/11/2026; documentacao/PROPOSTA_REEMBOLSO_PARCIAL.md).
 *
 * - Linhas de avaliacao_reembolso são imutáveis: correção = nova linha (revisão).
 * - Toda operação financeira que grava bloqueia primeiro a OS (SELECT ... FOR UPDATE);
 *   as leituras seguintes usam leitura com bloqueio, portanto enxergam o último estado confirmado.
 */

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

const centavos = (valor) => Math.round(Number(valor || 0) * 100);
const reais = (c) => c / 100;
const formatar = (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`;

/**
 * Situação financeira de devolução da OS.
 * @param executor conexão da transação (com a OS já bloqueada) ou o pool para consulta
 * @param bloquear true dentro de transação de gravação (leituras com FOR UPDATE)
 */
async function situacao(executor, id_os, bloquear = false) {
    const travar = bloquear ? " FOR UPDATE" : "";

    const [ordens] = await executor.execute(
        `SELECT id_os, status, tipo_encerramento FROM ordem_servico WHERE id_os = ?${travar}`,
        [id_os]
    );

    if (ordens.length === 0) {
        throw erroComStatus("Ordem de serviço não encontrada.", 404);
    }

    const [aprovados] = await executor.execute(
        `SELECT id_orcamento FROM orcamento WHERE id_os = ? AND status = 'APROVADO' LIMIT 1`,
        [id_os]
    );

    // Pagamentos confirmados e quanto de cada um já foi devolvido
    const [pagamentos] = await executor.execute(
        `SELECT p.id_pagamento, p.valor,
                (SELECT COALESCE(SUM(r.valor), 0) FROM reembolso r WHERE r.id_pagamento = p.id_pagamento) AS reembolsado
         FROM pagamento p
         WHERE p.id_os = ? AND p.status = 'CONFIRMADO'
         ORDER BY p.id_pagamento${travar}`,
        [id_os]
    );

    const [avaliacoes] = await executor.execute(
        `SELECT a.id_avaliacao, a.id_os, a.id_avaliacao_revisada, a.valor_definido, a.justificativa,
                a.motivo_revisao, a.id_usuario, u.nome AS nome_usuario, a.data_avaliacao
         FROM avaliacao_reembolso a
         LEFT JOIN usuario u ON u.id_usuario = a.id_usuario
         WHERE a.id_os = ?
         ORDER BY a.id_avaliacao`,
        [id_os]
    );

    const [[soma]] = await executor.execute(
        `SELECT COALESCE(SUM(r.valor), 0) AS total
         FROM reembolso r
         INNER JOIN avaliacao_reembolso a ON a.id_avaliacao = r.id_avaliacao
         WHERE a.id_os = ?`,
        [id_os]
    );

    const ordem = ordens[0];
    const disponivelCentavos = pagamentos.reduce(
        (total, p) => total + Math.max(0, centavos(p.valor) - centavos(p.reembolsado)),
        0
    );
    const reembolsadoAvaliacaoCentavos = centavos(soma?.total);

    // R1: IMPOSSIBILIDADE_TECNICA com orçamento APROVADO (prova de EM_REPARO) e pagamento CONFIRMADO.
    // Depois de avaliada, a OS continua "obrigatória" mesmo que os pagamentos tenham sido devolvidos.
    const obrigatoria = ordem.tipo_encerramento === "IMPOSSIBILIDADE_TECNICA" &&
        aprovados.length > 0 &&
        (pagamentos.length > 0 || avaliacoes.length > 0);

    const lista = avaliacoes.map((a) => ({
        ...a,
        valor_definido: Number(a.valor_definido),
        tipo: a.id_avaliacao_revisada ? "REVISAO" : "ORIGINAL"
    }));
    // Cadeia linear (id_avaliacao_revisada é UNIQUE): a vigente é a última gravada
    const vigente = lista.length ? lista[lista.length - 1] : null;

    return {
        id_os: Number(ordem.id_os),
        status_os: ordem.status,
        tipo_encerramento: ordem.tipo_encerramento,
        obrigatoria,
        pendente: obrigatoria && !vigente,
        vigente,
        avaliacoes: lista,
        total_disponivel: reais(disponivelCentavos),
        total_reembolsado_avaliacao: reais(reembolsadoAvaliacaoCentavos),
        saldo_a_reembolsar: vigente
            ? reais(Math.max(0, centavos(vigente.valor_definido) - reembolsadoAvaliacaoCentavos))
            : null,
        // Valores em centavos para as regras (não expostos pela API)
        _disponivel_centavos: disponivelCentavos,
        _reembolsado_avaliacao_centavos: reembolsadoAvaliacaoCentavos
    };
}

function semCamposInternos(s) {
    const { _disponivel_centavos, _reembolsado_avaliacao_centavos, ...publico } = s;
    return publico;
}

/**
 * Registra a avaliação original (dados.id_avaliacao_revisada ausente) ou uma revisão.
 * @param dados { id_os, valor_centavos, justificativa, motivo_revisao?, id_avaliacao_revisada?, id_usuario }
 */
async function registrar(dados) {
    const conexao = await pool.getConnection();
    const revisao = dados.id_avaliacao_revisada !== undefined && dados.id_avaliacao_revisada !== null;

    try {
        await conexao.beginTransaction();

        // Bloqueia a OS: avaliações e reembolsos da mesma OS ficam em fila
        const atual = await situacao(conexao, dados.id_os, true);

        if (!atual.obrigatoria) {
            throw erroComStatus(
                "A avaliação financeira só se aplica a OS encerrada por impossibilidade técnica durante o reparo, com pagamento confirmado.",
                409
            );
        }

        if (!revisao && atual.vigente) {
            throw erroComStatus("Esta OS já possui avaliação financeira. Para corrigir, registre uma revisão.", 409);
        }

        if (revisao) {
            if (!atual.vigente) {
                throw erroComStatus("Não há avaliação financeira para revisar.", 409);
            }
            if (Number(dados.id_avaliacao_revisada) !== Number(atual.vigente.id_avaliacao)) {
                throw erroComStatus("A avaliação foi alterada por outra revisão. Atualize a página e confira a avaliação vigente.", 409);
            }
        }

        // Mínimo: o que já foi devolvido sob avaliação; máximo: isso + o que ainda pode ser devolvido
        const minimo = atual._reembolsado_avaliacao_centavos;
        const maximo = minimo + atual._disponivel_centavos;

        if (dados.valor_centavos < minimo) {
            throw erroComStatus(`O valor definido não pode ser menor que o já reembolsado (${formatar(minimo)}).`, 409);
        }
        if (dados.valor_centavos > maximo) {
            throw erroComStatus(`O valor definido não pode ultrapassar o valor disponível para devolução (${formatar(maximo)}).`, 409);
        }

        const [resultado] = await conexao.execute(
            `INSERT INTO avaliacao_reembolso (
                id_os, id_avaliacao_revisada, valor_definido, justificativa, motivo_revisao, id_usuario
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                dados.id_os,
                revisao ? Number(dados.id_avaliacao_revisada) : null,
                reais(dados.valor_centavos),
                dados.justificativa,
                revisao ? dados.motivo_revisao : null,
                dados.id_usuario
            ]
        );

        await historicoRepository.registrar(conexao, {
            id_os: dados.id_os,
            id_usuario: dados.id_usuario,
            tipo_evento: "PAGAMENTO",
            descricao: revisao
                ? `Avaliação financeira revisada: reembolso definido em ${formatar(dados.valor_centavos)}.`
                : `Avaliação financeira registrada: reembolso definido em ${formatar(dados.valor_centavos)}.`,
            dados_anteriores: revisao
                ? { id_avaliacao: atual.vigente.id_avaliacao, valor_definido: atual.vigente.valor_definido }
                : null,
            dados_novos: {
                id_avaliacao: resultado.insertId,
                id_avaliacao_revisada: revisao ? Number(dados.id_avaliacao_revisada) : undefined,
                valor_definido: reais(dados.valor_centavos),
                justificativa: dados.justificativa,
                motivo_revisao: revisao ? dados.motivo_revisao : undefined
            }
        });

        await conexao.commit();
    } catch (erro) {
        await conexao.rollback();
        if (erro && erro.code === "ER_DUP_ENTRY") {
            throw erroComStatus("A avaliação foi registrada ou revisada por outra pessoa ao mesmo tempo. Atualize a página.", 409);
        }
        throw erro;
    } finally {
        conexao.release();
    }

    return semCamposInternos(await situacao(pool, dados.id_os));
}

async function consultar(id_os) {
    return semCamposInternos(await situacao(pool, id_os));
}

module.exports = { situacao, registrar, consultar, semCamposInternos, formatar };
