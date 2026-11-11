import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { Execucao, OrdemServicoDetalhes, STATUS_FINAIS } from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { formatarDataHora } from '../../../app/utils/formatacao-data';
import { Mensagem, MensagemAcao } from './mensagem-acao';

/** "2026-11-09T10:30" no fuso local, para <input type="datetime-local">. */
export function paraCampoDataHora(valor: string | null | undefined): string {
  if (!valor) return '';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '';
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/**
 * Execução técnica: diagnóstico (RN03), laudo e conclusão do reparo.
 * Registrar e editar: somente o técnico atribuído. Concluir: técnico atribuído ou ADMINISTRADOR.
 */
@Component({
  selector: 'app-secao-execucao',
  imports: [ReactiveFormsModule, MensagemAcao],
  templateUrl: './secao-execucao.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoExecucao {
  private readonly servico = inject(OrdemServicoService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly execucao = input<Execucao | null>(null);
  /** Perfil TECNICO (o backend só entrega ao técnico as OS atribuídas a ele). */
  readonly ehTecnico = input(false);
  readonly ehAdministrador = input(false);
  readonly alterado = output<void>();

  readonly formatarDataHora = formatarDataHora;
  readonly enviando = signal(false);
  readonly editando = signal(false);
  readonly confirmandoConclusao = signal(false);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly formDiagnostico = this.fb.group({
    diagnostico: ['', [Validators.required, Validators.maxLength(65535)]],
  });

  readonly formEdicao = this.fb.group({
    diagnostico: ['', [Validators.required]],
    laudo_tecnico: [''],
    resultado: [''],
    data_conclusao: [''],
  });

  readonly encerrada = computed(() => STATUS_FINAIS.includes(this.ordem().status));
  readonly podeRegistrar = computed(() => this.ehTecnico() && !this.encerrada() && !this.execucao() && !!this.ordem().tecnico);
  readonly podeEditar = computed(() => this.ehTecnico() && !this.encerrada() && !!this.execucao());
  readonly podeConcluir = computed(
    () => (this.ehTecnico() || this.ehAdministrador()) && this.ordem().status === 'EM_REPARO' && !!this.execucao()?.data_conclusao,
  );
  readonly faltaDataConclusao = computed(
    () => this.ordem().status === 'EM_REPARO' && !!this.execucao() && !this.execucao()?.data_conclusao,
  );

  registrar(): void {
    if (this.formDiagnostico.invalid || this.enviando()) {
      this.formDiagnostico.markAllAsTouched();
      return;
    }
    this.executar(
      this.servico.registrarDiagnostico(this.ordem().id_os, this.formDiagnostico.getRawValue().diagnostico.trim()),
      'Diagnóstico registrado. A OS passou para análise.',
      () => this.formDiagnostico.reset(),
    );
  }

  abrirEdicao(): void {
    const e = this.execucao();
    this.formEdicao.reset({
      diagnostico: e?.diagnostico ?? '',
      laudo_tecnico: e?.laudo_tecnico ?? '',
      resultado: e?.resultado ?? '',
      data_conclusao: paraCampoDataHora(e?.data_conclusao),
    });
    this.mensagem.set(null);
    this.editando.set(true);
  }

  salvarEdicao(): void {
    if (this.formEdicao.invalid || this.enviando()) {
      this.formEdicao.markAllAsTouched();
      return;
    }
    const v = this.formEdicao.getRawValue();
    this.executar(
      this.servico.atualizarExecucao(this.ordem().id_os, {
        diagnostico: v.diagnostico.trim(),
        laudo_tecnico: v.laudo_tecnico.trim() || null,
        resultado: v.resultado.trim() || null,
        data_conclusao: v.data_conclusao ? new Date(v.data_conclusao).toISOString() : null,
      }),
      'Execução técnica atualizada.',
      () => this.editando.set(false),
    );
  }

  concluir(): void {
    this.executar(this.servico.concluirReparo(this.ordem().id_os), 'Reparo concluído.', () =>
      this.confirmandoConclusao.set(false),
    );
  }

  invalido(campo: 'diagnostico'): boolean {
    const c = this.formDiagnostico.controls[campo];
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
