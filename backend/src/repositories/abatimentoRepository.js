const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const Abatimento = require("../models/abatimento");
const historicoRepository = require("./historicoRepository");
const pagamentoRepository = require("./pagamentoRepository");

/*
 * Abatimento formal (regra R1; decisões A1–A8, C1, C2).
 * - Reduz o total devido sem alterar o orçamento aprovado.
 * - Nasce APROVADO (A1); o cancelamento preserva o registro (A5).
 * - Toda gravação bloqueia primeiro a OS (SELECT ... FOR UPDATE), na mesma ordem das demais
 *   operações financeiras, e recalcula os valores antes de gravar (A4).
 * - Nenhuma operação altera ordem_servico, orcamento ou expedicao (AB7).
 */

// A3: etapas em que o abatimento pode ser registrado ou cancelado
const ETAPAS_PERMITIDAS = ["EM_REPARO", "CONCLUIDA", "AGUARDANDO_EXPEDICAO"];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

const formatar = (centavos) => `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

function resumoFinanceiro(valores) {
    return {
        total_devido: valores.total_devido_centavos / 100,
        saldo: Math.max(0, valores.total_devido_centavos - valores.total_confirmado_centavos) / 100
    };
}

async function bloquearOs(conexao, id_os) {
    const [ordens] = await conexao.execute(
        `SELECT id_os, status FROM ordem_servico WHERE id_os = ? FOR UPDATE`,
        [id_os]
    );

    if (ordens.length === 0) {
        throw erroComStatus("Ordem de serviço não encontrada.", 404);
    }

    return ordens[0];
}

class AbatimentoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async listarPorOs(id_os) {
        const linhas = await this.buscarTodos(
            `SELECT a.*, ur.nome AS nome_usuario_registro, uc.nome AS nome_usuario_cancelamento
             FROM abatimento a
             LEFT JOIN usuario ur ON ur.id_usuario = a.id_usuario_registro
             LEFT JOIN usuario uc ON uc.id_usuario = a.id_usuario_cancelamento
             WHERE a.id_os = ?
             ORDER BY a.id_abatimento`,
            [id_os]
        );
        return linhas.map((linha) => new Abatimento(linha));
    }

    async buscarPorId(id_abatimento) {
        const linha = await this.buscarUm(
            `SELECT a.*, ur.nome AS nome_usuario_registro, uc.nome AS nome_usuario_cancelamento
             FROM abatimento a
             LEFT JOIN usuario ur ON ur.id_usuario = a.id_usuario_registro
             LEFT JOIN usuario uc ON uc.id_usuario = a.id_usuario_cancelamento
             WHERE a.id_abatimento = ?`,
            [id_abatimento]
        );
        return linha ? new Abatimento(linha) : null;
    }

    /**
     * Registro (A1, A3, A4). O abatimento se vincula ao orçamento APROVADO da OS.
     * @param dados { id_os, valor_centavos, motivo, id_usuario }
     */
    async registrar(dados) {
        const conexao = await this.pool.getConnection();
        let idAbatimento;

        try {
            await conexao.beginTransaction();

            const ordem = await bloquearOs(conexao, dados.id_os);

            if (!ETAPAS_PERMITIDAS.includes(ordem.status)) {
                throw erroComStatus(
                    `Não é possível registrar abatimento: a OS está em ${ordem.status}. Permitido em EM_REPARO, CONCLUIDA ou AGUARDANDO_EXPEDICAO.`,
                    409
                );
            }

            // Recalcula com a OS bloqueada (A4)
            const antes = await pagamentoRepository.buscarValoresOs(dados.id_os, conexao);

            if (!antes.tem_orcamento_aprovado || !antes.id_orcamento_aprovado) {
                throw erroComStatus("Não existe orçamento aprovado para esta ordem de serviço.", 409);
            }

            const disponivel = antes.total_devido_centavos - antes.total_confirmado_centavos - antes.total_pendente_centavos;

            if (dados.valor_centavos > disponivel) {
                throw erroComStatus(
                    `O abatimento ultrapassa o valor ainda devido (disponível: ${formatar(Math.max(0, disponivel))}, já descontados os pagamentos confirmados e pendentes).`,
                    409
                );
            }

            const [resultado] = await conexao.execute(
                `INSERT INTO abatimento (id_os, id_orcamento, valor, motivo, status, id_usuario_registro)
                 VALUES (?, ?, ?, ?, 'APROVADO', ?)`,
                [dados.id_os, antes.id_orcamento_aprovado, dados.valor_centavos / 100, dados.motivo, dados.id_usuario]
            );
            idAbatimento = resultado.insertId;

            const depois = await pagamentoRepository.buscarValoresOs(dados.id_os, conexao);

            await historicoRepository.registrar(conexao, {
                id_os: dados.id_os,
                id_usuario: dados.id_usuario,
                tipo_evento: "ABATIMENTO",
                descricao: `Abatimento nº ${idAbatimento} de ${formatar(dados.valor_centavos)} registrado.`,
                dados_anteriores: resumoFinanceiro(antes),
                dados_novos: {
                    id_abatimento: idAbatimento,
                    id_orcamento: antes.id_orcamento_aprovado,
                    valor: dados.valor_centavos / 100,
                    motivo: dados.motivo,
                    status: "APROVADO",
                    ...resumoFinanceiro(depois)
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorId(idAbatimento);
    }

    /**
     * Cancelamento (A5, C1): antes da entrega ou retirada; registro preservado.
     * @param dados { justificativa, id_usuario }
     */
    async cancelar(id_abatimento, dados) {
        const inicial = await this.buscarPorId(id_abatimento);

        if (!inicial) {
            throw erroComStatus("Abatimento não encontrado.", 404);
        }

        const conexao = await this.pool.getConnection();

        try {
            await conexao.beginTransaction();

            const ordem = await bloquearOs(conexao, inicial.id_os);

            if (!ETAPAS_PERMITIDAS.includes(ordem.status)) {
                throw erroComStatus(
                    `Não é possível cancelar o abatimento: a OS está em ${ordem.status} (cancelamento só antes da entrega ou retirada).`,
                    409
                );
            }

            const [linhas] = await conexao.execute(
                `SELECT id_abatimento, id_os, valor, status FROM abatimento WHERE id_abatimento = ? FOR UPDATE`,
                [id_abatimento]
            );

            if (linhas[0]?.status !== "APROVADO") {
                throw erroComStatus("Este abatimento já foi cancelado.", 409);
            }

            const antes = await pagamentoRepository.buscarValoresOs(inicial.id_os, conexao);

            await conexao.execute(
                `UPDATE abatimento
                 SET status = 'CANCELADO',
                     id_usuario_cancelamento = ?,
                     data_cancelamento = CURRENT_TIMESTAMP,
                     justificativa_cancelamento = ?
                 WHERE id_abatimento = ?`,
                [dados.id_usuario, dados.justificativa, id_abatimento]
            );

            const depois = await pagamentoRepository.buscarValoresOs(inicial.id_os, conexao);
            const valorCentavos = Math.round(Number(linhas[0].valor) * 100);

            await historicoRepository.registrar(conexao, {
                id_os: inicial.id_os,
                id_usuario: dados.id_usuario,
                tipo_evento: "ABATIMENTO",
                descricao: `Abatimento nº ${id_abatimento} de ${formatar(valorCentavos)} cancelado.`,
                dados_anteriores: { id_abatimento: Number(id_abatimento), status: "APROVADO", ...resumoFinanceiro(antes) },
                dados_novos: {
                    id_abatimento: Number(id_abatimento),
                    status: "CANCELADO",
                    valor: valorCentavos / 100,
                    justificativa_cancelamento: dados.justificativa,
                    ...resumoFinanceiro(depois)
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorId(id_abatimento);
    }
}

module.exports = new AbatimentoRepository();
module.exports.ETAPAS_PERMITIDAS = ETAPAS_PERMITIDAS;
