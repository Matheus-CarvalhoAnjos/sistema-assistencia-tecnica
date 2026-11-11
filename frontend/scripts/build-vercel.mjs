// Build de produção para a Vercel: injeta o endereço da API (variável API_BASE_URL)
// como a constante API_BASE_URL_BUILD lida por src/environments/environment.production.ts.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const bruto = (process.env.API_BASE_URL ?? '').trim();

if (!bruto) {
  console.error('API_BASE_URL não definida. Informe o endereço da API, por exemplo https://<backend>.vercel.app/api');
  process.exit(1);
}

let url;
try {
  url = new URL(bruto);
} catch {
  console.error('API_BASE_URL não é um endereço válido.');
  process.exit(1);
}

if (url.protocol !== 'https:') {
  console.error('API_BASE_URL deve usar https://.');
  process.exit(1);
}

const apiBaseUrl = url.href.replace(/\/+$/, '');
const ng = createRequire(import.meta.url).resolve('@angular/cli/bin/ng.js');

console.log(`Build de produção com API em ${apiBaseUrl}`);

const resultado = spawnSync(
  process.execPath,
  [ng, 'build', '--configuration', 'production', '--define', `API_BASE_URL_BUILD=${JSON.stringify(apiBaseUrl)}`],
  { stdio: 'inherit' },
);

process.exit(resultado.status ?? 1);
