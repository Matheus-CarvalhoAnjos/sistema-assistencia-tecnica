import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { Cliente, ClienteEntrada, RespostaCliente } from '../models/cliente';

/** Acesso à API de clientes (ADMINISTRADOR e ATENDENTE). */
@Injectable({ providedIn: 'root' })
export class ClienteService {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/clientes`;

  /** Lista os clientes; `busca` filtra por nome ou CPF/CNPJ no servidor. */
  listar(busca = ''): Observable<Cliente[]> {
    const termo = busca.trim();
    const params = termo ? new HttpParams().set('busca', termo) : undefined;
    return this.http.get<Cliente[]>(this.url, { params });
  }

  buscarPorId(id: number): Observable<Cliente> {
    return this.http.get<Cliente>(`${this.url}/${id}`);
  }

  criar(dados: ClienteEntrada): Observable<RespostaCliente> {
    return this.http.post<RespostaCliente>(this.url, dados);
  }

  atualizar(id: number, dados: ClienteEntrada): Observable<RespostaCliente> {
    return this.http.put<RespostaCliente>(`${this.url}/${id}`, dados);
  }
}
