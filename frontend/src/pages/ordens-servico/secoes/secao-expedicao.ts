import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import {
  Expedicao,
  FormaEntrega,
  OrdemServicoDetalhes,
  PROXIMO_STATUS_EXPEDICAO,
  ROTULOS_STATUS_EXPEDICAO,
  StatusExpedicao,
} from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { formatarDataHora, formatarMoeda } from '../../../app/utils/formatacao-data';
import { Mensagem, MensagemAcao } from './mensagem-acao';

const ACAO_PROXIMO_STATUS: Readonly<Record<string, string>> = {
  EM_TRANSITO: 'Marcar como despachado',
  ENTREGUE: 'Confirmar entrega',
  RETIRADO: 'Confirmar retirada pelo cliente',
};

/**
 * Expedição/devolução (RN18–RN20), gerenciada por ADMINISTRADOR e ATENDENTE.
 * ENVIO: PENDENTE → EM_TRANSITO → ENTREGUE. RETIRADA: AGUARDANDO_RETIRADA → RETIRADO.
 */
@Component({
  selector: 'app-secao-expedicao',
  imports: [MensagemAcao],
  templateUrl: './secao-expedicao.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoExpedicao {
  private readonly servico = inject(OrdemServicoService);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly expedicao = input<Expedicao | null>(null);
  readonly saldoDevedor = input(0);
  readonly podeOperar = input(false);
  /**
   * Q1: avaliação financeira pendente NÃO bloqueia a devolução física; só gera aviso para ADM/ATD.
   * O fluxo de devolução e o da avaliação financeira são independentes.
   */
  readonly avaliacaoPendente = input(false);
  readonly alterado = output<void>();

  readonly rotulos = ROTULOS_STATUS_EXPEDICAO;
  readonly formatarDataHora = formatarDataHora;
  readonly formatarMoeda = formatarMoeda;
  readonly enviando = signal(false);
  readonly registrando = signal(false);
  readonly confirmando = signal(false);
  readonly forma = signal<FormaEntrega>('RETIRADA');
  readonly rastreio = signal('');
  readonly mensagem = signal<Mensagem | null>(null);

  /** Registro permitido: OS concluída (com quitação) ou encerrada sem reparo, ainda sem expedição. */
  readonly podeRegistrar = computed(
    () => this.podeOperar() && !this.expedicao() && ['CONCLUIDA', 'ENCERRADA_SEM_REPARO'].includes(this.ordem().status),
  );

  readonly exigeQuitacao = computed(() => this.ordem().status === 'CONCLUIDA' && this.saldoDevedor() > 0);

  readonly proximoStatus = computed<StatusExpedicao | null>(() => {
    const e = this.expedicao();
    if (!e?.forma_entrega) return null;
    return PROXIMO_STATUS_EXPEDICAO[e.forma_entrega as FormaEntrega]?.[e.status as StatusExpedicao] ?? null;
  });

  rotuloStatus(status: string): string {
    return this.rotulos[status] || status;
  }

  rotuloAcao(status: StatusExpedicao): string {
    return ACAO_PROXIMO_STATUS[status] ?? status;
  }

  abrirRegistro(): void {
    this.forma.set('RETIRADA');
    this.rastreio.set('');
    this.mensagem.set(null);
    this.registrando.set(true);
  }

  registrar(): void {
    const forma = this.forma();
    const rastreio = forma === 'ENVIO' ? this.rastreio().trim() || null : null;
    this.executar(this.servico.registrarExpedicao(this.ordem().id_os, forma, rastreio), 'Devolução registrada.', () =>
      this.registrando.set(false),
    );
  }

  avancar(): void {
    const proximo = this.proximoStatus();
    if (!proximo) return;
    const rastreio = proximo === 'EM_TRANSITO' ? this.rastreio().trim() || null : null;
    const sucesso = proximo === 'EM_TRANSITO' ? 'Envio despachado.' : 'Devolução concluída.';
    this.executar(this.servico.atualizarExpedicao(this.ordem().id_os, proximo, rastreio), sucesso, () => {
      this.confirmando.set(false);
      this.rastreio.set('');
    });
  }

  private executar(requisicao: ReturnType<OrdemServicoService['concluirReparo']>, sucesso: string, aoConcluir: () => void): void {
    this.enviando.set(true);
    this.mensagem.set(null);
    requisicao.subscribe({
      next: () => {
        this.enviando.set(false);
        aoConcluir();
        this.mensagem.set({ tipo: 'sucesso', texto: sucesso });
        this.alterado.emit();
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }
}
