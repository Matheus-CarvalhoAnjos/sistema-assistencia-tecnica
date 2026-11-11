import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface Mensagem {
  tipo: 'sucesso' | 'erro';
  texto: string;
}

/** Resultado de uma ação (anunciado por leitores de tela). */
@Component({
  selector: 'app-mensagem-acao',
  template: `
    @if (mensagem(); as m) {
      <p
        class="aviso"
        [class.aviso-sucesso]="m.tipo === 'sucesso'"
        [class.aviso-erro]="m.tipo === 'erro'"
        [attr.role]="m.tipo === 'erro' ? 'alert' : 'status'"
      >
        {{ m.texto }}
      </p>
    }
  `,
  styleUrls: ['../../compartilhado/pagina.css'],
  styles: `
    .aviso {
      margin: 12px 0 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MensagemAcao {
  readonly mensagem = input<Mensagem | null>(null);
}
