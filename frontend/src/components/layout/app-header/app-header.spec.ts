import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UsuarioAutenticado } from '../../../app/models/usuario-autenticado';
import { AppHeader } from './app-header';

describe('AppHeader', () => {
  function iniciaisDe(nome: string): string {
    TestBed.configureTestingModule({ imports: [AppHeader], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(AppHeader);
    fixture.componentRef.setInput('usuario', { id_usuario: 1, nome, email: 'x@t.test', perfil: 'ATENDENTE' } as UsuarioAutenticado);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('.user-avatar')!.textContent!.trim();
  }

  it('uses the first and last words of the name as initials', () => {
    expect(iniciaisDe('Maria da Silva')).toBe('MS');
  });

  it('ignores words that do not start with a letter, such as "(demo)"', () => {
    expect(iniciaisDe('Ana Atendente (demo)')).toBe('AA');
  });

  it('uses the first two letters of a single name', () => {
    expect(iniciaisDe('Admin')).toBe('AD');
  });
});
