const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const AcessorioRecebido = require("../models/acessorioRecebido");
const historicoRepository = require("./historicoRepository");

// D7: inclusão permitida somente com a OS ativa antes da conclusão do reparo
const ETAPAS_PERMITIDAS = ["RECEBIDA", "EM_ANALISE", "AGUARDANDO_APROVACAO", "EM_REPARO"];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

/**
 * Bloqueia a OS do equipamento e confere etapa e técnico (D7), dentro da transação.
 * acessorio_recebido pertence ao item da solicitação: a OS é a da URL (contexto.id_os) ou a
 * OS atual do equipamento (a mais recente do item; o backend garante uma só OS ativa).
 * @returns id da OS que recebe o evento do histórico
 */
async function bloquearOsDoItem(conexao, idItem, contexto) {
    const [ordens] = contexto.id_os
        ? await conexao.execute(
            `SELECT id_os, id_item, status, id_tecnico FROM ordem_servico WHERE id_os = ? FOR UPDATE`,
            [contexto.id_os]
        )
        : await conexao.execute(
            `SELECT id_os, id_item, status, id_tecnico
             FROM ordem_servico
             WHERE id_item = ?
             ORDER BY id_os DESC
             LIMIT 1
             FOR UPDATE`,
            [idItem]
        );

    const ordem = ordens[0];

    if (!ordem || Number(ordem.id_item) !== Number(idItem)) {
        throw erroComStatus("O equipamento não possui ordem de serviço.", 409);
    }

    if (!ETAPAS_PERMITIDAS.includes(ordem.status)) {
        throw erroComStatus(
            `Não é possível registrar ou alterar acessórios: a OS nº ${ordem.id_os} está em ${ordem.status}.`,
            409
        );
    }

    if (String(contexto.perfil).toUpperCase() === "TECNICO" &&
        Number(ordem.id_tecnico) !== Number(contexto.id_usuario)) {
        throw erroComStatus("Somente o técnico atribuído à OS pode registrar ou alterar acessórios nela.", 403);
    }

    return Number(ordem.id_os);
}

const normalizarTexto = (valor) => (valor === undefined || valor === null || valor === "" ? null : valor);

class AcessorioRecebidoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    async verificarItemExiste(id_item) {
        const linha = await this.buscarUm(
            `SELECT id_item
             FROM item_solicitacao
             WHERE id_item = ?`,
            [id_item]
        );

        return !!linha;
    }

    async listarPorItem(id_item) {
        const linhas = await this.buscarTodos(
            `SELECT ar.*,
                    a.descricao AS descricao_acessorio,
                    a.preco_atual
             FROM acessorio_recebido ar
             INNER JOIN acessorio a
                 ON a.id_acessorio = ar.id_acessorio
             WHERE ar.id_item = ?
             ORDER BY ar.id_acessorio_recebido ASC`,
            [id_item]
        );

        return linhas.map((linha) => new AcessorioRecebido(linha));
    }

    async buscarPorId(id) {
        const linha = await this.buscarUm(
            `SELECT *
             FROM acessorio_recebido
             WHERE id_acessorio_recebido = ?`,
            [id]
        );

        return linha ? new AcessorioRecebido(linha) : null;
    }

    /**
     * Grava vários registros em UMA transação: ou todos são gravados, ou nenhum (D7, P4).
     *
     * acessorio_recebido pertence ao item da solicitação; o evento do histórico vai para a
     * OS atual do equipamento (a mais recente do item; o backend garante uma só OS ativa).
     * Pela rota da OS (contexto.id_os) a OS é a da URL.
     * Etapa e técnico são conferidos aqui, com a OS bloqueada, para não haver corrida com
     * conclusão, encerramento ou troca de técnico.
     *
     * @param registros [{ id_item, id_acessorio, descricao_acessorio, quantidade, observacoes }]
     * @param contexto { id_usuario, perfil, id_os? }
     */
    async criarVarios(registros, contexto = {}) {
        const conexao = await this.pool.getConnection();
        const ids = [];

        try {
            await conexao.beginTransaction();

            // Bloqueia as OS em ordem crescente de item (evita deadlock entre lotes)
            const itens = [...new Set(registros.map((r) => Number(r.id_item)))].sort((a, b) => a - b);
            const osPorItem = new Map();

            for (const idItem of itens) {
                osPorItem.set(idItem, await bloquearOsDoItem(conexao, idItem, contexto));
            }

            for (const dados of registros) {
                const [resultado] = await conexao.execute(
                    `INSERT INTO acessorio_recebido (
                        id_item,
                        id_acessorio,
                        quantidade,
                        observacoes
                    ) VALUES (?, ?, ?, ?)`,
                    [dados.id_item, dados.id_acessorio, dados.quantidade, dados.observacoes ?? null]
                );
                ids.push(resultado.insertId);

                await historicoRepository.registrar(conexao, {
                    id_os: osPorItem.get(Number(dados.id_item)),
                    id_usuario: contexto.id_usuario ?? null,
                    tipo_evento: "ACESSORIO",
                    descricao: `Acessório recebido registrado: ${dados.quantidade}× ${dados.descricao_acessorio ?? "acessório nº " + dados.id_acessorio}.`,
                    dados_novos: {
                        id_acessorio_recebido: resultado.insertId,
                        id_item: Number(dados.id_item),
                        id_acessorio: Number(dados.id_acessorio),
                        descricao_acessorio: dados.descricao_acessorio,
                        quantidade: dados.quantidade,
                        observacoes: dados.observacoes ?? undefined
                    }
                });
            }

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        const criados = [];
        for (const id of ids) {
            criados.push(await this.buscarPorId(id));
        }
        return criados;
    }

    /**
     * Alteração de um acessório recebido (D7): mesmas permissões e etapas da inclusão.
     * Ordem de bloqueio igual à da inclusão (OS e depois o registro). Grava evento ACESSORIO
     * na OS do equipamento com os valores anteriores e novos, somente dos campos que mudaram.
     * Sem mudança: nada é gravado.
     *
     * @param dados { id_acessorio?, descricao_acessorio?, quantidade?, observacoes? } (undefined = manter)
     * @param contexto { id_usuario, perfil, id_os? }
     * @returns { registro, alterado }
     */
    async atualizar(id_acessorio_recebido, dados, contexto = {}) {
        const inicial = await this.buscarPorId(id_acessorio_recebido);

        if (!inicial) {
            throw erroComStatus("Acessório recebido não encontrado.", 404);
        }

        const conexao = await this.pool.getConnection();
        let alterado = false;

        try {
            await conexao.beginTransaction();

            const idOs = await bloquearOsDoItem(conexao, inicial.id_item, contexto);

            const [linhas] = await conexao.execute(
                `SELECT ar.id_acessorio_recebido, ar.id_item, ar.id_acessorio, ar.quantidade, ar.observacoes,
                        a.descricao AS descricao_acessorio
                 FROM acessorio_recebido ar
                 INNER JOIN acessorio a ON a.id_acessorio = ar.id_acessorio
                 WHERE ar.id_acessorio_recebido = ?
                 FOR UPDATE`,
                [id_acessorio_recebido]
            );

            const atual = linhas[0];

            if (!atual) {
                throw erroComStatus("Acessório recebido não encontrado.", 404);
            }

            const novo = {
                id_acessorio: dados.id_acessorio ?? Number(atual.id_acessorio),
                quantidade: dados.quantidade ?? Number(atual.quantidade),
                observacoes: dados.observacoes === undefined ? normalizarTexto(atual.observacoes) : normalizarTexto(dados.observacoes)
            };

            const anteriores = { id_acessorio_recebido: Number(id_acessorio_recebido) };
            const novos = { id_acessorio_recebido: Number(id_acessorio_recebido) };

            if (novo.id_acessorio !== Number(atual.id_acessorio)) {
                anteriores.id_acessorio = Number(atual.id_acessorio);
                anteriores.descricao_acessorio = atual.descricao_acessorio;
                novos.id_acessorio = novo.id_acessorio;
                novos.descricao_acessorio = dados.descricao_acessorio;
            }
            if (novo.quantidade !== Number(atual.quantidade)) {
                anteriores.quantidade = Number(atual.quantidade);
                novos.quantidade = novo.quantidade;
            }
            if (novo.observacoes !== normalizarTexto(atual.observacoes)) {
                anteriores.observacoes = normalizarTexto(atual.observacoes);
                novos.observacoes = novo.observacoes;
            }

            alterado = Object.keys(novos).length > 1;

            if (alterado) {
                await conexao.execute(
                    `UPDATE acessorio_recebido
                     SET id_acessorio = ?, quantidade = ?, observacoes = ?
                     WHERE id_acessorio_recebido = ?`,
                    [novo.id_acessorio, novo.quantidade, novo.observacoes, id_acessorio_recebido]
                );

                await historicoRepository.registrar(conexao, {
                    id_os: idOs,
                    id_usuario: contexto.id_usuario ?? null,
                    tipo_evento: "ACESSORIO",
                    descricao: `Acessório recebido nº ${id_acessorio_recebido} alterado.`,
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

        return { registro: await this.buscarPorId(id_acessorio_recebido), alterado };
    }
}

module.exports = new AcessorioRecebidoRepository();
