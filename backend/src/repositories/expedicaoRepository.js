const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const Expedicao = require("../models/expedicao");
const pagamentoRepository = require("./pagamentoRepository");
const historicoRepository = require("./historicoRepository");

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

// RN19 (MER v1.4): status inicial e transições permitidas para cada forma de entrega
const STATUS_INICIAL = { ENVIO: "PENDENTE", RETIRADA: "AGUARDANDO_RETIRADA" };
const PROXIMO_STATUS = {
    ENVIO: { PENDENTE: "EM_TRANSITO", EM_TRANSITO: "ENTREGUE" },
    RETIRADA: { AGUARDANDO_RETIRADA: "RETIRADO" }
};
const STATUS_FINAIS = ["ENTREGUE", "RETIRADO"];

class ExpedicaoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async buscarPorOs(id_os) {
        const linha = await this.buscarUm(
            `SELECT id_expedicao, id_os, id_usuario, data_envio,
                    forma_entrega, codigo_rastreio, status, data_entrega
             FROM expedicao
             WHERE id_os = ?`,
            [id_os]
        );

        return linha ? new Expedicao(linha) : null;
    }

    async criar(dados) {
        const conexao = await this.pool.getConnection();
        let idExpedicao;

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

            const ordem = ordens[0];
            const semReparo = ordem.status === "ENCERRADA_SEM_REPARO";

            if (!semReparo && !["CONCLUIDA", "AGUARDANDO_EXPEDICAO"].includes(ordem.status)) {
                throw erroComStatus("A ordem de serviço ainda não está liberada para expedição.", 409);
            }

            if (!semReparo) {
                const valores = await pagamentoRepository.buscarValoresOs(dados.id_os, conexao);

                if (!valores.tem_orcamento_aprovado) {
                    // Reparo em garantia (garantia SIM): não há orçamento nem cobrança; o total devido é zero
                    const [garantias] = await conexao.execute(
                        `SELECT garantia_status FROM ordem_servico WHERE id_os = ?`,
                        [dados.id_os]
                    );

                    if (garantias?.[0]?.garantia_status !== "SIM") {
                        throw erroComStatus("A expedição exige um orçamento aprovado.", 409);
                    }
                }

                if (valores.total_confirmado_centavos < valores.total_devido_centavos) { // RN20 com R1: quitação sobre o total devido
                    throw erroComStatus("A expedição exige a quitação do orçamento aprovado.", 409);
                }
            }

            const [expedicoes] = await conexao.execute(
                `SELECT id_expedicao
                 FROM expedicao
                 WHERE id_os = ?
                 FOR UPDATE`,
                [dados.id_os]
            );

            if (expedicoes.length > 0) {
                throw erroComStatus("Já existe uma expedição registrada para esta ordem de serviço.", 409);
            }

            const [resultado] = await conexao.execute(
                `INSERT INTO expedicao (
                    id_os,
                    id_usuario,
                    data_envio,
                    forma_entrega,
                    codigo_rastreio,
                    status
                ) VALUES (?, ?, NULL, ?, ?, ?)`,
                [dados.id_os, dados.id_usuario, dados.forma_entrega, dados.codigo_rastreio, STATUS_INICIAL[dados.forma_entrega]]
            );

            idExpedicao = resultado.insertId;
            const aguardaExpedicao = !semReparo && ordem.status === "CONCLUIDA";

            if (aguardaExpedicao) {
                await conexao.execute(
                    `UPDATE ordem_servico
                     SET status = 'AGUARDANDO_EXPEDICAO'
                     WHERE id_os = ?`,
                    [dados.id_os]
                );
            }

            await historicoRepository.registrar(conexao, {
                id_os: dados.id_os,
                id_usuario: dados.id_usuario,
                tipo_evento: "EXPEDICAO",
                descricao: `Devolução registrada por ${dados.forma_entrega}.`,
                dados_anteriores: aguardaExpedicao ? { status_os: ordem.status } : null,
                dados_novos: {
                    id_expedicao: idExpedicao,
                    forma_entrega: dados.forma_entrega,
                    status: STATUS_INICIAL[dados.forma_entrega],
                    codigo_rastreio: dados.codigo_rastreio ?? null,
                    status_os: aguardaExpedicao ? "AGUARDANDO_EXPEDICAO" : undefined
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();

            if (erro.code === "ER_DUP_ENTRY") {
                throw erroComStatus("Já existe uma expedição registrada para esta ordem de serviço.", 409);
            }

            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorOs(dados.id_os);
    }

    async atualizarStatus(id_os, status, codigo_rastreio = null, id_usuario = null) {
        const expedicaoInicial = await this.buscarPorOs(id_os);

        if (!expedicaoInicial) {
            throw erroComStatus("Expedição não encontrada.", 404);
        }

        const conexao = await this.pool.getConnection();
        let ordem;

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

            const [expedicoes] = await conexao.execute(
                `SELECT id_expedicao, id_os, forma_entrega, status
                 FROM expedicao
                 WHERE id_os = ?
                 FOR UPDATE`,
                [id_os]
            );

            if (expedicoes.length === 0) {
                throw erroComStatus("Expedição não encontrada.", 404);
            }

            ordem = expedicoes[0];
            ordem.status_os = ordens[0].status;

            const esperado = PROXIMO_STATUS[ordem.forma_entrega]?.[ordem.status];

            if (!esperado) {
                throw erroComStatus("Esta expedição já foi concluída e não pode ter o status alterado.", 409);
            }

            if (status !== esperado) {
                throw erroComStatus(
                    `Transição inválida para ${ordem.forma_entrega}: ${ordem.status} só pode passar para ${esperado}.`,
                    409
                );
            }

            const concluida = STATUS_FINAIS.includes(status);
            const comReparo = ordem.status_os === "AGUARDANDO_EXPEDICAO";

            // RN20: em OS com cobrança, a devolução só é concluída com o saldo zerado
            // (um reembolso depois do registro da expedição volta a deixar saldo)
            if (concluida && comReparo) {
                const valores = await pagamentoRepository.buscarValoresOs(id_os, conexao);

                if (valores.total_confirmado_centavos < valores.total_devido_centavos) { // RN20 com R1: quitação sobre o total devido
                    throw erroComStatus("A devolução exige a quitação do orçamento aprovado.", 409);
                }
            }

            await conexao.execute(
                `UPDATE expedicao
                 SET status = ?,
                     data_envio = CASE WHEN ? = 'EM_TRANSITO' THEN CURRENT_TIMESTAMP ELSE data_envio END,
                     codigo_rastreio = COALESCE(?, codigo_rastreio),
                     data_entrega = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE data_entrega END
                 WHERE id_os = ?`,
                [status, status, codigo_rastreio, concluida ? 1 : 0, id_os]
            );

            // RN19: OS reparada é FINALIZADA após entrega/retirada; OS sem reparo
            // permanece ENCERRADA_SEM_REPARO mesmo depois da devolução
            const finalizaOs = concluida && comReparo;

            if (finalizaOs) {
                await conexao.execute(
                    `UPDATE ordem_servico
                     SET status = 'FINALIZADA',
                         data_encerramento = CURRENT_TIMESTAMP
                     WHERE id_os = ?`,
                    [id_os]
                );
            }

            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario,
                tipo_evento: "EXPEDICAO",
                descricao: finalizaOs
                    ? `Expedição ${status}; OS finalizada.`
                    : `Expedição atualizada para ${status}.`,
                dados_anteriores: {
                    status: ordem.status,
                    status_os: finalizaOs ? ordem.status_os : undefined
                },
                dados_novos: {
                    status,
                    codigo_rastreio: codigo_rastreio ?? undefined,
                    status_os: finalizaOs ? "FINALIZADA" : undefined
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return await this.buscarPorOs(id_os);
    }
}

module.exports = new ExpedicaoRepository();
