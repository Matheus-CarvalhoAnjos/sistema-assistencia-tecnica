const BaseService = require("./BaseService");
const ordemServicoRepository = require("../repositories/ordemServicoRepository");
const historicoRepository = require("../repositories/historicoRepository");
const usuarioRepository = require("../repositories/usuarioRepository");
const acessorioRecebidoRepository = require("../repositories/acessorioRecebidoRepository");
const encerramentoRepository = require("../repositories/encerramentoRepository");

const MAX_BYTES_TEXT = 65535; // ordem_servico.motivo_encerramento TEXT

function ehTecnico(usuario) {
    return String(usuario?.perfil ?? "").toUpperCase() === "TECNICO";
}

function podeAcessar(ordemServico, usuario) {
    if (!ehTecnico(usuario)) {
        return true;
    }

    return ordemServico.id_tecnico !== null &&
        ordemServico.id_tecnico !== undefined &&
        Number(ordemServico.id_tecnico) === Number(usuario.id_usuario);
}

const STATUS_OS = [
    "RECEBIDA",
    "EM_ANALISE",
    "AGUARDANDO_APROVACAO",
    "EM_REPARO",
    "CONCLUIDA",
    "AGUARDANDO_EXPEDICAO",
    "FINALIZADA",
    "ENCERRADA_SEM_REPARO"
];

const STATUS_FINAIS = ["FINALIZADA", "ENCERRADA_SEM_REPARO"];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

// Valida os filtros recebidos na query string da listagem
function lerFiltros(consulta = {}) {
    const filtros = {};

    if (consulta.status) {
        const status = String(consulta.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

        if (status.some((s) => !STATUS_OS.includes(s))) {
            throw erroComStatus("Status de ordem de serviço inválido.", 400);
        }

        filtros.status = status;
    }

    if (consulta.id_tecnico !== undefined && consulta.id_tecnico !== "") {
        const id = Number(consulta.id_tecnico);

        if (!Number.isInteger(id) || id <= 0) {
            throw erroComStatus("ID do técnico inválido.", 400);
        }

        filtros.id_tecnico = id;
    }

    if (String(consulta.sem_tecnico).toLowerCase() === "true") {
        filtros.sem_tecnico = true;
    }

    if (typeof consulta.busca === "string" && consulta.busca.trim()) {
        filtros.busca = consulta.busca.trim().slice(0, 100);
    }

    for (const campo of ["data_inicio", "data_fim"]) {
        if (consulta[campo]) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(consulta[campo]))) {
                throw erroComStatus("Use datas no formato AAAA-MM-DD.", 400);
            }

            filtros[campo] = String(consulta[campo]);
        }
    }

    return filtros;
}

class OrdemServicoService extends BaseService {
    /*
     * Lista as OS com filtros. O técnico vê somente as OS atribuídas a ele:
     * os filtros de técnico enviados por ele são ignorados e a solicitação
     * de origem não é devolvida (técnico não acessa Solicitações).
     */
    async listarTodos(usuario, consulta = {}) {
        const filtros = lerFiltros(consulta);

        if (ehTecnico(usuario)) {
            delete filtros.sem_tecnico;
            filtros.id_tecnico = Number(usuario.id_usuario);

            const ordens = await ordemServicoRepository.listarTodos(filtros);

            return ordens.map((ordem) => {
                const { id_solicitacao, ...semSolicitacao } = ordem;
                return semSolicitacao;
            });
        }

        return await ordemServicoRepository.listarTodos(filtros);
    }

    async buscarPorId(id, usuario) {
        return await this.verificarAcessoOs(id, usuario);
    }

    /*
     * Detalhes da OS para a tela. Supõe que o acesso já foi verificado
     * (middleware autorizarAcessoOs). Para o TÉCNICO: cliente só com o nome
     * e sem os dados da solicitação de origem.
     */
    async buscarDetalhes(id, usuario) {
        const idOs = this.validarIdPositivo(id, "ID da ordem de serviço");
        const linha = await ordemServicoRepository.buscarDetalhes(idOs);

        if (!linha || !podeAcessar(linha, usuario)) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        const tecnico = ehTecnico(usuario);
        const acessorios = await acessorioRecebidoRepository.listarPorItem(linha.id_item);

        const detalhes = {
            id_os: linha.id_os,
            status: linha.status,
            data_abertura: linha.data_abertura,
            data_encerramento: linha.data_encerramento,
            motivo_encerramento: linha.motivo_encerramento,
            tipo_encerramento: linha.tipo_encerramento ?? null,
            tecnico: linha.id_tecnico
                ? { id_usuario: linha.id_tecnico, nome: linha.nome_tecnico, ativo: !!linha.tecnico_ativo }
                : null,
            equipamento: {
                id_item: linha.id_item,
                tipo_equipamento: linha.tipo_equipamento,
                marca: linha.marca,
                modelo: linha.modelo,
                numero_serie: linha.numero_serie,
                estado_fisico: linha.estado_fisico,
                garantia_status: linha.garantia_status,
                observacoes: linha.observacoes_equipamento
            },
            cliente: tecnico
                ? { id_cliente: linha.id_cliente, nome_razao_social: linha.nome_razao_social }
                : {
                    id_cliente: linha.id_cliente,
                    nome_razao_social: linha.nome_razao_social,
                    telefone: linha.telefone,
                    email: linha.email
                },
            acessorios
        };

        if (!tecnico) {
            detalhes.solicitacao = {
                id_solicitacao: linha.id_solicitacao,
                data_abertura: linha.data_solicitacao,
                descricao_inicial: linha.descricao_inicial
            };
        }

        return detalhes;
    }

    /*
     * Ponto único de controle de acesso a uma OS.
     * Retorna a OS ou lança 404. Para o TÉCNICO, uma OS de outro técnico
     * ou sem técnico também gera 404, para não revelar que ela existe.
     */
    async verificarAcessoOs(id, usuario) {
        const idOs = this.validarIdPositivo(id, "ID da ordem de serviço");

        const ordemServico = await ordemServicoRepository.buscarPorId(idOs);

        if (!ordemServico || !podeAcessar(ordemServico, usuario)) {
            const erro = new Error("Ordem de serviço não encontrada.");
            erro.statusCode = 404;
            throw erro;
        }

        return ordemServico;
    }

    async criarParaItem(dados, usuario) {
        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            const erro = new Error("Os dados da ordem de serviço são inválidos.");
            erro.statusCode = 400;
            throw erro;
        }

        const id_item = this.validarIdPositivo(dados.id_item, "ID do item");

        const itemExiste = await ordemServicoRepository.verificarItemExiste(id_item);

        if (!itemExiste) {
            const erro = new Error("Item da solicitação não encontrado.");
            erro.statusCode = 404;
            throw erro;
        }

        const jaExisteOsAtiva = await ordemServicoRepository.verificarOsAtivaPorItem(id_item);

        if (jaExisteOsAtiva) {
            const erro = new Error("Já existe uma ordem de serviço ativa para este item.");
            erro.statusCode = 409;
            throw erro;
        }

        let id_tecnico = null;

        if (dados.id_tecnico !== null && dados.id_tecnico !== undefined) {
            id_tecnico = this.validarIdPositivo(dados.id_tecnico, "ID do técnico");
            const tecnico = await usuarioRepository.buscarPorId(id_tecnico);

            if (!tecnico || !tecnico.ativo) {
                const erro = new Error("Técnico não encontrado ou inativo.");
                erro.statusCode = 404;
                throw erro;
            }

            if (String(tecnico.perfil).toUpperCase() !== "TECNICO") {
                const erro = new Error("Somente usuários com perfil TECNICO podem ser atribuídos a uma ordem de serviço.");
                erro.statusCode = 403;
                throw erro;
            }

        }

        return await ordemServicoRepository.criar({
            id_item,
            id_tecnico,
            status: "RECEBIDA",
            id_usuario: usuario?.id_usuario ?? null
        });
    }

    async atribuirTecnico(id_os, id_tecnico, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const idTecnico = this.validarIdPositivo(id_tecnico, "ID do técnico");

        const ordemServico = await ordemServicoRepository.buscarPorId(idOs);

        if (!ordemServico) {
            const erro = new Error("Ordem de serviço não encontrada.");
            erro.statusCode = 404;
            throw erro;
        }

        // Uma OS encerrada mantém o técnico que a atendeu (correção A6)
        if (STATUS_FINAIS.includes(ordemServico.status)) {
            throw erroComStatus("Não é possível alterar o técnico de uma ordem de serviço encerrada.", 409);
        }

        const tecnico = await usuarioRepository.buscarPorId(idTecnico);

        if (!tecnico || !tecnico.ativo) {
            const erro = new Error("Técnico não encontrado ou inativo.");
            erro.statusCode = 404;
            throw erro;
        }

        if (String(tecnico.perfil).toUpperCase() !== "TECNICO") {
            const erro = new Error("Somente usuários com perfil TECNICO podem ser atribuídos a uma ordem de serviço.");
            erro.statusCode = 403;
            throw erro;
        }

        const atualizado = await ordemServicoRepository.atribuirTecnico(idOs, idTecnico, usuario?.id_usuario ?? null);

        if (!atualizado) {
            const erro = new Error("Não foi possível atribuir o técnico à ordem de serviço.");
            erro.statusCode = 400;
            throw erro;
        }

        return await ordemServicoRepository.buscarPorId(idOs);
    }

    /*
     * Encerramento sem reparo (RN07, RN08). O acesso à OS já foi verificado pelo
     * middleware autorizarAcessoOs (o técnico só chega aqui nas OS atribuídas a ele).
     * - IMPOSSIBILIDADE_TECNICA: somente o técnico atribuído.
     * - DESISTENCIA_CLIENTE: ADMINISTRADOR, ATENDENTE ou o técnico atribuído.
     * ORCAMENTO_REJEITADO continua automático (resposta do orçamento) e não é aceito aqui.
     */
    async encerrarSemReparo(id_os, dados, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
            throw erroComStatus("Os dados do encerramento são inválidos.", 400);
        }

        const tipo = dados.tipo_encerramento;

        if (!Object.keys(encerramentoRepository.ETAPAS_PERMITIDAS).includes(tipo)) {
            throw erroComStatus("O tipo de encerramento deve ser IMPOSSIBILIDADE_TECNICA ou DESISTENCIA_CLIENTE.", 400);
        }

        const perfil = String(usuario?.perfil ?? "").toUpperCase();

        if (tipo === "IMPOSSIBILIDADE_TECNICA" && perfil !== "TECNICO") {
            throw erroComStatus("Somente o técnico atribuído pode registrar impossibilidade técnica.", 403);
        }

        if (!["ADMINISTRADOR", "ATENDENTE", "TECNICO"].includes(perfil)) {
            throw erroComStatus("Você não possui permissão para encerrar esta ordem de serviço.", 403);
        }

        const ordemServico = await ordemServicoRepository.buscarPorId(idOs);

        if (!ordemServico || !podeAcessar(ordemServico, usuario)) {
            throw erroComStatus("Ordem de serviço não encontrada.", 404);
        }

        const motivo = this.validarTexto(dados.motivo_encerramento, "Justificativa do encerramento");

        if (Buffer.byteLength(motivo, "utf8") > MAX_BYTES_TEXT) {
            throw erroComStatus(`A justificativa excede o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`, 400);
        }

        return await encerramentoRepository.encerrarSemReparo({
            id_os: idOs,
            tipo_encerramento: tipo,
            motivo,
            id_usuario: Number(usuario.id_usuario),
            exigirTecnicoAtribuido: perfil === "TECNICO"
        });
    }

    // Histórico da OS em ordem cronológica (o acesso é verificado pelo middleware autorizarAcessoOs).
    // O técnico não recebe os eventos de PAGAMENTO: dados financeiros não fazem parte da sua função (P3).
    async listarHistorico(id_os, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");
        const eventos = await historicoRepository.listarPorOs(idOs);
        // P3 e C2: eventos financeiros (PAGAMENTO e ABATIMENTO) não são entregues ao técnico
        return ehTecnico(usuario)
            ? eventos.filter((evento) => !["PAGAMENTO", "ABATIMENTO"].includes(evento.tipo_evento))
            : eventos;
    }

    // Garantia (RN05/RN06): somente o técnico atribuído verifica e corrige.
    // PENDENTE → SIM/NAO e SIM ↔ NAO; nunca volta para PENDENTE. Só com a OS em EM_ANALISE
    // e enquanto nenhum orçamento tiver sido emitido (depois disso fica fixa).
    // A garantia SIM não dispensa o orçamento: os serviços cobertos saem a R$ 0,00.
    async atualizarGarantia(id_os, garantia_status, usuario) {
        const idOs = this.validarIdPositivo(id_os, "ID da ordem de serviço");

        if (!ehTecnico(usuario)) {
            throw erroComStatus("Somente o técnico atribuído pode alterar a garantia.", 403);
        }

        if (!["SIM", "NAO"].includes(garantia_status)) {
            const erro = new Error("A situação da garantia deve ser SIM ou NAO.");
            erro.statusCode = 400;
            throw erro;
        }

        const ordemServico = await ordemServicoRepository.buscarPorId(idOs);

        if (!ordemServico) {
            const erro = new Error("Ordem de serviço não encontrada.");
            erro.statusCode = 404;
            throw erro;
        }

        // Chamada direta ao service (sem o middleware): técnico de outra OS não altera
        if (!podeAcessar(ordemServico, usuario)) {
            throw erroComStatus("Somente o técnico atribuído pode alterar a garantia.", 403);
        }

        // RN06: a garantia é verificada durante EM_ANALISE (depois do diagnóstico e antes do orçamento)
        if (ordemServico.status !== "EM_ANALISE") {
            const erro = new Error("A garantia só pode ser definida com a OS em análise, antes da emissão do orçamento.");
            erro.statusCode = 409;
            throw erro;
        }

        // Etapa, técnico e orçamentos são conferidos de novo no repository, com a OS bloqueada
        await ordemServicoRepository.atualizarGarantia(idOs, garantia_status, Number(usuario.id_usuario));

        // A etapa não muda: com SIM ou NAO a OS segue em EM_ANALISE para o orçamento
        return {
            id_os: idOs,
            garantia_status,
            status: ordemServico.status
        };
    }
}

module.exports = new OrdemServicoService();
