import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, Subject, switchMap } from 'rxjs';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import { Cliente } from '../../app/models/cliente';
import { Acessorio, SolicitacaoCriada, SolicitacaoEntrada } from '../../app/models/solicitacao';
import { AcessorioService } from '../../app/services/acessorio.service';
import { ClienteService } from '../../app/services/cliente.service';
import { SolicitacaoService } from '../../app/services/solicitacao.service';
import { formatarDocumento, formatarTelefone } from '../../app/utils/formatacao';

const MAX_EQUIPAMENTOS = 20;

type GrupoAcessorio = FormGroup<{
  id_acessorio: FormControl<number | null>;
  quantidade: FormControl<number>;
  observacoes: FormControl<string>;
}>;

type GrupoEquipamento = FormGroup<{
  tipo_equipamento: FormControl<string>;
  marca: FormControl<string>;
  modelo: FormControl<string>;
  numero_serie: FormControl<string>;
  estado_fisico: FormControl<string>;
  observacoes: FormControl<string>;
  acessorios: FormArray<GrupoAcessorio>;
}>;

/** Campo obrigatório que não aceita só espaços. */
function textoObrigatorio(controle: AbstractControl) {
  return typeof controle.value === 'string' && controle.value.trim() ? null : { required: true };
}

/**
 * Abertura de solicitação: cliente, problema relatado, equipamentos e acessórios.
 * A consulta posterior é feita pelas Ordens de Serviço geradas.
 */
@Component({
  selector: 'app-nova-solicitacao',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './nova-solicitacao.html',
  styleUrls: ['../compartilhado/pagina.css', './nova-solicitacao.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NovaSolicitacaoPage implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly clienteService = inject(ClienteService);
  private readonly acessorioService = inject(AcessorioService);
  private readonly solicitacaoService = inject(SolicitacaoService);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  private readonly buscasCliente = new Subject<string>();

  /** Query param ?cliente=ID (volta do cadastro de cliente). */
  readonly cliente = input<string>();

  readonly maxEquipamentos = MAX_EQUIPAMENTOS;
  readonly formatarDocumento = formatarDocumento;
  readonly formatarTelefone = formatarTelefone;

  // Cliente
  readonly clienteSelecionado = signal<Cliente | null>(null);
  readonly termoCliente = signal('');
  readonly sugestoes = signal<Cliente[]>([]);
  readonly buscandoClientes = signal(false);

  // Catálogo de acessórios
  readonly catalogo = signal<Acessorio[]>([]);
  readonly carregandoCatalogo = signal(true);
  readonly erroCatalogo = signal<string | null>(null);

  // Formulário
  readonly aberto = signal(0);
  readonly tentouEnviar = signal(false);
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly resultado = signal<SolicitacaoCriada | null>(null);

  readonly formulario = this.fb.group({
    descricao_inicial: ['', textoObrigatorio],
    itens: this.fb.array<GrupoEquipamento>([this.novoEquipamento()]),
  });

  get itens(): FormArray<GrupoEquipamento> {
    return this.formulario.controls.itens;
  }

  constructor() {
    this.buscasCliente
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((termo) => {
          if (termo.length < 2) {
            this.buscandoClientes.set(false);
            return of<Cliente[]>([]);
          }
          this.buscandoClientes.set(true);
          return this.clienteService.listar(termo).pipe(catchError(() => of<Cliente[]>([])));
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((clientes) => {
        this.sugestoes.set(clientes.slice(0, 8));
        this.buscandoClientes.set(false);
      });
  }

  ngOnInit(): void {
    this.carregarCatalogo();

    const id = Number(this.cliente());
    if (Number.isInteger(id) && id > 0) {
      this.clienteService.buscarPorId(id).subscribe({
        next: (cliente) => this.clienteSelecionado.set(cliente),
        error: () => undefined, // segue sem cliente pré-selecionado
      });
    }
  }

  carregarCatalogo(): void {
    this.carregandoCatalogo.set(true);
    this.erroCatalogo.set(null);
    this.acessorioService.listarAtivos().subscribe({
      next: (acessorios) => {
        this.catalogo.set(acessorios);
        this.carregandoCatalogo.set(false);
      },
      error: (erro: unknown) => {
        this.erroCatalogo.set(mensagemDeErro(erro));
        this.carregandoCatalogo.set(false);
      },
    });
  }

  // ---------- Cliente ----------

  aoBuscarCliente(evento: Event): void {
    const termo = (evento.target as HTMLInputElement).value;
    this.termoCliente.set(termo);
    this.buscasCliente.next(termo.trim());
  }

  selecionarCliente(cliente: Cliente): void {
    this.clienteSelecionado.set(cliente);
    this.sugestoes.set([]);
    this.termoCliente.set('');
    this.buscasCliente.next('');
  }

  trocarCliente(): void {
    this.clienteSelecionado.set(null);
    this.focarDepois('#busca-cliente');
  }

  // ---------- Equipamentos e acessórios ----------

  acessoriosDe(indice: number): FormArray<GrupoAcessorio> {
    return this.itens.at(indice).controls.acessorios;
  }

  adicionarEquipamento(): void {
    if (this.itens.length >= MAX_EQUIPAMENTOS) {
      return;
    }
    this.itens.push(this.novoEquipamento());
    this.aberto.set(this.itens.length - 1);
    this.focarDepois(`#eq-${this.itens.length - 1}-tipo_equipamento`);
  }

  removerEquipamento(indice: number): void {
    if (this.itens.length === 1) {
      return;
    }
    const preenchido = Object.values(this.itens.at(indice).getRawValue()).some((valor) =>
      Array.isArray(valor) ? valor.length > 0 : String(valor).trim() !== '',
    );
    if (preenchido && !window.confirm(`Remover o equipamento ${indice + 1}?`)) {
      return;
    }
    this.itens.removeAt(indice);
    this.aberto.set(Math.min(this.aberto(), this.itens.length - 1));
  }

  alternar(indice: number): void {
    this.aberto.set(this.aberto() === indice ? -1 : indice);
  }

  adicionarAcessorio(indice: number): void {
    this.acessoriosDe(indice).push(
      this.fb.group({
        id_acessorio: this.fb.control<number | null>(null, Validators.required),
        quantidade: this.fb.control(1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
        observacoes: this.fb.control('', Validators.maxLength(255)),
      }) as GrupoAcessorio,
    );
  }

  removerAcessorio(indice: number, posicao: number): void {
    this.acessoriosDe(indice).removeAt(posicao);
  }

  /** Resumo de uma linha mostrado no cartão recolhido. */
  resumo(indice: number): string {
    const { tipo_equipamento, marca, modelo, acessorios } = this.itens.at(indice).getRawValue();
    const descricao = [tipo_equipamento, [marca, modelo].filter(Boolean).join(' ')]
      .map((parte) => parte.trim())
      .filter(Boolean)
      .join(' · ');
    const qtd = acessorios.length;
    const textoAcessorios = qtd ? ` · ${qtd} ${qtd === 1 ? 'acessório' : 'acessórios'}` : '';
    return (descricao || 'Não preenchido') + textoAcessorios;
  }

  errosNoEquipamento(indice: number): number {
    if (!this.tentouEnviar()) {
      return 0;
    }
    const grupo = this.itens.at(indice);
    const proprios = Object.entries(grupo.controls).filter(
      ([nome, controle]) => nome !== 'acessorios' && controle.invalid,
    ).length;
    const acessorios = grupo.controls.acessorios.controls.filter((c) => c.invalid).length;
    return proprios + acessorios;
  }

  /** Mensagem de validação de um controle, após tocar no campo ou tentar enviar. */
  mensagem(controle: AbstractControl, rotulo: string): string | null {
    if (!controle.invalid || !(controle.touched || this.tentouEnviar())) {
      return null;
    }
    const erros = controle.errors ?? {};
    if (erros['required']) return `Informe ${rotulo}.`;
    if (erros['maxlength']) {
      return `Use no máximo ${(erros['maxlength'] as { requiredLength: number }).requiredLength} caracteres.`;
    }
    if (erros['min'] || erros['pattern']) return 'Informe um número inteiro maior que zero.';
    return 'Valor inválido.';
  }

  // ---------- Envio ----------

  abrirSolicitacao(): void {
    this.tentouEnviar.set(true);
    this.erro.set(null);

    const cliente = this.clienteSelecionado();
    if (!cliente) {
      this.focar('#busca-cliente');
      return;
    }

    if (this.formulario.invalid || this.enviando()) {
      this.formulario.markAllAsTouched();
      this.focarPrimeiroInvalido();
      return;
    }

    const valores = this.formulario.getRawValue();
    const dados: SolicitacaoEntrada = {
      id_cliente: cliente.id_cliente,
      descricao_inicial: valores.descricao_inicial.trim(),
      itens: valores.itens.map((item) => ({
        tipo_equipamento: item.tipo_equipamento.trim(),
        marca: item.marca.trim(),
        modelo: item.modelo.trim(),
        numero_serie: item.numero_serie.trim() || null,
        estado_fisico: item.estado_fisico.trim(),
        observacoes: item.observacoes.trim() || null,
        acessorios: item.acessorios.map((acessorio) => ({
          id_acessorio: Number(acessorio.id_acessorio),
          quantidade: Number(acessorio.quantidade),
          observacoes: acessorio.observacoes.trim() || null,
        })),
      })),
    };

    this.enviando.set(true);
    this.solicitacaoService.criar(dados).subscribe({
      next: (resposta) => {
        this.enviando.set(false);
        this.resultado.set(resposta.solicitacao);
        this.focarDepois('#resultado-titulo');
      },
      error: (erro: unknown) => {
        this.enviando.set(false);
        this.erro.set(mensagemDeErro(erro));
        this.focarDepois('.aviso-erro');
      },
    });
  }

  /** Limpa tudo para abrir outra solicitação. */
  novaSolicitacao(): void {
    this.resultado.set(null);
    this.clienteSelecionado.set(null);
    this.tentouEnviar.set(false);
    this.erro.set(null);
    this.formulario.reset();
    this.itens.clear();
    this.itens.push(this.novoEquipamento());
    this.aberto.set(0);
  }

  descricaoAcessorio(id: number | null): string {
    return this.catalogo().find((a) => a.id_acessorio === id)?.descricao ?? '';
  }

  private novoEquipamento(): GrupoEquipamento {
    return this.fb.group({
      tipo_equipamento: ['', [textoObrigatorio, Validators.maxLength(100)]],
      marca: ['', [textoObrigatorio, Validators.maxLength(100)]],
      modelo: ['', [textoObrigatorio, Validators.maxLength(100)]],
      numero_serie: ['', Validators.maxLength(100)],
      estado_fisico: ['', textoObrigatorio],
      observacoes: [''],
      acessorios: this.fb.array<GrupoAcessorio>([]),
    });
  }

  private focarPrimeiroInvalido(): void {
    if (this.formulario.controls.descricao_inicial.invalid) {
      this.focar('#descricao_inicial');
      return;
    }
    const indice = this.itens.controls.findIndex((grupo) => grupo.invalid);
    if (indice >= 0) {
      this.aberto.set(indice);
      this.focarDepois(`#equipamento-${indice} [aria-invalid="true"]`);
    }
  }

  private focar(seletor: string): void {
    this.elemento.nativeElement.querySelector<HTMLElement>(seletor)?.focus();
  }

  /** Move o foco depois que a tela for atualizada (o elemento pode ainda não existir). */
  private focarDepois(seletor: string): void {
    afterNextRender(() => this.focar(seletor), { injector: this.injector });
  }
}
