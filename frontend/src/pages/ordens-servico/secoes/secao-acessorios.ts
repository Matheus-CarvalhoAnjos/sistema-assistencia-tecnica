import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { mensagemDeErro } from '../../../app/auth/mensagem-erro';
import { OrdemServicoDetalhes } from '../../../app/models/ordem-servico';
import { Acessorio, AcessorioRecebido } from '../../../app/models/solicitacao';
import { AcessorioService } from '../../../app/services/acessorio.service';
import { OrdemServicoService } from '../../../app/services/ordem-servico.service';
import { Mensagem, MensagemAcao } from './mensagem-acao';

/** D7: inclusão e alteração permitidas até o reparo; a partir de CONCLUIDA o registro fica fechado. */
export const ETAPAS_ACESSORIO = ['RECEBIDA', 'EM_ANALISE', 'AGUARDANDO_APROVACAO', 'EM_REPARO'];

/** null = formulário fechado; 0 = novo acessório; id = alteração do acessório recebido. */
type Edicao = number | null;

/**
 * Acessórios recebidos do equipamento da OS: inclusão e alteração depois da abertura (D7).
 * Não há exclusão (não aprovada). Quem pode operar é decidido pela página (ADMINISTRADOR,
 * ATENDENTE ou o técnico atribuído); a API confere de novo a etapa e o técnico e grava o
 * evento ACESSORIO no histórico, com valores anteriores e novos na alteração.
 */
@Component({
  selector: 'app-secao-acessorios',
  imports: [ReactiveFormsModule, MensagemAcao],
  templateUrl: './secao-acessorios.html',
  styleUrls: ['../../compartilhado/pagina.css', './secoes.css'],
  styles: [
    `
      .lista {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        font-size: 13px;
      }
      .lista li {
        display: grid;
        gap: 2px;
      }
      .linha-acessorio {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 6px 10px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecaoAcessorios {
  private readonly servico = inject(OrdemServicoService);
  private readonly acessorios = inject(AcessorioService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly ordem = input.required<OrdemServicoDetalhes>();
  /** Perfil autorizado (ADM, ATD ou técnico atribuído); a etapa é conferida aqui. */
  readonly podeRegistrarPerfil = input(false);
  readonly alterado = output<void>();

  readonly edicao = signal<Edicao>(null);
  readonly enviando = signal(false);
  readonly carregandoCatalogo = signal(false);
  readonly catalogo = signal<Acessorio[]>([]);
  readonly mensagem = signal<Mensagem | null>(null);

  readonly form = this.fb.group({
    id_acessorio: [0, [Validators.required, Validators.min(1)]],
    quantidade: [1, [Validators.required, Validators.min(1)]],
    observacoes: [''],
  });

  readonly podeOperar = computed(() => this.podeRegistrarPerfil() && ETAPAS_ACESSORIO.includes(this.ordem().status));
  /** Mantido para compatibilidade com os testes e a página. */
  readonly podeIncluir = this.podeOperar;
  readonly incluindo = computed(() => this.edicao() === 0);

  /**
   * Opções do catálogo (ativos). Na alteração, o acessório atual continua na lista mesmo
   * que tenha sido desativado depois (só não pode ser escolhido um outro inativo).
   */
  readonly opcoes = computed(() => {
    const id = this.edicao();
    const atual = id ? this.ordem().acessorios.find((a) => a.id_acessorio_recebido === id) : null;
    const lista = this.catalogo();
    if (atual && !lista.some((c) => c.id_acessorio === atual.id_acessorio)) {
      return [{ id_acessorio: atual.id_acessorio, descricao: atual.descricao_acessorio ?? `Acessório nº ${atual.id_acessorio}` }, ...lista];
    }
    return lista;
  });

  abrir(): void {
    this.abrirFormulario(0, { id_acessorio: 0, quantidade: 1, observacoes: '' });
  }

  editar(acessorio: AcessorioRecebido): void {
    this.abrirFormulario(acessorio.id_acessorio_recebido, {
      id_acessorio: acessorio.id_acessorio,
      quantidade: acessorio.quantidade,
      observacoes: acessorio.observacoes ?? '',
    });
  }

  fechar(): void {
    this.edicao.set(null);
  }

  invalido(): boolean {
    const quantidade = Number(this.form.controls.quantidade.value);
    return this.form.touched && (this.form.invalid || !Number.isInteger(quantidade));
  }

  salvar(): void {
    this.form.markAllAsTouched();
    const id = this.edicao();
    if (id === null || this.invalido() || this.enviando()) return;

    const v = this.form.getRawValue();
    const dados = {
      id_acessorio: Number(v.id_acessorio),
      quantidade: Number(v.quantidade),
      observacoes: v.observacoes.trim() || null,
    };
    const requisicao: Observable<{ mensagem: string }> = id === 0
      ? this.servico.registrarAcessorios(this.ordem().id_os, [dados])
      : this.servico.alterarAcessorio(this.ordem().id_os, id, dados);

    this.enviando.set(true);
    this.mensagem.set(null);
    requisicao.subscribe({
      next: (resposta) => {
        this.enviando.set(false);
        this.edicao.set(null);
        this.mensagem.set({ tipo: 'sucesso', texto: id === 0 ? 'Acessório registrado.' : resposta.mensagem });
        this.alterado.emit();
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
      },
    });
  }

  private abrirFormulario(edicao: number, valores: { id_acessorio: number; quantidade: number; observacoes: string }): void {
    this.form.reset(valores);
    this.mensagem.set(null);
    this.edicao.set(edicao);
    if (!this.catalogo().length) {
      this.carregandoCatalogo.set(true);
      this.acessorios.listarAtivos().subscribe({
        next: (lista) => {
          this.catalogo.set(lista);
          this.carregandoCatalogo.set(false);
        },
        error: (erro: unknown) => {
          this.carregandoCatalogo.set(false);
          this.edicao.set(null);
          this.mensagem.set({ tipo: 'erro', texto: mensagemDeErro(erro) });
        },
      });
    }
  }
}
