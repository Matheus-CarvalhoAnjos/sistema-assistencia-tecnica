import { formatarCep, formatarDocumento, formatarTelefone, somenteDigitos } from './formatacao';

describe('formatacao', () => {
  it('keeps only digits', () => {
    expect(somenteDigitos('123.456.789-01')).toBe('12345678901');
    expect(somenteDigitos(null)).toBe('');
  });

  it('formats CPF and CNPJ according to the person type, including partial input', () => {
    expect(formatarDocumento('12345678901', 'FISICA')).toBe('123.456.789-01');
    expect(formatarDocumento('12345678000199', 'JURIDICA')).toBe('12.345.678/0001-99');
    expect(formatarDocumento('1234', 'FISICA')).toBe('123.4');
    expect(formatarDocumento('123456789012345', 'FISICA')).toBe('123.456.789-01');
  });

  it('formats CEP and phone numbers', () => {
    expect(formatarCep('01001000')).toBe('01001-000');
    expect(formatarTelefone('1133334444')).toBe('(11) 3333-4444');
    expect(formatarTelefone('11999990000')).toBe('(11) 99999-0000');
  });
});
