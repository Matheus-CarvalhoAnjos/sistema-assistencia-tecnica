/**
 * Configuração de PRODUÇÃO (`ng build`).
 * Caminho relativo: o frontend e a API devem ser servidos no mesmo domínio, com HTTPS
 * (por exemplo, um proxy reverso que encaminha /api para o servidor Express).
 * Se a API ficar em outro domínio, informe aqui o endereço completo (https://...)
 * e inclua a origem do frontend em CORS_ORIGIN no backend.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
};
