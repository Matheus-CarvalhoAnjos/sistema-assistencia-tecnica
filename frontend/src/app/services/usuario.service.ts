import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { UsuarioResumo } from '../models/ordem-servico';
import { Usuario, UsuarioEntrada } from '../models/usuario';

export interface FiltrosUsuario {
  perfil?: string;
  ativo?: '' | '0' | '1';
}

/**
 * Usuários. Consulta: ADMINISTRADOR e ATENDENTE (o atendente lista técnicos para atribuir OS).
 * Cadastro, edição e ativação: somente ADMINISTRADOR (a API confere).
 */
@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/usuarios`;

  /** Técnicos que podem ser atribuídos a uma OS. */
  listarTecnicosAtivos(): Observable<UsuarioResumo[]> {
    const params = new HttpParams().set('perfil', 'TECNICO').set('ativo', '1');
    return this.http.get<UsuarioResumo[]>(this.url, { params });
  }

  listar(filtros: FiltrosUsuario = {}): Observable<Usuario[]> {
    let params = new HttpParams();
    if (filtros.perfil) params = params.set('perfil', filtros.perfil);
    if (filtros.ativo) params = params.set('ativo', filtros.ativo);
    return this.http.get<Usuario[]>(this.url, { params });
  }

  criar(dados: UsuarioEntrada): Observable<{ mensagem: string; usuario: Usuario }> {
    return this.http.post<{ mensagem: string; usuario: Usuario }>(this.url, dados);
  }

  atualizar(id: number, dados: UsuarioEntrada): Observable<{ mensagem: string; usuario: Usuario }> {
    return this.http.put<{ mensagem: string; usuario: Usuario }>(`${this.url}/${id}`, dados);
  }

  alterarAtivo(id: number, ativo: boolean): Observable<{ mensagem: string; usuario: Usuario }> {
    return this.http.patch<{ mensagem: string; usuario: Usuario }>(`${this.url}/${id}/ativo`, { ativo });
  }
}
