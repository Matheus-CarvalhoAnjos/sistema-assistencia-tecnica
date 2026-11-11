
const solicitacaoRepository = require("../repositories/solicitacaoRepository");
const clienteRepository = require("../repositories/clienteRepository");
const usuarioRepository = require("../repositories/usuarioRepository");
const acessorioRepository = require("../repositories/acessorioRepository");

// Limite de equipamentos por solicitação (decisão D-SOL-4)
const MAX_EQUIPAMENTOS = 20;

// Maior valor da coluna acessorio_recebido.quantidade (INT)
const MAX_QUANTIDADE = 2147483647;

// Limite das colunas TEXT (descricao_inicial, estado_fisico, observacoes).
// O MySQL conta BYTES, não caracteres: em UTF-8, "ç" ocupa 2 bytes, "€" 3 e um emoji 4.
const MAX_BYTES_TEXT = 65535;

// Campos obrigatórios do equipamento e tamanho máximo da coluna no banco
const CAMPOS_EQUIPAMENTO = [
    { campo: "tipo_equipamento", rotulo: "tipo", max: 100 },
    { campo: "marca", rotulo: "marca", max: 100 },
    { campo: "modelo", rotulo: "modelo", max: 100 }
];

function erroComStatus(mensagem, statusCode) {
    const erro = new Error(mensagem);
    erro.statusCode = statusCode;
    return erro;
}

// Rejeita (400) textos que não caberiam em uma coluna TEXT do banco
function validarBytesTexto(texto, mensagem) {
    if (Buffer.byteLength(texto, "utf8") > MAX_BYTES_TEXT) {
        throw erroComStatus(mensagem, 400);
    }
}

function textoOpcional(valor, rotulo, posicao, max) {
    if (valor === undefined || valor === null) {
        return null;
    }

    if (typeof valor !== "string") {
        throw erroComStatus(`O campo ${rotulo} do equipamento ${posicao} deve ser um texto.`, 400);
    }

    const texto = valor.trim();

    if (max && texto.length > max) {
        throw erroComStatus(
            `O campo ${rotulo} do equipamento ${posicao} deve ter no máximo ${max} caracteres.`,
            400
        );
    }

    validarBytesTexto(
        texto,
        `O campo ${rotulo} do equipamento ${posicao} excede o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`
    );

    return texto || null;
}

function validarAcessorios(acessorios, posicao) {
    if (acessorios === undefined || acessorios === null) {
        return [];
    }

    if (!Array.isArray(acessorios)) {
        throw erroComStatus(`Os acessórios do equipamento ${posicao} devem ser uma lista.`, 400);
    }

    const recebidos = [];

    for (const acessorio of acessorios) {
        if (!acessorio || typeof acessorio !== "object" || Array.isArray(acessorio)) {
            throw erroComStatus(`Acessório inválido no equipamento ${posicao}.`, 400);
        }

        const id_acessorio = Number(acessorio.id_acessorio);

        if (!Number.isInteger(id_acessorio) || id_acessorio <= 0) {
            throw erroComStatus(`Acessório inválido no equipamento ${posicao}.`, 400);
        }

        const quantidade = Number(acessorio.quantidade ?? 1);

        // Limite superior: maior valor aceito pela coluna INT do banco
        if (!Number.isInteger(quantidade) || quantidade <= 0 || quantidade > MAX_QUANTIDADE) {
            throw erroComStatus(
                "A quantidade do acessório deve ser um número inteiro maior que zero.",
                400
            );
        }

        const observacoes = textoOpcional(
            acessorio.observacoes,
            "observação do acessório",
            posicao
        );

        // Cada acessório informado vira um registro próprio, mesmo que o
        // mesmo acessório apareça mais de uma vez no equipamento
        recebidos.push({ id_acessorio, quantidade, observacoes });
    }

    return recebidos;
}

function validarEquipamento(item, indice) {
    const posicao = indice + 1;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw erroComStatus(`O equipamento ${posicao} é inválido.`, 400);
    }

    const equipamento = {};

    for (const { campo, rotulo, max } of CAMPOS_EQUIPAMENTO) {
        const valor = item[campo];

        if (typeof valor !== "string" || !valor.trim()) {
            throw erroComStatus(
                "Cada equipamento deve possuir tipo, marca, modelo e estado físico.",
                400
            );
        }

        if (valor.trim().length > max) {
            throw erroComStatus(
                `O campo ${rotulo} do equipamento ${posicao} deve ter no máximo ${max} caracteres.`,
                400
            );
        }

        equipamento[campo] = valor.trim();
    }

    if (typeof item.estado_fisico !== "string" || !item.estado_fisico.trim()) {
        throw erroComStatus(
            "Cada equipamento deve possuir tipo, marca, modelo e estado físico.",
            400
        );
    }

    equipamento.estado_fisico = item.estado_fisico.trim();
    validarBytesTexto(
        equipamento.estado_fisico,
        `O estado físico do equipamento ${posicao} excede o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`
    );
    equipamento.numero_serie = textoOpcional(item.numero_serie, "número de série", posicao, 100);
    equipamento.observacoes = textoOpcional(item.observacoes, "observações", posicao);

    // A garantia é verificada depois pelo fluxo da OS (decisão D-SOL-3)
    equipamento.garantia_status = "PENDENTE";
    equipamento.acessorios = validarAcessorios(item.acessorios, posicao);

    return equipamento;
}

class SolicitacaoService {

    async criar(dados) {

        // 1. Validar os dados principais
        if (
            !dados ||
            typeof dados !== "object" ||
            !dados.id_cliente ||
            !dados.id_atendente ||
            typeof dados.descricao_inicial !== "string" ||
            !dados.descricao_inicial.trim() ||
            !Array.isArray(dados.itens) ||
            dados.itens.length === 0
        ) {
            throw erroComStatus(
                "Cliente, atendente, descrição inicial e pelo menos um equipamento são obrigatórios.",
                400
            );
        }

        const id_cliente = Number(dados.id_cliente);

        if (!Number.isInteger(id_cliente) || id_cliente <= 0) {
            throw erroComStatus("Cliente inválido.", 400);
        }

        const descricao_inicial = dados.descricao_inicial.trim();

        validarBytesTexto(
            descricao_inicial,
            `A descrição inicial excede o tamanho máximo permitido (${MAX_BYTES_TEXT} bytes).`
        );

        if (dados.itens.length > MAX_EQUIPAMENTOS) {
            throw erroComStatus(
                `Uma solicitação pode ter no máximo ${MAX_EQUIPAMENTOS} equipamentos.`,
                400
            );
        }

        // 2. Validar os equipamentos e seus acessórios antes de acessar o banco
        const itens = dados.itens.map(validarEquipamento);

        // 3. Verificar se o cliente existe
        const cliente = await clienteRepository.buscarPorId(id_cliente);

        if (!cliente) {
            throw erroComStatus("Cliente não encontrado.", 404);
        }

        // 4. Verificar se o atendente existe e está ativo
        const atendente = await usuarioRepository.buscarPorId(dados.id_atendente);

        if (!atendente || !atendente.ativo) {
            throw erroComStatus("Atendente não encontrado ou inativo.", 404);
        }

        if (!["ADMINISTRADOR", "ATENDENTE"].includes(String(atendente.perfil).toUpperCase())) {
            throw erroComStatus(
                "O usuário informado não possui permissão para abrir solicitações.",
                403
            );
        }

        // 5. Verificar se os acessórios existem e estão ativos
        const descricoes = new Map();
        const idsAcessorios = new Set(
            itens.flatMap((item) => item.acessorios.map((a) => a.id_acessorio))
        );

        for (const id of idsAcessorios) {
            const acessorio = await acessorioRepository.buscarPorId(id);

            if (!acessorio) {
                throw erroComStatus("Acessório não encontrado.", 404);
            }

            if (!acessorio.ativo) {
                throw erroComStatus(`O acessório ${acessorio.descricao} está inativo.`, 409);
            }

            descricoes.set(id, acessorio.descricao);
        }

        for (const item of itens) {
            for (const acessorio of item.acessorios) {
                acessorio.descricao_acessorio = descricoes.get(acessorio.id_acessorio);
            }
        }

        // 6. Gravar tudo em uma única transação
        return await solicitacaoRepository.criar({
            id_cliente,
            id_atendente: Number(dados.id_atendente),
            descricao_inicial,
            itens
        });
    }

    // Verificar se o usuário pode acessar Solicitações (TECNICO não pode)
    verificarAcesso(usuario) {
        const perfil = String(usuario?.perfil ?? "").toUpperCase();

        if (!["ADMINISTRADOR", "ATENDENTE"].includes(perfil)) {
            throw erroComStatus("Você não possui permissão para acessar solicitações.", 403);
        }
    }

    // Listar todas as solicitações
    async listarTodos(usuario) {
        this.verificarAcesso(usuario);

        return await solicitacaoRepository.listarTodos();
    }

    // Buscar uma solicitação pelo ID
    async buscarPorId(id, usuario) {
        this.verificarAcesso(usuario);

        if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
            throw erroComStatus("ID da solicitação inválido.", 400);
        }

        const solicitacao = await solicitacaoRepository.buscarPorId(Number(id));

        if (!solicitacao) {
            throw erroComStatus("Solicitação não encontrada.", 404);
        }

        return solicitacao;
    }
}

module.exports = new SolicitacaoService();
