import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormArray, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import {
  DecisaoOrcamento,
  Execucao,
  ItemOrcamento,
  Orcamento,
  OrdemServicoDetalhes,
  TipoItemOrcamento,
} from '../../../app/models/ordem-servico';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { formatarDataHora, formatarMoeda } from '../../../app/utils/formatacao-data';
import { Mensagem, MensagemAcao } from './mensagem-acao';

const ROTULOS_STATUS: Readonly<Record<string, { titulo: string; tom: string }>> = {
  PENDENTE: { titulo: 'Aguardando resposta', tom: 'alerta' },
  APROVADO: { titulo: 'Aprovado', tom: 'verde' },
  REJEITADO: { titulo: 'Rejeitado', tom: 'neutro' },
  VENCIDO: { titulo: 'Vencido', tom: 'neutro' },
  CANCELADO: { titulo: 'Cancelado', tom: 'neutro' },
};

const ETAPAS_EMISSAO = ['RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO'];

/** Um orçamento PENDENTE ainda dentro da validade (RN10/RN17). */
export function pendenteVigente(orcamento: Orcamento, agora = Date.now()): boolean {
  return orcamento.status === 'PENDENTE' && new Date(orcamento.data_validade).getTime() > agora;
}

/**
 * Orçamentos da OS: emissão (técnico atribuído ou ADMINISTRADOR) e resposta do
 * cliente (ADMINISTRADOR/ATENDENTE). Só um orçamento PENDENTE por vez (RN17).
 */
@Component({
  selector: 'app-secao-orcamentos',
  imports: [ReactiveFormsModule, MensagemAcao],
  templateUrl: './secao-orcamentos.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  styles: `
    .tabela-itens {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    .tabela-itens th,
    .tabela-itens td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--line-subtle);
      text-align: left;
    }

    .tabela-itens th {
      color: var(--text-secondary);
      font-weight: 600;
    }

    .tabela-itens .numero {
      text-align: right;
      white-space: nowrap;
    }

    @media (max-width: 720px) {
      .tabela-itens {
        display: block;
        overflow-x: auto;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoOrcamentos {
  private readonly servico = inject(OrdemServicoService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  readonly orcamentos = input<Orcamento[]>([]);
  readonly execucao = input<Execucao | null>(null);
  readonly podeEmitirPerfil = input(false);
  readonly podeResponderPerfil = input(false);
  readonly alterado = output<void>();

  readonly formatarMoeda = formatarMoeda;
  readonly formatarDataHora = formatarDataHora;
  readonly enviando = signal(false);
  readonly emitindo = signal(false);
  readonly respondendo = signal<{ id: number; decisao: DecisaoOrcamento } | null>(null);
  readonly observacoes = signal('');
  readonly mensagem = signal<Mensagem | null>(null);

  readonly formOrcamento = this.fb.group({ itens: this.fb.array([this.novoItem()]) });

  get itens(): FormArray {
    return this.formOrcamento.controls.itens;
  }

  readonly pendente = computed(() => this.orcamentos().find((o) => pendenteVigente(o)) ?? null);

  /** Motivo pelo qual a emissão não está disponível (null quando está). */
  readonly bloqueioEmissao = computed(() => {
    const ordem = this.ordem();
    if (!ETAPAS_EMISSAO.includes(ordem.status)) return 'A OS não está em uma etapa que permita orçamento.';
    if (!this.execucao()) return 'Registre o diagnóstico antes de emitir o orçamento.';
    if (ordem.equipamento.garantia_status === 'PENDENTE') return 'Aguardando a verificação da garantia pelo atendente antes do orçamento.';
    // Garantia confirmada: reparo em garantia, sem orçamento e sem cobrança (mesma regra da API)
    if (ordem.equipamento.garantia_status === 'SIM') return 'Equipamento em garantia: o reparo segue sem orçamento e sem cobrança.';
    if (this.pendente()) return 'Já existe um orçamento aguardando resposta.';
    return null;
  });

  readonly podeResponder = computed(
    () => this.podeResponderPerfil() && this.ordem().status === 'AGUARDANDO_APROVACAO' && !!this.pendente(),
  );

  readonly totalPrevisto = signal(0);

  rotuloStatus(status: string): { titulo: string; tom: string } {
    return ROTULOS_STATUS[status] ?? { titulo: status, tom: 'neutro' };
  }

  subtotal(item: ItemOrcamento): number {
    return Number(item.quantidade) * Number(item.valor_unitario);
  }

  abrirEmissao(): void {
    this.itens.clear();
    this.itens.push(this.novoItem());
    this.recalcular();
    this.mensagem.set(null);
    this.emitindo.set(true);
  }

  adicionarItem(): void {
    this.itens.push(this.novoItem());
  }

  removerItem(indice: number): void {
    if (this.itens.length > 1) {
      this.itens.removeAt(indice);
      this.recalcular();
    }
  }

  recalcular(): void {
    const garantia = this.ordem().equipamento.garantia_status === 'SIM';
    const total = (this.itens.getRawValue() as ItemOrcamento[]).reduce((soma, item) => {
      const coberto = garantia && item.tipo_item === 'SERVICO';
      const valor = coberto ? 0 : Number(item.valor_unitario) || 0;
      return soma + valor * (Number(item.quantidade) || 0);
    }, 0);
    this.totalPrevisto.set(Math.round(total * 100) / 100);
  }

  emitir(): void {
    if (this.itens.invalid || this.enviando()) {
      this.itens.markAllAsTouched();
      return;
    }
    const itens = (this.itens.getRawValue() as ItemOrcamento[]).map((item) => ({
      tipo_item: item.tipo_item,
      descricao: item.descricao.trim(),
      quantidade: Number(item.quantidade),
      valor_unitario: Number(item.valor_unitario),
    }));
    this.executar(this.servico.emitirOrcamento(this.ordem().id_os, itens), 'Orçamento emitido (validade de 3 dias).', () =>
      this.emitindo.set(false),
    );
  }

  pedirResposta(id: number, decisao: DecisaoOrcamento): void {
    this.mensagem.set(null);
    this.respondendo.set({ id, decisao });
  }

  confirmarResposta(): void {
    const resposta = this.respondendo();
    if (!resposta) return;
    const texto = resposta.decisao === 'APROVADO' ? 'Orçamento aprovado. O reparo foi iniciado.' : 'Orçamento rejeitado. A OS foi encerrada sem reparo.';
    this.executar(
      this.servico.responderOrcamento(resposta.id, resposta.decisao, this.observacoes().trim() || null),
      texto,
      () => {
        this.respondendo.set(null);
        this.observacoes.set('');
      },
    );
  }

  itemInvalido(indice: number, campo: string): boolean {
    const controle = this.itens.at(indice).get(campo);
    return !!controle && controle.invalid && controle.touched;
  }

  private novoItem() {
    return this.fb.group({
      tipo_item: ['PECA' as TipoItemOrcamento, Validators.required],
      descricao: ['', [Validators.required, Validators.maxLength(255)]],
      quantidade: [1, [Validators.required, Validators.min(1)]],
      valor_unitario: [0, [Validators.required, Validators.min(0)]],
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
