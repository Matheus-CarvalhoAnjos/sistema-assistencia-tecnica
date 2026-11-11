import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { API_BASE_URL } from '../config/api.config';
import { authInterceptor } from './auth.interceptor';
import { AuthService, lerExpiracaoToken } from './auth.service';

const API = 'http://api.teste/api';

function criarToken(expiraEmSegundos: number): string {
  const codificar = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const exp = Math.floor(Date.now() / 1000) + expiraEmSegundos;
  return `${codificar({ alg: 'HS256', typ: 'JWT' })}.${codificar({ id_usuario: 1, perfil: 'ATENDENTE', exp })}.assinatura`;
}

const usuario = { id_usuario: 1, nome: 'Ana Souza', email: 'ana@exemplo.test', perfil: 'ATENDENTE' };

describe('Autenticação', () => {
  let auth: AuthService;
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: Router;

  function configurar(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  }

  function fazerLogin(token = criarToken(3600)): void {
    auth.login({ email: ' ana@exemplo.test ', senha: 'segredo' }).subscribe();
    backend
      .expectOne(`${API}/auth/login`)
      .flush({ mensagem: 'Login realizado com sucesso.', usuario, token });
  }

  beforeEach(() => {
    sessionStorage.clear();
    configurar();
  });

  afterEach(() => backend.verify());

  it('reads the expiration of a JWT', () => {
    const token = criarToken(60);
    expect(lerExpiracaoToken(token)).toBeGreaterThan(Date.now());
    expect(lerExpiracaoToken('invalido')).toBeNull();
  });

  it('logs in, sends trimmed credentials without a token and stores the session', () => {
    auth.login({ email: ' ana@exemplo.test ', senha: 'segredo' }).subscribe();
    const req = backend.expectOne(`${API}/auth/login`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'ana@exemplo.test', senha: 'segredo' });
    expect(req.request.headers.has('Authorization')).toBe(false);

    req.flush({ mensagem: 'ok', usuario, token: criarToken(3600) });

    expect(auth.estaAutenticado()).toBe(true);
    expect(auth.perfil()).toBe('ATENDENTE');
    expect(auth.possuiPerfil('ADMINISTRADOR', 'ATENDENTE')).toBe(true);
    expect(auth.possuiPerfil('TECNICO')).toBe(false);
    expect(sessionStorage.getItem('assistencia.sessao')).toContain('ATENDENTE');
  });

  it('adds the Bearer token to API requests only', () => {
    const token = criarToken(3600);
    fazerLogin(token);

    http.get(`${API}/solicitacoes`).subscribe();
    expect(backend.expectOne(`${API}/solicitacoes`).request.headers.get('Authorization')).toBe(
      `Bearer ${token}`,
    );

    http.get('https://outro.site/dados').subscribe();
    expect(backend.expectOne('https://outro.site/dados').request.headers.has('Authorization')).toBe(
      false,
    );
  });

  it('ends the session and goes to login with reason when the API answers 401', () => {
    fazerLogin();

    http.get(`${API}/clientes`).subscribe({ error: () => undefined });
    backend
      .expectOne(`${API}/clientes`)
      .flush({ mensagem: 'Token inválido ou expirado.' }, { status: 401, statusText: 'Unauthorized' });

    expect(auth.estaAutenticado()).toBe(false);
    expect(sessionStorage.getItem('assistencia.sessao')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { motivo: 'expirada' },
    });
  });

  it('keeps the session on 403', () => {
    fazerLogin();

    http.get(`${API}/solicitacoes`).subscribe({ error: () => undefined });
    backend
      .expectOne(`${API}/solicitacoes`)
      .flush({ mensagem: 'Sem permissão' }, { status: 403, statusText: 'Forbidden' });

    expect(auth.estaAutenticado()).toBe(true);
  });

  it('restores a valid session and discards an expired one', () => {
    fazerLogin();
    TestBed.resetTestingModule();
    configurar();
    expect(auth.estaAutenticado()).toBe(true);

    const salvo = JSON.parse(sessionStorage.getItem('assistencia.sessao') ?? '{}');
    sessionStorage.setItem(
      'assistencia.sessao',
      JSON.stringify({ ...salvo, expiraEm: Date.now() - 1000 }),
    );
    TestBed.resetTestingModule();
    configurar();
    expect(auth.estaAutenticado()).toBe(false);
  });
});
