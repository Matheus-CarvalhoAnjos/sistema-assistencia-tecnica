/*
 * Testes do controle de acesso às Ordens de Serviço (correções A1–A4).
 * Usam repositories simulados: nenhum teste acessa o banco de dados.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-apenas-para-testes";

const OrdemServico = require("../src/models/ordemServico");
const ordemServicoRepository = require("../src/repositories/ordemServicoRepository");
const ordemServicoService = require("../src/services/ordemServicoService");
const acessorioRecebidoRepository = require("../src/repositories/acessorioRecebidoRepository");
const acessorioRecebidoService = require("../src/services/acessorioRecebidoService");
const acessorioRepository = require("../src/repositories/acessorioRepository");
const orcamentoRepository = require("../src/repositories/orcamentoRepository");
const orcamentoService = require("../src/services/orcamentoService");
const pagamentoService = require("../src/services/pagamentoService");
const expedicaoService = require("../src/services/expedicaoService");
const execucaoService = require("../src/services/execucaoService");
const usuarioRepository = require("../src/repositories/usuarioRepository");
const autorizarAcessoOs = require("../src/middlewares/autorizarAcessoOs");

const ADMIN = { id_usuario: 5, perfil: "ADMINISTRADOR" };
const ATENDENTE = { id_usuario: 6, perfil: "ATENDENTE" };
const TECNICO = { id_usuario: 7, perfil: "TECNICO" };

// OS 1: de outro técnico (ID 2) · OS 2: do TECNICO (ID 7) · OS 3: sem técnico
const ORDENS = {
    1: { id_os: 1, id_item: 10, id_tecnico: 2, status: "RECEBIDA" },
    2: { id_os: 2, id_item: 20, id_tecnico: 7, status: "EM_REPARO" },
    3: { id_os: 3, id_item: 30, id_tecnico: null, status: "RECEBIDA" }
};

function substituirMetodos(teste, alvo, substitutos) {
    const originais = {};

    for (const [nome, metodo] of Object.entries(substitutos)) {
        originais[nome] = alvo[nome];
        alvo[nome] = metodo;
    }

    teste.after(() => {
        Object.assign(alvo, originais);
    });
}

function simularOrdens(teste) {
    substituirMetodos(teste, ordemServicoRepository, {
        buscarPorId: async (id) => (ORDENS[id] ? { ...ORDENS[id] } : null),
        buscarDetalhes: async (id) => (ORDENS[id] ? { ...ORDENS[id], id_cliente: 1, nome_razao_social: "Cliente" } : null),
        existeOsDoTecnicoParaItem: async (id_item, id_tecnico) =>
            Object.values(ORDENS).some((o) => o.id_item === id_item && o.id_tecnico === id_tecnico)
    });
}

async function esperar404(promessa) {
    await assert.rejects(promessa, (erro) => {
        assert.equal(erro.statusCode, 404);
        return true;
    });
}

// ---------- A1: listagem e consulta de OS ----------

test("technician listing is always filtered by the technician's own ID", async (teste) => {
    const chamadas = [];
    substituirMetodos(teste, ordemServicoRepository, {
        listarTodos: async (filtros) => {
            chamadas.push(filtros);
            return [];
        }
    });

    await ordemServicoService.listarTodos(TECNICO);
    await ordemServicoService.listarTodos({ id_usuario: "7", perfil: "tecnico" });
    await ordemServicoService.listarTodos(ADMIN);
    await ordemServicoService.listarTodos(ATENDENTE);

    assert.deepEqual(chamadas[0], { id_tecnico: 7 });
    assert.deepEqual(chamadas[1], { id_tecnico: 7 });
    // Administrador e atendente: sem filtro de técnico
    assert.deepEqual(chamadas[2], {});
    assert.deepEqual(chamadas[3], {});
});

test("technician can access only orders assigned to them", async (teste) => {
    simularOrdens(teste);

    const propria = await ordemServicoService.verificarAcessoOs(2, TECNICO);
    assert.equal(propria.id_os, 2);

    await esperar404(ordemServicoService.verificarAcessoOs(1, TECNICO));
    await esperar404(ordemServicoService.verificarAcessoOs(3, TECNICO));
    await esperar404(ordemServicoService.buscarPorId(1, TECNICO));
});

test("administrator and attendant can access any existing order", async (teste) => {
    simularOrdens(teste);

    for (const usuario of [ADMIN, ATENDENTE]) {
        for (const id of [1, 2, 3]) {
            const ordem = await ordemServicoService.verificarAcessoOs(id, usuario);
            assert.equal(ordem.id_os, id);
        }
    }

    await esperar404(ordemServicoService.verificarAcessoOs(99, ADMIN));
});

test("access middleware exposes the order or forwards a 404 error", async (teste) => {
    simularOrdens(teste);
    const middleware = autorizarAcessoOs("id_os");

    const permitido = { params: { id_os: "2" }, usuario: TECNICO };
    let erroRecebido = "não chamado";
    await middleware(permitido, {}, (erro) => { erroRecebido = erro; });
    assert.equal(erroRecebido, undefined);
    assert.equal(permitido.ordemServico.id_os, 2);

    const negado = { params: { id_os: "1" }, usuario: TECNICO };
    await middleware(negado, {}, (erro) => { erroRecebido = erro; });
    assert.equal(erroRecebido.statusCode, 404);
    assert.equal(negado.ordemServico, undefined);
});

// ---------- A2: dados do equipamento e do técnico ----------

test("service order model keeps equipment and technician data from joins", () => {
    const ordem = new OrdemServico({
        id_os: 1,
        id_item: 10,
        id_tecnico: 2,
        status: "RECEBIDA",
        tipo_equipamento: "Notebook",
        marca: "Dell",
        modelo: "Inspiron 15",
        nome_tecnico: "Tiago Técnico"
    });

    assert.equal(ordem.tipo_equipamento, "Notebook");
    assert.equal(ordem.marca, "Dell");
    assert.equal(ordem.modelo, "Inspiron 15");
    assert.equal(ordem.nome_tecnico, "Tiago Técnico");
});

// ---------- A3: orçamento precisa pertencer à OS do caminho ----------

test("quote lookup rejects a quote that belongs to another order", async (teste) => {
    substituirMetodos(teste, orcamentoRepository, {
        buscarPorId: async (id) => (id === 50 ? { id_orcamento: 50, id_os: 2 } : null)
    });

    const correto = await orcamentoService.buscarPorId(50, 2);
    assert.equal(correto.id_orcamento, 50);

    await esperar404(orcamentoService.buscarPorId(50, 1));
    await esperar404(orcamentoService.buscarPorId(51, 2));
});

// ---------- A4: acessórios recebidos ----------

test("technician cannot list accessories of equipment from another technician's order", async (teste) => {
    simularOrdens(teste);
    substituirMetodos(teste, acessorioRecebidoRepository, {
        listarPorItem: async () => [{ id_acessorio_recebido: 1 }]
    });

    await esperar404(acessorioRecebidoService.listarPorItem(10, TECNICO));
    await esperar404(acessorioRecebidoService.listarPorItem(30, TECNICO));

    const proprios = await acessorioRecebidoService.listarPorItem(20, TECNICO);
    assert.equal(proprios.length, 1);

    const doAdmin = await acessorioRecebidoService.listarPorItem(10, ADMIN);
    assert.equal(doAdmin.length, 1);
});

test("technician cannot register accessories on another technician's equipment", async (teste) => {
    simularOrdens(teste);
    let criados = 0;
    substituirMetodos(teste, acessorioRecebidoRepository, {
        verificarItemExiste: async () => true,
        // O serviço grava em lote, em uma transação (criarVarios)
        criarVarios: async (registros) => {
            criados += registros.length;
            return registros;
        }
    });
    substituirMetodos(teste, acessorioRepository, {
        buscarPorId: async () => ({ id_acessorio: 3, ativo: 1 })
    });

    await esperar404(acessorioRecebidoService.registrar({ id_item: 10, id_acessorio: 3 }, TECNICO));
    assert.equal(criados, 0);

    await acessorioRecebidoService.registrar({ id_item: 20, id_acessorio: 3 }, TECNICO);
    await acessorioRecebidoService.registrar({ id_item: 10, id_acessorio: 3 }, ATENDENTE);
    assert.equal(criados, 2);
});

// ---------- Matriz por rota (HTTP, sem banco) ----------

test("every order read route returns 404 to a technician who is not assigned", async (teste) => {
    simularOrdens(teste);

    const usuarios = { 5: ADMIN, 6: ATENDENTE, 7: TECNICO };
    substituirMetodos(teste, usuarioRepository, {
        buscarPorId: async (id) => (usuarios[id] ? { ...usuarios[id], ativo: 1 } : null)
    });
    substituirMetodos(teste, ordemServicoRepository, {
        listarTodos: async (filtros) => Object.values(ORDENS)
            .filter((o) => filtros.id_tecnico === undefined || o.id_tecnico === filtros.id_tecnico)
    });
    substituirMetodos(teste, acessorioRecebidoRepository, {
        listarPorItem: async () => []
    });
    substituirMetodos(teste, orcamentoService, {
        listarPorOs: async () => [],
        buscarPorId: async () => ({ id_orcamento: 50, id_os: 2 })
    });
    substituirMetodos(teste, pagamentoService, { listarPorOs: async () => ({ pagamentos: [] }) });
    substituirMetodos(teste, expedicaoService, { buscarPorOs: async () => null });
    substituirMetodos(teste, execucaoService, { buscarPorOs: async () => ({ id_os: 2 }) });

    const app = require("../src/app");
    const servidor = app.listen(0);
    teste.after(() => servidor.close());
    await new Promise((resolver) => servidor.once("listening", resolver));
    const base = `http://127.0.0.1:${servidor.address().port}/api`;

    const token = (usuario) => jwt.sign(
        { id_usuario: usuario.id_usuario, perfil: usuario.perfil },
        process.env.JWT_SECRET
    );
    const get = (caminho, usuario) => fetch(base + caminho, {
        headers: { Authorization: `Bearer ${token(usuario)}` }
    });

    const rotas = (id) => [
        `/ordens-servico/${id}`,
        `/ordens-servico/${id}/acessorios`,
        `/ordens-servico/${id}/execucao`,
        `/ordens-servico/${id}/orcamentos`,
        `/ordens-servico/${id}/orcamentos/50`,
        `/ordens-servico/${id}/expedicao`
    ];

    // P3: dados financeiros não são acessíveis ao técnico, nem nas próprias OS
    for (const id of [1, 2, 3]) {
        const resposta = await get(`/ordens-servico/${id}/pagamentos`, TECNICO);
        assert.equal(resposta.status, 403, `TECNICO em /ordens-servico/${id}/pagamentos`);
    }

    // OS de outro técnico e OS sem técnico: 404 em todas as rotas
    for (const id of [1, 3]) {
        for (const caminho of rotas(id)) {
            const resposta = await get(caminho, TECNICO);
            assert.equal(resposta.status, 404, `TECNICO em ${caminho}`);
        }
    }

    // OS do próprio técnico: 200 em todas as rotas
    for (const caminho of rotas(2)) {
        const resposta = await get(caminho, TECNICO);
        assert.equal(resposta.status, 200, `TECNICO em ${caminho}`);
    }

    // Administrador e atendente continuam acessando a OS de outro técnico
    for (const usuario of [ADMIN, ATENDENTE]) {
        const resposta = await get("/ordens-servico/1", usuario);
        assert.equal(resposta.status, 200, `${usuario.perfil} em /ordens-servico/1`);
    }

    // Listagem do técnico contém só a OS 2
    const lista = await (await get("/ordens-servico", TECNICO)).json();
    assert.deepEqual(lista.map((o) => o.id_os), [2]);

    // Registro de acessório pela OS de outro técnico é bloqueado
    const registro = await fetch(`${base}/ordens-servico/1/acessorios`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token(TECNICO)}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ id_acessorio: 3, quantidade: 1 })
    });
    assert.equal(registro.status, 404);
});
