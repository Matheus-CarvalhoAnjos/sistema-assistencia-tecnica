import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { Acessorio } from '../models/solicitacao';

export interface AcessorioEntrada {
  descricao: string;
  preco_atual: number | null;
}

export interface RespostaAcessorio {
  mensagem: string;
  acessorio: Acessorio;
}

/** Catálogo de acessórios. */
@Injectable({ providedIn: 'root' })
export class AcessorioService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/acessorios`;

  /** Acessórios ativos (a API já filtra os inativos). */
  listarAtivos(): Observable<Acessorio[]> {
    return this.http.get<Acessorio[]>(this.url);
  }

  /** Cadastro (ADMINISTRADOR e ATENDENTE). */
  criar(dados: AcessorioEntrada): Observable<RespostaAcessorio> {
    return this.http.post<RespostaAcessorio>(this.url, dados);
  }
}
