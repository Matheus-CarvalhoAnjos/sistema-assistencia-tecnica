const { pool } = require("../config/database");
const BaseRepository = require("./BaseRepository");
const historicoRepository = require("./historicoRepository");
const OrdemServico = require("../models/ordemServico");

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

class OrdemServicoRepository extends BaseRepository {
    constructor() {
        super(pool);
    }

    /*
     * Listagem com dados do equipamento, do cliente e do técnico.
     * Filtros (todos opcionais, já validados pelo service):
     * - id_tecnico: somente as OS desse técnico
     * - sem_tecnico: somente as OS sem técnico
     * - status: lista de status
     * - busca: nº da OS, nome do cliente, nº de série, tipo, marca ou modelo
     * - data_inicio / data_fim: período de abertura (AAAA-MM-DD)
     */
    async listarTodos(filtros = {}) {
        const condicoes = [];
        const parametros = [];

        if (filtros.id_tecnico !== undefined) {
            condicoes.push("os.id_tecnico = ?");
            parametros.push(filtros.id_tecnico);
        }

        if (filtros.sem_tecnico) {
            condicoes.push("os.id_tecnico IS NULL");
        }

        if (filtros.status && filtros.status.length > 0) {
            condicoes.push(`os.status IN (${filtros.status.map(() => "?").join(", ")})`);
            parametros.push(...filtros.status);
        }

        if (filtros.busca) {
            const like = `%${filtros.busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
            const opcoes = [
                "c.nome_razao_social LIKE ?",
                "i.numero_serie LIKE ?",
                "i.tipo_equipamento LIKE ?",
                "i.marca LIKE ?",
                "i.modelo LIKE ?"
            ];
            parametros.push(like, like, like, like, like);

            if (/^\d+$/.test(filtros.busca)) {
                opcoes.push("os.id_os = ?");
                parametros.push(Number(filtros.busca));
            }

            condicoes.push(`(${opcoes.join(" OR ")})`);
        }

        if (filtros.data_inicio) {
            condicoes.push("os.data_abertura >= ?");
            parametros.push(`${filtros.data_inicio} 00:00:00`);
        }

        if (filtros.data_fim) {
            condicoes.push("os.data_abertura <= ?");
            parametros.push(`${filtros.data_fim} 23:59:59`);
        }

        const where = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

        const linhas = await this.buscarTodos(
            `SELECT os.*,
                    i.tipo_equipamento,
                    i.marca,
                    i.modelo,
                    i.numero_serie,
                    os.garantia_status,
                    s.id_solicitacao,
                    c.id_cliente,
                    c.nome_razao_social AS nome_cliente,
                    u.nome AS nome_tecnico
             FROM ordem_servico os
             INNER JOIN item_solicitacao i
                 ON i.id_item = os.id_item
             INNER JOIN solicitacao s
                 ON s.id_solicitacao = i.id_solicitacao
             INNER JOIN cliente c
                 ON c.id_cliente = s.id_cliente
             LEFT JOIN usuario u
                 ON u.id_usuario = os.id_tecnico
             ${where}
             ORDER BY os.data_abertura DESC, os.id_os DESC`,
            parametros
        );

        return linhas.map((linha) => new OrdemServico(linha));
    }

    // Todos os dados exibidos na tela de detalhes da OS (o service decide o que cada perfil vê)
    async buscarDetalhes(id) {
        return await this.buscarUm(
            `SELECT os.id_os,
                    os.status,
                    os.data_abertura,
                    os.data_encerramento,
                    os.motivo_encerramento,
                    os.tipo_encerramento,
                    os.id_tecnico,
                    u.nome AS nome_tecnico,
                    u.ativo AS tecnico_ativo,
                    i.id_item,
                    i.tipo_equipamento,
                    i.marca,
                    i.modelo,
                    i.numero_serie,
                    i.estado_fisico,
                    os.garantia_status,
                    i.observacoes AS observacoes_equipamento,
                    c.id_cliente,
                    c.nome_razao_social,
                    c.telefone,
                    c.email,
                    s.id_solicitacao,
                    s.data_abertura AS data_solicitacao,
                    s.descricao_inicial
             FROM ordem_servico os
             INNER JOIN item_solicitacao i
                 ON i.id_item = os.id_item
             INNER JOIN solicitacao s
                 ON s.id_solicitacao = i.id_solicitacao
             INNER JOIN cliente c
                 ON c.id_cliente = s.id_cliente
             LEFT JOIN usuario u
                 ON u.id_usuario = os.id_tecnico
             WHERE os.id_os = ?`,
            [id]
        );
    }

    // Verifica se o equipamento possui alguma OS atribuída ao técnico
    async existeOsDoTecnicoParaItem(id_item, id_tecnico) {
        const linha = await this.buscarUm(
            `SELECT id_os
             FROM ordem_servico
             WHERE id_item = ?
               AND id_tecnico = ?
             LIMIT 1`,
            [id_item, id_tecnico]
        );

        return !!linha;
    }

    async buscarPorId(id) {
        const linha = await this.buscarUm(
            `SELECT os.*,
                    i.tipo_equipamento,
                    i.marca,
                    i.modelo,
                    u.nome AS nome_tecnico
             FROM ordem_servico os
             INNER JOIN item_solicitacao i
                 ON i.id_item = os.id_item
             LEFT JOIN usuario u
                 ON u.id_usuario = os.id_tecnico
             WHERE os.id_os = ?`,
            [id]
        );

        return linha ? new OrdemServico(linha) : null;
    }

    async verificarOsAtivaPorItem(id_item) {
        const linha = await this.buscarUm(
            `SELECT id_os
             FROM ordem_servico
             WHERE id_item = ?
               AND status NOT IN ('FINALIZADA', 'ENCERRADA_SEM_REPARO')
             LIMIT 1`,
            [id_item]
        );

        return !!linha;
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

    async criar(dados) {
        const conexao = await this.pool.getConnection();
        let idOs;

        try {
            await conexao.beginTransaction();

            const [itens] = await conexao.execute(
                `SELECT id_item
                 FROM item_solicitacao
                 WHERE id_item = ?
                 FOR UPDATE`,
                [dados.id_item]
            );

            if (itens.length === 0) {
                const erro = new Error("Item da solicitação não encontrado.");
                erro.statusCode = 404;
                throw erro;
            }

            const [ordensAtivas] = await conexao.execute(
                `SELECT id_os
                 FROM ordem_servico
                 WHERE id_item = ?
                   AND status NOT IN ('FINALIZADA', 'ENCERRADA_SEM_REPARO')
                 LIMIT 1
                 FOR UPDATE`,
                [dados.id_item]
            );

            if (ordensAtivas.length > 0) {
                const erro = new Error("Já existe uma ordem de serviço ativa para este item.");
                erro.statusCode = 409;
                throw erro;
            }

            // RN05 (MER v1.4): a nova OS herda a garantia da OS mais recente do mesmo
            // equipamento (mesmo id_item). Sem OS anterior, a garantia começa PENDENTE.
            const [anteriores] = await conexao.execute(
                `SELECT id_os, garantia_status
                 FROM ordem_servico
                 WHERE id_item = ?
                 ORDER BY id_os DESC
                 LIMIT 1`,
                [dados.id_item]
            );

            const garantiaHerdada = anteriores.length > 0 ? anteriores[0].garantia_status : "PENDENTE";

            const [resultado] = await conexao.execute(
                `INSERT INTO ordem_servico (
                    id_item,
                    id_tecnico,
                    status,
                    garantia_status
                ) VALUES (?, ?, ?, ?)`,
                [dados.id_item, dados.id_tecnico ?? null, "RECEBIDA", garantiaHerdada]
            );

            idOs = resultado.insertId;

            await historicoRepository.registrar(conexao, {
                id_os: idOs,
                id_usuario: dados.id_usuario ?? null,
                tipo_evento: "CRIACAO",
                descricao: anteriores.length > 0
                    ? `OS aberta para o equipamento nº ${dados.id_item}; garantia herdada da OS nº ${anteriores[0].id_os}.`
                    : `OS aberta para o equipamento nº ${dados.id_item}.`,
                dados_novos: {
                    status: "RECEBIDA",
                    garantia_status: garantiaHerdada,
                    garantia_herdada_da_os: anteriores.length > 0 ? anteriores[0].id_os : undefined,
                    id_item: dados.id_item,
                    id_tecnico: dados.id_tecnico ?? null
                }
            });

            await conexao.commit();
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }

        return this.buscarPorId(idOs);
    }

    // Executa uma alteração da OS e o seu evento na mesma transação.
    // A função recebe a conexão e a linha atual da OS (bloqueada com FOR UPDATE).
    async _alterarComHistorico(id_os, alterar) {
        const conexao = await this.pool.getConnection();

        try {
            await conexao.beginTransaction();

            const [linhas] = await conexao.execute(
                `SELECT id_os, id_tecnico, status, garantia_status
                 FROM ordem_servico
                 WHERE id_os = ?
                 FOR UPDATE`,
                [id_os]
            );

            const resultado = linhas.length > 0 ? await alterar(conexao, linhas[0]) : false;

            if (resultado) {
                await conexao.commit();
            } else {
                await conexao.rollback();
            }

            return resultado;
        } catch (erro) {
            await conexao.rollback();
            throw erro;
        } finally {
            conexao.release();
        }
    }

    async atribuirTecnico(id_os, id_tecnico, id_usuario = null) {
        return this._alterarComHistorico(id_os, async (conexao, atual) => {
            // Mesmo técnico: nada muda e nenhum evento é inventado
            if (Number(atual.id_tecnico) === Number(id_tecnico)) {
                return true;
            }

            await conexao.execute(
                `UPDATE ordem_servico
                 SET id_tecnico = ?
                 WHERE id_os = ?`,
                [id_tecnico, id_os]
            );

            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario,
                tipo_evento: "ATRIBUICAO_TECNICO",
                descricao: atual.id_tecnico ? "Técnico responsável alterado." : "Técnico atribuído à OS.",
                dados_anteriores: { id_tecnico: atual.id_tecnico ?? null },
                dados_novos: { id_tecnico }
            });

            return true;
        });
    }

    /*
     * Verificação/correção da garantia pelo técnico atribuído (RN05/RN06), em uma transação
     * com a linha da OS bloqueada. Confere de novo, já com o bloqueio:
     * - a etapa (somente EM_ANALISE);
     * - o técnico (a OS pode ter sido reatribuída depois da validação do service);
     * - se já existe orçamento emitido (depois da emissão a garantia fica fixa).
     * Grava a nova situação e o evento GARANTIA com valor anterior, novo valor e usuário
     * (a data/hora é a do evento). A etapa da OS não muda. Sem mudança, nada é gravado.
     */
    async atualizarGarantia(id_os, garantia_status, id_usuario) {
        return this._alterarComHistorico(id_os, async (conexao, atual) => {
            if (atual.status !== "EM_ANALISE") {
                throw erroComStatus("A garantia só pode ser definida com a OS em análise, antes da emissão do orçamento.", 409);
            }

            if (Number(atual.id_tecnico) !== Number(id_usuario)) {
                throw erroComStatus("Somente o técnico atribuído pode alterar a garantia.", 403);
            }

            if (atual.garantia_status === garantia_status) {
                return true;
            }

            // A emissão do orçamento também bloqueia esta linha: não há corrida entre as duas operações
            const [orcamentos] = await conexao.execute(
                `SELECT id_orcamento FROM orcamento WHERE id_os = ? LIMIT 1`,
                [id_os]
            );

            if (orcamentos.length > 0) {
                throw erroComStatus("A garantia não pode ser alterada depois da emissão do orçamento.", 409);
            }

            await conexao.execute(
                `UPDATE ordem_servico
                 SET garantia_status = ?
                 WHERE id_os = ?`,
                [garantia_status, id_os]
            );

            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario,
                tipo_evento: "GARANTIA",
                descricao: atual.garantia_status === "PENDENTE"
                    ? `Garantia definida como ${garantia_status}.`
                    : `Garantia corrigida de ${atual.garantia_status} para ${garantia_status}.`,
                dados_anteriores: { garantia_status: atual.garantia_status },
                dados_novos: { garantia_status }
            });

            return true;
        });
    }

    async marcarConcluida(id_os, id_usuario = null) {
        return this._alterarComHistorico(id_os, async (conexao, atual) => {
            if (atual.status !== "EM_REPARO") {
                return false;
            }

            await conexao.execute(
                `UPDATE ordem_servico
                 SET status = 'CONCLUIDA'
                 WHERE id_os = ?`,
                [id_os]
            );

            await historicoRepository.registrar(conexao, {
                id_os,
                id_usuario,
                tipo_evento: "REPARO",
                descricao: "Reparo concluído.",
                dados_anteriores: { status_os: "EM_REPARO" },
                dados_novos: { status_os: "CONCLUIDA" }
            });

            return true;
        });
    }
}

module.exports = new OrdemServicoRepository();
