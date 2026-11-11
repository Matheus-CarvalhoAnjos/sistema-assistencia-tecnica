import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { API_BASE_URL } from '../../app/config/api.config';
import { ClienteFormPage } from './cliente-form';

const API = 'http://api.teste/api';

describe('ClienteFormPage', () => {
  let fixture: ComponentFixture<ClienteFormPage>;
  let backend: HttpTestingController;
  let navegar: ReturnType<typeof vi.spyOn>;

  async function criar(id?: string) {
    await TestBed.configureTestingModule({
      imports: [ClienteFormPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ClienteFormPage);
    if (id) {
      fixture.componentRef.setInput('id', id);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  function preencher(valores: Record<string, string>) {
    for (const [campo, valor] of Object.entries(valores)) {
      const entrada = el().querySelector<HTMLInputElement | HTMLSelectElement>(`#campo-${campo}`)!;
      entrada.value = valor;
      entrada.dispatchEvent(new Event(entrada.tagName === 'SELECT' ? 'change' : 'input'));
    }
    fixture.detectChanges();
  }

  function preencherValido() {
    preencher({
      nome_razao_social: 'Maria Cliente',
      cpf_cnpj: '12345678901',
      telefone: '11999990000',
      email: 'maria@teste.test',
      cep: '01001000',
      logradouro: 'Rua Teste',
      numero: '100',
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
    });
  }

  function enviar() {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('shows validation messages and does not call the API when empty', async () => {
    await criar();
    enviar();

    expect(el().textContent).toContain('Informe o campo Nome.');
    expect(el().textContent).toContain('Informe o campo CPF.');
    expect(el().textContent).toContain('Informe a UF.');
    backend.expectNone(`${API}/clientes`);
  });

  it('applies masks while typing and validates the document by person type', async () => {
    await criar();
    preencher({ cpf_cnpj: '12345678901', cep: '01001000', telefone: '1133334444' });

    expect(el().querySelector<HTMLInputElement>('#campo-cpf_cnpj')!.value).toBe('123.456.789-01');
    expect(el().querySelector<HTMLInputElement>('#campo-cep')!.value).toBe('01001-000');
    expect(el().querySelector<HTMLInputElement>('#campo-telefone')!.value).toBe('(11) 3333-4444');

    // Pessoa jurídica exige 14 dígitos
    const juridica = el().querySelector<HTMLInputElement>('input[value="JURIDICA"]')!;
    juridica.click();
    fixture.detectChanges();
    enviar();
    expect(el().textContent).toContain('CNPJ deve conter 14 dígitos.');
  });

  it('sends digits only and navigates to the details after creating', async () => {
    await criar();
    preencherValido();
    enviar();

    const req = backend.expectOne(`${API}/clientes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      tipo_pessoa: 'FISICA',
      cpf_cnpj: '12345678901',
      telefone: '11999990000',
      cep: '01001000',
      complemento: null,
      uf: 'SP',
    });
    req.flush({ mensagem: 'ok', cliente: { id_cliente: 9 } });

    expect(navegar).toHaveBeenCalledWith(['/clientes', 9], { queryParams: { aviso: 'cadastrado' } });
  });

  it('accepts a client without e-mail and sends it as null (e-mail is optional)', async () => {
    await criar();
    preencherValido();
    preencher({ email: '' });
    enviar();

    const req = backend.expectOne(`${API}/clientes`);
    expect(req.request.body.email).toBeNull();
    req.flush({ mensagem: 'ok', cliente: { id_cliente: 10 } });
  });

  it('shows a 409 next to the document field', async () => {
    await criar();
    preencherValido();
    enviar();

    backend
      .expectOne(`${API}/clientes`)
      .flush(
        { mensagem: 'Já existe um cliente cadastrado com esse CPF/CNPJ.' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    expect(el().querySelector('#erro-cpf_cnpj')?.textContent).toContain('Já existe um cliente');
    expect(document.activeElement?.id).toBe('campo-cpf_cnpj');
  });

  it('shows a 400 message at the top of the form', async () => {
    await criar();
    preencherValido();
    enviar();

    backend
      .expectOne(`${API}/clientes`)
      .flush({ mensagem: 'UF inválida.' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();

    expect(el().querySelector('.aviso-erro')?.textContent).toContain('UF inválida.');
  });

  it('loads the client and saves with PUT in edit mode', async () => {
    await criar('1');
    backend.expectOne(`${API}/clientes/1`).flush({
      id_cliente: 1,
      tipo_pessoa: 'JURIDICA',
      nome_razao_social: 'Oficina Ltda',
      cpf_cnpj: '12345678000199',
      telefone: '1133334444',
      email: 'contato@oficina.test',
      cep: '01310100',
      logradouro: 'Av. Paulista',
      numero: '1000',
      complemento: 'Sala 1',
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    fixture.detectChanges();

    expect(el().querySelector<HTMLInputElement>('#campo-cpf_cnpj')!.value).toBe('12.345.678/0001-99');
    enviar();

    const req = backend.expectOne(`${API}/clientes/1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.cpf_cnpj).toBe('12345678000199');
    req.flush({ mensagem: 'ok', cliente: { id_cliente: 1 } });

    expect(navegar).toHaveBeenCalledWith(['/clientes', 1], { queryParams: { aviso: 'atualizado' } });
  });
});
