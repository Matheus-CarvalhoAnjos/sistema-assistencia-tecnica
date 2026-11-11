import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  EventoHistorico,
  FORMAS_PAGAMENTO,
  ROTULOS_STATUS_EXPEDICAO,
  STATUS_OS,
} from '../../../app/models/ordem-servico';
import { formatarDataHora, formatarMoeda } from '../../../app/utils/formatacao-data';

export interface EventoDerivado {
  data: string;
  titulo: string;
  detalhe?: string;
}

const TIPOS: Readonly<Record<string, string>> = {
  CRIACAO: 'Criação',
  ATRIBUICAO_TECNICO: 'Técnico',
  DIAGNOSTICO: 'Diagnóstico',
  GARANTIA: 'Garantia',
  ORCAMENTO: 'Orçamento',
  REPARO: 'Reparo',
  ENCERRAMENTO: 'Encerramento',
  PAGAMENTO: 'Pagamento',
  EXPEDICAO: 'Expedição',
  ACESSORIO: 'Acessório',
  ABATIMENTO: 'Abatimento',
};

const CAMPOS: Readonly<Record<string, string>> = {
  status: 'situação',
  status_os: 'OS',
  garantia_status: 'garantia',
  id_tecnico: 'técnico',
  tipo_encerramento: 'tipo',
  motivo_encerramento: 'motivo',
  forma_entrega: 'forma',
  codigo_rastreio: 'rastreio',
  forma_pagamento: 'forma',
  valor: 'valor',
  valor_total: 'valor',
  justificativa_reembolso: 'justificativa',
  motivo: 'motivo',
  justificativa_cancelamento: 'justificativa do cancelamento',
  total_devido: 'total devido',
  saldo: 'saldo',
  valor_reembolso: 'reembolso',
  valor_reembolsado: 'total reembolsado',
  valor_definido: 'valor definido',
  justificativa: 'justificativa',
  motivo_revisao: 'motivo da revisão',
  descricao_acessorio: 'acessório',
  quantidade: 'quantidade',
  observacoes: 'observações',
  laudo_tecnico: 'laudo',
  resultado: 'resultado',
  data_conclusao: 'conclusão',
};

const DATA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Campos com valor em reais: exibidos como moeda (R$). */
const CAMPOS_MOEDA: ReadonlySet<string> = new Set([
  'valor', 'valor_total', 'total_devido', 'saldo', 'valor_reembolso', 'valor_reembolsado', 'valor_definido',
]);

/** Campos com código de domínio: exibidos com o mesmo rótulo usado nas telas. */
const CAMPOS_CODIGO: ReadonlySet<string> = new Set([
  'status', 'status_os', 'garantia_status', 'tipo_encerramento', 'forma_entrega', 'forma_pagamento',
]);

const ROTULOS_CODIGO: Readonly<Record<string, string>> = {
  ...ROTULOS_STATUS_EXPEDICAO,
  ...Object.fromEntries(FORMAS_PAGAMENTO.map((f) => [f.codigo, f.titulo])),
  ...Object.fromEntries(STATUS_OS.map((s) => [s.codigo, s.titulo])),
  PENDENTE: 'Pendente',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
  CONFIRMADO: 'Confirmado',
  REEMBOLSADO: 'Reembolsado',
  SIM: 'Sim',
  NAO: 'Não',
  ENVIO: 'Envio',
  RETIRADA: 'Retirada',
  IMPOSSIBILIDADE_TECNICA: 'Impossibilidade técnica',
  DESISTENCIA_CLIENTE: 'Desistência do cliente',
  ORCAMENTO_REJEITADO: 'Orçamento rejeitado',
};

/** Texto de um valor do histórico conforme o campo (moeda, código, técnico, data ou texto). */
function textoDoValor(campo: string, valor: unknown, nomes: Readonly<Record<number, string>>): string {
  if (valor === null) return '—';
  if (CAMPOS_MOEDA.has(campo) && valor !== '' && !Number.isNaN(Number(valor))) return formatarMoeda(valor as number | string);
  if (CAMPOS_CODIGO.has(campo) && typeof valor === 'string') return ROTULOS_CODIGO[valor] ?? valor;
  if (campo === 'id_tecnico' && (typeof valor === 'number' || typeof valor === 'string')) return nomes[Number(valor)] ?? `nº ${valor}`;
  if (typeof valor === 'string' && DATA_ISO.test(valor)) return formatarDataHora(valor);
  return String(valor);
}

/**
 * Mudanças relevantes de um evento, no formato "campo: anterior → novo".
 * `nomes` traduz o número do técnico (id_tecnico) para o nome, quando conhecido.
 */
export function resumirMudancas(evento: EventoHistorico, nomes: Readonly<Record<number, string>> = {}): string[] {
  const antes = evento.dados_anteriores ?? {};
  const depois = evento.dados_novos ?? {};
  const linhas: string[] = [];

  for (const [campo, rotulo] of Object.entries(CAMPOS)) {
    const novo = depois[campo];
    if (novo === undefined) continue;
    const anterior = antes[campo];
    const texto = (valor: unknown) => textoDoValor(campo, valor, nomes);
    linhas.push(anterior === undefined ? `${rotulo}: ${texto(novo)}` : `${rotulo}: ${texto(anterior)} → ${texto(novo)}`);
  }
  return linhas;
}

/**
 * Histórico da OS (RN21), em ordem cronológica, a partir de GET /historico.
 * OS criadas antes da gravação do histórico não têm eventos: nesse caso a seção
 * mostra a linha do tempo montada a partir dos registros existentes (sem eventos retroativos).
 */
@Component({
  selector: 'app-secao-historico',
  template: `
    <section class="painel" aria-labelledby="historico-titulo">
      <h2 id="historico-titulo">Histórico</h2>

      @if (carregando()) {
        <p class="vazio" role="status">Carregando histórico…</p>
      } @else if (eventos()?.length) {
        <ol class="linha-tempo">
          @for (e of eventos(); track e.id_historico) {
            <li>
              <time [attr.datetime]="e.data_evento">{{ formatarDataHora(e.data_evento) }}</time>
              <span class="topo">
                <span class="etiqueta" data-tom="azul">{{ tipo(e.tipo_evento) }}</span>
                <strong>{{ e.descricao }}</strong>
              </span>
              <span class="secundario">{{ e.nome_usuario ?? 'Automático (sistema)' }}</span>
              @for (linha of mudancas(e); track $index) {
                <span class="secundario">{{ linha }}</span>
              }
            </li>
          }
        </ol>
      } @else {
        @if (falhou()) {
          <p class="aviso aviso-erro">Não foi possível carregar o histórico gravado.</p>
        }
        <ol class="linha-tempo">
          @for (evento of derivados(); track $index) {
            <li>
              <time>{{ formatarDataHora(evento.data) }}</time>
              <strong>{{ evento.titulo }}</strong>
              @if (evento.detalhe) {
                <span class="secundario">{{ evento.detalhe }}</span>
              }
            </li>
          }
        </ol>
        <p class="descricao nota">
          Esta OS não tem eventos gravados (foi aberta antes do histórico). A linha do tempo foi montada a partir dos registros existentes.
        </p>
      }
    </section>
  `,
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css', '../ordem-servico-detalhe.css'],
  styles: `
    .topo {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoHistorico {
  readonly eventos = input<EventoHistorico[] | null>(null);
  readonly derivados = input<EventoDerivado[]>([]);
  readonly carregando = input(false);
  readonly falhou = input(false);
  /** Nomes conhecidos de usuários (por exemplo, técnicos da OS), por id_usuario. */
  readonly nomesUsuarios = input<Readonly<Record<number, string>>>({});

  /** Nomes para traduzir id_tecnico: autores dos próprios eventos + nomes informados pela página. */
  private readonly nomes = computed<Readonly<Record<number, string>>>(() => {
    const mapa: Record<number, string> = {};
    for (const e of this.eventos() ?? []) {
      if (e.id_usuario !== null && e.nome_usuario) mapa[e.id_usuario] = e.nome_usuario;
    }
    return { ...mapa, ...this.nomesUsuarios() };
  });

  readonly formatarDataHora = formatarDataHora;

  tipo(codigo: string): string {
    return TIPOS[codigo] ?? codigo;
  }

  mudancas(evento: EventoHistorico): string[] {
    return resumirMudancas(evento, this.nomes());
  }
}
