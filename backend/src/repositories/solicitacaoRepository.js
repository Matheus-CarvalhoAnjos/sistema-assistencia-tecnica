
const { pool } = require("../config/database");
const historicoRepository = require("./historicoRepository");

class SolicitacaoRepository {

    async criar(dados) {
        const conexao = await pool.getConnection();

        try {
            await conexao.beginTransaction();

            // 1. Cadastrar a solicitação
            const [resultadoSolicitacao] = await conexao.execute(
                `INSERT INTO solicitacao
                (id_cliente, id_atendente, descricao_inicial)
                VALUES (?, ?, ?)`,
                [
                    dados.id_cliente,
                    dados.id_atendente,
                    dados.descricao_inicial
                ]
            );

            const idSolicitacao = resultadoSolicitacao.insertId;
            const itensInseridos = [];

            // 2. Cadastrar os equipamentos vinculados, suas OS e acessórios
            for (const item of dados.itens) {
                const [resultadoItem] = await conexao.execute(
                    `INSERT INTO item_solicitacao
                    (
                        id_solicitacao,
                        tipo_equipamento,
                        marca,
                        modelo,
                        numero_serie,
                        estado_fisico,
                        observacoes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        idSolicitacao,
                        item.tipo_equipamento,
                        item.marca,
                        item.modelo,
                        item.numero_serie ?? null,
                        item.estado_fisico,
                        item.observacoes ?? null
                    ]
                );

                const idItem = resultadoItem.insertId;

                // 3. Criar automaticamente uma OS para cada item cadastrado
                //    (a situação da garantia pertence à OS, não ao equipamento)
                const [resultadoOs] = await conexao.execute(
                    `INSERT INTO ordem_servico
                    (id_item, id_tecnico, status, garantia_status)
                    VALUES (?, ?, ?, ?)`,
                    [
                        idItem,
                        null,
                        "RECEBIDA",
                        item.garantia_status ?? "PENDENTE"
                    ]
                );

                // RN21: cada OS recebe o seu próprio evento de criação
                await historicoRepository.registrar(conexao, {
                    id_os: resultadoOs.insertId,
                    id_usuario: dados.id_atendente,
                    tipo_evento: "CRIACAO",
                    descricao: `OS aberta na solicitação nº ${idSolicitacao}.`,
                    dados_novos: {
                        status: "RECEBIDA",
                        garantia_status: item.garantia_status ?? "PENDENTE",
                        id_item: idItem,
                        id_solicitacao: idSolicitacao,
                        id_tecnico: null
                    }
                });

                // 4. Registrar os acessórios recebidos com o equipamento
                const acessoriosInseridos = [];

                for (const acessorio of item.acessorios ?? []) {
                    const [resultadoAcessorio] = await conexao.execute(
                        `INSERT INTO acessorio_recebido
                        (id_item, id_acessorio, quantidade, observacoes)
                        VALUES (?, ?, ?, ?)`,
                        [
                            idItem,
                            acessorio.id_acessorio,
                            acessorio.quantidade,
                            acessorio.observacoes ?? null
                        ]
                    );

                    acessoriosInseridos.push({
                        id_acessorio_recebido: resultadoAcessorio.insertId,
                        id_acessorio: acessorio.id_acessorio,
                        descricao_acessorio: acessorio.descricao_acessorio ?? null,
                        quantidade: acessorio.quantidade,
                        observacoes: acessorio.observacoes ?? null
                    });
                }

                itensInseridos.push({
                    id_item: idItem,
                    id_os: resultadoOs.insertId,
                    tipo_equipamento: item.tipo_equipamento,
                    marca: item.marca,
                    modelo: item.modelo,
                    numero_serie: item.numero_serie ?? null,
                    estado_fisico: item.estado_fisico,
                    garantia_status: item.garantia_status ?? "PENDENTE",
                    observacoes: item.observacoes ?? null,
                    acessorios: acessoriosInseridos
                });
            }

            // 5. Ler a data de abertura gerada pelo banco
            // (RN22: a solicitação não tem status próprio; o andamento é o das OS)
            const [[gravada]] = await conexao.execute(
                `SELECT data_abertura
                 FROM solicitacao
                 WHERE id_solicitacao = ?`,
                [idSolicitacao]
            );

            // 6. Confirmar todas as operações
            await conexao.commit();

            return {
                id_solicitacao: idSolicitacao,
                id_cliente: dados.id_cliente,
                id_atendente: dados.id_atendente,
                descricao_inicial: dados.descricao_inicial,
                data_abertura: gravada.data_abertura,
                itens: itensInseridos
            };

        } catch (erro) {
            // Se algo falhar, desfazer todas as operações
            await conexao.rollback();
            throw erro;

        } finally {
            // Liberar a conexão
            conexao.release();
        }
    }

        // Listar todas as solicitações
    async listarTodos() {

        const [solicitacoes] = await pool.execute(
            `SELECT
                s.id_solicitacao,
                s.id_cliente,
                c.nome_razao_social AS nome_cliente,
                s.id_atendente,
                u.nome AS nome_atendente,
                s.data_abertura,
                s.descricao_inicial

            FROM solicitacao s

            INNER JOIN cliente c
                ON s.id_cliente = c.id_cliente

            INNER JOIN usuario u
                ON s.id_atendente = u.id_usuario

            ORDER BY s.data_abertura DESC`
        );

        return solicitacoes;
    }


    // Buscar uma solicitação específica pelo ID
    async buscarPorId(id) {

        // Buscar os dados principais da solicitação
        const [solicitacoes] = await pool.execute(
            `SELECT
                s.id_solicitacao,
                s.id_cliente,
                c.nome_razao_social AS nome_cliente,
                s.id_atendente,
                u.nome AS nome_atendente,
                s.data_abertura,
                s.descricao_inicial

            FROM solicitacao s

            INNER JOIN cliente c
                ON s.id_cliente = c.id_cliente

            INNER JOIN usuario u
                ON s.id_atendente = u.id_usuario

            WHERE s.id_solicitacao = ?`,
            [id]
        );

        if (solicitacoes.length === 0) {
            return null;
        }

        const solicitacao = solicitacoes[0];

        // Buscar os equipamentos vinculados à solicitação
        const [itens] = await pool.execute(
            `SELECT
                i.id_item,
                i.tipo_equipamento,
                i.marca,
                i.modelo,
                i.numero_serie,
                i.estado_fisico,
                -- garantia da OS mais recente do equipamento
                (SELECT os.garantia_status
                 FROM ordem_servico os
                 WHERE os.id_item = i.id_item
                 ORDER BY os.id_os DESC
                 LIMIT 1) AS garantia_status,
                i.observacoes

            FROM item_solicitacao i

            WHERE i.id_solicitacao = ?

            ORDER BY i.id_item`,
            [id]
        );

        // Buscar os acessórios recebidos de todos os equipamentos da solicitação
        const [acessorios] = await pool.execute(
            `SELECT
                ar.id_acessorio_recebido,
                ar.id_item,
                ar.id_acessorio,
                a.descricao AS descricao_acessorio,
                ar.quantidade,
                ar.observacoes

            FROM acessorio_recebido ar

            INNER JOIN item_solicitacao i
                ON i.id_item = ar.id_item

            INNER JOIN acessorio a
                ON a.id_acessorio = ar.id_acessorio

            WHERE i.id_solicitacao = ?

            ORDER BY ar.id_acessorio_recebido`,
            [id]
        );

        // Buscar as OS de todos os equipamentos (um equipamento pode ter várias OS ao longo do tempo)
        const [ordens] = await pool.execute(
            `SELECT
                os.id_os,
                os.id_item,
                os.status,
                os.garantia_status,
                os.id_tecnico,
                u.nome AS nome_tecnico,
                os.data_abertura

            FROM ordem_servico os

            INNER JOIN item_solicitacao i
                ON i.id_item = os.id_item

            LEFT JOIN usuario u
                ON u.id_usuario = os.id_tecnico

            WHERE i.id_solicitacao = ?

            ORDER BY os.id_os`,
            [id]
        );

        // Adicionar os equipamentos, cada um com seus acessórios e suas OS
        solicitacao.itens = itens.map((item) => ({
            ...item,
            acessorios: acessorios
                .filter((acessorio) => acessorio.id_item === item.id_item)
                .map(({ id_item, ...acessorio }) => acessorio),
            ordens_servico: ordens
                .filter((ordem) => ordem.id_item === item.id_item)
                .map(({ id_item, ...ordem }) => ordem)
        }));

        return solicitacao;
    }
}

module.exports = new SolicitacaoRepository();

