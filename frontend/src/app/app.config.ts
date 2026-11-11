import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, Injectable, provideBrowserGlobalErrorListeners } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { provideRouter, RouterStateSnapshot, TitleStrategy, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

/** Nome do sistema exibido na aba do navegador. */
export const NOME_SISTEMA = 'Sistema de Assistência Técnica';

/** Aba do navegador: "<título da página> · Sistema de Assistência Técnica". */
@Injectable()
export class TituloSistemaStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const pagina = this.buildTitle(snapshot);
    this.title.setTitle(pagina ? `${pagina} · ${NOME_SISTEMA}` : NOME_SISTEMA);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: TitleStrategy, useClass: TituloSistemaStrategy },
  ],
};
