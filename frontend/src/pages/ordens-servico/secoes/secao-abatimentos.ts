import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { Abatimento, OrdemServicoDetalhes, PagamentosOs } from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { formatarDataHora, formatarMoeda } from '../../../app/utils/formatacao-data';
import { Mensagem, MensagemAcao } from './mensagem-acao';

/** A3: etapas em que o abatimento pode ser registrado ou cancelado. */
export const ETAPAS_ABATIMENTO = ['EM_REPARO', 'CONCLUIDA', 'AGUARDANDO_EXPEDICAO'];

/**
 * Abatimento formal (R1): reduz o total devido sem alterar o orçamento aprovado e é separado
 * do reembolso. Somente ADMINISTRADOR e ATENDENTE (a página só usa este componente para esses
 * perfis; a API confere). Nasce APROVADO (A1); cancelamento com justificativa preserva o registro (A5).
 */
@Component({
  selector: 'app-secao-abatimentos',
  imports: [MensagemAcao],
  templateUrl: './secao-abatimentos.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoAbatimentos {
  private readonly servico = inject(OrdemServicoService);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly abatimentos = input<Abatimento[] | null>(null);
  readonly resumo = input<PagamentosOs['resumo'] | null>(null);
  readonly alterado = output<void>();

  readonly formatarMoeda = formatarMoeda;
  readonly formatarDataHora = formatarDataHora;
  readonly registrando = signal(false);
  readonly confirmando = signal(false);
  readonly cancelando = signal<number | null>(null);
  readonly valor = signal<number | null>(null);
  readonly motivo = signal('');
  readonly justificativa = signal('');
  readonly enviando = signal(false);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly lista = computed(() => this.abatimentos() ?? []);
  readonly visivel = computed(() => !!this.resumo()?.tem_orcamento_aprovado || this.lista().length > 0);
  readonly podeOperar = computed(() => !!this.resumo()?.tem_orcamento_aprovado && ETAPAS_ABATIMENTO.includes(this.ordem().status));

  /** A4: total devido − total pago − pagamentos pendentes (mesma regra da API). */
  readonly disponivel = computed(() => {
    const r = this.resumo();
    return r ? Math.max(0, Math.round((r.saldo_devedor - r.pagamentos_pendentes) * 100) / 100) : 0;
  });

  /** U3: etapa permite abatimento, mas não há valor disponível (saldo quitado ou reservado por pendentes). */
  readonly semValorParaAbatimento = computed<'quitado' | 'reservado' | null>(() => {
    const r = this.resumo();
    if (!r || !this.podeOperar() || this.disponivel() > 0) return null;
    return r.saldo_devedor <= 0 ? 'quitado' : 'reservado';
  });

  abrir(): void {
    this.valor.set(null);
    this.motivo.set('');
    this.confirmando.set(false);
    this.cancelando.set(null);
    this.mensagem.set(null);
    this.registrando.set(true);
  }

  continuar(): void {
    const valor = Number(this.valor());
    const centavos = Math.round(valor * 100);
    const limite = Math.round(this.disponivel() * 100);
    if (!Number.isFinite(valor) || valor <= 0 || Math.abs(valor * 100 - centavos) > 1e-6 || centavos > limite) {
      this.mensagem.set({ tipo: 'erro', texto: `Informe um valor entre R$ 0,01 e ${formatarMoeda(this.disponivel())}.` });
      return;
    }
    if (!this.motivo().trim()) {
      this.mensagem.set({ tipo: 'erro', texto: 'Informe o motivo do abatimento.' });
      return;
    }
    this.mensagem.set(null);
    this.confirmando.set(true);
  }

  registrar(): void {
    this.executar(
      this.servico.registrarAbatimento(this.ordem().id_os, Math.round(Number(this.valor()) * 100) / 100, this.motivo().trim()),
      'Abatimento registrado.',
      () => {
        this.registrando.set(false);
        this.confirmando.set(false);
      },
    );
  }

  pedirCancelamento(abatimento: Abatimento): void {
    this.registrando.set(false);
    this.justificativa.set('');
    this.mensagem.set(null);
    this.cancelando.set(abatimento.id_abatimento);
  }

  cancelar(abatimento: Abatimento): void {
    const texto = this.justificativa().trim();
    if (!texto) {
      this.mensagem.set({ tipo: 'erro', texto: 'Informe a justificativa do cancelamento.' });
      return;
    }
    this.executar(this.servico.cancelarAbatimento(abatimento.id_abatimento, texto), 'Abatimento cancelado.', () =>
      this.cancelando.set(null),
    );
  }

  private executar(requisicao: ReturnType<OrdemServicoService['cancelarAbatimento']>, sucesso: string, aoConcluir: () => void): void {
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
        this.confirmando.set(false);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }
}
