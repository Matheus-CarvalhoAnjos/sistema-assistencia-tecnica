import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService } from '../../app/auth/auth.service';
import { API_BASE_URL } from '../../app/config/api.config';
import { Usuario } from '../../app/models/usuario';
import { UsuariosPage } from './usuarios';

const API = 'http://api.teste/api';

const USUARIOS: Usuario[] = [
  { id_usuario: 1, nome: 'Admin', email: 'admin@t.test', perfil: 'ADMINISTRADOR', ativo: 1 },
  { id_usuario: 3, nome: 'Tiago', email: 'tiago@t.test', perfil: 'TECNICO', ativo: 1 },
  { id_usuario: 4, nome: 'Ana', email: 'ana@t.test', perfil: 'ATENDENTE', ativo: 0 },
];

describe('UsuariosPage', () => {
  let fixture: ComponentFixture<UsuariosPage>;
  let backend: HttpTestingController;

  async function criar() {
    await TestBed.configureTestingModule({
      imports: [UsuariosPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: API },
        { provide: AuthService, useValue: { usuario: signal({ id_usuario: 1, nome: 'Admin', email: 'admin@t.test', perfil: 'ADMINISTRADOR' }) } },
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UsuariosPage);
    fixture.detectChanges();
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush(USUARIOS);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const botao = (rotulo: string) => [...el().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === rotulo);
  const preencher = (seletor: string, valor: string) => {
    const campo = el().querySelector<HTMLInputElement | HTMLSelectElement>(seletor)!;
    campo.value = valor;
    campo.dispatchEvent(new Event(campo.tagName === 'SELECT' ? 'change' : 'input'));
    fixture.detectChanges();
  };
  const recarregar = () => {
    backend.expectOne((r) => r.url === `${API}/usuarios`).flush(USUARIOS);
    fixture.detectChanges();
  };

  it('lists users with profile and situation and marks the logged user; never shows passwords', async () => {
    await criar();
    const linhas = [...el().querySelectorAll('tbody tr')].map((tr) => tr.textContent!.replace(/\s+/g, ' '));
    expect(linhas.length).toBe(3);
    expect(linhas[0]).toContain('(você)');
    expect(linhas[1]).toContain('Técnico');
    expect(linhas[2]).toContain('Inativo');
    expect(el().textContent).not.toContain('senha_hash');
  });

  it('creates a user: password is required', async () => {
    await criar();
    botao('Novo usuário')!.click();
    fixture.detectChanges();
    preencher('#campo-nome', 'Carla');
    preencher('#campo-email', 'carla@t.test');
    preencher('#campo-perfil', 'ATENDENTE');
    botao('Cadastrar')!.click();
    fixture.detectChanges();
    expect(el().textContent).toContain('Informe a senha.');
    backend.expectNone(`${API}/usuarios`);

    preencher('#campo-senha', 'segredo-de-teste');
    botao('Cadastrar')!.click();
    const req = backend.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({ nome: 'Carla', email: 'carla@t.test', perfil: 'ATENDENTE', senha: 'segredo-de-teste' });
    req.flush({ mensagem: 'Usuário cadastrado com sucesso.', usuario: { ...USUARIOS[1], nome: 'Carla' } });
    fixture.detectChanges();
    recarregar();
    expect(el().textContent).toContain('Usuário cadastrado com sucesso.');
  });

  it('S5: password shorter than 8 characters is refused on create and on edit (same rule as the API)', async () => {
    await criar();
    botao('Novo usuário')!.click();
    fixture.detectChanges();
    preencher('#campo-nome', 'Carla');
    preencher('#campo-email', 'carla@t.test');
    preencher('#campo-perfil', 'ATENDENTE');
    preencher('#campo-senha', '1234567');
    botao('Cadastrar')!.click();
    fixture.detectChanges();
    expect(el().textContent).toContain('A senha deve ter pelo menos 8 caracteres.');
    backend.expectNone(`${API}/usuarios`);

    el().querySelector<HTMLButtonElement>('button[aria-label="Editar Tiago"]')!.click();
    fixture.detectChanges();
    preencher('#campo-senha', 'curta');
    botao('Salvar alterações')!.click();
    fixture.detectChanges();
    expect(el().textContent).toContain('A senha deve ter pelo menos 8 caracteres.');
    backend.expectNone((r) => r.method === 'PUT');
  });

  it('edits a user without sending the password when it is left blank', async () => {
    await criar();
    el().querySelector<HTMLButtonElement>('button[aria-label="Editar Tiago"]')!.click();
    fixture.detectChanges();
    expect(el().textContent).toContain('Deixe em branco para manter a senha atual.');
    preencher('#campo-nome', 'Tiago Silva');
    botao('Salvar alterações')!.click();

    const req = backend.expectOne((r) => r.method === 'PUT');
    expect(req.request.url).toBe(`${API}/usuarios/3`);
    expect(req.request.body).toEqual({ nome: 'Tiago Silva', email: 'tiago@t.test', perfil: 'TECNICO' });
  });

  it('deactivates after confirming and shows the API message when the last administrator is protected', async () => {
    await criar();
    const desativar = [...el().querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === 'Desativar');
    desativar[0].click();
    fixture.detectChanges();
    expect(el().textContent).toContain('Desativar Admin?');
    botao('Confirmar')!.click();

    const req = backend.expectOne(`${API}/usuarios/1/ativo`);
    expect(req.request.body).toEqual({ ativo: false });
    req.flush({ mensagem: 'O sistema precisa de ao menos um administrador ativo.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('ao menos um administrador ativo');
  });

  it('activates an inactive user', async () => {
    await criar();
    botao('Ativar')!.click();
    fixture.detectChanges();
    botao('Confirmar')!.click();
    const req = backend.expectOne(`${API}/usuarios/4/ativo`);
    expect(req.request.body).toEqual({ ativo: true });
  });

  it('filters by profile and situation', async () => {
    await criar();
    preencher('#filtro-perfil', 'TECNICO');
    const porPerfil = backend.expectOne((r) => r.url === `${API}/usuarios`);
    expect(porPerfil.request.params.get('perfil')).toBe('TECNICO');
    porPerfil.flush([USUARIOS[1]]);
    preencher('#filtro-situacao', '0');
    const porSituacao = backend.expectOne((r) => r.url === `${API}/usuarios`);
    expect(porSituacao.request.params.get('ativo')).toBe('0');
  });
});
