import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { OrdemServicoDetalhes } from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { Mensagem, MensagemAcao } from './mensagem-acao';

export const ROTULOS_GARANTIA: Readonly<Record<string, string>> = {
  PENDENTE: 'Pendente de verificação',
  SIM: 'Em garantia',
  NAO: 'Fora da garantia',
};

/**
 * Garantia da OS (RN05/RN06): verificada pelo ATENDENTE durante EM_ANALISE, antes do
 * orçamento (a API confere o perfil). Não volta para PENDENTE.
 * - SIM: a OS segue direto para o reparo em garantia, sem orçamento e sem cobrança.
 * - NAO: segue o fluxo normal de orçamento pelo técnico.
 * TÉCNICO e ADMINISTRADOR apenas consultam a situação.
 */
@Component({
  selector: 'app-secao-garantia',
  imports: [MensagemAcao],
  template: `
    <section class="painel" aria-labelledby="garantia-titulo">
      <h2 id="garantia-titulo">Garantia</h2>
      <p class="valor-garantia">
        <span class="etiqueta" [attr.data-tom]="tom()">{{ rotulo() }}</span>
      </p>

      @if (podeAlterar()) {
        <fieldset class="campo formulario">
          <legend>{{ atual() === 'PENDENTE' ? 'Verificar garantia' : atual() === 'SIM' ? 'Confirmar garantia' : 'Corrigir garantia' }}</legend>
          <div class="opcoes" role="radiogroup" aria-label="Situação da garantia">
            @for (opcao of opcoes; track opcao.codigo) {
              <label class="opcao">
                <input
                  type="radio"
                  name="garantia"
                  [value]="opcao.codigo"
                  [checked]="escolha() === opcao.codigo"
                  (change)="escolha.set(opcao.codigo)"
                />
                {{ opcao.titulo }}
              </label>
            }
          </div>
          <p class="dica">
            Em garantia: a OS segue direto para o reparo, sem orçamento e sem cobrança.
            Fora da garantia: o técnico elabora o orçamento.
          </p>
          <div class="botoes">
            <button
              class="botao botao-primario"
              type="button"
              (click)="salvar()"
              [disabled]="!podeSalvar() || enviando()"
              [attr.aria-busy]="enviando()"
            >
              {{ enviando() ? 'Salvando…' : 'Salvar garantia' }}
            </button>
          </div>
        </fieldset>
      } @else if (ehAtendente() && ordem().status === 'RECEBIDA') {
        <p class="dica">A garantia é verificada com a OS em análise, depois do diagnóstico do técnico.</p>
      } @else if (!ehAtendente() && atual() === 'PENDENTE' && ['RECEBIDA', 'EM_ANALISE'].includes(ordem().status)) {
        <p class="dica">Aguardando a verificação da garantia pelo atendente.</p>
      } @else if (atual() === 'SIM' && ordem().status === 'EM_ANALISE') {
        <p class="dica">Garantia herdada: aguardando a confirmação pelo atendente para iniciar o reparo em garantia.</p>
      }

      <app-mensagem-acao [mensagem]="mensagem()" />
    </section>
  `,
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  styles: `
    .valor-garantia {
      margin: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoGarantia {
  private readonly servico = inject(OrdemServicoService);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly ehAtendente = input(false);
  readonly alterado = output<void>();

  readonly opcoes = [
    { codigo: 'SIM' as const, titulo: 'Em garantia' },
    { codigo: 'NAO' as const, titulo: 'Fora da garantia' },
  ];

  readonly escolha = signal<'SIM' | 'NAO' | null>(null);
  readonly enviando = signal(false);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly atual = computed(() => this.ordem().equipamento.garantia_status);
  readonly rotulo = computed(() => ROTULOS_GARANTIA[this.atual()] ?? this.atual());
  readonly tom = computed(() => ({ SIM: 'verde', NAO: 'neutro' })[this.atual()] ?? 'alerta');
  readonly podeAlterar = computed(() => this.ehAtendente() && this.ordem().status === 'EM_ANALISE');
  /** Salvar exige uma mudança, exceto confirmar um SIM herdado (que inicia o reparo em garantia). */
  readonly podeSalvar = computed(() => {
    const escolha = this.escolha();
    return !!escolha && (escolha !== this.atual() || escolha === 'SIM');
  });

  salvar(): void {
    const garantia = this.escolha();
    if (!garantia || this.enviando()) return;

    this.enviando.set(true);
    this.mensagem.set(null);
    this.servico.definirGarantia(this.ordem().id_os, garantia).subscribe({
      next: () => {
        this.enviando.set(false);
        this.escolha.set(null);
        this.mensagem.set({
          tipo: 'sucesso',
          texto:
            garantia === 'SIM'
              ? 'Garantia registrada: Em garantia. Reparo em garantia iniciado, sem orçamento e sem cobrança.'
              : `Garantia registrada: ${ROTULOS_GARANTIA[garantia]}.`,
        });
        this.alterado.emit();
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }
}
