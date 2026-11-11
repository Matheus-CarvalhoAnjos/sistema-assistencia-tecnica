import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UsuarioAutenticado } from '../../../app/models/usuario-autenticado';
import { TopNavigation } from './top-navigation';

describe('TopNavigation', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TopNavigation],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(perfil: string | null): HTMLElement {
    const fixture = TestBed.createComponent(TopNavigation);

    if (perfil) {
      const usuario: UsuarioAutenticado = {
        id_usuario: 1,
        nome: 'Usuário autenticado',
        email: 'usuario@exemplo.test',
        perfil,
      };
      fixture.componentRef.setInput('usuario', usuario);
    }

    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows Solicitações to Administrador and Atendente profiles', () => {
    expect(render('administrador').textContent).toContain('Solicitações');
    expect(render('ATENDENTE').textContent).toContain('Solicitações');
  });

  it('hides Solicitações from Técnico', () => {
    expect(render('tecnico').textContent).not.toContain('Solicitações');
  });

  it('shows Usuários only to Administrador and no disabled placeholder items', () => {
    expect(render('ADMINISTRADOR').textContent).toContain('Usuários');
    expect(render('ATENDENTE').textContent).not.toContain('Usuários');
    expect(render('TECNICO').textContent).not.toContain('Usuários');
    const html = render('ADMINISTRADOR');
    expect(html.querySelector('button[disabled]')).toBeNull();
    expect(html.textContent).not.toContain('Pagamentos');
  });

  it('does not assume a profile when no authenticated user is available', () => {
    const conteudo = render(null).textContent ?? '';

    expect(conteudo).toContain('Início');
    expect(conteudo).not.toContain('Solicitações');
    expect(conteudo).not.toContain('Clientes');
  });
});
