/*
 * Leitura oculta da senha em scripts/criar-administrador.js (interpretarTeclas).
 * Sem banco e sem terminal: importar o script não executa o cadastro.
 */
require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const { interpretarTeclas } = require("../scripts/criar-administrador");

/** Simula a digitação: cada item é um bloco recebido do terminal. */
function digitar(...blocos) {
    const estado = { valor: "", escape: 0 };
    let resultado = null;
    for (const bloco of blocos) {
        resultado = interpretarTeclas(estado, bloco);
        if (resultado) break;
    }
    return { valor: estado.valor, resultado };
}

test("Enter encerra a leitura com o texto digitado", () => {
    assert.deepEqual(digitar("Senha#Forte1\r"), { valor: "Senha#Forte1", resultado: "fim" });
    assert.deepEqual(digitar("abc\n"), { valor: "abc", resultado: "fim" });
});

test("teclas especiais (setas, Delete, Home, End, F1) não entram na senha", () => {
    assert.equal(digitar("abc\u001b[D\r").valor, "abc");           // seta esquerda
    assert.equal(digitar("ab\u001b[Ac\r").valor, "abc");            // seta para cima no meio
    assert.equal(digitar("abc\u001b[3~\r").valor, "abc");           // Delete
    assert.equal(digitar("\u001b[Habc\u001b[F\r").valor, "abc");    // Home e End
    assert.equal(digitar("abc\u001bOP\r").valor, "abc");            // F1 (SS3)
    assert.equal(digitar("abc\u001b[1;5C\r").valor, "abc");         // Ctrl+seta (com parâmetros)
});

test("sequência especial dividida entre blocos também é descartada", () => {
    assert.equal(digitar("abc\u001b", "[", "3", "~", "d\r").valor, "abcd");
});

test("Backspace apaga o último caractere, inclusive acentuado", () => {
    assert.equal(digitar("abcx\u007f\r").valor, "abc");
    assert.equal(digitar("senhaç\u0008\r").valor, "senha");
    assert.equal(digitar("\u007f\u007fab\r").valor, "ab");
});

test("Ctrl+C cancela a leitura", () => {
    assert.equal(digitar("abc\u0003").resultado, "cancelado");
});

test("caracteres de controle soltos (Tab) são ignorados; espaços e acentos são mantidos", () => {
    assert.equal(digitar("a\tb c ã\r").valor, "ab c ã");
});
