import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import {
  CredenciaisLogin,
  PerfilUsuario,
  RespostaLogin,
  UsuarioAutenticado,
} from '../models/usuario-autenticado';

interface Sessao {
  token: string;
  usuario: UsuarioAutenticado;
  /** Momento de expiração do token, em milissegundos (epoch). */
  expiraEm: number;
}

/** Motivo exibido na tela de login quando a sessão é encerrada sem ação do usuário. */
export type MotivoEncerramento = 'expirada';

const CHAVE_SESSAO = 'assistencia.sessao';

/** Lê o campo `exp` (em segundos) do payload de um JWT. Retorna null se o token for ilegível. */
export function lerExpiracaoToken(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiUrl = inject(API_BASE_URL);

  private readonly sessao = signal<Sessao | null>(null);
  private temporizadorExpiracao: ReturnType<typeof setTimeout> | null = null;

  readonly usuario = computed(() => this.sessao()?.usuario ?? null);
  readonly token = computed(() => this.sessao()?.token ?? null);
  readonly estaAutenticado = computed(() => this.sessao() !== null);
  readonly perfil = computed(
    () => (this.sessao()?.usuario.perfil.trim().toUpperCase() as PerfilUsuario | undefined) ?? null,
  );

  constructor() {
    this.restaurarSessao();
  }

  login(credenciais: CredenciaisLogin): Observable<RespostaLogin> {
    return this.http
      .post<RespostaLogin>(`${this.apiUrl}/auth/login`, {
        email: credenciais.email.trim(),
        senha: credenciais.senha,
      })
      .pipe(tap((resposta) => this.iniciarSessao(resposta)));
  }

  /** Encerra a sessão e leva o usuário para a tela de login. */
  logout(motivo?: MotivoEncerramento): void {
    const retorno = motivo ? this.router.url : undefined;
    this.limparSessao();

    const queryParams: Record<string, string> = {};
    if (motivo) {
      queryParams['motivo'] = motivo;
    }
    if (retorno && retorno !== '/' && !retorno.startsWith('/login')) {
      queryParams['retorno'] = retorno;
    }

    void this.router.navigate(['/login'], { queryParams });
  }

  possuiPerfil(...perfis: readonly PerfilUsuario[]): boolean {
    const perfil = this.perfil();
    return perfil !== null && perfis.includes(perfil);
  }

  private iniciarSessao(resposta: RespostaLogin): void {
    const expiraEm = lerExpiracaoToken(resposta.token);

    if (expiraEm === null || expiraEm <= Date.now()) {
      throw new Error('O servidor retornou um token inválido.');
    }

    const sessao: Sessao = { token: resposta.token, usuario: resposta.usuario, expiraEm };
    this.sessao.set(sessao);
    this.gravar(sessao);
    this.agendarExpiracao(expiraEm);
  }

  private restaurarSessao(): void {
    let sessao: Sessao | null = null;

    try {
      const bruto = sessionStorage.getItem(CHAVE_SESSAO);
      sessao = bruto ? (JSON.parse(bruto) as Sessao) : null;
    } catch {
      sessao = null;
    }

    if (!sessao?.token || !sessao.usuario || !(sessao.expiraEm > Date.now())) {
      this.limparSessao();
      return;
    }

    this.sessao.set(sessao);
    this.agendarExpiracao(sessao.expiraEm);
  }

  private agendarExpiracao(expiraEm: number): void {
    this.cancelarTemporizador();
    // setTimeout aceita no máximo ~24,8 dias; acima disso, o interceptor trata o 401.
    const espera = Math.min(expiraEm - Date.now(), 2_147_483_647);
    this.temporizadorExpiracao = setTimeout(() => this.logout('expirada'), espera);
  }

  private limparSessao(): void {
    this.cancelarTemporizador();
    this.sessao.set(null);
    try {
      sessionStorage.removeItem(CHAVE_SESSAO);
    } catch {
      // Armazenamento indisponível: nada a limpar.
    }
  }

  private gravar(sessao: Sessao): void {
    try {
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
    } catch {
      // Sem armazenamento, a sessão vale só até recarregar a página.
    }
  }

  private cancelarTemporizador(): void {
    if (this.temporizadorExpiracao !== null) {
      clearTimeout(this.temporizadorExpiracao);
      this.temporizadorExpiracao = null;
    }
  }
}
