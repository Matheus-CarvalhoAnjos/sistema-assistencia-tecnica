import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { AuthService } from './auth.service';

/**
 * Envia o JWT nas requisições para a API e encerra a sessão quando
 * o backend responde 401 (token ausente, inválido, expirado ou usuário inativo).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const apiUrl = inject(API_BASE_URL);

  const ehApi = req.url.startsWith(apiUrl);
  const ehLogin = req.url === `${apiUrl}/auth/login`;
  const token = auth.token();

  const requisicao =
    ehApi && !ehLogin && token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(requisicao).pipe(
    catchError((erro: unknown) => {
      if (
        erro instanceof HttpErrorResponse &&
        erro.status === 401 &&
        ehApi &&
        !ehLogin &&
        auth.estaAutenticado()
      ) {
        auth.logout('expirada');
      }
      return throwError(() => erro);
    }),
  );
};
