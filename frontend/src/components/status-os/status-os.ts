import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { rotuloStatus, STATUS_OS } from '../../app/models/ordem-servico';

/** Selo com o status da Ordem de Serviço em português. */
@Component({
  selector: 'app-status-os',
  template: `<span class="selo" [attr.data-tom]="tom()">{{ rotulo() }}</span>`,
  styles: `
    .selo {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border: 1px solid var(--accent-blue);
      border-radius: 999px;
      color: var(--text-primary);
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .selo::before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-blue-highlight);
      content: '';
    }

    .selo[data-tom='green'] {
      border-color: var(--accent-green);
    }

    .selo[data-tom='green']::before {
      background: var(--accent-green);
    }

    .selo[data-tom='neutral'] {
      border-color: var(--line-default);
    }

    .selo[data-tom='neutral']::before {
      background: var(--text-secondary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusOs {
  readonly status = input.required<string>();

  readonly rotulo = computed(() => rotuloStatus(this.status()));
  readonly tom = computed(() => STATUS_OS.find((s) => s.codigo === this.status())?.tom ?? 'neutral');
}
