import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { Execucao, OrdemServicoDetalhes, TipoEncerramento } from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { Mensagem, MensagemAcao } from './mensagem-acao';

/** Etapas em que cada encerramento é permitido (RN07/RN08; o backend aplica a mesma regra). */
const ETAPAS: Readonly<Record<TipoEncerramento, readonly string[]>> = {
  IMPOSSIBILIDADE_TECNICA: ['RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO', 'EM_REPARO'],
  DESISTENCIA_CLIENTE: ['RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO'],
};

export const ROTULOS_ENCERRAMENTO: Readonly<Record<string, string>> = {
  IMPOSSIBILIDADE_TECNICA: 'Impossibilidade técnica',
  DESISTENCIA_CLIENTE: 'Desistência do cliente',
  ORCAMENTO_REJEITADO: 'Orçamento rejeitado',
};

/**
 * Encerramento sem reparo.
 * - Impossibilidade técnica: técnico atribuído, com diagnóstico, até EM_REPARO.
 * - Desistência do cliente: ADMINISTRADOR, ATENDENTE ou técnico atribuído, antes do reparo.
 */
@Component({
  selector: 'app-secao-encerramento',
  imports: [MensagemAcao],
  template: `
    @if (opcoes().length) {
      <section class="painel encerramento" aria-labelledby="encerramento-titulo">
        <h2 id="encerramento-titulo">Encerrar sem reparo</h2>
        <p class="dica">Orçamentos e pagamentos pendentes serão cancelados. Pagamentos confirmados são mantidos; não há reembolso automático — a administração ou o atendimento avalia cada caso.</p>

        <form class="formulario" (submit)="$event.preventDefault(); pedirConfirmacao()">
          <fieldset class="campo">
            <legend>Motivo do encerramento *</legend>
            <div class="opcoes">
              @for (opcao of opcoes(); track opcao) {
                <label class="opcao">
                  <input type="radio" name="tipo-encerramento" [value]="opcao" [checked]="tipo() === opcao"
                    (change)="tipo.set(opcao); confirmando.set(false)" />
                  {{ rotulos[opcao] }}
                </label>
              }
            </div>
          </fieldset>
          <div class="campo">
            <label for="campo-justificativa-encerramento">Justificativa *</label>
            <textarea id="campo-justificativa-encerramento" [value]="justificativa()"
              (input)="justificativa.set($any($event.target).value); confirmando.set(false)"
              [attr.aria-invalid]="tentou() && !justificativa().trim()"
              aria-describedby="erro-justificativa-encerramento"></textarea>
            @if (tentou() && !justificativa().trim()) {
              <span class="erro-campo" id="erro-justificativa-encerramento">Informe a justificativa.</span>
            }
          </div>

          @if (confirmando()) {
            <div class="confirmacao" role="group" aria-labelledby="confirmar-encerramento">
              <p id="confirmar-encerramento">
                <strong>Encerrar a OS nº {{ ordem().id_os }} por {{ rotulos[tipo()!].toLowerCase() }}?</strong>
                Esta ação não pode ser desfeita.
              </p>
              <div class="botoes">
                <button class="botao botao-perigo" type="button" (click)="encerrar()" [disabled]="enviando()" [attr.aria-busy]="enviando()">
                  {{ enviando() ? 'Encerrando…' : 'Confirmar encerramento' }}
                </button>
                <button class="botao" type="button" (click)="confirmando.set(false)" [disabled]="enviando()">Voltar</button>
              </div>
            </div>
          } @else {
            <div class="botoes">
              <button class="botao botao-perigo" type="submit">Encerrar sem reparo</button>
            </div>
          }
        </form>

        <app-mensagem-acao [mensagem]="mensagem()" />
      </section>
    } @else if (mensagem()) {
      <app-mensagem-acao [mensagem]="mensagem()" />
    }
  `,
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  styles: `
    .encerramento {
      border-color: rgb(224 96 90 / 45%);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoEncerramento {
  private readonly servico = inject(OrdemServicoService);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly execucao = input<Execucao | null>(null);
  readonly ehTecnico = input(false);
  readonly ehFuncionario = input(false);
  readonly alterado = output<void>();

  readonly rotulos = ROTULOS_ENCERRAMENTO;
  readonly tipo = signal<TipoEncerramento | null>(null);
  readonly justificativa = signal('');
  readonly tentou = signal(false);
  readonly confirmando = signal(false);
  readonly enviando = signal(false);
  readonly mensagem = signal<Mensagem | null>(null);

  /** Tipos disponíveis para o perfil e a etapa atual. */
  readonly opcoes = computed<TipoEncerramento[]>(() => {
    const status = this.ordem().status;
    const lista: TipoEncerramento[] = [];
    if (this.ehTecnico() && !!this.execucao() && ETAPAS.IMPOSSIBILIDADE_TECNICA.includes(status)) {
      lista.push('IMPOSSIBILIDADE_TECNICA');
    }
    if ((this.ehTecnico() || this.ehFuncionario()) && ETAPAS.DESISTENCIA_CLIENTE.includes(status)) {
      lista.push('DESISTENCIA_CLIENTE');
    }
    return lista;
  });

  pedirConfirmacao(): void {
    this.tentou.set(true);
    this.mensagem.set(null);
    if (!this.tipo() || !this.opcoes().includes(this.tipo()!)) {
      this.mensagem.set({ tipo: 'erro', texto: 'Escolha o motivo do encerramento.' });
      return;
    }
    if (!this.justificativa().trim()) return;
    this.confirmando.set(true);
  }

  encerrar(): void {
    const tipo = this.tipo();
    if (!tipo || this.enviando()) return;

    this.enviando.set(true);
    this.servico.encerrarSemReparo(this.ordem().id_os, tipo, this.justificativa().trim()).subscribe({
      next: (resposta) => {
        this.enviando.set(false);
        this.confirmando.set(false);
        const { orcamentos_cancelados: orc, pagamentos_cancelados: pag } = resposta.encerramento;
        const extras = [
          orc.length ? `${orc.length} orçamento(s) pendente(s) cancelado(s)` : '',
          pag.length ? `${pag.length} pagamento(s) pendente(s) cancelado(s)` : '',
        ].filter(Boolean);
        this.mensagem.set({ tipo: 'sucesso', texto: `OS encerrada sem reparo.${extras.length ? ' ' + extras.join('; ') + '.' : ''}` });
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
