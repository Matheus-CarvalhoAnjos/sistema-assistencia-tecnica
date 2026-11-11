import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, of, Subject, switchMap, tap } from 'rxjs';
import { mensagemDeErro } from '../../app/auth/mensagem-erro';
import { Cliente } from '../../app/models/cliente';
import { ClienteService } from '../../app/services/cliente.service';
import {
  formatarDocumento,
  formatarTelefone,
  rotuloTipoPessoa,
} from '../../app/utils/formatacao';

/** Lista de clientes com busca por nome ou CPF/CNPJ. */
@Component({
  selector: 'app-clientes',
  imports: [RouterLink],
  templateUrl: './clientes.html',
  styleUrls: ['../compartilhado/pagina.css', './clientes.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesPage {
  private readonly clienteService = inject(ClienteService);
  private readonly buscas = new Subject<string>();

  readonly clientes = signal<Cliente[]>([]);
  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly termo = signal('');

  readonly formatarDocumento = formatarDocumento;
  readonly formatarTelefone = formatarTelefone;
  readonly rotuloTipoPessoa = rotuloTipoPessoa;

  constructor() {
    this.buscas
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => {
          this.carregando.set(true);
          this.erro.set(null);
        }),
        switchMap((termo) =>
          this.clienteService.listar(termo).pipe(
            catchError((erro: unknown) => {
              this.erro.set(mensagemDeErro(erro));
              return of<Cliente[]>([]);
            }),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((clientes) => {
        this.clientes.set(clientes);
        this.carregando.set(false);
      });

    this.carregar();
  }

  aoDigitar(evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value;
    this.termo.set(valor);
    this.buscas.next(valor.trim());
  }

  limparBusca(): void {
    this.termo.set('');
    this.buscas.next('');
  }

  /** Recarrega ignorando o filtro de valores repetidos (botão "Tentar novamente"). */
  carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.clienteService.listar(this.termo()).subscribe({
      next: (clientes) => {
        this.clientes.set(clientes);
        this.carregando.set(false);
      },
      error: (erro: unknown) => {
        this.erro.set(mensagemDeErro(erro));
        this.carregando.set(false);
      },
    });
  }
}
