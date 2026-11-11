import { InjectionToken } from '@angular/core';
import { environment } from '../../environments/environment';

/** Endereço base da API Express (sem barra no final), definido por ambiente em src/environments. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});
