import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PerfilUsuario } from '../models/usuario-autenticado';
import { AuthService } from './auth.service';

/** Exige sessão ativa; caso contrário, envia para o login guardando a rota pedida. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).estaAutenticado()) {
    return true;
  }

  const queryParams = state.url && state.url !== '/' ? { retorno: state.url } : {};
  return inject(Router).createUrlTree(['/login'], { queryParams });
};

/**
 * Exige um dos perfis listados em `data.perfis` da rota.
 * Use junto com authGuard: { canActivate: [authGuard, perfilGuard], data: { perfis: [...] } }.
 * A proteção real é do backend; este guard só evita telas que retornariam 403.
 */
export const perfilGuard: CanActivateFn = (route) => {
  const perfis = (route.data['perfis'] ?? []) as readonly PerfilUsuario[];

  if (inject(AuthService).possuiPerfil(...perfis)) {
    return true;
  }

  return inject(Router).createUrlTree(['/']);
};

/** Impede abrir o login quando já existe sessão ativa. */
export const somenteVisitanteGuard: CanActivateFn = () =>
  inject(AuthService).estaAutenticado() ? inject(Router).createUrlTree(['/']) : true;
