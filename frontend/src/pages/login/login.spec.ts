import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { API_BASE_URL } from '../../app/config/api.config';
import { LoginPage } from './login';

const API = 'http://api.teste/api';

describe('LoginPage', () => {
  let backend: HttpTestingController;

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
  });

  function preencher(fixture: ReturnType<typeof TestBed.createComponent<LoginPage>>, email: string, senha: string) {
    const el = fixture.nativeElement as HTMLElement;
    const emailInput = el.querySelector<HTMLInputElement>('#login-email')!;
    const senhaInput = el.querySelector<HTMLInputElement>('#login-senha')!;
    emailInput.value = email;
    emailInput.dispatchEvent(new Event('input'));
    senhaInput.value = senha;
    senhaInput.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('shows validation messages and does not call the API when the form is empty', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    preencher(fixture, '', '');

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Informe o e-mail.');
    expect(texto).toContain('Informe a senha.');
    backend.expectNone(`${API}/auth/login`);
  });

  it('shows the API error message on invalid credentials', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    preencher(fixture, 'ana@exemplo.test', 'errada');

    backend
      .expectOne(`${API}/auth/login`)
      .flush({ mensagem: 'E-mail ou senha inválidos.' }, { status: 401, statusText: 'Unauthorized' });
    fixture.detectChanges();

    const alerta = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain('E-mail ou senha inválidos.');
  });

  it('shows the expired-session notice', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentRef.setInput('motivo', 'expirada');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Sua sessão expirou');
  });

  it('ignores external return URLs after login', () => {
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentRef.setInput('retorno', '//site-malicioso.test');
    fixture.detectChanges();
    preencher(fixture, 'ana@exemplo.test', 'certa');

    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    backend.expectOne(`${API}/auth/login`).flush({
      mensagem: 'ok',
      usuario: { id_usuario: 1, nome: 'Ana', email: 'ana@exemplo.test', perfil: 'ATENDENTE' },
      token: `x.${payload}.y`,
    });

    expect(navegar).toHaveBeenCalledWith('/');
  });
});
