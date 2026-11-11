/**
 * Configuração de DESENVOLVIMENTO (padrão): usada por `ng serve` e pelos testes.
 * Na build de produção este arquivo é substituído por `environment.production.ts`
 * (angular.json → configurations.production.fileReplacements).
 */
export const environment = {
  production: false,
  /** Endereço base da API Express (sem barra no final). */
  apiBaseUrl: 'http://localhost:3000/api',
};
