/*
 * Seed dos usuários de teste (somente ambiente de desenvolvimento).
 *
 * Uso:
 *   1. Copie scripts/usuarios-teste.example.json para scripts/usuarios-teste.local.json
 *      e preencha nome, e-mail, perfil e senha de cada conta.
 *      O arquivo .local.json é ignorado pelo Git e nunca deve ser versionado.
 *   2. Execute:  npm run seed:usuarios
 *
 * Comportamento:
 *   - Cria a conta quando o e-mail não existe.
 *   - Quando o e-mail já existe, atualiza nome, perfil, senha e reativa a conta.
 *   - Não exclui nenhum usuário e não altera outras tabelas.
 *   - Tudo roda em uma transação: se algo falhar, nada é gravado.
 *   - As senhas são gravadas apenas como hash bcrypt (mesmo custo do usuarioService).
 *   - Recusa executar se o banco não estiver em um host local.
 */
require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcrypt");
const { pool } = require("../src/config/database");

const ARQUIVO_CREDENCIAIS = path.join(__dirname, "usuarios-teste.local.json");
const PERFIS = ["ADMINISTRADOR", "ATENDENTE", "TECNICO"];
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "::1"];
const CUSTO_BCRYPT = 10;

function carregarUsuarios() {
    if (!fs.existsSync(ARQUIVO_CREDENCIAIS)) {
        throw new Error(
            "Arquivo scripts/usuarios-teste.local.json não encontrado. " +
            "Copie usuarios-teste.example.json e preencha as contas."
        );
    }

    const usuarios = JSON.parse(fs.readFileSync(ARQUIVO_CREDENCIAIS, "utf8"));

    if (!Array.isArray(usuarios) || usuarios.length === 0) {
        throw new Error("O arquivo de credenciais deve conter uma lista de usuários.");
    }

    const emails = new Set();

    return usuarios.map((usuario, indice) => {
        const nome = typeof usuario.nome === "string" ? usuario.nome.trim() : "";
        const email = typeof usuario.email === "string" ? usuario.email.trim().toLowerCase() : "";
        const perfil = typeof usuario.perfil === "string" ? usuario.perfil.trim().toUpperCase() : "";
        const senha = typeof usuario.senha === "string" ? usuario.senha : "";

        if (!nome || nome.length > 100) {
            throw new Error(`Usuário ${indice + 1}: nome obrigatório (máximo 100 caracteres).`);
        }
        if (!FORMATO_EMAIL.test(email) || email.length > 150) {
            throw new Error(`Usuário ${indice + 1}: e-mail inválido.`);
        }
        if (!PERFIS.includes(perfil)) {
            throw new Error(`Usuário ${indice + 1}: perfil deve ser ${PERFIS.join(", ")}.`);
        }
        if (!senha.trim()) {
            throw new Error(`Usuário ${indice + 1}: senha obrigatória.`);
        }
        if (emails.has(email)) {
            throw new Error(`E-mail repetido no arquivo de credenciais: ${email}`);
        }
        emails.add(email);

        return { nome, email, perfil, senha };
    });
}

async function executar() {
    if (!HOSTS_LOCAIS.includes(process.env.DB_HOST)) {
        throw new Error("Seed bloqueado: o banco configurado não está em um host local.");
    }

    const usuarios = carregarUsuarios();
    const conexao = await pool.getConnection();

    try {
        await conexao.beginTransaction();

        for (const usuario of usuarios) {
            const senhaHash = await bcrypt.hash(usuario.senha, CUSTO_BCRYPT);

            const [existentes] = await conexao.execute(
                "SELECT id_usuario FROM usuario WHERE email = ? FOR UPDATE",
                [usuario.email]
            );

            if (existentes.length > 0) {
                await conexao.execute(
                    `UPDATE usuario
                     SET nome = ?, perfil = ?, senha_hash = ?, ativo = 1
                     WHERE id_usuario = ?`,
                    [usuario.nome, usuario.perfil, senhaHash, existentes[0].id_usuario]
                );
                console.log(`Atualizado: ${usuario.email} (${usuario.perfil})`);
            } else {
                await conexao.execute(
                    `INSERT INTO usuario (nome, email, senha_hash, perfil, ativo)
                     VALUES (?, ?, ?, ?, 1)`,
                    [usuario.nome, usuario.email, senhaHash, usuario.perfil]
                );
                console.log(`Criado: ${usuario.email} (${usuario.perfil})`);
            }
        }

        await conexao.commit();
        console.log("Seed concluído.");
    } catch (erro) {
        await conexao.rollback();
        throw erro;
    } finally {
        conexao.release();
    }
}

executar()
    .catch((erro) => {
        console.error("Falha no seed:", erro.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
