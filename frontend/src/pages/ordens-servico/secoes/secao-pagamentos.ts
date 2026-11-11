import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { FORMAS_PAGAMENTO, FormaPagamento, OrdemServicoDetalhes, Pagamento, PagamentosOs } from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { formatarDataHora, formatarMoeda } from '../../../app/utils/formatacao-data';
import { Mensagem, MensagemAcao } from './mensagem-acao';

const ROTULOS_STATUS: Readonly<Record<string, { titulo: string; tom: string }>> = {
  PENDENTE: { titulo: 'Pendente', tom: 'alerta' },
  CONFIRMADO: { titulo: 'Confirmado', tom: 'verde' },
  CANCELADO: { titulo: 'Cancelado', tom: 'neutro' },
  REEMBOLSADO: { titulo: 'Reembolsado', tom: 'neutro' },
};

const ETAPAS_PAGAMENTO = ['EM_REPARO', 'CONCLUIDA', 'AGUARDANDO_EXPEDICAO'];

type AcaoPagamento = { id: number; tipo: 'CONFIRMADO' | 'CANCELADO' | 'REEMBOLSO' };

/**
 * Pagamentos da OS (RN14–RN16). Os totais vêm da API (saldo não é armazenado).
 * Registrar, confirmar, cancelar e reembolsar: ADMINISTRADOR e ATENDENTE.
 * Reembolso parcial ou integral, limitado ao valor ainda disponível do pagamento (D6).
 */
@Component({
  selector: 'app-secao-pagamentos',
  imports: [ReactiveFormsModule, MensagemAcao],
  templateUrl: './secao-pagamentos.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoPagamentos {
  private readonly servico = inject(OrdemServicoService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly dados = input<PagamentosOs | null>(null);
  readonly podeOperar = input(false);
  /** D1: OS que exige avaliação financeira ainda não registrada (reembolso bloqueado). */
  readonly avaliacaoPendente = input(false);
  /** D1/D6: quanto a avaliação financeira vigente ainda permite devolver (null = OS sem avaliação). */
  readonly limiteAvaliacao = input<number | null>(null);
  readonly alterado = output<void>();

  readonly formas = FORMAS_PAGAMENTO;
  readonly formatarMoeda = formatarMoeda;
  readonly formatarDataHora = formatarDataHora;
  readonly enviando = signal(false);
  readonly registrando = signal(false);
  readonly acao = signal<AcaoPagamento | null>(null);
  readonly justificativa = signal('');
  /** Valor do reembolso em edição (D6: parcial permitido). */
  readonly valorReembolso = signal<number | null>(null);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly form = this.fb.group({
    valor: [0, [Validators.required, Validators.min(0.01)]],
    forma_pagamento: ['PIX' as FormaPagamento, Validators.required],
  });

  readonly resumo = computed(() => this.dados()?.resumo ?? null);
  readonly pagamentos = computed(() => this.dados()?.pagamentos ?? []);

  /** Valor que ainda pode ser registrado: saldo menos o que já está pendente (mesma regra da API). */
  readonly disponivel = computed(() => {
    const r = this.resumo();
    if (!r) return 0;
    return Math.max(0, Math.round((r.saldo_devedor - r.pagamentos_pendentes) * 100) / 100);
  });

  readonly podeRegistrar = computed(
    () =>
      this.podeOperar() &&
      ETAPAS_PAGAMENTO.includes(this.ordem().status) &&
      !!this.resumo()?.tem_orcamento_aprovado &&
      this.disponivel() > 0,
  );

  /** U3: etapa permite pagamento, mas não há valor a registrar (saldo quitado ou reservado por pendentes). */
  readonly semValorParaRegistro = computed<'quitado' | 'reservado' | null>(() => {
    const r = this.resumo();
    if (!r || !this.podeOperar() || !ETAPAS_PAGAMENTO.includes(this.ordem().status) || !r.tem_orcamento_aprovado) return null;
    if (this.disponivel() > 0) return null;
    return r.saldo_devedor <= 0 ? 'quitado' : 'reservado';
  });

  readonly encerradaSemReparo = computed(() => this.ordem().status === 'ENCERRADA_SEM_REPARO');

  rotuloStatus(status: string): { titulo: string; tom: string } {
    return ROTULOS_STATUS[status] ?? { titulo: status, tom: 'neutro' };
  }

  rotuloForma(forma: string): string {
    return this.formas.find((f) => f.codigo === forma)?.titulo ?? forma;
  }

  abrirRegistro(): void {
    this.form.reset({ valor: this.disponivel(), forma_pagamento: 'PIX' });
    this.form.controls.valor.setValidators([Validators.required, Validators.min(0.01), Validators.max(this.disponivel())]);
    this.form.controls.valor.updateValueAndValidity();
    this.mensagem.set(null);
    this.registrando.set(true);
  }

  registrar(): void {
    if (this.form.invalid || this.enviando()) {
      this.form.markAllAsTouched();
      return;
    }
    const { valor, forma_pagamento } = this.form.getRawValue();
    this.executar(
      this.servico.registrarPagamento(this.ordem().id_os, Number(valor), forma_pagamento),
      'Pagamento registrado como pendente. Confirme-o quando for recebido.',
      () => this.registrando.set(false),
    );
  }

  pedirAcao(pagamento: Pagamento, tipo: AcaoPagamento['tipo']): void {
    this.mensagem.set(null);
    this.justificativa.set('');
    this.valorReembolso.set(tipo === 'REEMBOLSO' ? this.disponivelReembolso(pagamento) : null);
    this.acao.set({ id: pagamento.id_pagamento, tipo });
  }

  /**
   * Quanto ainda pode ser devolvido do pagamento (a API devolve o cálculo), limitado ao que a
   * avaliação financeira vigente ainda permite, quando a OS tem avaliação.
   */
  disponivelReembolso(pagamento: Pagamento): number {
    const doPagamento = pagamento.valor_disponivel_reembolso ?? (pagamento.status === 'CONFIRMADO' ? Number(pagamento.valor) : 0);
    const limite = this.limiteAvaliacao();
    return limite === null ? doPagamento : Math.min(doPagamento, limite);
  }

  reembolsoParcial(pagamento: Pagamento): boolean {
    return pagamento.status === 'CONFIRMADO' && (pagamento.valor_reembolsado ?? 0) > 0;
  }

  confirmarAcao(): void {
    const acao = this.acao();
    if (!acao) return;

    if (acao.tipo === 'REEMBOLSO') {
      const pagamento = this.pagamentos().find((p) => p.id_pagamento === acao.id);
      const limite = Math.round((pagamento ? this.disponivelReembolso(pagamento) : 0) * 100);
      const valor = Number(this.valorReembolso());
      const centavos = Math.round(valor * 100);
      if (!Number.isFinite(valor) || valor <= 0 || Math.abs(valor * 100 - centavos) > 1e-6 || centavos > limite) {
        this.mensagem.set({ tipo: 'erro', texto: 'Informe um valor entre R$ 0,01 e ' + formatarMoeda(limite / 100) + '.' });
        return;
      }
      const texto = this.justificativa().trim();
      if (!texto) {
        this.mensagem.set({ tipo: 'erro', texto: 'Informe a justificativa do reembolso.' });
        return;
      }
      this.executar(
        this.servico.reembolsarPagamento(acao.id, texto, centavos / 100),
        centavos === limite ? 'Reembolso registrado.' : 'Reembolso parcial registrado.',
        () => this.acao.set(null),
      );
      return;
    }

    this.executar(
      this.servico.atualizarStatusPagamento(acao.id, acao.tipo),
      acao.tipo === 'CONFIRMADO' ? 'Pagamento confirmado.' : 'Pagamento cancelado.',
      () => this.acao.set(null),
    );
  }

  valorInvalido(): boolean {
    const c = this.form.controls.valor;
    return c.invalid && c.touched;
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
