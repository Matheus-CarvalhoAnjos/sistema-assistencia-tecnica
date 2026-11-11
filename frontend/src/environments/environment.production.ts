/**
 * Configuração de PRODUÇÃO (`ng build`).
 *
 * Na Vercel, o endereço completo da API (https://.../api) vem da variável de ambiente
 * API_BASE_URL, injetada no build por `npm run build:vercel` (scripts/build-vercel.mjs)
 * como a constante API_BASE_URL_BUILD. A origem do frontend deve constar em CORS_ORIGIN
 * no backend.
 *
 * Sem essa constante (por exemplo, `ng build` comum), usa o caminho relativo `/api`:
 * frontend e API servidos no mesmo domínio, com HTTPS (proxy reverso para o Express).
 */
declare const API_BASE_URL_BUILD: string | undefined;

export const environment = {
  production: true,
  apiBaseUrl:
    typeof API_BASE_URL_BUILD === 'string' && API_BASE_URL_BUILD ? API_BASE_URL_BUILD : '/api',
};
