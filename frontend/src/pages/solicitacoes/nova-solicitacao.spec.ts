import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../app/config/api.config';
import { Cliente } from '../../app/models/cliente';
import { NovaSolicitacaoPage } from './nova-solicitacao';

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

const catalogo = [
  { id_acessorio: 3, descricao: 'Carregador', preco_atual: null, ativo: 1 },
  { id_acessorio: 4, descricao: 'Cabo de força', preco_atual: null, ativo: 1 },
];

describe('NovaSolicitacaoPage', () => {
  let fixture: ComponentFixture<NovaSolicitacaoPage>;
  let pagina: NovaSolicitacaoPage;
  let backend: HttpTestingController;

  async function criar(opcoes: { cliente?: string; acessorios?: unknown[] } = {}) {
    await TestBed.configureTestingModule({
      imports: [NovaSolicitacaoPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(NovaSolicitacaoPage);
    pagina = fixture.componentInstance;
    if (opcoes.cliente) {
      fixture.componentRef.setInput('cliente', opcoes.cliente);
    }
    fixture.detectChanges();
    backend.expectOne(`${API}/acessorios`).flush(opcoes.acessorios ?? catalogo);
    if (opcoes.cliente) {
      backend.expectOne(`${API}/clientes/${opcoes.cliente}`).flush(maria);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  function digitar(seletor: string, valor: string) {
    const campo = el().querySelector<HTMLInputElement | HTMLTextAreaElement>(seletor)!;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function preencherEquipamento(i: number, tipo = 'Notebook') {
    digitar(`#eq-${i}-tipo_equipamento`, tipo);
    digitar(`#eq-${i}-marca`, 'Dell');
    digitar(`#eq-${i}-modelo`, 'Inspiron 15');
    digitar(`#eq-${i}-estado_fisico`, 'Arranhões');
  }

  function enviar() {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('preselects the client coming back from the client registration', async () => {
    await criar({ cliente: '1' });
    expect(el().querySelector('.cliente-escolhido')?.textContent).toContain('Maria Cliente');
  });

  it('requires a client, the problem and the equipment fields without calling the API', async () => {
    await criar();
    enviar();

    expect(el().textContent).toContain('Selecione o cliente da solicitação.');

    pagina.selecionarCliente(maria);
    fixture.detectChanges();
    enviar();

    expect(el().textContent).toContain('Informe a descrição do problema.');
    expect(el().textContent).toContain('Informe o tipo.');
    backend.expectNone(`${API}/solicitacoes`);
  });

  it('adds equipment cards, keeps one open and cannot remove the last one', async () => {
    await criar();
    const remover = () => el().querySelectorAll<HTMLButtonElement>('.equipamento-topo .botao');

    expect(remover()[0].disabled).toBe(true);

    pagina.adicionarEquipamento();
    fixture.detectChanges();

    expect(el().querySelectorAll('.equipamento').length).toBe(2);
    expect(pagina.aberto()).toBe(1);
    expect(el().querySelector<HTMLElement>('#equipamento-campos-0')!.hidden).toBe(true);
    expect(remover()[0].disabled).toBe(false);

    pagina.removerEquipamento(1); // vazio: remove sem confirmação
    fixture.detectChanges();
    expect(el().querySelectorAll('.equipamento').length).toBe(1);
  });

  it('shows a notice and disables accessories when the catalog is empty', async () => {
    await criar({ acessorios: [] });
    expect(el().textContent).toContain('Nenhum acessório cadastrado no catálogo');
    const botao = [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Adicionar acessório'),
    )!;
    expect(botao.disabled).toBe(true);
  });

  it('sends the request with equipments and accessories and shows the generated OS', async () => {
    await criar();
    pagina.selecionarCliente(maria);
    digitar('#descricao_inicial', '  Não liga  ');
    preencherEquipamento(0);
    pagina.adicionarAcessorio(0);
    pagina.acessoriosDe(0).at(0).patchValue({ id_acessorio: 3, quantidade: 2 });
    pagina.adicionarEquipamento();
    fixture.detectChanges();
    preencherEquipamento(1, 'Impressora');

    enviar();

    const req = backend.expectOne(`${API}/solicitacoes`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      id_cliente: 1,
      descricao_inicial: 'Não liga',
      itens: [
        {
          tipo_equipamento: 'Notebook', marca: 'Dell', modelo: 'Inspiron 15', numero_serie: null,
          estado_fisico: 'Arranhões', observacoes: null,
          acessorios: [{ id_acessorio: 3, quantidade: 2, observacoes: null }],
        },
        {
          tipo_equipamento: 'Impressora', marca: 'Dell', modelo: 'Inspiron 15', numero_serie: null,
          estado_fisico: 'Arranhões', observacoes: null, acessorios: [],
        },
      ],
    });

    req.flush({
      mensagem: 'ok',
      solicitacao: {
        id_solicitacao: 12, id_cliente: 1, id_atendente: 6, descricao_inicial: 'Não liga',
        data_abertura: '2026-11-07T12:00:00Z',
        itens: [
          { id_item: 30, id_os: 40, tipo_equipamento: 'Notebook', marca: 'Dell', modelo: 'Inspiron 15',
            numero_serie: null, estado_fisico: 'Arranhões', observacoes: null, garantia_status: 'PENDENTE',
            acessorios: [{ id_acessorio_recebido: 1, id_acessorio: 3, descricao_acessorio: 'Carregador', quantidade: 2, observacoes: null }] },
          { id_item: 31, id_os: 41, tipo_equipamento: 'Impressora', marca: 'Dell', modelo: 'Inspiron 15',
            numero_serie: null, estado_fisico: 'Arranhões', observacoes: null, garantia_status: 'PENDENTE', acessorios: [] },
        ],
      },
    });
    fixture.detectChanges();

    expect(el().textContent).toContain('Solicitação nº 12 aberta');
    expect(el().textContent).toContain('OS nº 40');
    expect(el().textContent).toContain('OS nº 41');
    expect(el().textContent).toContain('2× Carregador');
  });

  it('shows the API error at the top and keeps the form filled', async () => {
    await criar();
    pagina.selecionarCliente(maria);
    digitar('#descricao_inicial', 'Não liga');
    preencherEquipamento(0);
    enviar();

    backend
      .expectOne(`${API}/solicitacoes`)
      .flush({ mensagem: 'Cliente não encontrado.' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(el().querySelector('.aviso-erro')?.textContent).toContain('Cliente não encontrado.');
    expect(el().querySelector<HTMLInputElement>('#eq-0-marca')!.value).toBe('Dell');
  });
});
