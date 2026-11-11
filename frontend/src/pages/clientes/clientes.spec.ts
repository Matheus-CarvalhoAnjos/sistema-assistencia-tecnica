import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../app/config/api.config';
import { Cliente } from '../../app/models/cliente';
import { ClientesPage } from './clientes';

const API = 'http://api.teste/api';

const maria: Cliente = {
  id_cliente: 1,
  tipo_pessoa: 'FISICA',
  nome_razao_social: 'Maria Cliente',
  cpf_cnpj: '12345678901',
  telefone: '11999990000',
  email: 'maria@teste.test',
  cep: '01001000',
  logradouro: 'Rua Teste',
  numero: '100',
  complemento: null,
  bairro: 'Centro',
  cidade: 'São Paulo',
  uf: 'SP',
};

describe('ClientesPage', () => {
  let fixture: ComponentFixture<ClientesPage>;
  let backend: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientesPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ClientesPage);
    fixture.detectChanges();
  });

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('shows loading, then the formatted clients', () => {
    expect(texto()).toContain('Carregando clientes');

    backend.expectOne(`${API}/clientes`).flush([maria]);
    fixture.detectChanges();

    expect(texto()).toContain('Maria Cliente');
    expect(texto()).toContain('123.456.789-01');
    expect(texto()).toContain('(11) 99999-0000');
    expect(texto()).toContain('1 cliente');
  });

  it('shows the empty state when there are no clients', () => {
    backend.expectOne(`${API}/clientes`).flush([]);
    fixture.detectChanges();
    expect(texto()).toContain('Nenhum cliente cadastrado');
  });

  it('shows the API error with a retry button', () => {
    backend
      .expectOne(`${API}/clientes`)
      .flush({ mensagem: 'Falha simulada.' }, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();

    expect(texto()).toContain('Não foi possível carregar os clientes');
    expect(texto()).toContain('Falha simulada.');

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[role="alert"] button')!
      .click();
    backend.expectOne(`${API}/clientes`).flush([maria]);
    fixture.detectChanges();
    expect(texto()).toContain('Maria Cliente');
  });

  it('searches on the server after the debounce and shows "no results"', async () => {
    vi.useFakeTimers();
    backend.expectOne(`${API}/clientes`).flush([maria]);

    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-clientes')!;
    campo.value = 'joão';
    campo.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    vi.useRealTimers();

    const req = backend.expectOne((r) => r.url === `${API}/clientes`);
    expect(req.request.params.get('busca')).toBe('joão');
    req.flush([]);
    fixture.detectChanges();

    expect(texto()).toContain('Nenhum cliente encontrado para "joão"');
  });
});
