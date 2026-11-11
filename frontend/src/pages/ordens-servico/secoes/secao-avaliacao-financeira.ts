import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { AvaliacaoFinanceira, OrdemServicoDetalhes } from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { formatarDataHora, formatarMoeda } from '../../../app/utils/formatacao-data';
import { Mensagem, MensagemAcao } from './mensagem-acao';

type Modo = 'ORIGINAL' | 'REVISAO';

/**
 * Avaliação financeira (D1–D4): obrigatória quando a OS foi encerrada por impossibilidade
 * técnica durante o reparo com pagamento confirmado. Somente ADMINISTRADOR e ATENDENTE
 * (o componente só é usado para esses perfis e a API confere).
 * Nenhum registro é editado: a correção gera uma revisão que preserva os anteriores.
 */
@Component({
  selector: 'app-secao-avaliacao-financeira',
  imports: [ReactiveFormsModule, MensagemAcao],
  templateUrl: './secao-avaliacao-financeira.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoAvaliacaoFinanceira {
  private readonly servico = inject(OrdemServicoService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly avaliacao = input<AvaliacaoFinanceira | null>(null);
  readonly alterado = output<void>();

  readonly formatarMoeda = formatarMoeda;
  readonly formatarDataHora = formatarDataHora;
  readonly modo = signal<Modo | null>(null);
  readonly confirmando = signal(false);
  readonly enviando = signal(false);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly form = this.fb.group({
    valor_definido: [0, [Validators.required, Validators.min(0)]],
    justificativa: ['', Validators.required],
    motivo_revisao: [''],
  });

  readonly vigente = computed(() => this.avaliacao()?.vigente ?? null);

  /** Faixa permitida: do que já foi reembolsado sob avaliação até isso + o disponível (mesma regra da API). */
  readonly minimo = computed(() => (this.modo() === 'REVISAO' ? this.avaliacao()?.total_reembolsado_avaliacao ?? 0 : 0));
  readonly maximo = computed(() => {
    const a = this.avaliacao();
    if (!a) return 0;
    return Math.round((a.total_disponivel + (this.modo() === 'REVISAO' ? a.total_reembolsado_avaliacao : 0)) * 100) / 100;
  });

  rotulo(tipo: string, revisada: number | null): string {
    return tipo === 'REVISAO' ? `Revisão da avaliação nº ${revisada}` : 'Avaliação original';
  }

  abrir(modo: Modo): void {
    const atual = this.vigente();
    this.form.reset({
      valor_definido: modo === 'REVISAO' && atual ? atual.valor_definido : 0,
      justificativa: '',
      motivo_revisao: '',
    });
    this.form.controls.motivo_revisao.setValidators(modo === 'REVISAO' ? [Validators.required] : []);
    this.form.controls.motivo_revisao.updateValueAndValidity();
    this.mensagem.set(null);
    this.confirmando.set(false);
    this.modo.set(modo);
  }

  fechar(): void {
    this.modo.set(null);
    this.confirmando.set(false);
  }

  /** Primeiro passo: valida e pede confirmação (o registro não pode ser editado depois). */
  revisar(): void {
    const v = this.form.getRawValue();
    const valor = Number(v.valor_definido);
    const foraDaFaixa = !Number.isFinite(valor) || valor < this.minimo() || valor > this.maximo() ||
      Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6;

    if (this.form.invalid || foraDaFaixa || !v.justificativa.trim() || (this.modo() === 'REVISAO' && !v.motivo_revisao.trim())) {
      this.form.markAllAsTouched();
      this.mensagem.set({
        tipo: 'erro',
        texto: foraDaFaixa
          ? `Informe um valor entre ${formatarMoeda(this.minimo())} e ${formatarMoeda(this.maximo())}.`
          : this.modo() === 'REVISAO'
            ? 'Informe a justificativa e o motivo da revisão.'
            : 'Informe a justificativa.',
      });
      return;
    }
    this.mensagem.set(null);
    this.confirmando.set(true);
  }

  confirmar(): void {
    const v = this.form.getRawValue();
    const valor = Math.round(Number(v.valor_definido) * 100) / 100;
    const id = this.ordem().id_os;
    const atual = this.vigente();
    const requisicao = this.modo() === 'REVISAO' && atual
      ? this.servico.revisarAvaliacao(id, {
          id_avaliacao_revisada: atual.id_avaliacao,
          valor_definido: valor,
          justificativa: v.justificativa.trim(),
          motivo_revisao: v.motivo_revisao.trim(),
        })
      : this.servico.registrarAvaliacao(id, valor, v.justificativa.trim());

    this.enviando.set(true);
    requisicao.subscribe({
      next: (resposta) => {
        this.enviando.set(false);
        this.fechar();
        this.mensagem.set({ tipo: 'sucesso', texto: resposta.mensagem });
        this.alterado.emit();
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.confirmando.set(false);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }
}
