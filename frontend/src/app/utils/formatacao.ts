/** Remove tudo o que não for dígito. */
export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** Aplica um padrão em que cada "0" é substituído por um dígito, parando quando os dígitos acabam. */
function aplicarMascara(digitos: string, padrao: string): string {
  let resultado = '';
  let indice = 0;

  for (const caractere of padrao) {
    if (indice >= digitos.length) {
      break;
    }
    if (caractere === '0') {
      resultado += digitos[indice];
      indice += 1;
    } else {
      resultado += caractere;
    }
  }

  return resultado;
}

/** CPF 000.000.000-00 (FISICA) ou CNPJ 00.000.000/0000-00 (JURIDICA). */
export function formatarDocumento(valor: string | null | undefined, tipo: string): string {
  const digitos = somenteDigitos(valor);
  return tipo === 'JURIDICA'
    ? aplicarMascara(digitos.slice(0, 14), '00.000.000/0000-00')
    : aplicarMascara(digitos.slice(0, 11), '000.000.000-00');
}

/** CEP 00000-000. */
export function formatarCep(valor: string | null | undefined): string {
  return aplicarMascara(somenteDigitos(valor).slice(0, 8), '00000-000');
}

/** Telefone (00) 0000-0000 ou (00) 00000-0000. */
export function formatarTelefone(valor: string | null | undefined): string {
  const digitos = somenteDigitos(valor).slice(0, 11);
  return digitos.length > 10
    ? aplicarMascara(digitos, '(00) 00000-0000')
    : aplicarMascara(digitos, '(00) 0000-0000');
}

/** Nome do tipo de pessoa para exibição. */
export function rotuloTipoPessoa(tipo: string): string {
  return tipo === 'JURIDICA' ? 'Pessoa jurídica' : 'Pessoa física';
}
