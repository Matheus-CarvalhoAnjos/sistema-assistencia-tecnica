import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../app/auth/auth.service';
import { API_BASE_URL } from '../../app/config/api.config';
import { OrdemServicoResumo } from '../../app/models/ordem-servico';
import { DashboardPage } from './dashboard';

const API = 'http://api.teste/api';

function ordem(id: number, alteracoes: Partial<OrdemServicoResumo> = {}): OrdemServicoResumo {
  return {
    id_os: id,
    id_item: id,
    id_tecnico: 7,
    nome_tecnico: 'Tecnico Teste',
    status: 'RECEBIDA',
    data_abertura: '2026-11-01T12:00:00Z',
    data_encerramento: null,
    motivo_encerramento: null,
    tipo_equipamento: 'Notebook',
    marca: 'Dell',
    modelo: 'Inspiron',
    numero_serie: null,
    garantia_status: 'PENDENTE',
    id_cliente: 1,
    nome_cliente: 'Maria Cliente',
    ...alteracoes,
  };
}

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let backend: HttpTestingController;

  async function criar(perfil: string) {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
        { provide: AuthService, useValue: { perfil: signal(perfil) } },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const texto = () => el().textContent ?? '';

  it('shows real orders, technician column and status counts for the attendant', async () => {
    await criar('ATENDENTE');
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([{ id_usuario: 7, nome: 'Tecnico Teste', perfil: 'TECNICO', ativo: 1 }]);
    backend.expectOne(`${API}/ordens-servico`).flush([
      ordem(1),
      ordem(2, { status: 'EM_REPARO' }),
      ordem(3, { id_tecnico: null, nome_tecnico: null }),
    ]);
    fixture.detectChanges();

    expect(texto()).toContain('Visão geral');
    expect(texto()).toContain('3 registros');
    expect(texto()).toContain('1 sem técnico');
    expect(el().querySelectorAll('tbody tr').length).toBe(3);
    expect(el().querySelector('thead')?.textContent).toContain('Técnico');
    expect(el().querySelector('a[href="/ordens-servico/2"]')).toBeTruthy();

    const recebidas = [...el().querySelectorAll('.status-item')].find((b) => b.textContent?.includes('Recebida'));
    expect(recebidas?.textContent).toContain('2');
  });

  it('technician sees "my orders" without the technician column or filter', async () => {
    await criar('TECNICO');
    backend.expectNone((r) => r.url === `${API}/usuarios`);
    backend.expectOne(`${API}/ordens-servico`).flush([ordem(2)]);
    fixture.detectChanges();

    expect(texto()).toContain('Minhas Ordens de Serviço');
    expect(el().querySelector('thead')?.textContent).not.toContain('Técnico');
    expect(el().querySelector('#filtro-tecnico')).toBeNull();
  });

  it('technician with no assigned orders sees a specific empty state', async () => {
    await criar('TECNICO');
    backend.expectOne(`${API}/ordens-servico`).flush([]);
    fixture.detectChanges();
    expect(texto()).toContain('Nenhuma Ordem de Serviço atribuída a você');
  });

  it('filters by status on the server when an indicator is clicked', async () => {
    await criar('ADMINISTRADOR');
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    backend.expectOne(`${API}/ordens-servico`).flush([ordem(1), ordem(2, { status: 'EM_REPARO' })]);
    fixture.detectChanges();

    const emReparo = [...el().querySelectorAll<HTMLButtonElement>('.status-item')].find((b) =>
      b.textContent?.includes('Em reparo'),
    )!;
    emReparo.click();
    fixture.detectChanges();

    const req = backend.expectOne((r) => r.url === `${API}/ordens-servico` && r.params.get('status') === 'EM_REPARO');
    req.flush([ordem(2, { status: 'EM_REPARO' })]);
    fixture.detectChanges();

    expect(el().querySelectorAll('tbody tr').length).toBe(1);
    expect(emReparo.getAttribute('aria-pressed')).toBe('true');
    expect(texto()).toContain('Limpar filtros');
  });

  it('"Não finalizadas" asks the server for every status except the closing ones', async () => {
    await criar('TECNICO');
    backend.expectOne(`${API}/ordens-servico`).flush([ordem(1), ordem(2, { status: 'FINALIZADA' })]);
    fixture.detectChanges();

    const select = el().querySelector<HTMLSelectElement>('#filtro-status')!;
    select.value = 'NAO_FINALIZADAS';
    select.dispatchEvent(new Event('change'));

    const req = backend.expectOne((r) => r.url === `${API}/ordens-servico` && r.params.has('status'));
    expect(req.request.params.get('status')).toBe(
      'RECEBIDA,EM_ANALISE,AGUARDANDO_APROVACAO,EM_REPARO,CONCLUIDA,AGUARDANDO_EXPEDICAO',
    );
    req.flush([ordem(1)]);
    fixture.detectChanges();

    expect(el().querySelectorAll('tbody tr').length).toBe(1);
    // Os indicadores continuam contando todas as OS visíveis
    const finalizadas = [...el().querySelectorAll('.status-item')].find((b) => b.textContent?.includes('Finalizada'));
    expect(finalizadas?.textContent).toContain('1');
  });

  it('filters orders without technician', async () => {
    await criar('ATENDENTE');
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    backend.expectOne(`${API}/ordens-servico`).flush([ordem(1)]);
    fixture.detectChanges();

    const select = el().querySelector<HTMLSelectElement>('#filtro-tecnico')!;
    select.value = 'sem';
    select.dispatchEvent(new Event('change'));

    const req = backend.expectOne((r) => r.params.get('sem_tecnico') === 'true');
    expect(req.request.params.has('id_tecnico')).toBe(false);
    req.flush([]);
    fixture.detectChanges();
    expect(texto()).toContain('Nenhuma Ordem de Serviço encontrada');
  });

  it('shows the API error with retry', async () => {
    await criar('ATENDENTE');
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush([]);
    backend.expectOne(`${API}/ordens-servico`).flush({ mensagem: 'Falha.' }, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();

    expect(texto()).toContain('Não foi possível carregar as Ordens de Serviço');
    expect(texto()).toContain('Sem conexão de dados');
  });
});
