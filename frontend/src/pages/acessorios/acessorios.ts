import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import { Acessorio } from '../../app/models/solicitacao';
import { AcessorioService } from '../../app/services/acessorio.service';

/** Converte "35,50", "35.50" ou "1.234,50" em número; texto vazio vira null. */
export function lerPreco(valor: string): number | null {
  const texto = valor.trim().replace(/\s/g, '');
  if (!texto) {
    return null;
  }
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto;
  return /^\d+(\.\d{1,2})?$/.test(normalizado) ? Number(normalizado) : Number.NaN;
}

function precoValido(controle: AbstractControl): ValidationErrors | null {
  const preco = lerPreco(String(controle.value ?? ''));
  if (preco === null) {
    return null;
  }
  return Number.isNaN(preco) || preco > 99999999.99 ? { preco: true } : null;
}

function textoObrigatorio(controle: AbstractControl): ValidationErrors | null {
  return String(controle.value ?? '').trim() ? null : { required: true };
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Catálogo de acessórios usado na abertura de solicitações (ADMINISTRADOR e ATENDENTE). */
@Component({
  selector: 'app-acessorios',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './acessorios.html',
  styleUrls: ['../compartilhado/pagina.css', './acessorios.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcessoriosPage implements OnInit {
  private readonly acessorioService = inject(AcessorioService);
  private readonly elemento: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);

  readonly acessorios = signal<Acessorio[]>([]);
  readonly carregando = signal(true);
  readonly erroLista = signal<string | null>(null);

  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly sucesso = signal<string | null>(null);
  readonly tentouEnviar = signal(false);

  readonly formulario = inject(NonNullableFormBuilder).group({
    descricao: ['', [textoObrigatorio, Validators.maxLength(150)]],
    preco_atual: ['', precoValido],
  });

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.erroLista.set(null);
    this.acessorioService.listarAtivos().subscribe({
      next: (acessorios) => {
        this.acessorios.set(acessorios);
        this.carregando.set(false);
      },
      error: (erro: unknown) => {
        this.erroLista.set(mensagemDeErro(erro));
        this.carregando.set(false);
      },
    });
  }

  formatarPreco(preco: Acessorio['preco_atual']): string {
    return preco === null || preco === undefined ? '—' : MOEDA.format(Number(preco));
  }

  mensagemCampo(campo: 'descricao' | 'preco_atual'): string | null {
    const controle = this.formulario.controls[campo];
    if (!controle.invalid || !(controle.touched || this.tentouEnviar())) {
      return null;
    }
    const erros = controle.errors ?? {};
    if (erros['servidor']) return erros['servidor'] as string;
    if (erros['required']) return 'Informe a descrição do acessório.';
    if (erros['maxlength']) return 'A descrição deve ter no máximo 150 caracteres.';
    if (erros['preco']) return 'Informe um valor como 35,90 (ou deixe em branco).';
    return 'Valor inválido.';
  }

  cadastrar(): void {
    this.tentouEnviar.set(true);
    this.erro.set(null);
    this.sucesso.set(null);

    if (this.formulario.invalid || this.enviando()) {
      this.formulario.markAllAsTouched();
      const campo = this.formulario.controls.descricao.invalid ? 'descricao' : 'preco_atual';
      this.focar(`#acessorio-${campo}`);
      return;
    }

    const { descricao, preco_atual } = this.formulario.getRawValue();
    this.enviando.set(true);
    this.acessorioService
      .criar({ descricao: descricao.trim(), preco_atual: lerPreco(preco_atual) })
      .subscribe({
        next: (resposta) => {
          this.enviando.set(false);
          this.acessorios.update((lista) =>
            [...lista, resposta.acessorio].sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')),
          );
          this.sucesso.set(`Acessório "${resposta.acessorio.descricao}" cadastrado.`);
          this.tentouEnviar.set(false);
          this.formulario.reset();
          this.focar('#acessorio-descricao');
        },
        error: (erro: unknown) => {
          this.enviando.set(false);
          if (erro instanceof HttpErrorResponse && erro.status === 409) {
            const descricao = this.formulario.controls.descricao;
            descricao.setErrors({ servidor: mensagemDeErro(erro) });
            descricao.markAsTouched();
            this.focar('#acessorio-descricao');
            return;
          }
          this.erro.set(mensagemDeErro(erro));
        },
      });
  }

  private focar(seletor: string): void {
    afterNextRender(
      () => this.elemento.nativeElement.querySelector<HTMLElement>(seletor)?.focus(),
      { injector: this.injector },
    );
  }
}
