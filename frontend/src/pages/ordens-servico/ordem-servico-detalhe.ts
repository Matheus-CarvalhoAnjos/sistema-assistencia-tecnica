import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../app/auth/auth.service';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import {
  Abatimento,
  AvaliacaoFinanceira,
  EventoHistorico,
  Execucao,
  Expedicao,
  Orcamento,
  OrdemServicoDetalhes,
  PagamentosOs,
  STATUS_FINAIS,
  UsuarioResumo,
} from '../../app/models/ordem-servico';
import { OrdemServicoService } from '../../app/services/ordem-servico.service';
import { UsuarioService } from '../../app/services/usuario.service';
import { formatarData, formatarDataHora, formatarMoeda } from '../../app/utils/formatacao-data';
import { formatarTelefone } from '../../app/utils/formatacao';
import { StatusOs } from '../../components/status-os/status-os';
import { SecaoAbatimentos } from './secoes/secao-abatimentos';
import { SecaoAcessorios } from './secoes/secao-acessorios';
import { SecaoAvaliacaoFinanceira } from './secoes/secao-avaliacao-financeira';
import { ROTULOS_ENCERRAMENTO, SecaoEncerramento } from './secoes/secao-encerramento';
import { SecaoExecucao } from './secoes/secao-execucao';
import { SecaoExpedicao } from './secoes/secao-expedicao';
import { SecaoGarantia } from './secoes/secao-garantia';
import { SecaoHistorico } from './secoes/secao-historico';
import { SecaoOrcamentos } from './secoes/secao-orcamentos';
import { SecaoPagamentos } from './secoes/secao-pagamentos';

export interface EventoLinhaTempo {
  data: string;
  titulo: string;
  detalhe?: string;
}

const ROTULOS_GARANTIA: Record<string, string> = {
  PENDENTE: 'Pendente de verificação',
  SIM: 'Em garantia',
  NAO: 'Fora da garantia',
};

/**
 * Linha do tempo montada a partir dos registros existentes. Usada só para OS sem
 * eventos gravados em HISTORICO_OS (abertas antes do histórico); não gera eventos retroativos.
 */
export function montarLinhaTempo(
  ordem: OrdemServicoDetalhes,
  execucao: Execucao | null,
  orcamentos: Orcamento[],
  pagamentos: PagamentosOs | null,
  expedicao: Expedicao | null,
): EventoLinhaTempo[] {
  const eventos: EventoLinhaTempo[] = [{ data: ordem.data_abertura, titulo: 'Ordem de Serviço aberta' }];

  if (execucao?.data_inicio) {
    eventos.push({ data: execucao.data_inicio, titulo: 'Análise técnica iniciada', detalhe: execucao.diagnostico });
  }
  if (execucao?.data_conclusao) {
    eventos.push({ data: execucao.data_conclusao, titulo: 'Execução concluída', detalhe: execucao.resultado ?? undefined });
  }
  for (const orcamento of orcamentos) {
    eventos.push({
      data: orcamento.data_emissao,
      titulo: `Orçamento nº ${orcamento.id_orcamento} emitido`,
      detalhe: `${formatarMoeda(orcamento.valor_total)} · válido até ${formatarData(orcamento.data_validade)}`,
    });
    if (orcamento.resposta) {
      eventos.push({
        data: orcamento.resposta.data_resposta,
        titulo: `Orçamento nº ${orcamento.id_orcamento} ${orcamento.resposta.decisao === 'APROVADO' ? 'aprovado' : 'rejeitado'} pelo cliente`,
        detalhe: orcamento.resposta.observacoes ?? undefined,
      });
    }
  }
  // Pagamento pendente ainda não tem data (data_pagamento é gravada na confirmação)
  for (const pagamento of pagamentos?.pagamentos ?? []) {
    if (pagamento.data_pagamento) {
      eventos.push({
        data: pagamento.data_pagamento,
        titulo: `Pagamento de ${formatarMoeda(pagamento.valor)}`,
        detalhe: pagamento.forma_pagamento,
      });
    }
    if (pagamento.data_reembolso) {
      eventos.push({
        data: pagamento.data_reembolso,
        titulo: `Pagamento de ${formatarMoeda(pagamento.valor)} reembolsado`,
        detalhe: pagamento.justificativa_reembolso ?? undefined,
      });
    }
  }
  if (expedicao?.data_envio) {
    eventos.push({
      data: expedicao.data_envio,
      titulo: 'Equipamento despachado',
      detalhe: expedicao.codigo_rastreio ? `rastreio ${expedicao.codigo_rastreio}` : undefined,
    });
  }
  if (expedicao?.data_entrega) {
    eventos.push({
      data: expedicao.data_entrega,
      titulo: expedicao.forma_entrega === 'RETIRADA' ? 'Equipamento retirado pelo cliente' : 'Equipamento entregue',
    });
  }
  if (ordem.data_encerramento) {
    eventos.push({
      data: ordem.data_encerramento,
      titulo: 'Ordem de Serviço encerrada',
      detalhe: ordem.motivo_encerramento ?? undefined,
    });
  }

  return eventos.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
}

/**
 * Detalhes da OS: ambiente de trabalho do técnico e dos funcionários.
 * O acesso é decidido pelo backend (o técnico só abre as suas); as seções
 * mostram cada ação apenas ao perfil e na etapa permitidos e a API confere de novo.
 */
@Component({
  selector: 'app-ordem-servico-detalhe',
  imports: [
    RouterLink,
    StatusOs,
    SecaoExecucao,
    SecaoGarantia,
    SecaoOrcamentos,
    SecaoPagamentos,
    SecaoExpedicao,
    SecaoHistorico,
    SecaoEncerramento,
    SecaoAvaliacaoFinanceira,
    SecaoAcessorios,
    SecaoAbatimentos,
  ],
  templateUrl: './ordem-servico-detalhe.html',
  styleUrls: ['../compartilhado/pagina.css', './ordem-servico-detalhe.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdemServicoDetalhePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly ordemServicoService = inject(OrdemServicoService);
  private readonly usuarioService = inject(UsuarioService);

  /** Parâmetro de rota :id. */
  readonly id = input.required<string>();

  readonly podeAtribuir = computed(() => this.auth.possuiPerfil('ADMINISTRADOR', 'ATENDENTE'));
  /** ADMINISTRADOR ou ATENDENTE: pagamentos, expedição, resposta de orçamento. */
  readonly ehFuncionario = this.podeAtribuir;
  readonly ehTecnico = computed(() => this.auth.possuiPerfil('TECNICO'));
  readonly ehAdministrador = computed(() => this.auth.possuiPerfil('ADMINISTRADOR'));
  readonly rotulosEncerramento = ROTULOS_ENCERRAMENTO;
  readonly formatarData = formatarData;
  readonly formatarDataHora = formatarDataHora;
  readonly formatarMoeda = formatarMoeda;
  readonly formatarTelefone = formatarTelefone;

  readonly ordem = signal<OrdemServicoDetalhes | null>(null);
  readonly carregando = signal(true);
  readonly naoEncontrada = signal(false);
  readonly erro = signal<string | null>(null);

  readonly execucao = signal<Execucao | null>(null);
  readonly orcamentos = signal<Orcamento[]>([]);
  readonly pagamentos = signal<PagamentosOs | null>(null);
  readonly expedicao = signal<Expedicao | null>(null);
  readonly historico = signal<EventoHistorico[] | null>(null);
  /** Avaliação financeira (D1): carregada só para ADM/ATD em OS encerrada por impossibilidade técnica. */
  readonly avaliacao = signal<AvaliacaoFinanceira | null>(null);
  /** R1: abatimentos (somente ADMINISTRADOR e ATENDENTE). */
  readonly abatimentos = signal<Abatimento[] | null>(null);
  readonly carregandoComplementos = signal(true);
  readonly erroComplementos = signal(false);
  readonly erroHistorico = signal(false);

  readonly tecnicos = signal<UsuarioResumo[]>([]);
  readonly tecnicoEscolhido = signal<number | null>(null);
  readonly atribuindo = signal(false);
  readonly mensagemAtribuicao = signal<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  /** D7: ADMINISTRADOR, ATENDENTE ou o técnico atribuído registram acessórios (a etapa é conferida na seção). */
  readonly podeRegistrarAcessorio = computed(() => {
    if (this.ehFuncionario()) return true;
    const tecnico = this.ordem()?.tecnico;
    return this.ehTecnico() && !!tecnico && tecnico.id_usuario === this.auth.usuario()?.id_usuario;
  });

  readonly encerrada = computed(() => {
    const ordem = this.ordem();
    return !!ordem && STATUS_FINAIS.includes(ordem.status);
  });

  /** Nomes de técnicos conhecidos pela página (atual e lista de atribuição), para o histórico. */
  readonly nomesUsuarios = computed<Readonly<Record<number, string>>>(() => {
    const mapa: Record<number, string> = {};
    for (const t of this.tecnicos()) mapa[t.id_usuario] = t.nome;
    const atual = this.ordem()?.tecnico;
    if (atual) mapa[atual.id_usuario] = atual.nome;
    return mapa;
  });

  readonly linhaTempo = computed(() => {
    const ordem = this.ordem();
    return ordem
      ? montarLinhaTempo(ordem, this.execucao(), this.orcamentos(), this.pagamentos(), this.expedicao())
      : [];
  });

  ngOnInit(): void {
    this.carregar();
  }

  rotuloGarantia(status: string): string {
    return ROTULOS_GARANTIA[status] ?? status;
  }

  /** Recarrega os dados depois de uma ação, sem esconder a página. */
  atualizar(): void {
    const id = Number(this.id());
    this.ordemServicoService.buscarDetalhes(id).subscribe({
      next: (ordem) => {
        this.ordem.set(ordem);
        this.carregarComplementos(id);
      },
      error: (erro: unknown) => this.erro.set(mensagemDeErro(erro)),
    });
  }

  carregar(): void {
    const id = Number(this.id());
    this.carregando.set(true);
    this.erro.set(null);
    this.naoEncontrada.set(false);

    if (!Number.isInteger(id) || id <= 0) {
      this.naoEncontrada.set(true);
      this.carregando.set(false);
      return;
    }

    this.ordemServicoService.buscarDetalhes(id).subscribe({
      next: (ordem) => {
        this.ordem.set(ordem);
        this.tecnicoEscolhido.set(ordem.tecnico?.ativo ? ordem.tecnico.id_usuario : null);
        this.carregando.set(false);
        this.carregarComplementos(id);
        if (this.podeAtribuir()) {
          this.carregarTecnicos();
        }
      },
      error: (erro: unknown) => {
        // 404 também para OS de outro técnico: a API não revela se ela existe
        if (erro instanceof HttpErrorResponse && (erro.status === 404 || erro.status === 400)) {
          this.naoEncontrada.set(true);
        } else {
          this.erro.set(mensagemDeErro(erro));
        }
        this.carregando.set(false);
      },
    });
  }

  aoEscolherTecnico(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.tecnicoEscolhido.set(valor ? Number(valor) : null);
  }

  atribuir(): void {
    const ordem = this.ordem();
    const idTecnico = this.tecnicoEscolhido();
    if (!ordem || !idTecnico || this.atribuindo()) {
      return;
    }

    this.atribuindo.set(true);
    this.mensagemAtribuicao.set(null);
    this.ordemServicoService.atribuirTecnico(ordem.id_os, idTecnico).subscribe({
      next: (resposta) => {
        this.ordem.set(resposta.ordem);
        this.atribuindo.set(false);
        this.mensagemAtribuicao.set({ tipo: 'sucesso', texto: `Técnico ${resposta.ordem.tecnico?.nome ?? ''} atribuído.` });
      },
      error: (erro: unknown) => {
        this.atribuindo.set(false);
        this.mensagemAtribuicao.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }

  private carregarComplementos(id: number): void {
    // Uma falha em um complemento não impede os demais nem os dados principais
    const marcarFalha = () => this.erroComplementos.set(true);
    this.erroComplementos.set(false);
    this.erroHistorico.set(false);

    forkJoin({
      execucao: this.ordemServicoService
        .buscarExecucao(id)
        .pipe(catchError(() => (marcarFalha(), of<Execucao | null>(null)))),
      orcamentos: this.ordemServicoService
        .listarOrcamentos(id)
        .pipe(catchError(() => (marcarFalha(), of<Orcamento[]>([])))),
      // Pagamentos: somente ADMINISTRADOR e ATENDENTE (o técnico não acessa dados financeiros)
      pagamentos: this.ehFuncionario()
        ? this.ordemServicoService.listarPagamentos(id).pipe(catchError(() => (marcarFalha(), of<PagamentosOs | null>(null))))
        : of<PagamentosOs | null>(null),
      expedicao: this.ordemServicoService
        .buscarExpedicao(id)
        .pipe(catchError(() => (marcarFalha(), of<Expedicao | null>(null)))),
      historico: this.ordemServicoService
        .listarHistorico(id)
        .pipe(catchError(() => (this.erroHistorico.set(true), of<EventoHistorico[] | null>(null)))),
      avaliacao:
        this.ehFuncionario() && this.ordem()?.tipo_encerramento === 'IMPOSSIBILIDADE_TECNICA'
          ? this.ordemServicoService.consultarAvaliacao(id).pipe(catchError(() => (marcarFalha(), of<AvaliacaoFinanceira | null>(null))))
          : of<AvaliacaoFinanceira | null>(null),
      abatimentos: this.ehFuncionario()
        ? this.ordemServicoService.listarAbatimentos(id).pipe(catchError(() => (marcarFalha(), of<Abatimento[] | null>(null))))
        : of<Abatimento[] | null>(null),
    }).subscribe((dados) => {
      this.execucao.set(dados.execucao);
      this.orcamentos.set(dados.orcamentos);
      this.pagamentos.set(dados.pagamentos);
      this.expedicao.set(dados.expedicao);
      this.historico.set(dados.historico);
      this.avaliacao.set(dados.avaliacao);
      this.abatimentos.set(dados.abatimentos);
      this.carregandoComplementos.set(false);
    });
  }

  private carregarTecnicos(): void {
    this.usuarioService.listarTecnicosAtivos().subscribe({
      next: (tecnicos) => this.tecnicos.set(tecnicos),
      error: () => this.tecnicos.set([]),
    });
  }
}
