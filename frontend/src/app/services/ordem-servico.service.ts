import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of, throwError } from 'rxjs';
import { API_BASE_URL } from '../config/api.config';
import { AcessorioRecebido, AcessorioRecebidoEntrada } from '../models/solicitacao';
import {
  Abatimento,
  AvaliacaoFinanceira,
  DecisaoOrcamento,
  EventoHistorico,
  Execucao,
  Expedicao,
  FiltrosOs,
  FormaEntrega,
  FormaPagamento,
  ItemOrcamento,
  Orcamento,
  OrdemServicoDetalhes,
  OrdemServicoResumo,
  Pagamento,
  PagamentosOs,
  RespostaEncerramento,
  StatusExpedicao,
  TipoEncerramento,
} from '../models/ordem-servico';

/** Dados editáveis da execução técnica (PATCH /:id/execucao). */
export interface DadosExecucao {
  diagnostico?: string;
  laudo_tecnico?: string | null;
  resultado?: string | null;
  data_conclusao?: string | null;
}

/**
 * Ordens de Serviço. O backend decide o que cada perfil vê e pode fazer:
 * o técnico recebe apenas as OS atribuídas a ele.
 */
@Injectable({ providedIn: 'root' })
export class OrdemServicoService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_BASE_URL);
  private readonly url = `${this.api}/ordens-servico`;

  listar(filtros: FiltrosOs = {}): Observable<OrdemServicoResumo[]> {
    let params = new HttpParams();
    const status = typeof filtros.status === 'string' ? filtros.status : (filtros.status ?? []).join(',');
    if (status) params = params.set('status', status);
    if (filtros.id_tecnico) params = params.set('id_tecnico', filtros.id_tecnico);
    if (filtros.sem_tecnico) params = params.set('sem_tecnico', 'true');
    if (filtros.busca?.trim()) params = params.set('busca', filtros.busca.trim());
    return this.http.get<OrdemServicoResumo[]>(this.url, { params });
  }

  buscarDetalhes(id: number): Observable<OrdemServicoDetalhes> {
    return this.http.get<OrdemServicoDetalhes>(`${this.url}/${id}`);
  }

  atribuirTecnico(id: number, idTecnico: number): Observable<{ mensagem: string; ordem: OrdemServicoDetalhes }> {
    return this.http.patch<{ mensagem: string; ordem: OrdemServicoDetalhes }>(`${this.url}/${id}/tecnico`, {
      id_tecnico: idTecnico,
    });
  }

  /** A API responde 404 quando ainda não há execução registrada: vira null. */
  buscarExecucao(id: number): Observable<Execucao | null> {
    return this.http.get<Execucao>(`${this.url}/${id}/execucao`).pipe(
      catchError((erro: unknown) =>
        erro instanceof HttpErrorResponse && erro.status === 404 ? of(null) : throwError(() => erro),
      ),
    );
  }

  listarOrcamentos(id: number): Observable<Orcamento[]> {
    return this.http.get<Orcamento[]>(`${this.url}/${id}/orcamentos`);
  }

  listarPagamentos(id: number): Observable<PagamentosOs> {
    return this.http.get<PagamentosOs>(`${this.url}/${id}/pagamentos`);
  }

  buscarExpedicao(id: number): Observable<Expedicao | null> {
    return this.http.get<Expedicao | null>(`${this.url}/${id}/expedicao`);
  }

  /** Eventos da OS em ordem cronológica (RN21). */
  listarHistorico(id: number): Observable<EventoHistorico[]> {
    return this.http.get<EventoHistorico[]>(`${this.url}/${id}/historico`);
  }

  // ---------- Diagnóstico, garantia e reparo (técnico atribuído) ----------

  registrarDiagnostico(id: number, diagnostico: string): Observable<{ mensagem: string; execucao: Execucao }> {
    return this.http.post<{ mensagem: string; execucao: Execucao }>(`${this.url}/${id}/execucao`, { diagnostico });
  }

  atualizarExecucao(id: number, dados: DadosExecucao): Observable<{ mensagem: string; execucao: Execucao }> {
    return this.http.patch<{ mensagem: string; execucao: Execucao }>(`${this.url}/${id}/execucao`, dados);
  }

  concluirReparo(id: number): Observable<unknown> {
    return this.http.patch(`${this.url}/${id}/execucao/concluir`, {});
  }

  definirGarantia(id: number, garantia: 'SIM' | 'NAO'): Observable<unknown> {
    return this.http.patch(`${this.url}/${id}/garantia`, { garantia_status: garantia });
  }

  // ---------- Orçamentos ----------

  emitirOrcamento(id: number, itens: ItemOrcamento[]): Observable<{ mensagem: string; orcamento: Orcamento }> {
    return this.http.post<{ mensagem: string; orcamento: Orcamento }>(`${this.url}/${id}/orcamentos`, { itens });
  }

  responderOrcamento(idOrcamento: number, decisao: DecisaoOrcamento, observacoes: string | null): Observable<unknown> {
    return this.http.patch(`${this.api}/orcamentos/${idOrcamento}/resposta`, { decisao, observacoes });
  }

  // ---------- Pagamentos ----------

  registrarPagamento(id: number, valor: number, forma: FormaPagamento): Observable<{ mensagem: string; pagamento: Pagamento }> {
    return this.http.post<{ mensagem: string; pagamento: Pagamento }>(`${this.url}/${id}/pagamentos`, {
      valor,
      forma_pagamento: forma,
    });
  }

  atualizarStatusPagamento(idPagamento: number, status: 'CONFIRMADO' | 'CANCELADO'): Observable<unknown> {
    return this.http.patch(`${this.api}/pagamentos/${idPagamento}/status`, { status });
  }

  /** Sem valor, a API devolve todo o valor ainda disponível do pagamento (D6). */
  reembolsarPagamento(idPagamento: number, justificativa: string, valor: number | null = null): Observable<unknown> {
    return this.http.patch(`${this.api}/pagamentos/${idPagamento}/reembolso`, {
      justificativa_reembolso: justificativa,
      ...(valor === null ? {} : { valor }),
    });
  }

  // ---------- Avaliação financeira (ADMINISTRADOR e ATENDENTE) ----------

  consultarAvaliacao(id: number): Observable<AvaliacaoFinanceira> {
    return this.http.get<AvaliacaoFinanceira>(`${this.url}/${id}/avaliacao-financeira`);
  }

  registrarAvaliacao(id: number, valorDefinido: number, justificativa: string): Observable<{ mensagem: string; avaliacao: AvaliacaoFinanceira }> {
    return this.http.post<{ mensagem: string; avaliacao: AvaliacaoFinanceira }>(`${this.url}/${id}/avaliacao-financeira`, {
      valor_definido: valorDefinido,
      justificativa,
    });
  }

  /** Correção: novo registro que preserva a avaliação anterior (D2). */
  revisarAvaliacao(
    id: number,
    dados: { id_avaliacao_revisada: number; valor_definido: number; justificativa: string; motivo_revisao: string },
  ): Observable<{ mensagem: string; avaliacao: AvaliacaoFinanceira }> {
    return this.http.post<{ mensagem: string; avaliacao: AvaliacaoFinanceira }>(`${this.url}/${id}/avaliacao-financeira/revisoes`, dados);
  }

  // ---------- Abatimentos (R1; somente ADMINISTRADOR e ATENDENTE) ----------

  listarAbatimentos(id: number): Observable<Abatimento[]> {
    return this.http.get<Abatimento[]>(`${this.url}/${id}/abatimentos`);
  }

  registrarAbatimento(id: number, valor: number, motivo: string): Observable<{ mensagem: string; abatimento: Abatimento }> {
    return this.http.post<{ mensagem: string; abatimento: Abatimento }>(`${this.url}/${id}/abatimentos`, { valor, motivo });
  }

  cancelarAbatimento(idAbatimento: number, justificativa: string): Observable<{ mensagem: string; abatimento: Abatimento }> {
    return this.http.patch<{ mensagem: string; abatimento: Abatimento }>(`${this.api}/abatimentos/${idAbatimento}/cancelamento`, { justificativa });
  }

  // ---------- Acessórios recebidos depois da abertura (D7) ----------

  registrarAcessorios(id: number, acessorios: AcessorioRecebidoEntrada[]): Observable<{ mensagem: string; registros: AcessorioRecebido | AcessorioRecebido[] }> {
    return this.http.post<{ mensagem: string; registros: AcessorioRecebido | AcessorioRecebido[] }>(`${this.url}/${id}/acessorios`, acessorios);
  }

  /** D7: alteração (sem exclusão); a API grava valores anteriores e novos no histórico. */
  alterarAcessorio(id: number, idAcessorioRecebido: number, dados: AcessorioRecebidoEntrada): Observable<{ mensagem: string; registro: AcessorioRecebido }> {
    return this.http.patch<{ mensagem: string; registro: AcessorioRecebido }>(`${this.url}/${id}/acessorios/${idAcessorioRecebido}`, dados);
  }

  // ---------- Expedição ----------

  registrarExpedicao(id: number, forma: FormaEntrega, codigoRastreio: string | null): Observable<unknown> {
    return this.http.post(`${this.url}/${id}/expedicao`, { forma_entrega: forma, codigo_rastreio: codigoRastreio });
  }

  atualizarExpedicao(id: number, status: StatusExpedicao, codigoRastreio: string | null): Observable<unknown> {
    return this.http.patch(`${this.api}/expedicoes/${id}/status`, { status, codigo_rastreio: codigoRastreio });
  }

  // ---------- Encerramento sem reparo ----------

  encerrarSemReparo(id: number, tipo: TipoEncerramento, motivo: string): Observable<RespostaEncerramento> {
    return this.http.patch<RespostaEncerramento>(`${this.url}/${id}/encerramento`, {
      tipo_encerramento: tipo,
      motivo_encerramento: motivo,
    });
  }
}
