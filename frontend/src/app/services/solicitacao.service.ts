import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { RespostaSolicitacao, SolicitacaoEntrada } from '../models/solicitacao';

/**
 * Abertura de solicitações (ADMINISTRADOR e ATENDENTE).
 * A consulta posterior é feita pelas Ordens de Serviço.
 */
@Injectable({ providedIn: 'root' })
export class SolicitacaoService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/solicitacoes`;

  criar(dados: SolicitacaoEntrada): Observable<RespostaSolicitacao> {
    return this.http.post<RespostaSolicitacao>(this.url, dados);
  }
}
