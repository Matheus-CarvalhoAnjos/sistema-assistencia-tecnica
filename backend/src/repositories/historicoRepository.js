const { pool } = require("../config/database");

/*
 * Histórico da Ordem de Serviço (MER v1.4, RN21).
 *
 * - Os eventos são gravados pela MESMA conexão da operação principal, dentro da
 *   mesma transação: ou os dois são confirmados, ou os dois são desfeitos.
 * - Os registros são permanentes: este repository só insere e consulta
 *   (não há atualização nem exclusão pela aplicação).
 * - dados_anteriores / dados_novos aceitam apenas campos da lista abaixo,
 *   para nunca gravar senha, hash, token ou outro dado sensível.
 */

const TIPOS_EVENTO = [
    "CRIACAO",
    "ATRIBUICAO_TECNICO",
    "DIAGNOSTICO",
    "GARANTIA",
    "ORCAMENTO",
    "REPARO",
    "ENCERRAMENTO",
    "PAGAMENTO",
    "EXPEDICAO",
    // D7 (P4): inclusão de acessório depois da abertura. Exige a migração 20261109_03_historico_evento_acessorio.sql
    "ACESSORIO",
    // R1 (A6): registro e cancelamento de abatimentos. Exige a migração 20261109_04_abatimento_formal.sql
    "ABATIMENTO"
];

const CAMPOS_PERMITIDOS = new Set([
    "status", "status_os", "garantia_status", "garantia_herdada_da_os",
    "id_item", "id_solicitacao", "id_tecnico",
    "diagnostico", "laudo_tecnico", "resultado", "data_inicio", "data_conclusao",
    "id_orcamento", "valor_total", "data_validade", "decisao", "observacoes",
    "tipo_encerramento", "motivo_encerramento",
    "id_pagamento", "valor", "forma_pagamento", "justificativa_reembolso",
    "id_expedicao", "forma_entrega", "codigo_rastreio",
    // Avaliação financeira e reembolso parcial (D1–D6)
    "id_avaliacao", "id_avaliacao_revisada", "valor_definido", "justificativa", "motivo_revisao",
    "id_reembolso", "valor_reembolso", "valor_reembolsado", "valor_disponivel",
    // Acessórios recebidos (D7)
    "id_acessorio_recebido", "id_acessorio", "descricao_acessorio", "quantidade",
    // Abatimento formal (R1)
    "id_abatimento", "motivo", "justificativa_cancelamento", "total_devido", "saldo"
]);

function filtrarDados(dados) {
    if (!dados) {
        return null;
    }

    const filtrado = {};

    for (const [campo, valor] of Object.entries(dados)) {
        if (!CAMPOS_PERMITIDOS.has(campo)) {
            throw new Error(`Campo não permitido no histórico da OS: ${campo}`);
        }
        if (valor !== undefined) {
            filtrado[campo] = valor instanceof Date ? valor.toISOString() : valor;
        }
    }

    return Object.keys(filtrado).length > 0 ? JSON.stringify(filtrado) : null;
}

/**
 * Grava um evento usando a conexão (transação) da operação principal.
 * @param conexao conexão com a transação aberta
 * @param evento { id_os, id_usuario (null = automático), tipo_evento, descricao, dados_anteriores, dados_novos }
 */
async function registrar(conexao, evento) {
    if (!TIPOS_EVENTO.includes(evento.tipo_evento)) {
        throw new Error(`Tipo de evento inválido: ${evento.tipo_evento}`);
    }

    if (!evento.id_os || !evento.descricao) {
        throw new Error("O evento do histórico precisa da OS e da descrição.");
    }

    await conexao.execute(
        `INSERT INTO historico_os (
            id_os,
            id_usuario,
            tipo_evento,
            descricao,
            data_evento,
            dados_anteriores,
            dados_novos
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
        [
            evento.id_os,
            evento.id_usuario ?? null,
            evento.tipo_evento,
            evento.descricao,
            filtrarDados(evento.dados_anteriores),
            filtrarDados(evento.dados_novos)
        ]
    );
}

/** Eventos da OS em ordem cronológica (empate na data: ordem de gravação). */
async function listarPorOs(id_os) {
    const [linhas] = await pool.execute(
        `SELECT h.id_historico,
                h.id_os,
                h.id_usuario,
                u.nome AS nome_usuario,
                h.tipo_evento,
                h.descricao,
                h.data_evento,
                h.dados_anteriores,
                h.dados_novos
         FROM historico_os h
         LEFT JOIN usuario u
             ON u.id_usuario = h.id_usuario
         WHERE h.id_os = ?
         ORDER BY h.data_evento, h.id_historico`,
        [id_os]
    );

    return linhas;
}

module.exports = {
    TIPOS_EVENTO,
    registrar,
    listarPorOs
};
