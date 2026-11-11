import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../app/config/api.config';
import { AcessoriosPage, lerPreco } from './acessorios';

const API = 'http://api.teste/api';

describe('lerPreco', () => {
  it('accepts comma or dot decimals and empty values', () => {
    expect(lerPreco('')).toBeNull();
    expect(lerPreco('35,90')).toBe(35.9);
    expect(lerPreco('35.90')).toBe(35.9);
    expect(lerPreco('1.234,50')).toBe(1234.5);
    expect(lerPreco('abc')).toBeNaN();
    expect(lerPreco('1,234')).toBeNaN();
  });
});

describe('AcessoriosPage', () => {
  let fixture: ComponentFixture<AcessoriosPage>;
  let backend: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AcessoriosPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AcessoriosPage);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  function digitar(id: string, valor: string) {
    const campo = el().querySelector<HTMLInputElement>(`#${id}`)!;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function enviar() {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('shows the empty catalog state', () => {
    backend.expectOne(`${API}/acessorios`).flush([]);
    fixture.detectChanges();
    expect(el().textContent).toContain('Nenhum acessório cadastrado.');
  });

  it('lists accessories with formatted prices', () => {
    backend.expectOne(`${API}/acessorios`).flush([
      { id_acessorio: 1, descricao: 'Carregador', preco_atual: '35.90', ativo: 1 },
      { id_acessorio: 2, descricao: 'Cabo', preco_atual: null, ativo: 1 },
    ]);
    fixture.detectChanges();
    const texto = el().textContent ?? '';
    expect(texto).toContain('Carregador');
    expect(texto).toMatch(/R\$\s?35,90/);
    expect(texto).toContain('Acessórios ativos (2)');
  });

  it('validates before calling the API', () => {
    backend.expectOne(`${API}/acessorios`).flush([]);
    digitar('acessorio-preco_atual', '12,345');
    enviar();
    expect(el().textContent).toContain('Informe a descrição do acessório.');
    expect(el().textContent).toContain('Informe um valor como 35,90');
    backend.expectNone((r) => r.method === 'POST');
  });

  it('creates an accessory, adds it to the list and clears the form', () => {
    backend.expectOne(`${API}/acessorios`).flush([]);
    digitar('acessorio-descricao', ' Carregador ');
    digitar('acessorio-preco_atual', '35,90');
    enviar();

    const req = backend.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ descricao: 'Carregador', preco_atual: 35.9 });
    req.flush({
      mensagem: 'ok',
      acessorio: { id_acessorio: 7, descricao: 'Carregador', preco_atual: '35.90', ativo: 1 },
    });
    fixture.detectChanges();

    expect(el().textContent).toContain('Acessório "Carregador" cadastrado.');
    expect(el().textContent).toContain('Acessórios ativos (1)');
    expect(el().querySelector<HTMLInputElement>('#acessorio-descricao')!.value).toBe('');
  });

  it('sends null price when left blank and shows 409 next to the description', () => {
    backend.expectOne(`${API}/acessorios`).flush([]);
    digitar('acessorio-descricao', 'Cabo');
    enviar();

    const req = backend.expectOne((r) => r.method === 'POST');
    expect(req.request.body.preco_atual).toBeNull();
    req.flush(
      { mensagem: 'Já existe um acessório cadastrado com essa descrição.' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(el().querySelector('#erro-descricao')?.textContent).toContain('Já existe um acessório');
  });
});
