/*
 * TESTES DE INTEGRAÇÃO REAIS (MySQL) — fluxo completo da assistência técnica.
 *
 * Execução:  npm run test:integracao
 *
 * Segurança:
 * - Grava SOMENTE no banco de testes "<DB_NAME>_teste" (ou DB_NAME_TESTE, que precisa terminar em "_teste").
 * - O banco real (DB_NAME) é apenas LIDO: estrutura (SHOW CREATE TABLE) e contagem de linhas
 *   antes e depois, para provar que nada foi alterado.
 * - Depois de copiar a estrutura, aplica no banco de testes as migrações pendentes
 *   (banco/migracoes/pendentes.json): o fluxo roda no estado de destino do modelo.
 * - O banco de testes é recriado a cada execução e apagado ao final
 *   (defina MANTER_BANCO_TESTE=1 para mantê-lo e inspecionar os dados).
 * - Os usuários de teste recebem uma senha aleatória gerada nesta execução (não é exibida).
 */
require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const { aplicarPendentes, listarPendentes, listarExecutadas, credenciaisAdmin } = require("./migracoes");
// Conexões de preparação/conferência usam a credencial administrativa; a API testada usa DB_USER (S1)
const ADMIN = credenciaisAdmin();

const BANCO_REAL = process.env.DB_NAME;
const BANCO_TESTE = process.env.DB_NAME_TESTE || `${BANCO_REAL}_teste`;

if (!BANCO_REAL || !/_teste$/.test(BANCO_TESTE) || BANCO_TESTE === BANCO_REAL) {
    throw new Error(`Banco de testes inválido (${BANCO_TESTE}). O nome precisa terminar em "_teste" e ser diferente do banco real.`);
}

// A partir daqui a aplicação usa o banco de testes (dotenv não sobrescreve variáveis já definidas)
process.env.DB_NAME = BANCO_TESTE;
process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

const SENHA_TESTE = crypto.randomBytes(12).toString("hex");
const USUARIOS = {
    admin: { nome: "Admin Integração", email: "admin@integracao.test", perfil: "ADMINISTRADOR", ativo: 1 },
    atendente: { nome: "Atendente Integração", email: "atendente@integracao.test", perfil: "ATENDENTE", ativo: 1 },
    tecnico: { nome: "Técnico Integração", email: "tecnico@integracao.test", perfil: "TECNICO", ativo: 1 },
    tecnico2: { nome: "Outro Técnico", email: "tecnico2@integracao.test", perfil: "TECNICO", ativo: 1 },
    inativo: { nome: "Técnico Inativo", email: "inativo@integracao.test", perfil: "TECNICO", ativo: 0 }
};

let admin;          // conexão administrativa (sem banco padrão)
let db;             // conexão de verificação no banco de testes
let servidor;
let base;
let contagemRealAntes;
let migracoesAplicadas = [];
const tokens = {};
const ids = {};

const q = (nome) => `\`${nome.replace(/`/g, "")}\``;

async function contarLinhasReais() {
    const [tabelas] = await admin.query(
        "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        [BANCO_REAL]
    );
    const contagem = {};
    for (const { t } of tabelas) {
        const [[linha]] = await admin.query(`SELECT COUNT(*) AS n FROM ${q(BANCO_REAL)}.${q(t)}`);
        contagem[t] = Number(linha.n);
    }
    return contagem;
}

async function prepararBancoTeste() {
    // Sempre do zero: uma execução anterior com MANTER_BANCO_TESTE=1 deixa tabelas das migrações
    // (o nome já foi conferido no início: termina em "_teste" e é diferente do banco real)
    await admin.query(`DROP DATABASE IF EXISTS ${q(BANCO_TESTE)}`);
    await admin.query(`CREATE DATABASE ${q(BANCO_TESTE)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);

    const [tabelas] = await admin.query(
        "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
        [BANCO_REAL]
    );

    const sessao = await mysql.createConnection({
        host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password, database: BANCO_TESTE
    });
    try {
        await sessao.query("SET FOREIGN_KEY_CHECKS = 0");
        for (const { t } of tabelas) {
            // Estrutura lida do banco real; criada SOMENTE no banco de testes
            const [[ddl]] = await admin.query(`SHOW CREATE TABLE ${q(BANCO_REAL)}.${q(t)}`);
            await sessao.query(`DROP TABLE IF EXISTS ${q(BANCO_TESTE)}.${q(t)}`);
            await sessao.query(ddl["Create Table"].replace(/ AUTO_INCREMENT=\d+/, ""));
        }
        await sessao.query("SET FOREIGN_KEY_CHECKS = 1");

        // Migrações pendentes: executadas SOMENTE no banco de testes (o módulo recusa outro nome)
        migracoesAplicadas = await aplicarPendentes(BANCO_TESTE);

        const hash = await bcrypt.hash(SENHA_TESTE, 10);
        for (const [chave, u] of Object.entries(USUARIOS)) {
            const [r] = await sessao.query(
                "INSERT INTO usuario (nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, ?)",
                [u.nome, u.email, hash, u.perfil, u.ativo]
            );
            ids[chave] = r.insertId;
        }
    } finally {
        await sessao.end();
    }
    return tabelas.length;
}

async function api(metodo, caminho, quem, corpo) {
    const resposta = await fetch(base + caminho, {
        method: metodo,
        headers: {
            "Content-Type": "application/json",
            ...(quem ? { Authorization: `Bearer ${tokens[quem]}` } : {})
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await resposta.text();
    const ehJson = (resposta.headers.get("content-type") || "").includes("application/json");
    return { status: resposta.status, corpo: texto && ehJson ? JSON.parse(texto) : null };
}

async function linha(sql, parametros = []) {
    const [linhas] = await db.query(sql, parametros);
    return linhas[0];
}

async function linhas(sql, parametros = []) {
    const [resultado] = await db.query(sql, parametros);
    return resultado;
}

test.before(async () => {
    admin = await mysql.createConnection({
        host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password
    });
    contagemRealAntes = await contarLinhasReais();
    const qtd = await prepararBancoTeste();
    assert.equal(qtd, Object.keys(contagemRealAntes).length);

    db = await mysql.createConnection({
        host: process.env.DB_HOST, user: ADMIN.user, password: ADMIN.password, database: BANCO_TESTE
    });

    const app = require("../src/app");
    servidor = app.listen(0);
    await new Promise((resolver) => servidor.once("listening", resolver));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
});

test.after(async () => {
    if (servidor) servidor.close();
    await require("../src/config/database").pool.end().catch(() => {});
    if (db) await db.end();
    if (admin) {
        if (process.env.MANTER_BANCO_TESTE !== "1") {
            await admin.query(`DROP DATABASE IF EXISTS ${q(BANCO_TESTE)}`); // somente o banco de testes
        }
        await admin.end();
    }
});

test(`integração real no banco "${BANCO_TESTE}"`, async (t) => {
    const [[{ banco }]] = await db.query("SELECT DATABASE() AS banco");
    assert.equal(banco, BANCO_TESTE);
    assert.notEqual(banco, BANCO_REAL);

    await t.test("1. login e acesso por perfil", async () => {
        for (const chave of ["admin", "atendente", "tecnico", "tecnico2"]) {
            const r = await api("POST", "/auth/login", null, { email: USUARIOS[chave].email, senha: SENHA_TESTE });
            assert.equal(r.status, 200, chave);
            assert.equal(r.corpo.usuario.perfil, USUARIOS[chave].perfil);
            tokens[chave] = r.corpo.token;
        }
        assert.equal((await api("POST", "/auth/login", null, { email: USUARIOS.admin.email, senha: "senha-errada" })).status, 401);
        assert.equal((await api("POST", "/auth/login", null, { email: USUARIOS.inativo.email, senha: SENHA_TESTE })).status, 403);
        assert.equal((await api("GET", "/solicitacoes")).status, 401);
        assert.equal((await api("GET", "/solicitacoes", "tecnico")).status, 403);
        assert.equal((await api("GET", "/clientes", "tecnico")).status, 403);
    });

    await t.test("2. cadastro e consulta de clientes", async () => {
        const cliente = {
            tipo_pessoa: "FISICA", nome_razao_social: "Maria Integração", cpf_cnpj: "529.982.247-25",
            telefone: "(11) 98765-4321", cep: "01001-000", logradouro: "Praça da Sé", numero: "100",
            bairro: "Sé", cidade: "São Paulo", uf: "sp"
        };
        const r = await api("POST", "/clientes", "atendente", cliente);
        assert.equal(r.status, 201);
        ids.cliente = r.corpo.cliente.id_cliente;

        const consulta = await api("GET", `/clientes/${ids.cliente}`, "admin");
        assert.equal(consulta.status, 200);
        assert.equal(consulta.corpo.cpf_cnpj, "52998224725");
        assert.equal((await api("POST", "/clientes", "admin", cliente)).status, 409);

        const gravado = await linha("SELECT cpf_cnpj, cep, uf FROM cliente WHERE id_cliente = ?", [ids.cliente]);
        assert.deepEqual({ ...gravado }, { cpf_cnpj: "52998224725", cep: "01001000", uf: "SP" });
    });

    await t.test("3-4. abertura de solicitação com itens, acessórios repetidos e uma OS por item", async () => {
        const acessorio = await api("POST", "/acessorios", "atendente", { descricao: "Carregador (integração)" });
        assert.equal(acessorio.status, 201);
        ids.acessorio = acessorio.corpo.acessorio.id_acessorio;

        assert.equal((await api("POST", "/solicitacoes", "tecnico", {})).status, 403);

        const r = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente,
            descricao_inicial: "Notebook não liga e impressora falhando",
            itens: [
                {
                    tipo_equipamento: "Notebook", marca: "Dell", modelo: "Inspiron", estado_fisico: "Arranhado",
                    acessorios: [
                        { id_acessorio: ids.acessorio, quantidade: 1, observacoes: "original" },
                        { id_acessorio: ids.acessorio, quantidade: 1, observacoes: "paralelo" }
                    ]
                },
                { tipo_equipamento: "Impressora", marca: "HP", modelo: "Laser", estado_fisico: "Bom estado" }
            ]
        });
        assert.equal(r.status, 201);
        ids.solicitacao = r.corpo.solicitacao.id_solicitacao;
        [ids.item1, ids.item2] = r.corpo.solicitacao.itens.map((i) => i.id_item);
        [ids.os1, ids.os2] = r.corpo.solicitacao.itens.map((i) => i.id_os);

        const ordens = await linhas("SELECT id_os, id_item, status, garantia_status, id_tecnico FROM ordem_servico ORDER BY id_os");
        assert.deepEqual(ordens.map((o) => [o.id_item, o.status, o.garantia_status, o.id_tecnico]), [
            [ids.item1, "RECEBIDA", "PENDENTE", null],
            [ids.item2, "RECEBIDA", "PENDENTE", null]
        ]);
        const acessorios = await linhas("SELECT id_item, quantidade, observacoes FROM acessorio_recebido ORDER BY id_acessorio_recebido");
        assert.deepEqual(acessorios.map((a) => [a.id_item, a.quantidade, a.observacoes]), [
            [ids.item1, 1, "original"], [ids.item1, 1, "paralelo"]
        ]);

        const detalhes = await api("GET", `/solicitacoes/${ids.solicitacao}`, "admin");
        assert.equal(detalhes.status, 200);
        const [notebook, impressora] = detalhes.corpo.solicitacao.itens;
        assert.equal(notebook.acessorios.length, 2);
        assert.equal(notebook.acessorios[0].descricao_acessorio, "Carregador (integração)");
        assert.deepEqual(notebook.ordens_servico.map((o) => o.id_os), [ids.os1]);
        assert.deepEqual(impressora.ordens_servico.map((o) => o.id_os), [ids.os2]);
        assert.equal(impressora.garantia_status, "PENDENTE");
    });

    await t.test("5. atribuição de técnico", async () => {
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/tecnico`, "atendente", { id_tecnico: ids.admin })).status, 403);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/tecnico`, "atendente", { id_tecnico: ids.inativo })).status, 404);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/tecnico`, "tecnico", { id_tecnico: ids.tecnico })).status, 403);

        for (const os of [ids.os1, ids.os2]) {
            assert.equal((await api("PATCH", `/ordens-servico/${os}/tecnico`, "atendente", { id_tecnico: ids.tecnico })).status, 200);
        }
        const lista = await api("GET", "/ordens-servico", "tecnico2");
        assert.equal(lista.status, 200);
        assert.equal((await api("GET", `/ordens-servico/${ids.os1}`, "tecnico2")).status, 404);
    });

    await t.test("6. diagnóstico (RECEBIDA → EM_ANALISE) e garantia verificada pelo técnico atribuído", async () => {
        const corpo = { diagnostico: "Placa-mãe com oxidação" };
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/execucao`, "admin", corpo)).status, 403);
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/execucao`, "tecnico2", corpo)).status, 403);
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/execucao`, "tecnico", corpo)).status, 201);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [ids.os1])).status, "EM_ANALISE");

        // Administrador e atendente não alteram a garantia; outro técnico nem enxerga a OS
        for (const quem of ["admin", "atendente"]) {
            assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/garantia`, quem, { garantia_status: "NAO" })).status, 403, quem);
        }
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/garantia`, "tecnico2", { garantia_status: "NAO" })).status, 404);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/garantia`, "tecnico", { garantia_status: "PENDENTE" })).status, 400);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/garantia`, "tecnico", { garantia_status: "NAO" })).status, 200);
        assert.equal((await linha("SELECT garantia_status FROM ordem_servico WHERE id_os = ?", [ids.os1])).garantia_status, "NAO");
    });

    await t.test("7. orçamento: criação, bloqueio de segundo pendente e aprovação", async () => {
        const itens = [
            { tipo_item: "PECA", descricao: "Placa-mãe", quantidade: 1, valor_unitario: 200 },
            { tipo_item: "SERVICO", descricao: "Mão de obra", quantidade: 1, valor_unitario: 100 }
        ];
        const r = await api("POST", `/ordens-servico/${ids.os1}/orcamentos`, "tecnico", { itens });
        assert.equal(r.status, 201);
        ids.orcamento1 = r.corpo.orcamento.id_orcamento;
        assert.equal(Number(r.corpo.orcamento.valor_total), 300);

        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/orcamentos`, "tecnico", { itens })).status, 409);
        const pendentes = await linha("SELECT COUNT(*) AS n FROM orcamento WHERE id_os = ? AND status = 'PENDENTE'", [ids.os1]);
        assert.equal(Number(pendentes.n), 1);

        assert.equal((await api("PATCH", `/orcamentos/${ids.orcamento1}/resposta`, "tecnico", { decisao: "APROVADO" })).status, 403);
        assert.equal((await api("PATCH", `/orcamentos/${ids.orcamento1}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [ids.os1])).status, "EM_REPARO");
    });

    await t.test("8-9. pagamentos parciais, limite de saldo, confirmação e reembolso", async () => {
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/pagamentos`, "tecnico", { valor: 10, forma_pagamento: "PIX" })).status, 403);

        const p1 = await api("POST", `/ordens-servico/${ids.os1}/pagamentos`, "atendente", { valor: 100, forma_pagamento: "PIX" });
        assert.equal(p1.status, 201);
        ids.pag1 = p1.corpo.pagamento.id_pagamento;
        assert.equal(p1.corpo.pagamento.status, "PENDENTE");
        assert.equal(p1.corpo.pagamento.data_pagamento, null);

        // 100 reservado + 250 > 300
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/pagamentos`, "atendente", { valor: 250, forma_pagamento: "PIX" })).status, 409);
        assert.equal((await api("PATCH", `/pagamentos/${ids.pag1}/reembolso`, "admin", { justificativa_reembolso: "x" })).status, 409);

        const c1 = await api("PATCH", `/pagamentos/${ids.pag1}/status`, "atendente", { status: "CONFIRMADO" });
        assert.equal(c1.status, 200);
        assert.notEqual(c1.corpo.pagamento.data_pagamento, null);

        const p2 = await api("POST", `/ordens-servico/${ids.os1}/pagamentos`, "atendente", { valor: 200, forma_pagamento: "DINHEIRO" });
        assert.equal(p2.status, 201);
        assert.equal((await api("PATCH", `/pagamentos/${p2.corpo.pagamento.id_pagamento}/status`, "admin", { status: "CONFIRMADO" })).status, 200);

        let resumo = (await api("GET", `/ordens-servico/${ids.os1}/pagamentos`, "admin")).corpo.resumo;
        assert.equal(resumo.total_pago, 300);
        assert.equal(resumo.saldo_devedor, 0);

        // Reembolso integral e único; o registro original é preservado
        assert.equal((await api("PATCH", `/pagamentos/${ids.pag1}/reembolso`, "tecnico", { justificativa_reembolso: "x" })).status, 403);
        const reembolso = await api("PATCH", `/pagamentos/${ids.pag1}/reembolso`, "atendente", { justificativa_reembolso: "Cobrança em duplicidade" });
        assert.equal(reembolso.status, 200);
        assert.equal(reembolso.corpo.pagamento.status, "REEMBOLSADO");
        assert.equal(reembolso.corpo.pagamento.id_usuario_reembolso, ids.atendente);
        assert.equal(Number(reembolso.corpo.pagamento.valor), 100);
        assert.equal((await api("PATCH", `/pagamentos/${ids.pag1}/reembolso`, "atendente", { justificativa_reembolso: "de novo" })).status, 409);

        resumo = (await api("GET", `/ordens-servico/${ids.os1}/pagamentos`, "admin")).corpo.resumo;
        assert.equal(resumo.total_pago, 200);
        assert.equal(resumo.saldo_devedor, 100);

        const p3 = await api("POST", `/ordens-servico/${ids.os1}/pagamentos`, "atendente", { valor: 100, forma_pagamento: "CARTAO_DEBITO" });
        assert.equal(p3.status, 201);
        assert.equal((await api("PATCH", `/pagamentos/${p3.corpo.pagamento.id_pagamento}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
    });

    await t.test("conclusão do reparo", async () => {
        const fim = new Date(Date.now() + 1000).toISOString();
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/execucao`, "tecnico", { data_conclusao: fim, laudo_tecnico: "Placa trocada" })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os1}/execucao/concluir`, "tecnico")).status, 200);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [ids.os1])).status, "CONCLUIDA");
    });

    await t.test("11-12. expedição ENVIO e finalização após a entrega", async () => {
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/expedicao`, "tecnico", { forma_entrega: "ENVIO" })).status, 403);
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/expedicao`, "atendente", { forma_entrega: "Transportadora" })).status, 400);

        const r = await api("POST", `/ordens-servico/${ids.os1}/expedicao`, "atendente", { forma_entrega: "ENVIO" });
        assert.equal(r.status, 201);
        assert.equal(r.corpo.expedicao.status, "PENDENTE");
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [ids.os1])).status, "AGUARDANDO_EXPEDICAO");
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/expedicao`, "atendente", { forma_entrega: "ENVIO" })).status, 409);

        assert.equal((await api("PATCH", `/expedicoes/${ids.os1}/status`, "atendente", { status: "ENTREGUE" })).status, 409);
        assert.equal((await api("PATCH", `/expedicoes/${ids.os1}/status`, "atendente", { status: "EM_TRANSITO", codigo_rastreio: "BR123456789" })).status, 200);
        assert.equal((await api("PATCH", `/expedicoes/${ids.os1}/status`, "admin", { status: "ENTREGUE" })).status, 200);

        const exp = await linha("SELECT status, codigo_rastreio, data_envio, data_entrega FROM expedicao WHERE id_os = ?", [ids.os1]);
        assert.equal(exp.status, "ENTREGUE");
        assert.equal(exp.codigo_rastreio, "BR123456789");
        assert.ok(exp.data_envio && exp.data_entrega);
        const os = await linha("SELECT status, data_encerramento FROM ordem_servico WHERE id_os = ?", [ids.os1]);
        assert.equal(os.status, "FINALIZADA");
        assert.ok(os.data_encerramento);
    });

    await t.test("10. encerramento sem reparo (orçamento rejeitado) e devolução por RETIRADA", async () => {
        assert.equal((await api("POST", `/ordens-servico/${ids.os2}/execucao`, "tecnico", { diagnostico: "Fusor danificado" })).status, 201);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os2}/garantia`, "tecnico", { garantia_status: "NAO" })).status, 200);

        const orc = await api("POST", `/ordens-servico/${ids.os2}/orcamentos`, "tecnico", {
            itens: [
                { tipo_item: "PECA", descricao: "Fusor", quantidade: 1, valor_unitario: 80 },
                { tipo_item: "SERVICO", descricao: "Mão de obra", quantidade: 1, valor_unitario: 50 }
            ]
        });
        assert.equal(orc.status, 201);
        assert.equal(Number(orc.corpo.orcamento.valor_total), 130); // fora da garantia: peças e serviços cobrados
        assert.equal((await api("PATCH", `/orcamentos/${orc.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "REJEITADO" })).status, 200);

        const os = await linha("SELECT status, data_encerramento, motivo_encerramento FROM ordem_servico WHERE id_os = ?", [ids.os2]);
        assert.equal(os.status, "ENCERRADA_SEM_REPARO");
        assert.ok(os.data_encerramento);
        assert.equal((await api("POST", `/ordens-servico/${ids.os2}/pagamentos`, "atendente", { valor: 10, forma_pagamento: "PIX" })).status, 409);

        const exp = await api("POST", `/ordens-servico/${ids.os2}/expedicao`, "atendente", { forma_entrega: "RETIRADA" });
        assert.equal(exp.status, 201);
        assert.equal(exp.corpo.expedicao.status, "AGUARDANDO_RETIRADA");
        assert.equal((await api("PATCH", `/expedicoes/${ids.os2}/status`, "atendente", { status: "RETIRADO" })).status, 200);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [ids.os2])).status, "ENCERRADA_SEM_REPARO");
    });

    await t.test("RN05. nova OS do mesmo equipamento herda a garantia da OS anterior", async () => {
        const r = await api("POST", "/ordens-servico", "atendente", { id_item: ids.item2 });
        assert.equal(r.status, 201);
        const nova = await linha("SELECT status, garantia_status, id_tecnico FROM ordem_servico WHERE id_os = ?", [r.corpo.ordem.id_os]);
        assert.deepEqual({ ...nova }, { status: "RECEBIDA", garantia_status: "NAO", id_tecnico: null });

        // Já existe OS ativa para o item: segunda criação é recusada
        assert.equal((await api("POST", "/ordens-servico", "atendente", { id_item: ids.item2 })).status, 409);
        ids.os3 = r.corpo.ordem.id_os;
    });

    await t.test("concorrência: dois orçamentos simultâneos para a mesma OS geram um só PENDENTE", async () => {
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os3}/tecnico`, "atendente", { id_tecnico: ids.tecnico })).status, 200);
        assert.equal((await api("POST", `/ordens-servico/${ids.os3}/execucao`, "tecnico", { diagnostico: "Novo defeito" })).status, 201);

        const corpo = { itens: [{ tipo_item: "PECA", descricao: "Rolo", quantidade: 1, valor_unitario: 30 }] };
        const respostas = await Promise.all(
            Array.from({ length: 5 }, () => api("POST", `/ordens-servico/${ids.os3}/orcamentos`, "tecnico", corpo))
        );

        assert.deepEqual(respostas.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
        const pendentes = await linha("SELECT COUNT(*) AS n FROM orcamento WHERE id_os = ? AND status = 'PENDENTE'", [ids.os3]);
        assert.equal(Number(pendentes.n), 1);
    });

    await t.test("RN21. histórico gravado no MySQL: eventos, usuários, OS correta e ordem cronológica", async () => {
        const nomeUsuario = Object.fromEntries(Object.entries(ids).filter(([k]) => USUARIOS[k]).map(([k, v]) => [v, k]));
        const historicoDe = async (idOs) => (await linhas(
            "SELECT id_os, id_usuario, tipo_evento, descricao, dados_anteriores, dados_novos FROM historico_os WHERE id_os = ? ORDER BY data_evento, id_historico",
            [idOs]
        )).map((h) => ({ ...h, quem: h.id_usuario === null ? "automatico" : nomeUsuario[h.id_usuario] }));

        // OS 1: fluxo completo com reparo. Tentativas recusadas (403, 404, 409, 400) não geram eventos.
        const os1 = await historicoDe(ids.os1);
        assert.deepEqual(os1.map((h) => [h.tipo_evento, h.quem]), [
            ["CRIACAO", "atendente"],
            ["ATRIBUICAO_TECNICO", "atendente"],
            ["DIAGNOSTICO", "tecnico"],
            ["GARANTIA", "tecnico"],
            ["ORCAMENTO", "tecnico"],
            ["ORCAMENTO", "atendente"],
            ["REPARO", "atendente"],
            ["PAGAMENTO", "atendente"],   // p1 registrado
            ["PAGAMENTO", "atendente"],   // p1 confirmado
            ["PAGAMENTO", "atendente"],   // p2 registrado
            ["PAGAMENTO", "admin"],       // p2 confirmado
            ["PAGAMENTO", "atendente"],   // p1 reembolsado
            ["PAGAMENTO", "atendente"],   // p3 registrado
            ["PAGAMENTO", "atendente"],   // p3 confirmado
            ["DIAGNOSTICO", "tecnico"],   // laudo e data de conclusão
            ["REPARO", "tecnico"],        // reparo concluído
            ["EXPEDICAO", "atendente"],
            ["EXPEDICAO", "atendente"],   // EM_TRANSITO
            ["EXPEDICAO", "admin"]        // ENTREGUE + FINALIZADA
        ]);
        assert.deepEqual(os1[1].dados_novos, { id_tecnico: ids.tecnico });
        assert.deepEqual(os1[2].dados_anteriores, { status_os: "RECEBIDA" });
        assert.deepEqual(os1[3].dados_anteriores, { garantia_status: "PENDENTE" });
        assert.deepEqual(os1[3].dados_novos, { garantia_status: "NAO" });
        assert.equal(os1[11].dados_novos.status, "REEMBOLSADO");
        assert.equal(os1[11].dados_novos.justificativa_reembolso, "Cobrança em duplicidade");
        assert.deepEqual(os1[18].dados_novos, { status: "ENTREGUE", status_os: "FINALIZADA" });

        // Nenhum dado sensível no histórico
        const [[{ texto }]] = await db.query("SELECT GROUP_CONCAT(CONCAT_WS(' ', descricao, dados_anteriores, dados_novos)) AS texto FROM historico_os");
        assert.doesNotMatch(texto, /senha|hash|token|\$2[aby]\$/i);

        // OS 2: rejeição encerra sem reparo, com tipo e usuário (RN09/RN11)
        const os2 = await historicoDe(ids.os2);
        assert.deepEqual(os2.map((h) => [h.tipo_evento, h.quem]), [
            ["CRIACAO", "atendente"], ["ATRIBUICAO_TECNICO", "atendente"], ["DIAGNOSTICO", "tecnico"],
            ["GARANTIA", "tecnico"], ["ORCAMENTO", "tecnico"], ["ORCAMENTO", "atendente"],
            ["ENCERRAMENTO", "atendente"], ["EXPEDICAO", "atendente"], ["EXPEDICAO", "atendente"]
        ]);
        const encerrada = await linha("SELECT tipo_encerramento, id_usuario_encerramento FROM ordem_servico WHERE id_os = ?", [ids.os2]);
        assert.deepEqual({ ...encerrada }, { tipo_encerramento: "ORCAMENTO_REJEITADO", id_usuario_encerramento: ids.atendente });

        // OS 3: criação manual com garantia herdada; só 1 evento de orçamento apesar das 5 requisições simultâneas
        const os3 = await historicoDe(ids.os3);
        assert.deepEqual(os3.map((h) => h.tipo_evento), ["CRIACAO", "ATRIBUICAO_TECNICO", "DIAGNOSTICO", "ORCAMENTO"]);
        assert.equal(os3[0].dados_novos.garantia_herdada_da_os, ids.os2);

        // Consulta pela API: mesma ordem cronológica; técnico de outra OS não vê
        const api1 = await api("GET", `/ordens-servico/${ids.os1}/historico`, "tecnico");
        assert.equal(api1.status, 200);
        // P3: o técnico recebe a mesma sequência, sem os eventos de PAGAMENTO
        assert.deepEqual(api1.corpo.map((h) => h.tipo_evento), os1.map((h) => h.tipo_evento).filter((t) => t !== "PAGAMENTO"));
        assert.equal((await api("GET", `/ordens-servico/${ids.os1}/historico`, "tecnico2")).status, 404);
        assert.equal((await api("DELETE", `/ordens-servico/${ids.os1}/historico`, "admin")).status, 404);
    });

    await t.test("RN21. falha real ao gravar o histórico desfaz a operação no MySQL", async () => {
        const historicoRepository = require("../src/repositories/historicoRepository");
        const original = historicoRepository.registrar;
        const antes = await linha("SELECT id_tecnico FROM ordem_servico WHERE id_os = ?", [ids.os3]);
        const eventosAntes = Number((await linha("SELECT COUNT(*) AS n FROM historico_os")).n);

        // Simula erro do banco no INSERT do histórico (o técnico já terá sido trocado na transação)
        historicoRepository.registrar = async (conexao, evento) => {
            await conexao.execute("INSERT INTO historico_os (id_os, tipo_evento, descricao) VALUES (?, 'TIPO_INEXISTENTE', 'x')", [evento.id_os]);
        };
        try {
            const r = await api("PATCH", `/ordens-servico/${ids.os3}/tecnico`, "atendente", { id_tecnico: ids.tecnico2 });
            assert.equal(r.status, 500);
        } finally {
            historicoRepository.registrar = original;
        }

        const depois = await linha("SELECT id_tecnico FROM ordem_servico WHERE id_os = ?", [ids.os3]);
        assert.equal(antes.id_tecnico, ids.tecnico);
        assert.equal(depois.id_tecnico, ids.tecnico); // a troca foi desfeita junto com o histórico
        assert.equal(Number((await linha("SELECT COUNT(*) AS n FROM historico_os")).n), eventosAntes);
    });

    await t.test("GARANTIA: pendente bloqueia o orçamento; técnico corrige SIM ↔ NAO; SIM passa por orçamento com serviço a R$ 0,00", async () => {
        const nova = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente, descricao_inicial: "Equipamento em garantia",
            itens: [{ tipo_equipamento: "Notebook", marca: "Dell", modelo: "G", estado_fisico: "ok" }]
        });
        assert.equal(nova.status, 201);
        const osG = nova.corpo.solicitacao.itens[0].id_os;
        const statusOs = async () => (await linha("SELECT status, garantia_status FROM ordem_servico WHERE id_os = ?", [osG]));
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/tecnico`, "atendente", { id_tecnico: ids.tecnico })).status, 200);
        assert.equal((await api("POST", `/ordens-servico/${osG}/execucao`, "tecnico", { diagnostico: "Teclado com defeito de fábrica" })).status, 201);

        // PENDENTE: o técnico não avança para o orçamento
        const itens = [{ tipo_item: "PECA", descricao: "Teclado", quantidade: 1, valor_unitario: 200 }];
        assert.equal((await api("POST", `/ordens-servico/${osG}/orcamentos`, "tecnico", { itens })).status, 409);
        assert.equal((await statusOs()).status, "EM_ANALISE");

        // Somente o técnico atribuído altera a garantia; a etapa da OS não muda
        for (const quem of ["admin", "atendente"]) {
            assert.equal((await api("PATCH", `/ordens-servico/${osG}/garantia`, quem, { garantia_status: "SIM" })).status, 403, quem);
        }
        const g = await api("PATCH", `/ordens-servico/${osG}/garantia`, "tecnico", { garantia_status: "SIM" });
        assert.equal(g.status, 200);
        assert.equal(g.corpo.garantia.status, "EM_ANALISE");
        assert.deepEqual({ ...(await statusOs()) }, { status: "EM_ANALISE", garantia_status: "SIM" });

        // Correções ainda em análise: SIM → NAO → SIM
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/garantia`, "tecnico", { garantia_status: "NAO" })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/garantia`, "tecnico", { garantia_status: "SIM" })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/garantia`, "tecnico", { garantia_status: "PENDENTE" })).status, 400);

        // Garantia SIM passa por orçamento: o serviço sai a R$ 0,00 e a peça é cobrada
        const orc = await api("POST", `/ordens-servico/${osG}/orcamentos`, "tecnico", {
            itens: [...itens, { tipo_item: "SERVICO", descricao: "Troca do teclado", quantidade: 1, valor_unitario: 120 }]
        });
        assert.equal(orc.status, 201);
        assert.equal(Number(orc.corpo.orcamento.valor_total), 200);
        const itensGravados = await linhas("SELECT tipo_item, valor_unitario FROM item_orcamento WHERE id_orcamento = ? ORDER BY id_item_orcamento", [orc.corpo.orcamento.id_orcamento]);
        assert.deepEqual(itensGravados.map((i) => [i.tipo_item, Number(i.valor_unitario)]), [["PECA", 200], ["SERVICO", 0]]);

        // Depois da emissão do orçamento a garantia fica fixa
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/garantia`, "tecnico", { garantia_status: "NAO" })).status, 409);

        // Aprovação do cliente registrada pelo atendente; a peça é cobrada normalmente
        assert.equal((await api("PATCH", `/orcamentos/${orc.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        assert.equal((await statusOs()).status, "EM_REPARO");
        const pagamentos = await api("GET", `/ordens-servico/${osG}/pagamentos`, "atendente");
        assert.equal(pagamentos.corpo.resumo.saldo_devedor, 200);

        // Técnico consulta a garantia e conclui o reparo
        const detalhe = await api("GET", `/ordens-servico/${osG}`, "tecnico");
        assert.equal(detalhe.corpo.equipamento.garantia_status, "SIM");
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/execucao`, "tecnico", { laudo_tecnico: "Teclado substituído em garantia", data_conclusao: new Date(Date.now() + 1000).toISOString() })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osG}/execucao/concluir`, "tecnico")).status, 200);

        // Histórico: cada alteração da garantia com valor anterior, novo valor e o técnico responsável
        const historico = await linhas("SELECT tipo_evento, id_usuario, dados_anteriores, dados_novos FROM historico_os WHERE id_os = ? ORDER BY data_evento, id_historico", [osG]);
        const garantias = historico.filter((h) => h.tipo_evento === "GARANTIA");
        assert.deepEqual(garantias.map((h) => [h.id_usuario, h.dados_anteriores.garantia_status, h.dados_novos.garantia_status]), [
            [ids.tecnico, "PENDENTE", "SIM"],
            [ids.tecnico, "SIM", "NAO"],
            [ids.tecnico, "NAO", "SIM"]
        ]);
    });

    await t.test("14. encerramento sem reparo: desistência, impossibilidade técnica e cancelamentos (RN06, RN07, RN08, RN12, RN13, RN22)", async () => {
        const nova = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente,
            descricao_inicial: "Três equipamentos para encerramento",
            itens: ["Celular", "Tablet", "Console"].map((tipo) => ({ tipo_equipamento: tipo, marca: "M", modelo: "X", estado_fisico: "ok" }))
        });
        assert.equal(nova.status, 201);
        assert.equal("status" in nova.corpo.solicitacao, false); // RN22
        const [osA, osB, osC] = nova.corpo.solicitacao.itens.map((i) => i.id_os);
        for (const os of [osA, osB, osC]) {
            assert.equal((await api("PATCH", `/ordens-servico/${os}/tecnico`, "atendente", { id_tecnico: ids.tecnico })).status, 200);
        }
        const os = (id) => linha("SELECT status, tipo_encerramento, motivo_encerramento, id_usuario_encerramento, data_encerramento FROM ordem_servico WHERE id_os = ?", [id]);
        const encerrar = (id, quem, tipo, motivo = "Justificativa de teste") =>
            api("PATCH", `/ordens-servico/${id}/encerramento`, quem, { tipo_encerramento: tipo, motivo_encerramento: motivo });

        // OS A — RECEBIDA: garantia antes da análise é recusada (RN06); impossibilidade exige diagnóstico;
        // desistência não exige diagnóstico
        assert.equal((await api("PATCH", `/ordens-servico/${osA}/garantia`, "tecnico", { garantia_status: "SIM" })).status, 409);
        assert.equal((await encerrar(osA, "tecnico", "IMPOSSIBILIDADE_TECNICA")).status, 409);
        assert.equal((await encerrar(osA, "atendente", "DESISTENCIA_CLIENTE", "   ")).status, 400);
        assert.equal((await encerrar(osA, "tecnico2", "DESISTENCIA_CLIENTE")).status, 404);
        const a = await encerrar(osA, "atendente", "DESISTENCIA_CLIENTE", "Cliente desistiu na entrega");
        assert.equal(a.status, 200);
        assert.equal(a.corpo.ordem.status, "ENCERRADA_SEM_REPARO");
        const linhaA = await os(osA);
        assert.equal(linhaA.status, "ENCERRADA_SEM_REPARO");
        assert.equal(linhaA.tipo_encerramento, "DESISTENCIA_CLIENTE");
        assert.equal(linhaA.motivo_encerramento, "Cliente desistiu na entrega");
        assert.equal(linhaA.id_usuario_encerramento, ids.atendente);
        assert.ok(linhaA.data_encerramento);
        assert.equal((await encerrar(osA, "atendente", "DESISTENCIA_CLIENTE")).status, 409); // já encerrada

        // OS B — orçamento PENDENTE é cancelado na desistência registrada pelo técnico
        assert.equal((await api("POST", `/ordens-servico/${osB}/execucao`, "tecnico", { diagnostico: "Bateria" })).status, 201);
        assert.equal((await api("PATCH", `/ordens-servico/${osB}/garantia`, "atendente", { garantia_status: "NAO" })).status, 403);
        assert.equal((await api("PATCH", `/ordens-servico/${osB}/garantia`, "tecnico", { garantia_status: "NAO" })).status, 200);
        const orcB = await api("POST", `/ordens-servico/${osB}/orcamentos`, "tecnico", {
            itens: [{ tipo_item: "PECA", descricao: "Bateria", quantidade: 1, valor_unitario: 90 }]
        });
        assert.equal(orcB.status, 201);
        assert.equal((await api("PATCH", `/ordens-servico/${osB}/garantia`, "tecnico", { garantia_status: "SIM" })).status, 409); // após o orçamento
        const b = await encerrar(osB, "tecnico", "DESISTENCIA_CLIENTE", "Cliente não quis aguardar");
        assert.equal(b.status, 200);
        assert.deepEqual(b.corpo.encerramento.orcamentos_cancelados, [orcB.corpo.orcamento.id_orcamento]);
        assert.equal((await linha("SELECT status FROM orcamento WHERE id_orcamento = ?", [orcB.corpo.orcamento.id_orcamento])).status, "CANCELADO");
        assert.equal((await api("PATCH", `/orcamentos/${orcB.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 409);

        // OS C — EM_REPARO: desistência recusada; impossibilidade só pelo técnico; pagamento PENDENTE é
        // cancelado e o CONFIRMADO preservado; orçamento APROVADO preservado; reembolso continua possível
        assert.equal((await api("POST", `/ordens-servico/${osC}/execucao`, "tecnico", { diagnostico: "Leitor" })).status, 201);
        assert.equal((await api("PATCH", `/ordens-servico/${osC}/garantia`, "tecnico", { garantia_status: "NAO" })).status, 200);
        const orcC = await api("POST", `/ordens-servico/${osC}/orcamentos`, "tecnico", {
            itens: [{ tipo_item: "SERVICO", descricao: "Troca do leitor", quantidade: 1, valor_unitario: 150 }]
        });
        assert.equal((await api("PATCH", `/orcamentos/${orcC.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        const confirmado = await api("POST", `/ordens-servico/${osC}/pagamentos`, "atendente", { valor: 50, forma_pagamento: "PIX" });
        assert.equal((await api("PATCH", `/pagamentos/${confirmado.corpo.pagamento.id_pagamento}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        const pendente = await api("POST", `/ordens-servico/${osC}/pagamentos`, "atendente", { valor: 30, forma_pagamento: "PIX" });

        assert.equal((await encerrar(osC, "atendente", "DESISTENCIA_CLIENTE")).status, 409);
        assert.equal((await encerrar(osC, "admin", "IMPOSSIBILIDADE_TECNICA")).status, 403);
        const c = await encerrar(osC, "tecnico", "IMPOSSIBILIDADE_TECNICA", "Peça descontinuada");
        assert.equal(c.status, 200);
        assert.deepEqual(c.corpo.encerramento.pagamentos_cancelados, [pendente.corpo.pagamento.id_pagamento]);

        const pagamentos = await linhas("SELECT id_pagamento, status FROM pagamento WHERE id_os = ? ORDER BY id_pagamento", [osC]);
        assert.deepEqual(pagamentos.map((p) => p.status), ["CONFIRMADO", "CANCELADO"]);
        assert.equal((await linha("SELECT status FROM orcamento WHERE id_orcamento = ?", [orcC.corpo.orcamento.id_orcamento])).status, "APROVADO");
        assert.equal((await api("POST", `/ordens-servico/${osC}/pagamentos`, "atendente", { valor: 10, forma_pagamento: "PIX" })).status, 409);
        assert.equal((await api("PATCH", `/pagamentos/${pendente.corpo.pagamento.id_pagamento}/status`, "atendente", { status: "CONFIRMADO" })).status, 409);
        // D1: impossibilidade técnica em EM_REPARO com pagamento confirmado exige avaliação antes do reembolso
        const semAvaliacao = await api("PATCH", `/pagamentos/${confirmado.corpo.pagamento.id_pagamento}/reembolso`, "atendente", { justificativa_reembolso: "Serviço não realizado" });
        assert.equal(semAvaliacao.status, 409);
        assert.match(semAvaliacao.corpo.mensagem, /avaliação financeira/);
        ids.osA = osA;
        ids.osC = osC;
        ids.pagC = confirmado.corpo.pagamento.id_pagamento;

        // Histórico das três OS, na mesma transação de cada encerramento
        const tipos = async (id) => (await linhas("SELECT tipo_evento, dados_novos FROM historico_os WHERE id_os = ? ORDER BY data_evento, id_historico", [id]))
            .map((h) => `${h.tipo_evento}${h.dados_novos?.status ? `:${h.dados_novos.status}` : ""}`);
        assert.deepEqual(await tipos(osA), ["CRIACAO:RECEBIDA", "ATRIBUICAO_TECNICO", "ENCERRAMENTO"]);
        assert.deepEqual(await tipos(osB), [
            "CRIACAO:RECEBIDA", "ATRIBUICAO_TECNICO", "DIAGNOSTICO", "GARANTIA",
            "ORCAMENTO:PENDENTE", "ENCERRAMENTO", "ORCAMENTO:CANCELADO"
        ]);
        assert.deepEqual(await tipos(osC), [
            "CRIACAO:RECEBIDA", "ATRIBUICAO_TECNICO", "DIAGNOSTICO", "GARANTIA", "ORCAMENTO:PENDENTE",
            "ORCAMENTO:APROVADO", "REPARO", "PAGAMENTO:PENDENTE", "PAGAMENTO:CONFIRMADO", "PAGAMENTO:PENDENTE",
            "ENCERRAMENTO", "PAGAMENTO:CANCELADO"
        ]);
    });

    await t.test("P5/P3/P4: usuários, dados financeiros do técnico e acessórios em lote", async () => {
        // P5: o único administrador ativo não pode ser desativado nem perder o perfil
        assert.equal((await api("PATCH", `/usuarios/${ids.admin}/ativo`, "admin", { ativo: false })).status, 409);
        assert.equal((await api("PUT", `/usuarios/${ids.admin}`, "admin", { nome: "Admin", email: USUARIOS.admin.email, perfil: "ATENDENTE" })).status, 409);
        assert.equal((await api("PATCH", `/usuarios/${ids.tecnico2}/ativo`, "atendente", { ativo: false })).status, 403);

        // Edição com nova senha: o hash muda, a senha antiga deixa de valer, nada sensível é devolvido
        const novaSenha = `${SENHA_TESTE}-nova`;
        const edicao = await api("PUT", `/usuarios/${ids.tecnico2}`, "admin", {
            nome: "Outro Técnico Editado", email: USUARIOS.tecnico2.email, perfil: "TECNICO", senha: novaSenha
        });
        assert.equal(edicao.status, 200);
        assert.equal("senha_hash" in edicao.corpo.usuario, false);
        assert.equal((await api("POST", "/auth/login", null, { email: USUARIOS.tecnico2.email, senha: SENHA_TESTE })).status, 401);
        assert.equal((await api("POST", "/auth/login", null, { email: USUARIOS.tecnico2.email, senha: novaSenha })).status, 200);
        assert.equal((await api("PUT", `/usuarios/${ids.tecnico2}`, "admin", { nome: "X", email: USUARIOS.admin.email, perfil: "TECNICO" })).status, 409);

        // Desativado: não autentica e o token antigo deixa de valer
        assert.equal((await api("PATCH", `/usuarios/${ids.tecnico2}/ativo`, "admin", { ativo: false })).status, 200);
        assert.equal((await api("GET", "/ordens-servico", "tecnico2")).status, 401);
        assert.equal((await api("POST", "/auth/login", null, { email: USUARIOS.tecnico2.email, senha: novaSenha })).status, 403);
        assert.equal((await api("PATCH", `/usuarios/${ids.tecnico2}/ativo`, "admin", { ativo: true })).status, 200);

        // Com um segundo administrador ativo, o primeiro pode deixar o perfil
        assert.equal((await api("PUT", `/usuarios/${ids.atendente}`, "admin", { nome: USUARIOS.atendente.nome, email: USUARIOS.atendente.email, perfil: "ADMINISTRADOR" })).status, 200);
        assert.equal((await api("PATCH", `/usuarios/${ids.admin}/ativo`, "admin", { ativo: false })).status, 200);
        assert.equal((await api("PATCH", `/usuarios/${ids.atendente}/ativo`, "atendente", { ativo: false })).status, 409); // agora é o único
        // restaura os perfis para os próximos passos
        await db.query("UPDATE usuario SET ativo = 1 WHERE id_usuario = ?", [ids.admin]);
        await db.query("UPDATE usuario SET perfil = 'ATENDENTE' WHERE id_usuario = ?", [ids.atendente]);

        // P3: técnico sem acesso a pagamentos e sem eventos PAGAMENTO no histórico
        assert.equal((await api("GET", `/ordens-servico/${ids.os1}/pagamentos`, "tecnico")).status, 403);
        const historicoTecnico = await api("GET", `/ordens-servico/${ids.os1}/historico`, "tecnico");
        assert.equal(historicoTecnico.status, 200);
        assert.equal(historicoTecnico.corpo.some((e) => e.tipo_evento === "PAGAMENTO"), false);
        const historicoAdmin = await api("GET", `/ordens-servico/${ids.os1}/historico`, "admin");
        assert.ok(historicoAdmin.corpo.some((e) => e.tipo_evento === "PAGAMENTO"));

        // P4: lote com acessório inativo é recusado sem gravar nenhum registro
        const inativo = await linha("SELECT id_acessorio FROM acessorio LIMIT 1");
        await db.query("INSERT INTO acessorio (descricao, ativo) VALUES ('Bolsa (inativa)', 0)");
        const idInativo = (await linha("SELECT MAX(id_acessorio) AS id FROM acessorio")).id;
        const antes = Number((await linha("SELECT COUNT(*) AS n FROM acessorio_recebido")).n);
        const lote = await api("POST", "/acessorios-recebidos", "atendente", [
            { id_item: ids.item2, id_acessorio: inativo.id_acessorio },
            { id_item: ids.item2, id_acessorio: idInativo }
        ]);
        assert.equal(lote.status, 409);
        assert.equal(Number((await linha("SELECT COUNT(*) AS n FROM acessorio_recebido")).n), antes);

        const valido = await api("POST", "/acessorios-recebidos", "atendente", [
            { id_item: ids.item2, id_acessorio: inativo.id_acessorio, observacoes: "cabo extra" },
            { id_item: ids.item2, id_acessorio: inativo.id_acessorio }
        ]);
        assert.equal(valido.status, 201);
        assert.equal(Number((await linha("SELECT COUNT(*) AS n FROM acessorio_recebido")).n), antes + 2);
    });

    await t.test("P2: banco de testes no estado de destino (migrações executadas no principal em 09/11/2026)", async () => {
        // Nenhuma pendente: o banco de testes já nasce da estrutura do principal migrado
        assert.deepEqual(migracoesAplicadas.map((m) => m.arquivo), listarPendentes());
        assert.deepEqual(listarExecutadas(), [
            "20261109_01_remover_status_solicitacao.sql",
            "20261109_02_avaliacao_reembolso_parcial.sql",
            "20261109_03_historico_evento_acessorio.sql",
            "20261109_04_abatimento_formal.sql"
        ]);
        const colunaStatus = await linha(
            "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'solicitacao' AND COLUMN_NAME = 'status'",
            [BANCO_TESTE]
        );
        assert.equal(Number(colunaStatus.n), 0);
        const novas = await linhas(
            "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('abatimento', 'avaliacao_reembolso', 'reembolso') ORDER BY TABLE_NAME",
            [BANCO_TESTE]
        );
        assert.deepEqual(novas.map((r) => r.t), ["abatimento", "avaliacao_reembolso", "reembolso"]);
        const tipo = await linha(
            "SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'historico_os' AND COLUMN_NAME = 'tipo_evento'",
            [BANCO_TESTE]
        );
        assert.match(tipo.tipo, /'ACESSORIO','ABATIMENTO'\)$/);
        // Banco real (somente leitura): migrado em 09/11/2026 — sem a coluna legada e com as 3 tabelas novas
        const [[real]] = await admin.query(
            "SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'solicitacao' AND COLUMN_NAME = 'status') AS status_existe, " +
            "(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('abatimento', 'avaliacao_reembolso', 'reembolso')) AS tabelas_novas",
            [BANCO_REAL, BANCO_REAL]
        );
        assert.deepEqual({ status: Number(real.status_existe), novas: Number(real.tabelas_novas) }, { status: 0, novas: 3 });
    });

    await t.test("D1–D6: avaliação financeira, revisão e reembolsos parciais (OS C, impossibilidade em EM_REPARO)", async () => {
        const url = `/ordens-servico/${ids.osC}/avaliacao-financeira`;

        // R8: técnico não acessa; OS sem obrigação (desistência) recusa
        assert.equal((await api("GET", url, "tecnico")).status, 403);
        assert.equal((await api("POST", url, "tecnico", { valor_definido: 0, justificativa: "x" })).status, 403);
        assert.equal((await api("POST", `/ordens-servico/${ids.osA}/avaliacao-financeira`, "atendente", { valor_definido: 0, justificativa: "x" })).status, 409);

        const inicial = await api("GET", url, "atendente");
        assert.equal(inicial.status, 200);
        assert.equal(inicial.corpo.obrigatoria, true);
        assert.equal(inicial.corpo.pendente, true);
        assert.equal(inicial.corpo.total_disponivel, 50);

        // D1: valor acima do disponível é recusado
        assert.equal((await api("POST", url, "atendente", { valor_definido: 50.01, justificativa: "x" })).status, 409);

        // Concorrência: 5 avaliações originais simultâneas → uma só gravada
        const respostas = await Promise.all(Array.from({ length: 5 }, () =>
            api("POST", url, "atendente", { valor_definido: 30, justificativa: "Peça já encomendada; devolver parte" })
        ));
        assert.deepEqual(respostas.map((r) => r.status).sort(), [201, 409, 409, 409, 409]);
        const originais = await linha("SELECT COUNT(*) AS n FROM avaliacao_reembolso WHERE id_os = ? AND id_avaliacao_revisada IS NULL", [ids.osC]);
        assert.equal(Number(originais.n), 1);
        const original = await linha("SELECT * FROM avaliacao_reembolso WHERE id_os = ?", [ids.osC]);
        assert.equal(original.id_usuario, ids.atendente);
        assert.ok(original.data_avaliacao);

        // D4: orçamento continua APROVADO
        assert.equal((await linha("SELECT COUNT(*) AS n FROM orcamento WHERE id_os = ? AND status = 'APROVADO'", [ids.osC])).n, 1);

        // D6: reembolso parcial dentro do valor definido
        const parcial = await api("PATCH", `/pagamentos/${ids.pagC}/reembolso`, "atendente", { justificativa_reembolso: "Primeira parte", valor: 20 });
        assert.equal(parcial.status, 200);
        assert.equal(parcial.corpo.pagamento.status, "CONFIRMADO");
        assert.equal(parcial.corpo.pagamento.valor_reembolsado, 20);
        assert.equal(parcial.corpo.pagamento.valor_disponivel_reembolso, 30);
        assert.equal((await api("PATCH", `/pagamentos/${ids.pagC}/reembolso`, "atendente", { justificativa_reembolso: "x", valor: 15 })).status, 409); // só restam 10 da avaliação

        // D2: revisões
        const revisoes = `${url}/revisoes`;
        assert.equal((await api("POST", revisoes, "atendente", { id_avaliacao_revisada: original.id_avaliacao, valor_definido: 50, justificativa: "x" })).status, 400); // sem motivo
        assert.equal((await api("POST", revisoes, "atendente", { id_avaliacao_revisada: original.id_avaliacao + 999, valor_definido: 50, justificativa: "x", motivo_revisao: "y" })).status, 409);
        assert.equal((await api("POST", revisoes, "atendente", { id_avaliacao_revisada: original.id_avaliacao, valor_definido: 10, justificativa: "x", motivo_revisao: "y" })).status, 409); // < já reembolsado
        const revisao = await api("POST", revisoes, "admin", {
            id_avaliacao_revisada: original.id_avaliacao, valor_definido: 50,
            justificativa: "Fornecedor aceitou a devolução da peça", motivo_revisao: "Valor recalculado após contato com o fornecedor"
        });
        assert.equal(revisao.status, 201);
        assert.equal(revisao.corpo.avaliacao.avaliacoes.length, 2);
        assert.equal(revisao.corpo.avaliacao.vigente.valor_definido, 50);
        assert.equal(revisao.corpo.avaliacao.vigente.motivo_revisao, "Valor recalculado após contato com o fornecedor");
        // A original permanece intacta
        const originalDepois = await linha("SELECT * FROM avaliacao_reembolso WHERE id_avaliacao = ?", [original.id_avaliacao]);
        assert.deepEqual({ ...originalDepois }, { ...original });

        // Reembolso do restante sem informar valor: completa o pagamento
        const restante = await api("PATCH", `/pagamentos/${ids.pagC}/reembolso`, "admin", { justificativa_reembolso: "Restante após a revisão" });
        assert.equal(restante.status, 200);
        assert.equal(restante.corpo.pagamento.status, "REEMBOLSADO");
        assert.equal(restante.corpo.pagamento.reembolsos.length, 2);
        const vinculos = await linhas("SELECT valor, id_avaliacao FROM reembolso WHERE id_pagamento = ? ORDER BY id_reembolso", [ids.pagC]);
        assert.deepEqual(vinculos.map((r) => [Number(r.valor), r.id_avaliacao]), [[20, original.id_avaliacao], [30, revisao.corpo.avaliacao.vigente.id_avaliacao]]);

        const final = (await api("GET", url, "atendente")).corpo;
        assert.deepEqual([final.obrigatoria, final.pendente, final.total_reembolsado_avaliacao, final.saldo_a_reembolsar], [true, false, 50, 0]);

        // Histórico da OS C: avaliação, reembolso parcial, revisão e conclusão do reembolso (todos PAGAMENTO)
        const eventos = await linhas("SELECT tipo_evento, descricao, id_usuario FROM historico_os WHERE id_os = ? ORDER BY data_evento, id_historico", [ids.osC]);
        assert.deepEqual(eventos.slice(-4).map((e) => [e.tipo_evento, e.descricao]), [
            ["PAGAMENTO", "Avaliação financeira registrada: reembolso definido em R$ 30,00."],
            ["PAGAMENTO", `Reembolso parcial de R$ 20,00 do pagamento nº ${ids.pagC}.`],
            ["PAGAMENTO", "Avaliação financeira revisada: reembolso definido em R$ 50,00."],
            ["PAGAMENTO", `Reembolso de R$ 30,00 concluiu a devolução do pagamento nº ${ids.pagC}.`]
        ]);
    });

    await t.test("D5/D6: reembolsos parciais simultâneos em OS FINALIZADA não ultrapassam o valor; saldo recalculado (R6)", async () => {
        const pagamentos = (await api("GET", `/ordens-servico/${ids.os1}/pagamentos`, "admin")).corpo.pagamentos;
        const p2 = pagamentos.find((p) => Number(p.valor) === 200 && p.status === "CONFIRMADO");
        assert.ok(p2);

        const respostas = await Promise.all(Array.from({ length: 5 }, (_, i) =>
            api("PATCH", `/pagamentos/${p2.id_pagamento}/reembolso`, "atendente", { justificativa_reembolso: `Parte ${i + 1}`, valor: 50 })
        ));
        assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 200, 200, 200, 409]);
        const soma = await linha("SELECT SUM(valor) AS total, COUNT(*) AS n FROM reembolso WHERE id_pagamento = ?", [p2.id_pagamento]);
        assert.deepEqual([Number(soma.total), Number(soma.n)], [200, 4]);
        assert.equal((await linha("SELECT status FROM pagamento WHERE id_pagamento = ?", [p2.id_pagamento])).status, "REEMBOLSADO");

        const resumo = (await api("GET", `/ordens-servico/${ids.os1}/pagamentos`, "admin")).corpo.resumo;
        assert.equal(resumo.total_pago, 100);   // só o p3 continua pago
        assert.equal(resumo.saldo_devedor, 200);
    });

    await t.test("D7 (P4): acessórios por etapa e técnico, com evento ACESSORIO na OS atual do equipamento", async () => {
        const acessorio = ids.acessorio;
        const contar = async () => Number((await linha("SELECT COUNT(*) AS n FROM acessorio_recebido")).n);

        // Lote válido do passo anterior (item2, atendente) gerou dois eventos na OS atual do item (OS 3)
        const eventosOs3 = await linhas("SELECT id_usuario, descricao FROM historico_os WHERE id_os = ? AND tipo_evento = 'ACESSORIO'", [ids.os3]);
        assert.equal(eventosOs3.length, 2);
        assert.ok(eventosOs3.every((e) => e.id_usuario === ids.atendente));

        // OS FINALIZADA (OS 1) e ENCERRADA_SEM_REPARO (OS C): recusado, nada gravado
        const antes = await contar();
        assert.equal((await api("POST", `/ordens-servico/${ids.os1}/acessorios`, "atendente", { id_acessorio: acessorio })).status, 409);
        assert.equal((await api("POST", `/ordens-servico/${ids.osC}/acessorios`, "admin", { id_acessorio: acessorio })).status, 409);
        assert.equal((await api("POST", "/acessorios-recebidos", "atendente", { id_item: ids.item1, id_acessorio: acessorio })).status, 409);
        assert.equal(await contar(), antes);

        // Técnico atribuído registra na própria OS ativa
        const proprio = await api("POST", `/ordens-servico/${ids.os3}/acessorios`, "tecnico", { id_acessorio: acessorio, quantidade: 2 });
        assert.equal(proprio.status, 201);
        const ultimo = await linha("SELECT id_os, id_usuario, tipo_evento, dados_novos FROM historico_os ORDER BY id_historico DESC LIMIT 1");
        assert.deepEqual([ultimo.id_os, ultimo.id_usuario, ultimo.tipo_evento, ultimo.dados_novos.quantidade], [ids.os3, ids.tecnico, "ACESSORIO", 2]);

        // OS atual do item passa para outro técnico: o anterior (que tem OS antiga do item) recebe 403
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os3}/tecnico`, "atendente", { id_tecnico: ids.tecnico2 })).status, 200);
        const depoisTroca = await contar();
        assert.equal((await api("POST", "/acessorios-recebidos", "tecnico", { id_item: ids.item2, id_acessorio: acessorio })).status, 403);
        assert.equal((await api("POST", `/ordens-servico/${ids.os3}/acessorios`, "tecnico", { id_acessorio: acessorio })).status, 404);
        assert.equal(await contar(), depoisTroca);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os3}/tecnico`, "atendente", { id_tecnico: ids.tecnico })).status, 200);
    });

    await t.test("D8 (O2): laudo editável em CONCLUIDA e AGUARDANDO_EXPEDICAO, bloqueado após FINALIZADA", async () => {
        const nova = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente, descricao_inicial: "Equipamento para laudo",
            itens: [{ tipo_equipamento: "Monitor", marca: "LG", modelo: "24", estado_fisico: "ok" }]
        });
        const osD = nova.corpo.solicitacao.itens[0].id_os;
        const passos = [
            ["PATCH", `/ordens-servico/${osD}/tecnico`, "atendente", { id_tecnico: ids.tecnico }],
            ["POST", `/ordens-servico/${osD}/execucao`, "tecnico", { diagnostico: "Fonte" }],
            ["PATCH", `/ordens-servico/${osD}/garantia`, "tecnico", { garantia_status: "NAO" }]
        ];
        for (const [m, u, q, c] of passos) assert.ok([200, 201].includes((await api(m, u, q, c)).status), u);
        const orc = await api("POST", `/ordens-servico/${osD}/orcamentos`, "tecnico", { itens: [{ tipo_item: "SERVICO", descricao: "Troca", quantidade: 1, valor_unitario: 10 }] });
        assert.equal((await api("PATCH", `/orcamentos/${orc.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        const pag = await api("POST", `/ordens-servico/${osD}/pagamentos`, "atendente", { valor: 10, forma_pagamento: "PIX" });
        assert.equal((await api("PATCH", `/pagamentos/${pag.corpo.pagamento.id_pagamento}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osD}/execucao`, "tecnico", { laudo_tecnico: "Fonte trocada", data_conclusao: new Date(Date.now() + 1000).toISOString() })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osD}/execucao/concluir`, "tecnico")).status, 200);

        const editar = (quem, laudo) => api("PATCH", `/ordens-servico/${osD}/execucao`, quem, { laudo_tecnico: laudo });

        // CONCLUIDA: técnico atribuído edita; acessório já não é aceito (D7)
        assert.equal((await editar("tecnico", "Fonte trocada; teste de 2 h")).status, 200);
        assert.equal((await editar("atendente", "x")).status, 403);
        assert.equal((await api("POST", `/ordens-servico/${osD}/acessorios`, "atendente", { id_acessorio: ids.acessorio })).status, 409);

        // AGUARDANDO_EXPEDICAO
        assert.equal((await api("POST", `/ordens-servico/${osD}/expedicao`, "atendente", { forma_entrega: "RETIRADA" })).status, 201);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [osD])).status, "AGUARDANDO_EXPEDICAO");
        assert.equal((await editar("tecnico", "Fonte trocada; teste de 4 h")).status, 200);

        // FINALIZADA: bloqueado
        assert.equal((await api("PATCH", `/expedicoes/${osD}/status`, "atendente", { status: "RETIRADO" })).status, 200);
        assert.equal((await editar("tecnico", "depois de finalizada")).status, 409);

        const edicoes = await linhas(
            "SELECT dados_anteriores, dados_novos, id_usuario FROM historico_os WHERE id_os = ? AND tipo_evento = 'DIAGNOSTICO' AND descricao LIKE 'Diagnóstico ou laudo%' ORDER BY id_historico",
            [osD]
        );
        assert.deepEqual(edicoes.slice(-2).map((e) => [e.dados_anteriores.laudo_tecnico, e.dados_novos.laudo_tecnico, e.id_usuario]), [
            ["Fonte trocada", "Fonte trocada; teste de 2 h", ids.tecnico],
            ["Fonte trocada; teste de 2 h", "Fonte trocada; teste de 4 h", ids.tecnico]
        ]);
        assert.equal((await linha("SELECT laudo_tecnico FROM execucao WHERE id_os = ?", [osD])).laudo_tecnico, "Fonte trocada; teste de 4 h");
    });

    await t.test("Q1: avaliação financeira pendente não bloqueia a devolução física; reembolso continua bloqueado", async () => {
        const nova = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente, descricao_inicial: "Q1: devolução com avaliação pendente",
            itens: [{ tipo_equipamento: "Tablet", marca: "S", modelo: "Q1", estado_fisico: "ok" }]
        });
        const osQ = nova.corpo.solicitacao.itens[0].id_os;
        for (const [m, u, quem, corpo] of [
            ["PATCH", `/ordens-servico/${osQ}/tecnico`, "atendente", { id_tecnico: ids.tecnico }],
            ["POST", `/ordens-servico/${osQ}/execucao`, "tecnico", { diagnostico: "Placa" }],
            ["PATCH", `/ordens-servico/${osQ}/garantia`, "tecnico", { garantia_status: "NAO" }]
        ]) assert.ok([200, 201].includes((await api(m, u, quem, corpo)).status), u);
        const orc = await api("POST", `/ordens-servico/${osQ}/orcamentos`, "tecnico", { itens: [{ tipo_item: "PECA", descricao: "Placa", quantidade: 1, valor_unitario: 90 }] });
        assert.equal((await api("PATCH", `/orcamentos/${orc.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        const pag = await api("POST", `/ordens-servico/${osQ}/pagamentos`, "atendente", { valor: 90, forma_pagamento: "PIX" });
        const idPag = pag.corpo.pagamento.id_pagamento;
        assert.equal((await api("PATCH", `/pagamentos/${idPag}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osQ}/encerramento`, "tecnico", { tipo_encerramento: "IMPOSSIBILIDADE_TECNICA", motivo_encerramento: "Sem peça" })).status, 200);

        const avaliacao = () => api("GET", `/ordens-servico/${osQ}/avaliacao-financeira`, "atendente");
        assert.equal((await avaliacao()).corpo.pendente, true);

        // Devolução física com a avaliação pendente: registrar e concluir a retirada
        const exp = await api("POST", `/ordens-servico/${osQ}/expedicao`, "atendente", { forma_entrega: "RETIRADA" });
        assert.equal(exp.status, 201);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [osQ])).status, "ENCERRADA_SEM_REPARO");
        assert.equal((await api("PATCH", `/expedicoes/${osQ}/status`, "atendente", { status: "RETIRADO" })).status, 200);

        // A OS continua ENCERRADA_SEM_REPARO; a avaliação continua pendente; o reembolso continua bloqueado
        const os = await linha("SELECT status, tipo_encerramento FROM ordem_servico WHERE id_os = ?", [osQ]);
        assert.deepEqual({ ...os }, { status: "ENCERRADA_SEM_REPARO", tipo_encerramento: "IMPOSSIBILIDADE_TECNICA" });
        assert.equal((await linha("SELECT status FROM expedicao WHERE id_os = ?", [osQ])).status, "RETIRADO");
        assert.equal((await avaliacao()).corpo.pendente, true);
        const bloqueado = await api("PATCH", `/pagamentos/${idPag}/reembolso`, "atendente", { justificativa_reembolso: "x" });
        assert.equal(bloqueado.status, 409);
        assert.match(bloqueado.corpo.mensagem, /avaliação financeira/);

        // Os fluxos são independentes: a avaliação pode ser registrada depois da devolução e libera o reembolso
        assert.equal((await api("POST", `/ordens-servico/${osQ}/avaliacao-financeira`, "atendente", { valor_definido: 90, justificativa: "Devolução integral" })).status, 201);
        const reembolso = await api("PATCH", `/pagamentos/${idPag}/reembolso`, "atendente", { justificativa_reembolso: "Conforme avaliação" });
        assert.equal(reembolso.status, 200);
        assert.equal(reembolso.corpo.pagamento.status, "REEMBOLSADO");
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [osQ])).status, "ENCERRADA_SEM_REPARO");
    });

    await t.test("D7: alteração de acessórios (perfil, OS atribuída, etapa e histórico com valores anteriores e novos)", async () => {
        const doItem2 = await linhas("SELECT id_acessorio_recebido, quantidade, observacoes FROM acessorio_recebido WHERE id_item = ? ORDER BY id_acessorio_recebido", [ids.item2]);
        const alvo = doItem2[0].id_acessorio_recebido;
        const eventos = () => linhas("SELECT id_os, id_usuario, descricao, dados_anteriores, dados_novos FROM historico_os WHERE tipo_evento = 'ACESSORIO' AND descricao LIKE 'Acessório recebido nº%alterado.' ORDER BY id_historico");

        // Técnico atribuído à OS atual do equipamento (OS 3), pela rota da OS
        const r = await api("PATCH", `/ordens-servico/${ids.os3}/acessorios/${alvo}`, "tecnico", { quantidade: 3, observacoes: "cabo extra conferido" });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.registro.quantidade, 3);
        let ev = await eventos();
        assert.equal(ev.length, 1);
        assert.deepEqual([ev[0].id_os, ev[0].id_usuario], [ids.os3, ids.tecnico]);
        assert.deepEqual(ev[0].dados_anteriores, { id_acessorio_recebido: alvo, quantidade: doItem2[0].quantidade, observacoes: doItem2[0].observacoes });
        assert.deepEqual(ev[0].dados_novos, { id_acessorio_recebido: alvo, quantidade: 3, observacoes: "cabo extra conferido" });

        // Sem mudança: 200 sem evento
        const igual = await api("PATCH", `/acessorios-recebidos/${alvo}`, "atendente", { quantidade: 3 });
        assert.deepEqual([igual.status, igual.corpo.mensagem], [200, "Nenhuma alteração."]);
        assert.equal((await eventos()).length, 1);

        // Atendente pela rota geral; acessório inativo e quantidade inválida recusados
        assert.equal((await api("PATCH", `/acessorios-recebidos/${alvo}`, "atendente", { observacoes: null })).status, 200);
        const inativo = (await linha("SELECT id_acessorio FROM acessorio WHERE ativo = 0 LIMIT 1")).id_acessorio;
        assert.equal((await api("PATCH", `/acessorios-recebidos/${alvo}`, "admin", { id_acessorio: inativo })).status, 409);
        assert.equal((await api("PATCH", `/acessorios-recebidos/${alvo}`, "admin", { quantidade: 0 })).status, 400);
        ev = await eventos();
        assert.equal(ev.length, 2);
        assert.deepEqual([ev[1].id_usuario, ev[1].dados_anteriores.observacoes, ev[1].dados_novos.observacoes], [ids.atendente, "cabo extra conferido", null]);

        // Acessório de outro equipamento pela rota desta OS: 404; equipamento com OS FINALIZADA: 409
        const doItem1 = (await linha("SELECT id_acessorio_recebido FROM acessorio_recebido WHERE id_item = ? LIMIT 1", [ids.item1])).id_acessorio_recebido;
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os3}/acessorios/${doItem1}`, "atendente", { quantidade: 9 })).status, 404);
        assert.equal((await api("PATCH", `/acessorios-recebidos/${doItem1}`, "atendente", { quantidade: 9 })).status, 409);

        // Técnico sem OS no equipamento: 404; técnico com OS antiga, mas a atual é de outro: 403
        assert.equal((await api("PATCH", `/acessorios-recebidos/${alvo}`, "tecnico2", { quantidade: 4 })).status, 404);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os3}/tecnico`, "atendente", { id_tecnico: ids.tecnico2 })).status, 200);
        assert.equal((await api("PATCH", `/acessorios-recebidos/${alvo}`, "tecnico", { quantidade: 4 })).status, 403);
        assert.equal((await api("PATCH", `/ordens-servico/${ids.os3}/tecnico`, "atendente", { id_tecnico: ids.tecnico })).status, 200);

        // Nada mudou nas tentativas recusadas; não existe exclusão
        assert.deepEqual({ ...(await linha("SELECT quantidade, observacoes FROM acessorio_recebido WHERE id_acessorio_recebido = ?", [alvo])) }, { quantidade: 3, observacoes: null });
        assert.equal((await eventos()).length, 2);
        assert.equal((await api("DELETE", `/acessorios-recebidos/${alvo}`, "admin")).status, 404);
    });

    await t.test("RN20 × reembolso: parcial antes da entrega, entrega com saldo, reembolso depois da entrega", async () => {
        const nova = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente, descricao_inicial: "RN20 × reembolso",
            itens: [{ tipo_equipamento: "Impressora", marca: "E", modelo: "RN20", estado_fisico: "ok" }]
        });
        const osR = nova.corpo.solicitacao.itens[0].id_os;
        for (const [m, u, quem, corpo] of [
            ["PATCH", `/ordens-servico/${osR}/tecnico`, "atendente", { id_tecnico: ids.tecnico }],
            ["POST", `/ordens-servico/${osR}/execucao`, "tecnico", { diagnostico: "Fusor" }],
            ["PATCH", `/ordens-servico/${osR}/garantia`, "tecnico", { garantia_status: "NAO" }]
        ]) assert.ok([200, 201].includes((await api(m, u, quem, corpo)).status), u);
        const orc = await api("POST", `/ordens-servico/${osR}/orcamentos`, "tecnico", { itens: [{ tipo_item: "PECA", descricao: "Fusor", quantidade: 1, valor_unitario: 100 }] });
        assert.equal((await api("PATCH", `/orcamentos/${orc.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        const p1 = (await api("POST", `/ordens-servico/${osR}/pagamentos`, "atendente", { valor: 100, forma_pagamento: "PIX" })).corpo.pagamento.id_pagamento;
        assert.equal((await api("PATCH", `/pagamentos/${p1}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osR}/execucao`, "tecnico", { data_conclusao: new Date(Date.now() + 1000).toISOString() })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${osR}/execucao/concluir`, "tecnico")).status, 200);
        assert.equal((await api("POST", `/ordens-servico/${osR}/expedicao`, "atendente", { forma_entrega: "ENVIO" })).status, 201);

        const estado = async () => ({
            os: (await linha("SELECT status, data_encerramento FROM ordem_servico WHERE id_os = ?", [osR])),
            exp: (await linha("SELECT status FROM expedicao WHERE id_os = ?", [osR])).status,
            resumo: (await api("GET", `/ordens-servico/${osR}/pagamentos`, "admin")).corpo.resumo
        });

        // 1. Reembolso parcial depois do registro da expedição e antes da entrega: permitido (D5/D6);
        //    o saldo volta a existir (R6); a OS e a expedição não mudam de situação
        assert.equal((await api("PATCH", `/pagamentos/${p1}/reembolso`, "atendente", { justificativa_reembolso: "Abatimento negociado", valor: 30 })).status, 200);
        let e = await estado();
        assert.deepEqual([e.os.status, e.exp, e.resumo.total_pago, e.resumo.saldo_devedor], ["AGUARDANDO_EXPEDICAO", "PENDENTE", 70, 30]);

        // O despacho não exige quitação; 2. a entrega com saldo pendente é recusada (RN20), sem mudar nada
        assert.equal((await api("PATCH", `/expedicoes/${osR}/status`, "atendente", { status: "EM_TRANSITO" })).status, 200);
        const entrega = await api("PATCH", `/expedicoes/${osR}/status`, "atendente", { status: "ENTREGUE" });
        assert.equal(entrega.status, 409);
        assert.match(entrega.corpo.mensagem, /quitação/);
        e = await estado();
        assert.deepEqual([e.os.status, e.exp, e.os.data_encerramento], ["AGUARDANDO_EXPEDICAO", "EM_TRANSITO", null]);

        // Quitado de novo, a entrega é concluída e a OS fica FINALIZADA
        const p2 = (await api("POST", `/ordens-servico/${osR}/pagamentos`, "atendente", { valor: 30, forma_pagamento: "DINHEIRO" })).corpo.pagamento.id_pagamento;
        assert.equal((await api("PATCH", `/pagamentos/${p2}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        assert.equal((await api("PATCH", `/expedicoes/${osR}/status`, "atendente", { status: "ENTREGUE" })).status, 200);
        const finalizada = await estado();
        assert.deepEqual([finalizada.os.status, finalizada.exp, finalizada.resumo.saldo_devedor], ["FINALIZADA", "ENTREGUE", 0]);

        // 3. Reembolso depois da entrega: permitido (D5), com histórico;
        // 4. a OS continua FINALIZADA e a expedição ENTREGUE (nenhuma volta de estado)
        assert.equal((await api("PATCH", `/pagamentos/${p2}/reembolso`, "atendente", { justificativa_reembolso: "Devolução pós-entrega", valor: 10 })).status, 200);
        e = await estado();
        assert.deepEqual([e.os.status, e.exp, e.resumo.total_pago, e.resumo.saldo_devedor], ["FINALIZADA", "ENTREGUE", 90, 10]);
        assert.equal(new Date(e.os.data_encerramento).getTime(), new Date(finalizada.os.data_encerramento).getTime());
        // Não há como "reabrir" pela API: novo pagamento e nova mudança da expedição são recusados
        assert.equal((await api("POST", `/ordens-servico/${osR}/pagamentos`, "atendente", { valor: 10, forma_pagamento: "PIX" })).status, 409);
        assert.equal((await api("PATCH", `/expedicoes/${osR}/status`, "atendente", { status: "EM_TRANSITO" })).status, 409);
        const ultimo = await linha("SELECT tipo_evento, descricao, dados_novos FROM historico_os WHERE id_os = ? ORDER BY id_historico DESC LIMIT 1", [osR]);
        assert.equal(ultimo.tipo_evento, "PAGAMENTO");
        assert.match(ultimo.descricao, /Reembolso parcial de R\$ 10,00/);
        assert.equal("status_os" in ultimo.dados_novos, false);
    });

    // ---------- R1: abatimento formal (critérios da seção 3.5.6) ----------
    async function novaOsEmReparo(valor, descricao) {
        const nova = await api("POST", "/solicitacoes", "atendente", {
            id_cliente: ids.cliente, descricao_inicial: descricao,
            itens: [{ tipo_equipamento: "Notebook", marca: "R1", modelo: descricao.slice(0, 40), estado_fisico: "ok" }]
        });
        const os = nova.corpo.solicitacao.itens[0].id_os;
        for (const [m, u, quem, corpo] of [
            ["PATCH", `/ordens-servico/${os}/tecnico`, "atendente", { id_tecnico: ids.tecnico }],
            ["POST", `/ordens-servico/${os}/execucao`, "tecnico", { diagnostico: "Defeito" }],
            ["PATCH", `/ordens-servico/${os}/garantia`, "tecnico", { garantia_status: "NAO" }]
        ]) assert.ok([200, 201].includes((await api(m, u, quem, corpo)).status), u);
        const orc = await api("POST", `/ordens-servico/${os}/orcamentos`, "tecnico", { itens: [{ tipo_item: "PECA", descricao: "Peça", quantidade: 1, valor_unitario: valor }] });
        assert.equal((await api("PATCH", `/orcamentos/${orc.corpo.orcamento.id_orcamento}/resposta`, "atendente", { decisao: "APROVADO" })).status, 200);
        return { os, idOrc: orc.corpo.orcamento.id_orcamento };
    }
    const resumoDe = async (os) => (await api("GET", `/ordens-servico/${os}/pagamentos`, "admin")).corpo.resumo;
    const abater = (os, valor, quem = "atendente", motivo = "Abatimento negociado") => api("POST", `/ordens-servico/${os}/abatimentos`, quem, { valor, motivo });
    const pagarConfirmado = async (os, valor) => {
        const p = await api("POST", `/ordens-servico/${os}/pagamentos`, "atendente", { valor, forma_pagamento: "PIX" });
        assert.equal(p.status, 201, `pagamento ${valor}`);
        assert.equal((await api("PATCH", `/pagamentos/${p.corpo.pagamento.id_pagamento}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        return p.corpo.pagamento.id_pagamento;
    };
    async function concluirReparo(os) {
        assert.equal((await api("PATCH", `/ordens-servico/${os}/execucao`, "tecnico", { data_conclusao: new Date(Date.now() + 1000).toISOString() })).status, 200);
        assert.equal((await api("PATCH", `/ordens-servico/${os}/execucao/concluir`, "tecnico")).status, 200);
    }

    await t.test("R1: abatimento parcial, integral, perfis, etapas e orçamento preservado", async () => {
        const { os, idOrc } = await novaOsEmReparo(100, "R1 parcial e integral");
        const orcamentoAntes = await linha("SELECT valor_total, status FROM orcamento WHERE id_orcamento = ?", [idOrc]);
        const itensAntes = await linhas("SELECT descricao, quantidade, valor_unitario FROM item_orcamento WHERE id_orcamento = ?", [idOrc]);

        // A2/C2: técnico não registra nem lista
        assert.equal((await abater(os, 10, "tecnico")).status, 403);
        assert.equal((await api("GET", `/ordens-servico/${os}/abatimentos`, "tecnico")).status, 403);
        // Validações
        assert.equal((await abater(os, 0)).status, 400);
        assert.equal((await api("POST", `/ordens-servico/${os}/abatimentos`, "atendente", { valor: 10, motivo: " " })).status, 400);

        // Parcial: 20 → devido 80; o pagamento passa a ser limitado a 80
        const a1 = await abater(os, 20);
        assert.equal(a1.status, 201);
        assert.deepEqual([a1.corpo.abatimento.status, Number(a1.corpo.abatimento.valor), a1.corpo.abatimento.id_orcamento, a1.corpo.abatimento.id_usuario_registro],
            ["APROVADO", 20, idOrc, ids.atendente]);
        let r = await resumoDe(os);
        assert.deepEqual([r.total_orcado, r.total_abatido, r.total_devido, r.total_pago, r.saldo_devedor], [100, 20, 80, 0, 80]);
        assert.equal((await api("POST", `/ordens-servico/${os}/pagamentos`, "atendente", { valor: 80.01, forma_pagamento: "PIX" })).status, 409);

        // Integral (A7): mais 80 → devido 0; nenhum pagamento é aceito
        assert.equal((await abater(os, 80, "admin", "Cortesia")).status, 201);
        r = await resumoDe(os);
        assert.deepEqual([r.total_devido, r.saldo_devedor], [0, 0]);
        assert.equal((await abater(os, 0.01)).status, 409);
        assert.equal((await api("POST", `/ordens-servico/${os}/pagamentos`, "atendente", { valor: 0.01, forma_pagamento: "PIX" })).status, 409);

        // Entrega sem pagamento quando o saldo recalculado é zero (A7 + RN20)
        await concluirReparo(os);
        assert.equal((await api("POST", `/ordens-servico/${os}/expedicao`, "atendente", { forma_entrega: "RETIRADA" })).status, 201);
        assert.equal((await api("PATCH", `/expedicoes/${os}/status`, "atendente", { status: "RETIRADO" })).status, 200);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [os])).status, "FINALIZADA");

        // A3: FINALIZADA bloqueia registro e cancelamento; nada muda
        assert.equal((await abater(os, 1)).status, 409);
        assert.equal((await api("PATCH", `/abatimentos/${a1.corpo.abatimento.id_abatimento}/cancelamento`, "admin", { justificativa: "x" })).status, 409);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [os])).status, "FINALIZADA");

        // O orçamento aprovado e seus itens não foram alterados
        assert.deepEqual({ ...(await linha("SELECT valor_total, status FROM orcamento WHERE id_orcamento = ?", [idOrc])) }, { ...orcamentoAntes });
        assert.deepEqual((await linhas("SELECT descricao, quantidade, valor_unitario FROM item_orcamento WHERE id_orcamento = ?", [idOrc])).map((x) => ({ ...x })), itensAntes.map((x) => ({ ...x })));

        // Lista (ADM/ATD) e histórico: técnico não vê ABATIMENTO
        const lista = await api("GET", `/ordens-servico/${os}/abatimentos`, "atendente");
        assert.deepEqual(lista.corpo.map((a) => [Number(a.valor), a.status]), [[20, "APROVADO"], [80, "APROVADO"]]);
        const histTec = await api("GET", `/ordens-servico/${os}/historico`, "tecnico");
        assert.equal(histTec.corpo.some((e) => e.tipo_evento === "ABATIMENTO"), false);
        const evs = await linhas("SELECT id_usuario, descricao, dados_anteriores, dados_novos FROM historico_os WHERE id_os = ? AND tipo_evento = 'ABATIMENTO' ORDER BY id_historico", [os]);
        assert.equal(evs.length, 2);
        assert.deepEqual([evs[0].id_usuario, evs[0].dados_anteriores, evs[0].dados_novos.total_devido, evs[0].dados_novos.saldo, evs[0].dados_novos.motivo],
            [ids.atendente, { total_devido: 100, saldo: 100 }, 80, 80, "Abatimento negociado"]);
        assert.equal(evs[1].id_usuario, ids.admin);

        // Etapas sem orçamento aprovado e OS encerrada sem reparo
        assert.equal((await abater(ids.os3, 1)).status, 409);           // AGUARDANDO_APROVACAO
        assert.equal((await abater(ids.osC, 1)).status, 409);           // ENCERRADA_SEM_REPARO
    });

    await t.test("R1: combinado com pagamento parcial e com reembolso; limite com pendentes; entrega após quitação", async () => {
        // Pagamento parcial: pago 50; abatimento 30 → saldo 20; 25 → 409; pagar 20 → 0
        const a = await novaOsEmReparo(100, "R1 com pagamento");
        await pagarConfirmado(a.os, 50);
        assert.equal((await abater(a.os, 30)).status, 201);
        assert.equal((await resumoDe(a.os)).saldo_devedor, 20);
        assert.equal((await abater(a.os, 25)).status, 409);
        await pagarConfirmado(a.os, 20);
        assert.equal((await resumoDe(a.os)).saldo_devedor, 0);

        // A4: pendente reserva saldo. Pago 0, pendente 30, devido 100 → limite 70
        const b = await novaOsEmReparo(100, "R1 com pendente");
        const pend = await api("POST", `/ordens-servico/${b.os}/pagamentos`, "atendente", { valor: 30, forma_pagamento: "PIX" });
        assert.equal(pend.status, 201);
        const excesso = await abater(b.os, 70.01);
        assert.equal(excesso.status, 409);
        assert.match(excesso.corpo.mensagem, /R\$ 70,00/);
        assert.equal((await abater(b.os, 70)).status, 201);
        // O pendente ainda pode ser confirmado: total pago = devido
        assert.equal((await api("PATCH", `/pagamentos/${pend.corpo.pagamento.id_pagamento}/status`, "atendente", { status: "CONFIRMADO" })).status, 200);
        assert.equal((await resumoDe(b.os)).saldo_devedor, 0);

        // Com reembolso: pago 100; reembolso 30 (saldo 30); abatimento 30 (saldo 0); entrega liberada
        const c = await novaOsEmReparo(100, "R1 com reembolso");
        const pag = await pagarConfirmado(c.os, 100);
        await concluirReparo(c.os);
        assert.equal((await api("POST", `/ordens-servico/${c.os}/expedicao`, "atendente", { forma_entrega: "ENVIO" })).status, 201);
        assert.equal((await api("PATCH", `/pagamentos/${pag}/reembolso`, "atendente", { justificativa_reembolso: "Devolução parcial", valor: 30 })).status, 200);
        assert.equal((await api("PATCH", `/expedicoes/${c.os}/status`, "atendente", { status: "EM_TRANSITO", codigo_rastreio: "R1BR" })).status, 200);
        assert.equal((await api("PATCH", `/expedicoes/${c.os}/status`, "atendente", { status: "ENTREGUE" })).status, 409); // saldo 30
        assert.equal((await abater(c.os, 30, "atendente", "Abatimento negociado na entrega")).status, 201);
        let r = await resumoDe(c.os);
        assert.deepEqual([r.total_devido, r.total_pago, r.saldo_devedor], [70, 70, 0]);
        assert.equal((await api("PATCH", `/expedicoes/${c.os}/status`, "atendente", { status: "ENTREGUE" })).status, 200);
        assert.equal((await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [c.os])).status, "FINALIZADA");
        // Registros e eventos independentes
        assert.equal(Number((await linha("SELECT COUNT(*) AS n FROM reembolso WHERE id_pagamento = ?", [pag])).n), 1);
        assert.equal(Number((await linha("SELECT COUNT(*) AS n FROM abatimento WHERE id_os = ?", [c.os])).n), 1);
        const tipos = (await linhas("SELECT tipo_evento, descricao FROM historico_os WHERE id_os = ? AND tipo_evento IN ('PAGAMENTO','ABATIMENTO') ORDER BY id_historico", [c.os])).map((e) => e.tipo_evento);
        assert.deepEqual(tipos.slice(-2), ["PAGAMENTO", "ABATIMENTO"]);
    });

    await t.test("R1: cancelamento (A5, C1, C4) preserva o registro e recalcula o devido", async () => {
        const { os } = await novaOsEmReparo(100, "R1 cancelamento");
        await pagarConfirmado(os, 70);
        const a = await abater(os, 30);
        const id = a.corpo.abatimento.id_abatimento;
        await concluirReparo(os);
        assert.equal((await api("POST", `/ordens-servico/${os}/expedicao`, "atendente", { forma_entrega: "ENVIO" })).status, 201);
        assert.equal((await api("PATCH", `/expedicoes/${os}/status`, "atendente", { status: "EM_TRANSITO" })).status, 200);

        assert.equal((await api("PATCH", `/abatimentos/${id}/cancelamento`, "tecnico", { justificativa: "x" })).status, 403);
        assert.equal((await api("PATCH", `/abatimentos/${id}/cancelamento`, "admin", { justificativa: "" })).status, 400);
        // C1: ADMINISTRADOR cancela o abatimento registrado pelo atendente; C4: com a expedição em trânsito
        const c = await api("PATCH", `/abatimentos/${id}/cancelamento`, "admin", { justificativa: "Abatimento lançado em duplicidade" });
        assert.equal(c.status, 200);
        const reg = await linha("SELECT status, valor, motivo, id_usuario_registro, id_usuario_cancelamento, data_cancelamento, justificativa_cancelamento FROM abatimento WHERE id_abatimento = ?", [id]);
        assert.deepEqual([reg.status, Number(reg.valor), reg.motivo, reg.id_usuario_registro, reg.id_usuario_cancelamento, reg.justificativa_cancelamento],
            ["CANCELADO", 30, "Abatimento negociado", ids.atendente, ids.admin, "Abatimento lançado em duplicidade"]);
        assert.ok(reg.data_cancelamento);
        assert.equal((await api("PATCH", `/abatimentos/${id}/cancelamento`, "atendente", { justificativa: "de novo" })).status, 409);
        let r = await resumoDe(os);
        assert.deepEqual([r.total_abatido, r.total_devido, r.saldo_devedor], [0, 100, 30]);
        // Saldo voltou: entrega bloqueada (RN20) até nova quitação
        assert.equal((await api("PATCH", `/expedicoes/${os}/status`, "atendente", { status: "ENTREGUE" })).status, 409);
        await pagarConfirmado(os, 30);
        assert.equal((await api("PATCH", `/expedicoes/${os}/status`, "atendente", { status: "ENTREGUE" })).status, 200);
        const ev = await linha("SELECT id_usuario, dados_anteriores, dados_novos FROM historico_os WHERE id_os = ? AND tipo_evento = 'ABATIMENTO' ORDER BY id_historico DESC LIMIT 1", [os]);
        assert.deepEqual([ev.id_usuario, ev.dados_anteriores.status, ev.dados_novos.status, ev.dados_anteriores.saldo, ev.dados_novos.saldo], [ids.admin, "APROVADO", "CANCELADO", 0, 30]);
    });

    await t.test("R1: concorrência entre operações financeiras e falha real no histórico", async () => {
        // 5 abatimentos simultâneos de 30 com devido 100 → exatamente 3
        const a = await novaOsEmReparo(100, "R1 concorrência abatimentos");
        const r1 = await Promise.all(Array.from({ length: 5 }, () => abater(a.os, 30)));
        assert.deepEqual(r1.map((x) => x.status).sort(), [201, 201, 201, 409, 409]);
        assert.equal(Number((await linha("SELECT SUM(valor) AS s FROM abatimento WHERE id_os = ? AND status = 'APROVADO'", [a.os])).s), 90);

        // Abatimento × pagamento simultâneos que juntos ultrapassariam o devido → exatamente um
        const b = await novaOsEmReparo(100, "R1 concorrência abatimento e pagamento");
        const [ab, pg] = await Promise.all([
            abater(b.os, 60),
            api("POST", `/ordens-servico/${b.os}/pagamentos`, "atendente", { valor: 60, forma_pagamento: "PIX" })
        ]);
        assert.deepEqual([ab.status, pg.status].sort(), [201, 409]);

        // Abatimento × conclusão da entrega: nunca FINALIZADA com saldo
        // (o registro da expedição de OS reparada exige quitação: o saldo de 30 vem de um reembolso posterior)
        const c = await novaOsEmReparo(100, "R1 concorrência entrega");
        const pagC = await pagarConfirmado(c.os, 100);
        await concluirReparo(c.os);
        assert.equal((await api("POST", `/ordens-servico/${c.os}/expedicao`, "atendente", { forma_entrega: "RETIRADA" })).status, 201);
        assert.equal((await api("PATCH", `/pagamentos/${pagC}/reembolso`, "atendente", { justificativa_reembolso: "Parte devolvida", valor: 30 })).status, 200);
        const [x1, x2] = await Promise.all([abater(c.os, 30), api("PATCH", `/expedicoes/${c.os}/status`, "atendente", { status: "RETIRADO" })]);
        const final = (await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [c.os])).status;
        if (final === "FINALIZADA") assert.equal((await resumoDe(c.os)).saldo_devedor, 0);
        // Em qualquer ordem o abatimento é aceito: ou vem antes da retirada (que então é concluída),
        // ou a retirada é recusada por saldo e a OS continua em AGUARDANDO_EXPEDICAO
        assert.equal(x1.status, 201);
        assert.ok([200, 409].includes(x2.status));

        // Cancelamento × entrega: exatamente um vence
        const d = await novaOsEmReparo(100, "R1 concorrência cancelamento");
        await pagarConfirmado(d.os, 70);
        const idAb = (await abater(d.os, 30)).corpo.abatimento.id_abatimento;
        await concluirReparo(d.os);
        assert.equal((await api("POST", `/ordens-servico/${d.os}/expedicao`, "atendente", { forma_entrega: "RETIRADA" })).status, 201);
        const [canc, entr] = await Promise.all([
            api("PATCH", `/abatimentos/${idAb}/cancelamento`, "admin", { justificativa: "Concorrência" }),
            api("PATCH", `/expedicoes/${d.os}/status`, "atendente", { status: "RETIRADO" })
        ]);
        assert.deepEqual([canc.status, entr.status].sort(), [200, 409]);
        const os = (await linha("SELECT status FROM ordem_servico WHERE id_os = ?", [d.os])).status;
        const ab2 = (await linha("SELECT status FROM abatimento WHERE id_abatimento = ?", [idAb])).status;
        assert.ok((os === "FINALIZADA" && ab2 === "APROVADO") || (os === "AGUARDANDO_EXPEDICAO" && ab2 === "CANCELADO"), `${os}/${ab2}`);

        // RN21: falha real ao gravar o histórico desfaz o abatimento
        const e = await novaOsEmReparo(100, "R1 rollback");
        const historicoRepository = require("../src/repositories/historicoRepository");
        const original = historicoRepository.registrar;
        historicoRepository.registrar = async (conexao, evento) => {
            await conexao.execute("INSERT INTO historico_os (id_os, tipo_evento, descricao) VALUES (?, 'TIPO_INEXISTENTE', 'x')", [evento.id_os]);
        };
        try {
            assert.equal((await abater(e.os, 10)).status, 500);
        } finally {
            historicoRepository.registrar = original;
        }
        assert.equal(Number((await linha("SELECT COUNT(*) AS n FROM abatimento WHERE id_os = ?", [e.os])).n), 0);
        assert.equal((await resumoDe(e.os)).total_devido, 100);
    });

    await t.test("banco real preservado (somente leitura)", async () => {
        assert.deepEqual(await contarLinhasReais(), contagemRealAntes);
    });
});
