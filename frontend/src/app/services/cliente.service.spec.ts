import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.config';
import { ClienteEntrada } from '../models/cliente';
import { ClienteService } from './cliente.service';

const API = 'http://api.teste/api';

const entrada: ClienteEntrada = {
  tipo_pessoa: 'FISICA',
  nome_razao_social: 'Maria',
  cpf_cnpj: '12345678901',
  telefone: '11999990000',
  email: 'maria@teste.test',
  cep: '01001000',
  logradouro: 'Rua A',
  numero: '1',
  complemento: null,
  bairro: 'Centro',
  cidade: 'São Paulo',
  uf: 'SP',
};

describe('ClienteService', () => {
  let service: ClienteService;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE_URL, useValue: API }],
    });
    service = TestBed.inject(ClienteService);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('lists without a search parameter when the term is blank', () => {
    service.listar('  ').subscribe();
    const req = backend.expectOne(`${API}/clientes`);
    expect(req.request.params.has('busca')).toBe(false);
    req.flush([]);
  });

  it('sends the trimmed search term', () => {
    service.listar(' maria ').subscribe();
    const req = backend.expectOne((r) => r.url === `${API}/clientes`);
    expect(req.request.params.get('busca')).toBe('maria');
    req.flush([]);
  });

  it('uses GET, POST and PUT on the expected URLs', () => {
    service.buscarPorId(3).subscribe();
    expect(backend.expectOne(`${API}/clientes/3`).request.method).toBe('GET');

    service.criar(entrada).subscribe();
    const criar = backend.expectOne(`${API}/clientes`);
    expect(criar.request.method).toBe('POST');
    expect(criar.request.body).toEqual(entrada);

    service.atualizar(3, entrada).subscribe();
    expect(backend.expectOne(`${API}/clientes/3`).request.method).toBe('PUT');
  });
});
